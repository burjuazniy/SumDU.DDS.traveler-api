#!/usr/bin/env bash
# Subscriber (replica): the schema comes from db/migrations (logical replication does not copy DDL),
# then a subscription to the publisher copies existing rows and streams new changes.
set -euo pipefail
: "${REPL_USER:?}" "${REPL_PASSWORD:?}" "${PRIMARY_HOST:=postgres}"

until pg_isready -h "$PRIMARY_HOST" -p 5432 -U "$REPL_USER" -d "$POSTGRES_DB" -q; do
  echo "waiting for publisher ${PRIMARY_HOST}..."; sleep 2
done

psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" <<SQL
CREATE SUBSCRIPTION travel_sub
  CONNECTION 'host=${PRIMARY_HOST} port=5432 dbname=${POSTGRES_DB} user=${REPL_USER} password=${REPL_PASSWORD}'
  PUBLICATION travel_pub
  WITH (copy_data = true, create_slot = true, slot_name = 'travel_sub_slot');
SQL
