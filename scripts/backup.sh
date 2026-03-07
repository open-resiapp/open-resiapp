#!/bin/bash
# OpenResiApp — Database & uploads backup script
# Usage: ./scripts/backup.sh
# Recommended: run daily via cron
#   0 3 * * * /path/to/open-resiapp/scripts/backup.sh >> /var/log/resiapp-backup.log 2>&1

set -euo pipefail

# --- Configuration ---
BACKUP_DIR="${BACKUP_DIR:-/backups/resiapp}"
COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.prod.yml}"
DB_CONTAINER="$(docker compose -f "$COMPOSE_FILE" ps -q db 2>/dev/null || echo "")"
KEEP_DAILY=7
KEEP_WEEKLY=4
DATE=$(date +%F)
TIMESTAMP=$(date +%F_%H%M%S)

# --- Helpers ---
log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*"; }

die() {
  log "ERROR: $*"
  exit 1
}

# --- Preflight ---
if [ -z "$DB_CONTAINER" ]; then
  die "Database container not found. Is docker compose running?"
fi

mkdir -p "$BACKUP_DIR/daily" "$BACKUP_DIR/weekly"

# --- Database backup ---
log "Starting database backup..."
DUMP_FILE="$BACKUP_DIR/daily/db_${TIMESTAMP}.sql.gz"

docker exec "$DB_CONTAINER" pg_dump -U postgres --no-owner --clean resiapp \
  | gzip > "$DUMP_FILE"

DUMP_SIZE=$(du -h "$DUMP_FILE" | cut -f1)
log "Database backup complete: $DUMP_FILE ($DUMP_SIZE)"

# --- Uploads backup ---
log "Starting uploads backup..."
UPLOADS_FILE="$BACKUP_DIR/daily/uploads_${TIMESTAMP}.tar.gz"

docker compose -f "$COMPOSE_FILE" cp app:/app/uploads - \
  | gzip > "$UPLOADS_FILE" 2>/dev/null || log "WARN: No uploads to backup or container not running"

log "Uploads backup complete: $UPLOADS_FILE"

# --- Weekly backup (keep one per Sunday) ---
if [ "$(date +%u)" -eq 7 ]; then
  log "Sunday — creating weekly backup copy..."
  cp "$DUMP_FILE" "$BACKUP_DIR/weekly/db_${TIMESTAMP}.sql.gz"
  [ -f "$UPLOADS_FILE" ] && cp "$UPLOADS_FILE" "$BACKUP_DIR/weekly/uploads_${TIMESTAMP}.tar.gz"
fi

# --- Cleanup old backups ---
log "Cleaning up old backups..."

# Remove daily backups older than KEEP_DAILY days
find "$BACKUP_DIR/daily" -name "*.gz" -mtime +${KEEP_DAILY} -delete 2>/dev/null || true

# Remove weekly backups older than KEEP_WEEKLY weeks
find "$BACKUP_DIR/weekly" -name "*.gz" -mtime +$((KEEP_WEEKLY * 7)) -delete 2>/dev/null || true

log "Backup complete. Daily: $(ls "$BACKUP_DIR/daily"/*.gz 2>/dev/null | wc -l | tr -d ' ') files, Weekly: $(ls "$BACKUP_DIR/weekly"/*.gz 2>/dev/null | wc -l | tr -d ' ') files"