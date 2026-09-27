import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createAdminApp } from '@as/world-api';
import { setupTestWorld, type TestWorld } from './helpers';

let t: TestWorld;
let admin: ReturnType<typeof createAdminApp>;
beforeAll(async () => {
  t = await setupTestWorld();
  admin = createAdminApp(
    { config: { environment: 'test', jwtSecret: 'x'.repeat(40), tokenEncryptionKey: '', assetBaseUrl: '' }, openDb: async () => ({ db: t.db, close: async () => {} }), apple: t.apple, rateLimiter: { allow: async () => true }, log: () => {} },
    { verify: async (req) => (req.headers.get('x-test-admin') === 'ok' ? { email: 'mod@implemon.com' } : null) },
  );
});
afterAll(async () => { await t.close(); });

const adminCall = async (method: string, path: string, body?: unknown, ok = true) => {
  const res = await admin.request(path, { method, headers: { 'content-type': 'application/json', ...(ok ? { 'x-test-admin': 'ok' } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, body: await res.json() as any };
};

describe('Milestone 6: moderation', () => {
  it('admin surface rejects non-admins (resident tokens do not work here)', async () => {
    expect((await adminCall('GET', '/admin/v1/reports', undefined, false)).status).toBe(403);
  });

  it('report -> review queue -> hide property / suspend resident, all audited', async () => {
    const reporter = await t.newcomer('rep');
    const target = await t.newcomer('bad');
    const guest = await t.newcomer('guestx');
    await t.call(guest, 'POST', `/v1/spaces/${target.spaceId}/stay`, undefined, { idem: true });
    const rep = await t.call(reporter, 'POST', '/v1/reports', { target_type: 'property', target_id: target.propertyId, reason_code: 'offensive_layout' });
    const queue = await adminCall('GET', '/admin/v1/reports');
    expect(queue.body.items.map((r: { id: string }) => r.id)).toContain(rep.body.resource_id);

    expect((await adminCall('POST', '/admin/v1/moderation', { target_type: 'property', target_id: target.propertyId, action: 'hide', reason: 'layout', report_id: rep.body.resource_id })).status).toBe(200);
    expect((await t.call(reporter, 'GET', `/v1/properties/${target.propertyId}`)).status).toBe(404);
    expect((await t.call(guest, 'GET', '/v1/me')).body.active_stay).toBeUndefined();
    expect((await t.call(target, 'GET', `/v1/properties/${target.propertyId}`)).status).toBe(200); // owner still sees own home

    expect((await adminCall('POST', '/admin/v1/moderation', { target_type: 'resident', target_id: target.residentId, action: 'suspend', reason: 'repeat' })).status).toBe(200);
    expect((await t.call(target, 'POST', `/v1/properties/${reporter.propertyId}/visit`)).body.code).toBe('account_inactive');
    expect((await t.call(target, 'GET', '/v1/me')).body.account_status).toBe('suspended');

    await adminCall('POST', `/admin/v1/reports/${rep.body.resource_id}/status`, { status: 'resolved', note: 'hidden' });
    const audit = await adminCall('GET', `/admin/v1/moderation/${target.propertyId}`);
    expect(audit.body.items.map((a: { action_type: string }) => a.action_type).sort()).toEqual(['hide', 'report_resolved']);
    expect(audit.body.items[0].actor_admin_id).toBe('mod@implemon.com');
  });

  it('hidden item definitions disappear from the catalog', async () => {
    const a = await t.newcomer('cat');
    const listing = (await t.call(a, 'GET', '/v1/catalog')).body.listings[0];
    await adminCall('POST', '/admin/v1/moderation', { target_type: 'item_definition', target_id: listing.item_definition_id, action: 'hide', reason: 'test' });
    expect((await t.call(a, 'GET', '/v1/catalog')).body.listings.map((l: { id: string }) => l.id)).not.toContain(listing.id);
    await adminCall('POST', '/admin/v1/moderation', { target_type: 'item_definition', target_id: listing.item_definition_id, action: 'unhide', reason: 'test' });
  });

  it('integrity + ops endpoints', async () => {
    expect((await adminCall('GET', '/admin/v1/integrity')).body.ok).toBe(true);
    expect((await adminCall('GET', '/admin/v1/ops')).body).toMatchObject({ open_reports: expect.any(Number) });
  });
});
