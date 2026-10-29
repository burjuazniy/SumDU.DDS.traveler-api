#!/usr/bin/env bash
# Synchronous replication (lab 4, step 3). Set through ALTER SYSTEM at the end of initdb, not as a
# command-line flag: during initdb no standby exists yet, so a synchronous setting would make every
# commit of the init scripts wait forever. The value takes effect when the real server starts.
set -euo pipefail
if [ -n "${SYNC_STANDBYS:-}" ]; then
  psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
    -c "ALTER SYSTEM SET synchronous_standby_names = '${SYNC_STANDBYS}'" \
    -c "ALTER SYSTEM SET synchronous_commit = 'on'"
fi
