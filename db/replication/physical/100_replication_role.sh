#!/usr/bin/env bash
# Primary: replication role (credentials from environment) and pg_hba hardening.
# The stock image ends pg_hba.conf with "host all all all scram-sha-256" (any address);
# here every TCP rule is limited to the compose network ("samenet").
set -euo pipefail
: "${REPL_USER:?REPL_USER is required}" "${REPL_PASSWORD:?REPL_PASSWORD is required}"

psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
  -v repl_user="$REPL_USER" -v repl_password="$REPL_PASSWORD" <<'SQL'
CREATE ROLE :"repl_user" WITH LOGIN REPLICATION PASSWORD :'repl_password';
SQL

sed -i -E 's/^host\s+all\s+all\s+all\s+scram-sha-256/host all all samenet scram-sha-256/' "${PGDATA}/pg_hba.conf"
echo "host replication ${REPL_USER} samenet scram-sha-256" >> "${PGDATA}/pg_hba.conf"
