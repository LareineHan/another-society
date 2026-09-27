// Captures REAL API responses from the in-process Worker app into Swift test fixtures, so the iOS
// Codable models are verified against what the server actually sends (cross-language contract test).
// Usage: DATABASE_URL=postgres://.../fresh_db pnpm tsx scripts/capture-ios-fixtures.mts
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import pg from 'pg';
import { createDb } from '@as/db';
import { createApp, devAppleProvider } from '@as/world-api';

const out = 'apps/ios/Packages/ASKit/Tests/ASKitTests/Fixtures';
mkdirSync(out, { recursive: true });
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 4 });
const db = createDb(pool);
const app = createApp({
  config: { environment: 'test', jwtSecret: 'fixture-secret-fixture-secret-fixture', tokenEncryptionKey: btoa(String.fromCharCode(...new Uint8Array(32).fill(3))), assetBaseUrl: 'https://assets.example.test' },
  openDb: async () => ({ db, close: async () => {} }),
  apple: devAppleProvider,
  rateLimiter: { allow: async () => true },
  log: () => {},
});
let n = 0;
// Tokens in fixtures are replaced with inert placeholders (shape preserved, nothing reusable committed).
const redact = (j: unknown) => (j && typeof j === 'object' && 'access_token' in (j as object)
  ? { ...(j as object), access_token: 'fixture.access.token', refresh_token: 'fixture-refresh-token-fixture-refresh-token' } : j);
async function call(token: string | null, method: string, path: string, body?: unknown, idem = false, save?: string) {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (token) headers.authorization = `Bearer ${token}`;
  if (idem) headers['idempotency-key'] = `fixture-${Date.now()}-${n++}-xxxxxxxx`;
  const res = await app.request(path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  const json = text ? JSON.parse(text) : null;
  if (save) writeFileSync(join(out, `${save}.json`), JSON.stringify(redact(json), null, 2) + '\n');
  return { status: res.status, body: json };
}

const signIn = async (who: string, save?: string) => (await call(null, 'POST', '/v1/auth/apple', { identity_token: `dev:${who}`, authorization_code: 'c', nonce: 'nonce-123456' }, false, save)).body;
const host = await signIn('fixture-host', 'auth_apple');
const guest = await signIn('fixture-guest');
const H = host.access_token as string;
const G = guest.access_token as string;
await call(H, 'GET', '/v1/me', undefined, false, 'me_new');
const boot = (await call(H, 'GET', '/v1/world/bootstrap', undefined, false, 'bootstrap')).body;
const cityId = boot.cities[0].id;
await call(H, 'PATCH', '/v1/resident', { display_name: 'Mori' });
await call(H, 'PUT', '/v1/resident/mini', { definition: { hair: 'mini.hair.bob', accessory: 'mini.acc.scarf' } }, false, 'resident_mini');
const plots = (await call(H, 'GET', `/v1/onboarding/plots?city_id=${cityId}`, undefined, false, 'onboarding_plots')).body.plots;
const res = (await call(H, 'POST', `/v1/plots/${plots[0].id}/reserve`, undefined, true, 'reserve')).body;
const claim = (await call(H, 'POST', `/v1/plots/${plots[0].id}/claim`, { reservation_id: res.reservation_id, structure_asset_id: 'structure.home.cottage.a' }, true, 'claim')).body;
const hp = claim.property;
const gres = (await call(G, 'POST', `/v1/plots/${plots[1].id}/reserve`, undefined, true)).body;
await call(G, 'POST', `/v1/plots/${plots[1].id}/claim`, { reservation_id: gres.reservation_id, structure_asset_id: 'structure.home.cottage.b' }, true);
await call(H, 'GET', `/v1/cities/${cityId}/roads`, undefined, false, 'roads');
await call(H, 'GET', `/v1/cities/${cityId}/chunks?minX=-1&minY=-1&maxX=0&maxY=1`, undefined, false, 'chunks');
const inv = (await call(H, 'GET', '/v1/inventory', undefined, false, 'inventory')).body.items;
await call(H, 'PUT', `/v1/spaces/${hp.space_ids[0]}/layout`, { expected_revision: 1, placements: [
  { item_instance_id: inv[0].id, x_u: 3000, y_u: 4000, rotation_q: 1 },
  { item_instance_id: inv[3].id, x_u: 8000, y_u: 2000, rotation_q: 0, layer: 1 },
] }, true, 'layout_saved');
await call(H, 'PUT', `/v1/spaces/${hp.space_ids[0]}/layout`, { expected_revision: 1, placements: [] }, true, 'error_revision_conflict');
await call(G, 'POST', `/v1/properties/${hp.id}/visit`, undefined, false, 'visit');
await call(G, 'POST', `/v1/spaces/${hp.space_ids[0]}/stay`, undefined, true, 'stay');
await call(G, 'GET', '/v1/wallet', undefined, false, 'wallet');
const catalog = (await call(G, 'GET', '/v1/catalog', undefined, false, 'catalog')).body.listings;
const giftListing = catalog.find((l: { gift_eligible: boolean }) => l.gift_eligible);
const bought = (await call(G, 'POST', '/v1/store/purchases', { listing_id: giftListing.id, quantity: 1 }, true, 'purchase')).body;
await call(G, 'POST', '/v1/gifts', { property_id: hp.id, space_id: hp.space_ids[0], item_instance_id: bought.items[0].id, drop_x_u: 5000, drop_y_u: 5000 }, true, 'gift');
await call(H, 'GET', `/v1/properties/${hp.id}`, undefined, false, 'property_owner');
await call(G, 'GET', `/v1/properties/${hp.id}`, undefined, false, 'property_visitor');
await call(H, 'GET', `/v1/spaces/${hp.space_ids[0]}`, undefined, false, 'space_owner');
const inbox = (await call(H, 'GET', '/v1/gifts/inbox', undefined, false, 'gift_inbox')).body.items;
await call(H, 'POST', `/v1/gifts/${inbox[0].id}/resolve`, { action: 'keep_here' }, true, 'gift_resolved');
await call(G, 'GET', '/v1/me', undefined, false, 'me_staying');
await call(H, 'GET', `/v1/properties/${hp.id}/visits/summary`, undefined, false, 'visit_summary');
await call(G, 'GET', `/v1/wander?city_id=${cityId}&limit=5`, undefined, false, 'wander');
await call(G, 'DELETE', '/v1/stay', undefined, true, 'stay_ended');
await call(G, 'POST', `/v1/spaces/${hp.space_ids[0]}/stay`, undefined, false, 'error_idempotency_required');
await call(H, 'PATCH', `/v1/properties/${hp.id}/access`, { away_access_mode: 'closed' }, false, 'property_access');
await call(null, 'POST', '/v1/auth/refresh', { refresh_token: host.refresh_token }, false, 'auth_refresh');
await pool.end();
console.log('fixtures written to', out);
