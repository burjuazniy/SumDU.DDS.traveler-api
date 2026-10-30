#!/usr/bin/env bash
# Shard server bootstrap: creates this server's vnode databases (SHARD_DBS="db_0 db_1 ...") with the
# application schema, and a non-superuser application role that only gets DML privileges.
# (The superuser stays for the admin tools; a superuser would ignore the REVOKE that the
# rebalancing tool uses to tell the application that a vnode has moved.)
set -euo pipefail
: "${SHARD_DBS:?}" "${APP_DB_USER:?}" "${APP_DB_PASSWORD:?}"

psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d postgres \
  -v app_user="$APP_DB_USER" -v app_password="$APP_DB_PASSWORD" <<'SQL'
CREATE ROLE :"app_user" LOGIN PASSWORD :'app_password';
SQL

for db in $SHARD_DBS; do
  echo "creating ${db}"
  psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d postgres -c "CREATE DATABASE ${db}"
  for f in /migrations/*.sql; do
    psql -v ON_ERROR_STOP=1 -q -U "$POSTGRES_USER" -d "$db" -f "$f"
  done
  psql -v ON_ERROR_STOP=1 -q -U "$POSTGRES_USER" -d "$db" -v app_user="$APP_DB_USER" <<'SQL'
GRANT CONNECT ON DATABASE :"DBNAME" TO :"app_user";
GRANT USAGE ON SCHEMA public TO :"app_user";
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO :"app_user";
SQL
done
