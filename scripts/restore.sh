#!/bin/bash
# BytováApp — Database restore script
# Usage: ./scripts/restore.sh /backups/bytapp/daily/db_2026-03-04_030000.sql.gz

set -euo pipefail

COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.prod.yml}"
DB_CONTAINER="$(docker compose -f "$COMPOSE_FILE" ps -q db 2>/dev/null || echo "")"

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*"; }

die() {
  log "ERROR: $*"
  exit 1
}

# --- Validate input ---
BACKUP_FILE="${1:-}"
if [ -z "$BACKUP_FILE" ]; then
  die "Usage: $0 <backup-file.sql.gz>"
fi

if [ ! -f "$BACKUP_FILE" ]; then
  die "Backup file not found: $BACKUP_FILE"
fi

if [ -z "$DB_CONTAINER" ]; then
  die "Database container not found. Is docker compose running?"
fi

# --- Confirm ---
echo ""
echo "WARNING: This will OVERWRITE the current database with:"
echo "  $BACKUP_FILE"
echo ""
read -p "Type 'yes' to continue: " CONFIRM
if [ "$CONFIRM" != "yes" ]; then
  echo "Aborted."
  exit 0
fi

# --- Restore ---
log "Restoring database from: $BACKUP_FILE"

gunzip -c "$BACKUP_FILE" | docker exec -i "$DB_CONTAINER" psql -U postgres -d bytapp --quiet

log "Database restore complete."
log "Restart the app to pick up changes: docker compose -f $COMPOSE_FILE restart app"