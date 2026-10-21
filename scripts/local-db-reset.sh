#!/usr/bin/env bash
# Rebuild the local test database from the legacy schema + forward migrations.
set -euo pipefail
DB="${ALLIN_DB_URL:-postgres://postgres@127.0.0.1:54329/allin_test}"
ADMIN="${ALLIN_ADMIN_DB_URL:-postgres://postgres@127.0.0.1:54329/postgres}"
psql "$ADMIN" -v ON_ERROR_STOP=1 -q -c "drop database if exists allin_test with (force);" -c "create database allin_test;"
psql "$DB" -v ON_ERROR_STOP=1 -q -f supabase/local/bootstrap_local.sql
psql "$DB" -v ON_ERROR_STOP=1 -q -f supabase/local/legacy_schema.sql
for f in supabase/migrations/*.sql; do
  case "$f" in *cron*) continue;; esac
  psql "$DB" -v ON_ERROR_STOP=1 -q -f "$f"
done
echo "local db ready: $DB"
