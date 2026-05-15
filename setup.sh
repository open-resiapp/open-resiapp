#!/usr/bin/env bash
set -euo pipefail

# OpenResiApp — One-Command Setup
# Generates config, starts services, creates admin account

echo ""
echo "  OpenResiApp — Setup"
echo "  ==================="
echo ""

# ─── Detect OS ───

detect_os() {
  if [[ -f /etc/os-release ]]; then
    . /etc/os-release
    OS_ID="${ID:-unknown}"
    OS_ID_LIKE="${ID_LIKE:-}"
  elif [[ "$(uname)" == "Darwin" ]]; then
    OS_ID="macos"
    OS_ID_LIKE=""
  else
    OS_ID="unknown"
    OS_ID_LIKE=""
  fi
}

is_debian_based() {
  [[ "$OS_ID" == "debian" || "$OS_ID" == "ubuntu" || "$OS_ID_LIKE" == *"debian"* || "$OS_ID_LIKE" == *"ubuntu"* ]]
}

is_rhel_based() {
  [[ "$OS_ID" == "centos" || "$OS_ID" == "rhel" || "$OS_ID" == "fedora" || "$OS_ID" == "rocky" || "$OS_ID" == "almalinux" || "$OS_ID_LIKE" == *"rhel"* || "$OS_ID_LIKE" == *"fedora"* ]]
}

detect_os

# ─── Check and install prerequisites ───

install_openssl() {
  echo "  Installing openssl..."
  if is_debian_based; then
    sudo apt-get update -qq && sudo apt-get install -y -qq openssl > /dev/null
  elif is_rhel_based; then
    sudo dnf install -y -q openssl > /dev/null 2>&1 || sudo yum install -y -q openssl > /dev/null 2>&1
  elif [[ "$OS_ID" == "alpine" ]]; then
    sudo apk add --quiet openssl
  elif [[ "$OS_ID" == "macos" ]]; then
    echo "  openssl should come with macOS. Try: brew install openssl"
    exit 1
  else
    echo "  Error: Cannot auto-install openssl on this OS ($OS_ID)."
    echo "  Install it manually and re-run this script."
    exit 1
  fi
  echo "  openssl installed."
}

install_docker() {
  echo "  Installing Docker..."
  if is_debian_based || is_rhel_based; then
    # Official Docker install script — works on most Linux distros
    curl -fsSL https://get.docker.com | sh
    sudo systemctl enable --now docker
    # Add current user to docker group so they don't need sudo
    if [[ -n "${SUDO_USER:-}" ]]; then
      sudo usermod -aG docker "$SUDO_USER"
    else
      sudo usermod -aG docker "$USER"
    fi
    echo ""
    echo "  Docker installed."
    echo "  NOTE: You may need to log out and back in for docker group to take effect."
    echo "        Or run: newgrp docker"
    echo ""
  elif [[ "$OS_ID" == "macos" ]]; then
    echo "  On macOS, install Docker Desktop from: https://www.docker.com/products/docker-desktop/"
    exit 1
  else
    echo "  Error: Cannot auto-install Docker on this OS ($OS_ID)."
    echo "  Install manually: https://docs.docker.com/engine/install/"
    exit 1
  fi
}

# Check openssl
if ! command -v openssl &> /dev/null; then
  echo "  openssl not found."
  read -rp "  Install it now? [Y/n]: " INSTALL_OPENSSL
  if [[ "$INSTALL_OPENSSL" == "n" || "$INSTALL_OPENSSL" == "N" ]]; then
    echo "  Aborted. openssl is required."
    exit 1
  fi
  install_openssl
fi
echo "  [ok] openssl"

# Check docker
if ! command -v docker &> /dev/null; then
  echo "  Docker not found."
  read -rp "  Install it now? [Y/n]: " INSTALL_DOCKER
  if [[ "$INSTALL_DOCKER" == "n" || "$INSTALL_DOCKER" == "N" ]]; then
    echo "  Aborted. Docker is required."
    exit 1
  fi
  install_docker
fi
echo "  [ok] docker"

# Check docker compose
if ! docker compose version &> /dev/null; then
  echo "  Docker Compose plugin not found."
  echo "  Installing docker-compose-plugin..."
  if is_debian_based; then
    sudo apt-get update -qq && sudo apt-get install -y -qq docker-compose-plugin > /dev/null
  elif is_rhel_based; then
    sudo dnf install -y -q docker-compose-plugin > /dev/null 2>&1 || sudo yum install -y -q docker-compose-plugin > /dev/null 2>&1
  else
    echo "  Error: Cannot auto-install Docker Compose on this OS ($OS_ID)."
    echo "  Install it: https://docs.docker.com/compose/install/"
    exit 1
  fi
  if ! docker compose version &> /dev/null; then
    echo "  Error: Docker Compose installation failed."
    echo "  Install it manually: https://docs.docker.com/compose/install/"
    exit 1
  fi
  echo "  docker-compose-plugin installed."
