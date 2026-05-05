#!/bin/sh
set -e

echo "OpenResiApp — starting up..."

# ── Wait for PostgreSQL to be ready ─────────────────────────────
echo "Waiting for database..."
until node -e "
  const { Client } = require('pg');
  const c = new Client({ connectionString: process.env.DATABASE_URL });
  c.connect().then(() => { c.end(); process.exit(0); }).catch(() => process.exit(1));
" 2>/dev/null; do
  echo "  Database not ready, retrying in 2s..."
  sleep 2
done
echo "Database is ready."

# ── Pre-migration backup ────────────────────────────────────────
# Skips if there are no pending migrations (cheap restart) or if the
# operator opts out via DISABLE_PREMIGRATION_BACKUP=1. Backups go to
# /app/backups, which should be a mounted volume in production so the
# dumps survive container removal. Retention keeps the last
# PREMIGRATION_BACKUP_RETENTION dumps (default 5).
BACKUP_DIR="/app/backups"
RETENTION="${PREMIGRATION_BACKUP_RETENTION:-5}"

if [ "${DISABLE_PREMIGRATION_BACKUP:-0}" = "1" ]; then
  echo "Pre-migration backup disabled via DISABLE_PREMIGRATION_BACKUP=1."
else
  PENDING=$(node -e "
    const { Client } = require('pg');
    const fs = require('fs');
    const journal = JSON.parse(fs.readFileSync('./drizzle/meta/_journal.json', 'utf8'));
    const c = new Client({ connectionString: process.env.DATABASE_URL });
    c.connect()
      .then(async () => {
        try {
          const r = await c.query(\"SELECT COUNT(*)::int AS c FROM drizzle.__drizzle_migrations\");
          console.log(journal.entries.length - r.rows[0].c);
        } catch (e) {
          // Table doesn't exist yet — fresh install, all migrations pending.
          console.log(journal.entries.length);
        } finally {
          await c.end();
        }
      })
      .catch(() => { console.log('0'); });
  " 2>/dev/null || echo "0")

  if [ "$PENDING" -gt 0 ]; then
    mkdir -p "$BACKUP_DIR"
    STAMP=$(date -u +"%Y%m%d-%H%M%SZ")
    DUMP_FILE="$BACKUP_DIR/pre-migrate-${STAMP}.dump"
    echo "Pre-migration backup: $PENDING pending migration(s). Dumping to $DUMP_FILE..."
    if pg_dump --format=custom --file="$DUMP_FILE" "$DATABASE_URL"; then
      SIZE=$(wc -c < "$DUMP_FILE" 2>/dev/null || echo "?")
      echo "Backup complete (${SIZE} bytes)."
    else
      echo "ERROR: pg_dump failed. Aborting startup to protect data." >&2
      echo "Set DISABLE_PREMIGRATION_BACKUP=1 to bypass (NOT recommended for production)." >&2
      exit 1
    fi

    # Retention: keep the newest $RETENTION dumps, delete older ones.
    KEEP=$(ls -1t "$BACKUP_DIR"/pre-migrate-*.dump 2>/dev/null | head -n "$RETENTION")
    for f in "$BACKUP_DIR"/pre-migrate-*.dump; do
      [ -f "$f" ] || continue
      if ! echo "$KEEP" | grep -qx "$f"; then
        rm -f "$f"
        echo "Pruned old backup: $f"
      fi
    done
  else
    echo "No pending migrations; skipping pre-migration backup."
  fi
fi

# ── Run migrations ──────────────────────────────────────────────
echo "Running database migrations..."
npx drizzle-kit migrate
echo "Migrations complete."

# ── Start the app ───────────────────────────────────────────────
echo "Starting Next.js server..."
exec node server.js
