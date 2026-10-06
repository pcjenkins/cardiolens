#!/bin/sh
set -e
# First start only: create and seed the database on the volume. Later starts keep existing data.
if [ ! -f "$DB_PATH" ]; then
  echo "No database at $DB_PATH - seeding demo data"
  node --no-warnings scripts/seed.mjs
fi
exec node server.js