fi
echo "  [ok] docker compose"

echo ""

# ─── Collect input ───

echo "  Answer a few questions to configure your instance."
echo ""

read -rp "  Domain (e.g. dom.example.sk): " APP_DOMAIN
if [[ -z "$APP_DOMAIN" ]]; then
  echo "  Error: Domain is required."
  exit 1
fi

read -rp "  Community name (e.g. Bytove spolocenstvo Hlavna 12): " APP_NAME
APP_NAME="${APP_NAME:-OpenResiApp Community}"

read -rp "  Language — sk or en [sk]: " LANGUAGE
LANGUAGE="${LANGUAGE:-sk}"

# ─── Community template (BYT-20260515-001) ───
echo ""
echo "  Pick the community template that best matches your use case."
echo "  This seeds the entity kinds, default voting method, and starter"
echo "  tree shape. Press Enter for the default (hoa)."
echo ""
echo "    Residential & housing"
echo "     1) hoa                  HOA / Residential building   (default)"
echo "     2) cottage              Cottage settlement"
echo "     3) street               Street with houses"
echo "     4) mobile_home_park     Mobile home park"
echo ""
echo "    Land & nature"
echo "     5) garden               Garden community"
echo "     6) urbar                Land commons (urbar)"
echo "     7) apiary               Beekeeping association"
echo "     8) hunting_association  Hunting association"
echo "     9) fishing_cooperative  Fishing cooperative"
echo ""
echo "    Commercial & shared"
echo "    10) garage               Garage building"
echo "    11) storage_units        Storage units facility"
echo "    12) office_building      Office building"
echo "    13) coworking            Coworking space"
echo "    14) industrial_park      Industrial park"
echo "    15) marina               Marina / boat club"
echo ""
echo "    Social & civic"
echo "    16) sports_club          Sports club"
echo "    17) parents_association  School parents association"
echo "    18) religious_community  Religious community / parish"
echo "    19) cemetery             Cemetery plots"
echo ""
echo "    20) custom               Custom (empty — configure via UI)"
echo ""
read -rp "  Template [hoa]: " INSTALL_TEMPLATE
INSTALL_TEMPLATE="${INSTALL_TEMPLATE:-hoa}"

# Validate against the known slug list. Keep in sync with
# src/lib/templates/*.json.
VALID_TEMPLATES=(hoa cottage street mobile_home_park garden urbar apiary \
  hunting_association fishing_cooperative garage storage_units office_building \
  coworking industrial_park marina sports_club parents_association \
  religious_community cemetery custom)
TEMPLATE_OK=false
for t in "${VALID_TEMPLATES[@]}"; do
  if [[ "$INSTALL_TEMPLATE" == "$t" ]]; then TEMPLATE_OK=true; break; fi
done
if [[ "$TEMPLATE_OK" != "true" ]]; then
  echo "  Error: Unknown template '${INSTALL_TEMPLATE}'."
  echo "  Run setup.sh again and pick one of: ${VALID_TEMPLATES[*]}"
  exit 1
fi

if [[ "$LANGUAGE" != "sk" && "$LANGUAGE" != "en" ]]; then
  echo "  Error: Language must be 'sk' or 'en'."
  exit 1
fi

read -rp "  Admin email (e.g. admin@${APP_DOMAIN}): " ADMIN_EMAIL
if [[ -z "$ADMIN_EMAIL" ]]; then
  ADMIN_EMAIL="admin@${APP_DOMAIN}"
  echo "  Using default: ${ADMIN_EMAIL}"
fi

read -rp "  Admin name (e.g. Jan Novak): " ADMIN_NAME
if [[ -z "$ADMIN_NAME" ]]; then
  echo "  Error: Admin name is required."
  exit 1
fi

# ─── Generate secrets ───

echo ""
echo "  Generating secrets..."

POSTGRES_PASSWORD=$(openssl rand -base64 32 | tr -d '/+=' | head -c 40)
NEXTAUTH_SECRET=$(openssl rand -base64 32 | tr -d '/+=' | head -c 40)

APP_URL="https://${APP_DOMAIN}"

# ─── Write .env ───

if [[ -f ".env" ]]; then
  read -rp "  .env already exists. Overwrite? [y/N]: " OVERWRITE
  if [[ "$OVERWRITE" != "y" && "$OVERWRITE" != "Y" ]]; then
    echo "  Aborted. Existing .env was not changed."
    exit 0
  fi
fi

