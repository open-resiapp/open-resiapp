#!/bin/bash
# OpenResiApp — Initial Hetzner server setup
# Run this ONCE on a fresh Hetzner server as root
# Usage: ssh root@your-server 'bash -s' < scripts/hetzner-setup.sh

set -euo pipefail

log() { echo "[SETUP] $*"; }

# --- System updates ---
log "Updating system packages..."
apt update && apt upgrade -y

# --- Firewall (ufw as fallback — also set up Hetzner Cloud Firewall in console) ---
log "Setting up firewall..."
apt install -y ufw
ufw default deny incoming
ufw default allow outgoing
ufw allow 22/tcp   # SSH
ufw allow 80/tcp   # HTTP
ufw allow 443/tcp  # HTTPS
ufw --force enable
log "Firewall enabled: SSH(22), HTTP(80), HTTPS(443)"

# --- Automatic security updates ---
log "Setting up unattended upgrades..."
apt install -y unattended-upgrades
dpkg-reconfigure -plow unattended-upgrades

# --- SSH hardening ---
log "Hardening SSH..."
SSHD_CONFIG="/etc/ssh/sshd_config"

# Disable password auth (assumes you've already added your SSH key)
sed -i 's/^#*PasswordAuthentication.*/PasswordAuthentication no/' "$SSHD_CONFIG"
sed -i 's/^#*PermitRootLogin.*/PermitRootLogin prohibit-password/' "$SSHD_CONFIG"
sed -i 's/^#*ChallengeResponseAuthentication.*/ChallengeResponseAuthentication no/' "$SSHD_CONFIG"

systemctl restart sshd
log "SSH hardened: password auth disabled, root login via key only"

# --- Create app user ---
log "Creating deploy user..."
if ! id "deploy" &>/dev/null; then
  adduser --disabled-password --gecos "" deploy
  usermod -aG docker deploy 2>/dev/null || true
  mkdir -p /home/deploy/.ssh
  cp /root/.ssh/authorized_keys /home/deploy/.ssh/
  chown -R deploy:deploy /home/deploy/.ssh
  chmod 700 /home/deploy/.ssh
  chmod 600 /home/deploy/.ssh/authorized_keys
  log "User 'deploy' created with your SSH key"
else
  log "User 'deploy' already exists"
fi

# --- Install Docker ---
log "Installing Docker..."
if ! command -v docker &>/dev/null; then
  curl -fsSL https://get.docker.com | sh
  systemctl enable docker
  usermod -aG docker deploy
  log "Docker installed"
else
  log "Docker already installed"
fi

# --- Create backup directory ---
mkdir -p /backups/resiapp/daily /backups/resiapp/weekly
chown -R deploy:deploy /backups
log "Backup directory created at /backups/resiapp"

# --- Docker log rotation ---
log "Configuring Docker log rotation..."
cat > /etc/docker/daemon.json <<'EOF'
{
  "log-driver": "json-file",
  "log-opts": {
    "max-size": "10m",
    "max-file": "3"
  }
}
EOF
systemctl restart docker

# --- Setup backup cron ---
log "Setting up daily backup cron for deploy user..."
CRON_LINE="0 3 * * * cd /home/deploy/open-resiapp && /home/deploy/open-resiapp/scripts/backup.sh >> /var/log/resiapp-backup.log 2>&1"
(crontab -u deploy -l 2>/dev/null || true; echo "$CRON_LINE") | sort -u | crontab -u deploy -
log "Backup cron set: daily at 3:00 AM"

log ""
log "=== Setup complete ==="
log "Next steps:"
log "  1. Set up Hetzner Cloud Firewall in the console (allow 22, 80, 443)"
log "  2. SSH in as deploy: ssh deploy@your-server"
log "  3. Clone your repo: git clone <repo-url> ~/open-resiapp"
log "  4. Create .env file: cp .env.example .env && nano .env"
log "  5. Generate secrets:"
log "     POSTGRES_PASSWORD: openssl rand -base64 32"
log "     NEXTAUTH_SECRET: openssl rand -base64 64"
log "  6. Deploy: docker compose -f docker-compose.prod.yml up -d --build"
log "     (Migrations run automatically on startup)"
log "  7. Seed (optional): docker compose -f docker-compose.prod.yml exec app node -e \"require('./drizzle/seed.js')\""