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

# ── PostgreSQL client/server version check ──────────────────────
# pg_dump refuses to dump a server whose major is NEWER than the client
# (forward-incompatible direction). We surface both majors on every boot
# so the version state is always visible in CloudWatch.
#
# Expected steady state is matched majors (image client == RDS server).
# The skip path below is a FALLBACK, not the norm: on 2026-05-07 a server
# upgrade to PG17 against a PG16 client image aborted startup on every
# customer instance (504s until the image was rebuilt). When the client
# is older than the server we skip the pre-migration backup — a
# defense-in-depth snapshot, not a hard requirement to migrate — rather
# than brick the instance. Per-DB S3 backups remain the wider safety net.
# Set FORCE_PREMIGRATION_BACKUP=1 to restore strict abort-on-skew.
SERVER_VERSION_NUM=$(psql "$DATABASE_URL" -tAc "SHOW server_version_num")
SERVER_MAJOR=$((SERVER_VERSION_NUM / 10000))
CLIENT_MAJOR=$(pg_dump --version | grep -oE '[0-9]+' | head -1)
echo "PostgreSQL client (pg_dump) major: ${CLIENT_MAJOR}"
echo "PostgreSQL server major:           ${SERVER_MAJOR}"

if [ "$CLIENT_MAJOR" -lt "$SERVER_MAJOR" ]; then
  if [ "${FORCE_PREMIGRATION_BACKUP:-0}" = "1" ]; then
    echo "WARNING: pg_dump client (${CLIENT_MAJOR}) older than server (${SERVER_MAJOR})." >&2
    echo "WARNING: FORCE_PREMIGRATION_BACKUP=1 set — attempting the dump anyway (likely to abort)." >&2
  else
    echo "WARNING: ═══════════════════════════════════════════════════════════════"
    echo "WARNING: pg_dump client (${CLIENT_MAJOR}) is OLDER than server (${SERVER_MAJOR})."
    echo "WARNING: pg_dump cannot dump a newer server — skipping pre-migration backup."
    echo "WARNING: Migrations WILL still run. Per-DB S3 backups remain the safety net."
    echo "WARNING: Rebuild the image with postgresql${SERVER_MAJOR}-client to restore backups."
    echo "WARNING: ═══════════════════════════════════════════════════════════════"
    DISABLE_PREMIGRATION_BACKUP=1
  fi
fi

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
      SIZE=$(wc -c < "$DUMP_FILE" 2>/dev/null || echo "0")
      if [ "$SIZE" -lt 1024 ]; then
        echo "ERROR: pg_dump produced a suspiciously small file (${SIZE} bytes < 1KB)." >&2
        echo "ERROR: Treating as a failed backup. Aborting startup to protect data." >&2
        rm -f "$DUMP_FILE"
        exit 1
      fi
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
