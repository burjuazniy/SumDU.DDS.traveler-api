// Fires truly concurrent requests (Hurl runs requests of one file sequentially) to show
// that problems 1-3 from the lab are solved. Usage: node scripts/race-demo.js [baseUrl]
const BASE = process.argv[2] || process.env.API_URL || 'http://127.0.0.1:4567';

async function api(method, path, body) {
  const res = await fetch(BASE + path, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body && JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

let failed = 0;
const check = (ok, label) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok) failed++;
};

// Problem 1: A and B both read version 1 and update different fields at the same time.
{
  const plan = (await api('POST', '/api/travel-plans', { title: 'Європа', budget: 2000 })).body;
  const [a, b] = await Promise.all([
    api('PUT', `/api/travel-plans/${plan.id}`, { budget: 2500, version: plan.version }),
    api('PUT', `/api/travel-plans/${plan.id}`, { title: 'Супер Європа', version: plan.version }),
  ]);
  const statuses = [a.status, b.status].sort();
  check(statuses[0] === 200 && statuses[1] === 409, `P1: one update wins, the other gets 409 (got ${statuses})`);
  const loser = a.status === 409 ? a : b;
  check(loser.body.current_version === 2, 'P1: 409 reports current_version = 2');
  const after = (await api('GET', `/api/travel-plans/${plan.id}`)).body;
  check(after.version === 2, 'P1: exactly one version bump, nothing silently overwritten');
  await api('DELETE', `/api/travel-plans/${plan.id}`);
}

// Problem 2: 50 users add a location to the same plan simultaneously.
{
  const plan = (await api('POST', '/api/travel-plans', { title: 'Order race' })).body;
  await api('POST', `/api/travel-plans/${plan.id}/locations`, { name: 'Paris' });
  await api('POST', `/api/travel-plans/${plan.id}/locations`, { name: 'Rome' });
  const N = 50;
  const results = await Promise.all(Array.from({ length: N }, (_, i) =>
    api('POST', `/api/travel-plans/${plan.id}/locations`, { name: `City ${i}` })));
  check(results.every((r) => r.status === 201), `P2: all ${N} concurrent inserts succeeded`);
  const orders = (await api('GET', `/api/travel-plans/${plan.id}`)).body.locations.map((l) => l.visit_order);
  const unique = new Set(orders);
  check(unique.size === orders.length && orders.length === N + 2, `P2: ${orders.length} locations, ${unique.size} distinct visit_order values`);
  check(Math.max(...orders) === N + 2, 'P2: orders are 1..N+2 without gaps');
  await api('DELETE', `/api/travel-plans/${plan.id}`);
}

// Problem 3: A changes budget and B changes notes of the same location at the same time.
{
  const plan = (await api('POST', '/api/travel-plans', { title: 'Field race' })).body;
  const loc = (await api('POST', `/api/travel-plans/${plan.id}/locations`, { name: 'Louvre', budget: 50, notes: 'Book tickets' })).body;
  let ok = true;
  for (let i = 0; i < 20; i++) {
    const budget = 75 + i;
    const notes = `Tickets booked! #${i}`;
    await Promise.all([
      api('PUT', `/api/locations/${loc.id}`, { budget }),
      api('PUT', `/api/locations/${loc.id}`, { notes }),
    ]);
    const cur = (await api('GET', `/api/travel-plans/${plan.id}`)).body.locations[0];
    if (cur.budget !== budget || cur.notes !== notes) ok = false;
  }
  check(ok, 'P3: 20 rounds of concurrent budget/notes edits, both changes always kept');
  await api('DELETE', `/api/travel-plans/${plan.id}`);
}

console.log(failed ? `\n${failed} check(s) failed` : '\nAll concurrency checks passed');
process.exit(failed ? 1 : 0);
