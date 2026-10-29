// Aggregates k6 JSON output (k6 run --out json=run.json.gz) into time windows:
// VUs, requests/s, avg / p95 latency and error rate per window. Prints a table and writes CSV.
// Usage: node timeline.js <run.json.gz> [windowSeconds=15] [out.csv]
import { createReadStream, writeFileSync } from 'node:fs';
import { createGunzip } from 'node:zlib';
import { createInterface } from 'node:readline';

const [file, windowArg = '15', csvOut] = process.argv.slice(2);
const W = Number(windowArg) * 1000;
const input = file.endsWith('.gz') ? createReadStream(file).pipe(createGunzip()) : createReadStream(file);

const buckets = new Map();
let t0 = null;
const bucket = (ts) => {
  const t = Date.parse(ts);
  if (t0 === null) t0 = t;
  const k = Math.floor((t - t0) / W);
  if (!buckets.has(k)) buckets.set(k, { dur: [], failed: 0, reqs: 0, vus: 0 });
  return buckets.get(k);
};

for await (const line of createInterface({ input })) {
  if (!line.startsWith('{"metric"') && !line.includes('"type":"Point"')) continue;
  const p = JSON.parse(line);
  if (p.type !== 'Point') continue;
  const b = bucket(p.data.time);
  if (p.metric === 'http_req_duration') b.dur.push(p.data.value);
  else if (p.metric === 'http_req_failed') { b.reqs++; b.failed += p.data.value; }
  else if (p.metric === 'vus') b.vus = Math.max(b.vus, p.data.value);
}

const pct = (arr, q) => {
  if (!arr.length) return 0;
  arr.sort((a, b) => a - b);
  return arr[Math.min(arr.length - 1, Math.floor(q * arr.length))];
};
const rows = [...buckets.entries()].sort((a, b) => a[0] - b[0]).map(([k, b]) => ({
  t: (k * W) / 1000,
  vus: b.vus,
  rps: +(b.reqs / (W / 1000)).toFixed(0),
  avg: b.dur.length ? +(b.dur.reduce((s, x) => s + x, 0) / b.dur.length).toFixed(1) : 0,
  p95: +pct(b.dur, 0.95).toFixed(1),
  err: b.reqs ? +((100 * b.failed) / b.reqs).toFixed(2) : 0,
}));

console.log('t,s   VUs   req/s   avg,ms   p95,ms   err,%');
for (const r of rows) {
  console.log(`${String(r.t).padStart(5)} ${String(r.vus).padStart(5)} ${String(r.rps).padStart(7)} ${String(r.avg).padStart(8)} ${String(r.p95).padStart(8)} ${String(r.err).padStart(7)}`);
}
if (csvOut) {
  writeFileSync(csvOut, 't_s,vus,rps,avg_ms,p95_ms,err_pct\n' + rows.map((r) => [r.t, r.vus, r.rps, r.avg, r.p95, r.err].join(',')).join('\n'));
}
