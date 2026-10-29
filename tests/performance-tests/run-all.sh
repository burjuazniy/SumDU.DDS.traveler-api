#!/usr/bin/env bash
# Runs load, stress, spike and endurance tests one after another against $API_URL.
# Per test: HTML dashboard, end-of-test summary (JSON + text) and raw metrics (json.gz).
cd "$(dirname "$0")"
TAG=${TAG:-native}
for t in ${TESTS:-load stress spike endurance}; do
  echo "=== $t ($TAG) $(date +%T)"
  K6_WEB_DASHBOARD=true K6_WEB_DASHBOARD_EXPORT=reports/$t-$TAG.html \
    k6 run --quiet --summary-export reports/$t-$TAG-summary.json --out json=reports/$t-$TAG.json.gz \
    tests/$t-test.js > reports/$t-$TAG.txt 2>&1
  echo "exit $? $(date +%T)"
done
