# OpenResiApp

[![Docker Hub](https://img.shields.io/docker/v/ipk0/open-resiapp?label=Docker%20Hub&sort=semver)](https://hub.docker.com/r/ipk0/open-resiapp)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![GitHub Discussions](https://img.shields.io/github/discussions/open-resiapp/open-resiapp)](https://github.com/open-resiapp/open-resiapp/discussions)

Open-source web application for managing residential apartment buildings (bytove domy) in Slovakia. Built for building administrators, owners, and tenants.

**Self-hosted. Free. No vendor lock-in.** Deploy with one `docker compose up` command and manage your building in minutes.

## Features

- **Weighted Voting** — Three methods (by share, by flat, by area), three quorum types, SHA-256 audited votes
- **Paper Ballots** — Vote counter enters ballots for elderly residents with photo proof
- **Mandates** — Power of attorney delegation per § 14(5) of Act 182/1993
- **Board** — Announcements with categories (info, urgent, event, maintenance), per-entrance targeting
- **Owner Management** — Five roles: admin, owner, tenant, vote counter, caretaker
- **PDF Minutes** — Auto-generated voting minutes with audit log and QR code
- **Documents** — Upload and share building documents
- **Multi-language** — Slovak and English UI
- **Settings** — Building configuration, entrances, flats with ownership shares

## Docker Image

```bash
docker pull ipk0/open-resiapp:latest
```

Available on [Docker Hub](https://hub.docker.com/r/ipk0/open-resiapp). Supports `linux/amd64` and `linux/arm64`.

## Quick Deploy (5 minutes)

You need a VPS with Docker installed (any provider — Hetzner, AWS, Azure, DigitalOcean).

### Option A: Automated setup (recommended)

```bash
mkdir open-resiapp && cd open-resiapp
curl -O https://raw.githubusercontent.com/open-resiapp/open-resiapp/main/setup.sh
chmod +x setup.sh
./setup.sh              # asks domain + building name, generates secrets
docker compose up -d
```

The script generates secure passwords, creates `.env` and `docker-compose.yml` — no manual secret management needed.

### Option B: Manual setup

<details>
<summary>Click to expand manual instructions</summary>

**1. Create `docker-compose.yml`:**

```yaml
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
```

**2. Create `.env`:**

```bash
APP_NAME="Bytove spolocenstvo Hlavna 12"
APP_URL=https://yourdomain.sk
APP_DOMAIN=yourdomain.sk
POSTGRES_PASSWORD=$(openssl rand -base64 32 | tr -d '/+=')
NEXTAUTH_SECRET=$(openssl rand -base64 32 | tr -d '/+=')
```

**3. Deploy:**

```bash
docker compose up -d
```

</details>

### Create admin account

```bash
docker compose exec app npx tsx src/scripts/create-admin.ts \
  --email admin@yourdomain.sk --name "Your Name"
```

That's it. Database migrations run automatically on startup. HTTPS is handled by Caddy.

## Update

```bash
docker compose pull
docker compose up -d
```

This pulls the latest image and restarts the app. Database migrations run automatically — no manual steps needed.

## Backup

### Automated backup

```bash
# Inside your project directory, create backup script
docker compose exec db pg_dump -U postgres resiapp | gzip > backup_$(date +%Y%m%d).sql.gz
```

Add to cron for daily backups:

```bash
(crontab -l 2>/dev/null; echo "0 3 * * * cd /path/to/project && docker compose exec -T db pg_dump -U postgres resiapp | gzip > /backups/resiapp_\$(date +\%Y\%m\%d).sql.gz") | crontab -
```

### Restore

```bash
gunzip < backup_20260309.sql.gz | docker compose exec -T db psql -U postgres resiapp
```

## Development

### Prerequisites

- Node.js 20+
- PostgreSQL 16 (or Docker)

### Setup

```bash
git clone https://github.com/open-resiapp/open-resiapp.git
cd open-resiapp
npm install
docker compose up db        # start PostgreSQL
npm run db:generate
npm run db:migrate
npm run db:seed
npm run dev                 # http://localhost:3000
```

### Seed Credentials

| Role  | Email          | Password   |
|-------|----------------|------------|
| Admin | admin@test.sk  | Admin123!  |
| Owner | jan@test.sk    | Admin123!  |
| Owner | maria@test.sk  | Admin123!  |

### Scripts

| Command              | Description                    |
|----------------------|--------------------------------|
| `npm run dev`        | Start development server       |
| `npm run build`      | Build for production           |
| `npm run lint`       | Run ESLint                     |
| `npm run db:generate`| Generate Drizzle migrations    |
| `npm run db:migrate` | Run database migrations        |
| `npm run db:seed`    | Seed database with test data   |
| `npm run db:studio`  | Open Drizzle Studio            |

## Tech Stack

- **Next.js 16** (App Router) + TypeScript
- **Tailwind CSS**
- **PostgreSQL 16** + Drizzle ORM
- **NextAuth v5** (credentials provider)
- **next-intl** (i18n)
- **Docker** + Caddy

## Community

- **[GitHub Discussions](https://github.com/open-resiapp/open-resiapp/discussions)** — ask questions, share ideas, show your setup
- **[Issues](https://github.com/open-resiapp/open-resiapp/issues)** — report bugs and track feature requests

We communicate in both Slovak and English. Use whichever you're comfortable with.

## Contributing

Contributions are welcome! Whether it's bug fixes, new features, translations, or documentation — every bit helps.

See **[CONTRIBUTING.md](CONTRIBUTING.md)** for the full guide, or jump straight in:

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/my-feature`)
3. Make your changes (code in English, UI text via translation files)
4. Open a Pull Request

## License

[MIT License](LICENSE)