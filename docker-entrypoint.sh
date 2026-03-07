#!/bin/sh
set -e

echo "OpenResiApp — starting up..."

# Wait for PostgreSQL to be ready
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

# Run migrations
echo "Running database migrations..."
npx drizzle-kit migrate
echo "Migrations complete."

# Start the app
echo "Starting Next.js server..."
exec node server.js
