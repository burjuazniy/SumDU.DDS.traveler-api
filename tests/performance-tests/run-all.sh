#!/usr/bin/env bash
# Runs load, stress, spike and endurance tests one after another against $API_URL.
# Per test: HTML dashboard with charts, aggregated recording (ndjson.gz, see timeline.js)
# and the end-of-test summary (JSON + text).
cd "$(dirname "$0")"
TAG=${TAG:-native}
for t in ${TESTS:-load stress spike endurance}; do
  echo "=== $t ($TAG) $(date +%T)"
  K6_WEB_DASHBOARD=true K6_WEB_DASHBOARD_PERIOD=10s \
  K6_WEB_DASHBOARD_EXPORT=reports/$t-$TAG.html K6_WEB_DASHBOARD_RECORD=reports/$t-$TAG.ndjson.gz \
    k6 run --quiet --summary-export reports/$t-$TAG-summary.json tests/$t-test.js > reports/$t-$TAG.txt 2>&1
  echo "exit $? $(date +%T)"
  sleep 20  # let the API and PostgreSQL settle between tests
done
