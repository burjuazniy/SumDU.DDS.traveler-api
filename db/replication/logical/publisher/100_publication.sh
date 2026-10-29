#!/usr/bin/env bash
# Publisher (primary): replication role from environment, publication for all tables,
# pg_hba rule that lets only that role connect from the compose network.
set -euo pipefail
: "${REPL_USER:?REPL_USER is required}" "${REPL_PASSWORD:?REPL_PASSWORD is required}"

psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
  -v repl_user="$REPL_USER" -v repl_password="$REPL_PASSWORD" <<'SQL'
CREATE ROLE :"repl_user" WITH LOGIN REPLICATION PASSWORD :'repl_password';
GRANT SELECT ON ALL TABLES IN SCHEMA public TO :"repl_user";
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO :"repl_user";
CREATE PUBLICATION travel_pub FOR ALL TABLES;
SQL

echo "host ${POSTGRES_DB} ${REPL_USER} samenet scram-sha-256" >> "${PGDATA}/pg_hba.conf"