cat > .env <<EOF
# OpenResiApp — generated by setup.sh on $(date +%Y-%m-%d)
APP_NAME="${APP_NAME}"
APP_URL=${APP_URL}
APP_DOMAIN=${APP_DOMAIN}
LANGUAGE=${LANGUAGE}
INSTALL_TEMPLATE=${INSTALL_TEMPLATE}
POSTGRES_PASSWORD=${POSTGRES_PASSWORD}
NEXTAUTH_SECRET=${NEXTAUTH_SECRET}
EOF

chmod 600 .env
echo "  Created .env"

# ─── Write docker-compose.yml ───

if [[ ! -f "docker-compose.yml" ]]; then
  cat > docker-compose.yml <<'COMPOSE'
services:
  db:
    image: postgres:16-alpine
    restart: unless-stopped
    environment:
      POSTGRES_DB: resiapp
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
    volumes:
      - postgres_data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U postgres"]
      interval: 10s
      timeout: 5s
      retries: 5

  app:
    image: ipk0/open-resiapp:latest
    restart: unless-stopped
    depends_on:
      db:
        condition: service_healthy
    environment:
      DATABASE_URL: postgresql://postgres:${POSTGRES_PASSWORD}@db:5432/resiapp
      NEXTAUTH_SECRET: ${NEXTAUTH_SECRET}
      NEXTAUTH_URL: ${APP_URL}
      AUTH_TRUST_HOST: "true"
      APP_NAME: ${APP_NAME:-Bytove spolocenstvo}
      LANGUAGE: ${LANGUAGE:-sk}
    volumes:
      - uploads:/app/uploads

  caddy:
    image: caddy:2-alpine
    restart: unless-stopped
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - caddy_data:/data
    depends_on:
      - app
    command: caddy reverse-proxy --from ${APP_DOMAIN} --to app:3000

volumes:
  postgres_data:
  uploads:
  caddy_data:
COMPOSE
  echo "  Created docker-compose.yml"
else
  echo "  docker-compose.yml already exists, skipping"
fi

# ─── Start services ───

echo ""
echo "  Starting services (this may take a minute on first run)..."
echo ""

docker compose pull --quiet
docker compose up -d

# ─── Wait for app to be healthy ───

echo ""
echo "  Waiting for app to be ready..."

MAX_WAIT=120
WAITED=0

while [[ $WAITED -lt $MAX_WAIT ]]; do
  # Check if the app container is running and responding
  if docker compose exec -T app node -e "
    const http = require('http');
    const req = http.get('http://localhost:3000', (res) => {
      process.exit(res.statusCode < 500 ? 0 : 1);
    });
    req.on('error', () => process.exit(1));
    req.setTimeout(3000, () => { req.destroy(); process.exit(1); });
  " 2>/dev/null; then
    echo "  App is ready!"
    break
  fi

  sleep 3
  WAITED=$((WAITED + 3))
  echo "  Still waiting... (${WAITED}s)"
done

if [[ $WAITED -ge $MAX_WAIT ]]; then
  echo ""
  echo "  Warning: App did not respond within ${MAX_WAIT}s."
  echo "  Check logs with: docker compose logs app"
  echo ""
  echo "  You can create the admin account manually later:"
  echo "    docker compose exec app npx tsx src/scripts/create-admin.ts \\"
  echo "      --email ${ADMIN_EMAIL} --name \"${ADMIN_NAME}\""
  exit 1
fi

# ─── Create admin account ───

echo ""
echo "  Creating admin account..."
echo ""

docker compose exec -T app npx tsx src/scripts/create-admin.ts \
  --email "$ADMIN_EMAIL" --name "$ADMIN_NAME"

# ─── Bootstrap community from template (BYT-20260515-001) ───

echo ""
echo "  Bootstrapping community from template '${INSTALL_TEMPLATE}'..."
echo ""

docker compose exec -T app npx tsx src/scripts/bootstrap-community.ts \
  --template "$INSTALL_TEMPLATE" \
  --name "$APP_NAME" \
  --locale "$LANGUAGE"

# ─── Done ───

echo ""
echo "  ================================================"
echo "  OpenResiApp is running!"
echo "  ================================================"
echo ""
echo "  URL:       ${APP_URL}"
echo "  Community: ${APP_NAME}"
echo "  Template:  ${INSTALL_TEMPLATE}"
echo "  Language:  ${LANGUAGE}"
echo ""
echo "  Admin:    ${ADMIN_EMAIL}"
echo "  Password: (printed above — save it now!)"
echo ""
echo "  Open ${APP_URL} in your browser and log in."
echo ""
echo "  ────────────────────────────────────────────────"
echo "  Useful commands:"
echo ""
echo "    Update:  docker compose pull && docker compose up -d"
echo "    Logs:    docker compose logs -f app"
echo "    Backup:  docker compose exec db pg_dump -U postgres resiapp | gzip > backup_\$(date +%Y%m%d).sql.gz"
echo "    Stop:    docker compose down"
echo ""
