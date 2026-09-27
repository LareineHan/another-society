// End-to-end smoke of the API Worker running in real workerd (`wrangler dev`, DEV_AUTH=true) against
// local Postgres: sign in -> choose plot -> claim -> decorate -> visit -> stay -> gift -> leave.
// Usage: (cd services/world-api && npx wrangler dev) & node scripts/workerd-smoke.mjs http://127.0.0.1:8787
import { randomUUID } from 'node:crypto';

// Target a running `wrangler dev` (real workerd + Hyperdrive localConnectionString).
const base = process.argv[2] ?? 'http://127.0.0.1:8787';
const mf = { dispatchFetch: (url, init) => fetch(url, init), dispose: async () => {} };

async function call(token, method, path, body, idem) {
  const headers = { 'content-type': 'application/json' };
  if (token) headers.authorization = `Bearer ${token}`;
  if (idem) headers['idempotency-key'] = randomUUID();
  const res = await mf.dispatchFetch(base + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}
const must = (r, status, label) => {
  if (r.status !== status) throw new Error(`${label}: expected ${status}, got ${r.status} ${JSON.stringify(r.body)}`);
  console.log(`✓ ${label} (${status})`);
  return r.body;
};

try {
  must(await call(null, 'GET', '/health'), 200, 'health (workerd -> Hyperdrive binding -> Postgres)');
  const signIn = async (who) => must(await call(null, 'POST', '/v1/auth/apple', { identity_token: `dev:${who}-${Date.now()}`, authorization_code: 'c', nonce: 'nonce-123456' }), 201, `sign in ${who}`);
  const a = await signIn('host');
  const b = await signIn('guest');
  const boot = must(await call(a.access_token, 'GET', '/v1/world/bootstrap'), 200, 'bootstrap');
  const cityId = boot.cities[0].id;
  const home = async (t, label) => {
    const plots = must(await call(t, 'GET', `/v1/onboarding/plots?city_id=${cityId}`), 200, `${label} plots`).plots;
    const plot = plots[Math.floor(Math.random() * plots.length)];
    const r = must(await call(t, 'POST', `/v1/plots/${plot.id}/reserve`, undefined, true), 201, `${label} reserve`);
    return must(await call(t, 'POST', `/v1/plots/${plot.id}/claim`, { reservation_id: r.reservation_id, structure_asset_id: 'structure.home.cottage.a' }, true), 201, `${label} claim`).property;
  };
  const ha = await home(a.access_token, 'host');
  await home(b.access_token, 'guest');
  const inv = must(await call(a.access_token, 'GET', '/v1/inventory'), 200, 'inventory').items;
  must(await call(a.access_token, 'PUT', `/v1/spaces/${ha.space_ids[0]}/layout`, { expected_revision: 1, placements: [{ item_instance_id: inv[0].id, x_u: 3000, y_u: 3000, rotation_q: 0 }] }, true), 200, 'layout save');
  must(await call(b.access_token, 'POST', `/v1/properties/${ha.id}/visit`), 200, 'visit');
  must(await call(b.access_token, 'POST', `/v1/spaces/${ha.space_ids[0]}/stay`, undefined, true), 201, 'stay');
  const listing = must(await call(b.access_token, 'GET', '/v1/catalog'), 200, 'catalog').listings.find((l) => l.gift_eligible);
  const bought = must(await call(b.access_token, 'POST', '/v1/store/purchases', { listing_id: listing.id, quantity: 1 }, true), 201, 'purchase');
  must(await call(b.access_token, 'POST', '/v1/gifts', { property_id: ha.id, space_id: ha.space_ids[0], item_instance_id: bought.items[0].id, drop_x_u: 2000, drop_y_u: 2000 }, true), 201, 'gift');
  const inbox = must(await call(a.access_token, 'GET', '/v1/gifts/inbox'), 200, 'gift inbox');
  must(await call(a.access_token, 'POST', `/v1/gifts/${inbox.items[0].id}/resolve`, { action: 'keep_here' }, true), 200, 'keep here');
  must(await call(b.access_token, 'DELETE', '/v1/stay', undefined, true), 200, 'leave');
  console.log('workerd smoke: OK');
} finally {
  await mf.dispose();
}
