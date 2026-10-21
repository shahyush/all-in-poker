#!/usr/bin/env bash
# Rebuild a local database from the legacy schema + forward migrations.
#   usage: scripts/local-db-reset.sh [dbname]   (default allin_test; the dev server uses allin_dev so test runs never reset it)
set -euo pipefail
NAME="${1:-allin_test}"
ADMIN="${ALLIN_ADMIN_DB_URL:-postgres://postgres@127.0.0.1:54329/postgres}"
DB="${ADMIN%/*}/$NAME"
psql "$ADMIN" -v ON_ERROR_STOP=1 -q -c "drop database if exists $NAME with (force);" -c "create database $NAME;"
psql "$DB" -v ON_ERROR_STOP=1 -q -f supabase/local/bootstrap_local.sql
psql "$DB" -v ON_ERROR_STOP=1 -q -f supabase/local/legacy_schema.sql
for f in supabase/migrations/*.sql; do
  case "$f" in *cron*) continue;; esac
  psql "$DB" -v ON_ERROR_STOP=1 -q -f "$f"
done
echo "local db ready: $DB"
