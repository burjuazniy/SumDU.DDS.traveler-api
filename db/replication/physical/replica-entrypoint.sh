#!/usr/bin/env bash
# Standby bootstrap: on first start clone the primary with pg_basebackup (own replication slot,
# standby.signal), then run the stock postgres entrypoint, which skips initdb for a non-empty PGDATA.
set -euo pipefail
: "${PRIMARY_HOST:?}" "${REPL_USER:?}" "${REPL_PASSWORD:?}" "${REPLICA_NAME:?}"

if [ ! -s "$PGDATA/PG_VERSION" ]; then
  until pg_isready -h "$PRIMARY_HOST" -p 5432 -q; do
    echo "waiting for primary ${PRIMARY_HOST}..."; sleep 2
  done
  export PGPASSWORD="$REPL_PASSWORD"
  mkdir -p "$PGDATA" && chmod 700 "$PGDATA"
  pg_basebackup -h "$PRIMARY_HOST" -p 5432 -U "$REPL_USER" -D "$PGDATA" \
    -X stream -R -C -S "$REPLICA_NAME" --checkpoint=fast --progress
  # application_name identifies this standby in synchronous_standby_names on the primary
  cat >> "$PGDATA/postgresql.auto.conf" <<CONF
primary_conninfo = 'host=${PRIMARY_HOST} port=5432 user=${REPL_USER} password=${REPL_PASSWORD} application_name=${REPLICA_NAME}'
primary_slot_name = '${REPLICA_NAME}'
CONF
  unset PGPASSWORD
fi

exec docker-entrypoint.sh postgres "$@"
