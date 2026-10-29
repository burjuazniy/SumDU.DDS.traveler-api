// Turns a k6 web-dashboard recording (K6_WEB_DASHBOARD_RECORD=run.ndjson.gz) into a per-period table:
// VUs, requests/s, avg / p95 latency and error rate. Unlike `--out json` the recording is
// pre-aggregated by k6, so producing it does not load the machine under test.
// Usage: node timeline.js <run.ndjson.gz> [out.csv] [groupPeriods=1]
import { createReadStream, writeFileSync } from 'node:fs';
import { createGunzip } from 'node:zlib';
import { createInterface } from 'node:readline';

const [file, csvOut, groupArg = '1'] = process.argv.slice(2);
const group = Number(groupArg);
const AGG = { trend: ['avg', 'max', 'med', 'min', 'p(90)', 'p(95)', 'p(99)'], counter: ['count', 'rate'], rate: ['rate'], gauge: ['value'] };

const meta = {}; // name -> type; snapshot arrays follow the alphabetical order of known metrics
let period = 10000;
let start = null;
const snaps = [];

for await (const line of createInterface({ input: createReadStream(file).pipe(createGunzip()) })) {
  const ev = JSON.parse(line);
  if (ev.event === 'param') period = ev.data.period;
  else if (ev.event === 'start') start = ev.data[0][0];
  else if (ev.event === 'metric') for (const [n, m] of Object.entries(ev.data)) meta[n] = m.type;
  else if (ev.event === 'snapshot') {
    const row = {};
    const names = Object.keys(meta).sort();
    ev.data.forEach((vals, i) => {
      if (!names[i]) return;
      const agg = AGG[meta[names[i]]] || [];
      row[names[i]] = Object.fromEntries(agg.map((a, j) => [a, vals[j]]));
    });
    snaps.push(row);
  }
}

const rows = [];
for (let i = 0; i < snaps.length; i += group) {
  const chunk = snaps.slice(i, i + group);
  const get = (s, m, a) => (s[m] && s[m][a]) || 0;
  const reqs = chunk.reduce((s, x) => s + get(x, 'http_reqs', 'count'), 0);
  const avg = reqs ? chunk.reduce((s, x) => s + get(x, 'http_req_duration', 'avg') * get(x, 'http_reqs', 'count'), 0) / reqs : 0;
  const errs = reqs ? chunk.reduce((s, x) => s + get(x, 'http_req_failed', 'rate') * get(x, 'http_reqs', 'count'), 0) / reqs : 0;
  rows.push({
    t: Math.round(((i + group) * period) / 1000),
    vus: Math.max(...chunk.map((x) => get(x, 'vus', 'value'))),
    rps: Math.round(reqs / ((chunk.length * period) / 1000)),
    avg: +avg.toFixed(1),
    p95: +Math.max(...chunk.map((x) => get(x, 'http_req_duration', 'p(95)'))).toFixed(1),
    p99: +Math.max(...chunk.map((x) => get(x, 'http_req_duration', 'p(99)'))).toFixed(1),
    err: +(100 * errs).toFixed(2),
  });
}

console.log('  t,s   VUs   req/s   avg,ms   p95,ms   p99,ms   err,%');
for (const r of rows) {
  console.log([r.t, r.vus, r.rps, r.avg, r.p95, r.p99, r.err].map((v, i) => String(v).padStart(i ? 8 : 5)).join(''));
}
if (csvOut) writeFileSync(csvOut, 't_s,vus,rps,avg_ms,p95_ms,p99_ms,err_pct\n' + rows.map((r) => Object.values(r).join(',')).join('\n') + '\n');
