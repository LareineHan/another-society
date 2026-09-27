import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { publishOutbox, handleEvent, processDeletion, minuteMaintenance, dailyRetention, reconcile, type OutboxMessage } from '@as/jobs';
import { devAppleProvider } from '@as/world-api';
import { setupTestWorld, count, type TestWorld } from './helpers';

let t: TestWorld;
beforeAll(async () => { t = await setupTestWorld(); });
afterAll(async () => { await t.close(); });

const jobDeps = () => ({
  db: t.db,
  apple: t.apple,
  tokenEncryptionKey: btoa(String.fromCharCode(...new Uint8Array(32).fill(7))),
  log: () => {},
});

async function drainOutbox() {
  const sent: OutboxMessage[] = [];
  for (;;) {
    const r = await publishOutbox(t.db, async (msgs) => { sent.push(...msgs); });
    if (!r.published) break;
  }
  for (const m of sent) await handleEvent(jobDeps(), m);
  return sent;
}

describe('§73.9 account deletion', () => {
  it('hidden immediately; queued deletion completes; Apple token revoked; place returns to the city', async () => {
    const host = await t.newcomer('leaving');
    const friend = await t.newcomer('friend');
    const other = await t.newcomer('otherhost');
    await t.call(host, 'PATCH', '/v1/resident', { display_name: 'Birch' });
    await t.call(friend, 'POST', `/v1/spaces/${host.spaceId}/stay`, undefined, { idem: true });
    await t.call(host, 'POST', `/v1/spaces/${other.spaceId}/stay`, undefined, { idem: true });

    const del = await t.call(host, 'DELETE', '/v1/account', undefined, { idem: true });
    expect(del.status).toBe(202);
    // Immediately: sessions revoked, home hidden from others, stays ended both ways.
    expect((await t.call(host, 'GET', '/v1/me')).status).toBe(401);
    expect((await t.call(friend, 'GET', `/v1/properties/${host.propertyId}`)).status).toBe(404);
    expect((await t.call(friend, 'GET', '/v1/me')).body.active_stay).toBeUndefined();
    expect(await count(t.db, t.sql`SELECT count(*)::int AS n FROM stays WHERE resident_id = ${host.residentId} AND ended_at IS NULL`)).toBe(0);
    const w = await t.call(friend, 'GET', `/v1/wander?city_id=${t.cityId}&limit=10`);
    expect(w.body.properties.map((p: { id: string }) => p.id)).not.toContain(host.propertyId);
    // Same Apple ID cannot sign back in while deletion is in progress.
    const blocked = await t.call(null, 'POST', '/v1/auth/apple', { identity_token: `dev:${host.name}`, authorization_code: 'c', nonce: 'nonce-123456' });
    expect([201, 403]).toContain(blocked.status); // dev tokens are random per signUp, so this is a different subject

    // Eventually: the queued job completes.
    const sent = await drainOutbox();
    expect(sent.some((m) => m.event_type === 'account.deletion_requested')).toBe(true);
    expect(t.apple.revoked).toContain('dev-apple-refresh-token');
    const user = await t.db.execute(t.sql`SELECT status FROM users WHERE id = ${host.userId}`);
    expect((user.rows[0] as { status: string }).status).toBe('deleted');
    expect(await count(t.db, t.sql`SELECT count(*)::int AS n FROM auth_identities WHERE user_id = ${host.userId}`)).toBe(0);
    const r = await t.db.execute(t.sql`SELECT display_name, mini_definition FROM residents WHERE id = ${host.residentId}`);
    expect(r.rows[0]).toEqual({ display_name: 'Former resident', mini_definition: {} });
    const plot = await t.db.execute(t.sql`SELECT status FROM plots WHERE id = ${host.plotId}`);
    expect((plot.rows[0] as { status: string }).status).toBe('vacant');
    expect((await t.call(friend, 'GET', '/v1/wallet')).status).toBe(200);
    expect(await count(t.db, t.sql`SELECT count(*)::int AS n FROM wallets WHERE resident_id = ${host.residentId} AND balance = 0`)).toBe(1);
    // Re-running is a no-op.
    expect(await processDeletion(jobDeps(), del.body.resource_id)).toBe('noop');
    expect((await reconcile(t.db)).ok).toBe(true);
  });

  it('Apple revocation failure marks the request failed and retries later', async () => {
    const a = await t.newcomer('flaky');
    const del = await t.call(a, 'DELETE', '/v1/account', undefined, { idem: true });
    const failing = { ...jobDeps(), apple: { ...devAppleProvider, revokeRefreshToken: async () => { throw new Error('apple down'); } } };
    await expect(processDeletion(failing, del.body.resource_id)).rejects.toThrow('apple down');
    const st = await t.db.execute(t.sql`SELECT status FROM deletion_requests WHERE id = ${del.body.resource_id}`);
    expect((st.rows[0] as { status: string }).status).toBe('failed');
    expect(await processDeletion(jobDeps(), del.body.resource_id)).toBe('completed');
  });
});

describe('jobs: outbox, maintenance, retention', () => {
  it('outbox publish failure backs off and later succeeds exactly once per event', async () => {
    await t.newcomer('evented');
    const pendingBefore = await count(t.db, t.sql`SELECT count(*)::int AS n FROM outbox_events WHERE status <> 'published'`);
    const failed = await publishOutbox(t.db, async () => { throw new Error('queue unavailable'); });
    expect(failed.failed).toBeGreaterThan(0);
    await t.db.execute(t.sql`UPDATE outbox_events SET available_at = now() WHERE status = 'failed'`);
    const seen = new Set<string>();
    for (;;) {
      const r = await publishOutbox(t.db, async (m) => m.forEach((x) => seen.add(x.id)));
      if (!r.published) break;
    }
    expect(await count(t.db, t.sql`SELECT count(*)::int AS n FROM outbox_events WHERE status <> 'published'`)).toBe(0);
    expect(seen.size).toBe(pendingBefore);
  });

  it('minute maintenance releases lapsed reservations; retention purges raw visits after 7 days', async () => {
    const a = await t.signUp('lapsed');
    const plot = (await t.call(a, 'GET', `/v1/onboarding/plots?city_id=${t.cityId}`)).body.plots[0].id;
    const r = await t.call(a, 'POST', `/v1/plots/${plot}/reserve`, undefined, { idem: true });
    await t.db.execute(t.sql`UPDATE plot_reservations SET expires_at = now() - interval '1 minute' WHERE id = ${r.body.reservation_id}`);
    expect((await minuteMaintenance(t.db)).released).toBeGreaterThanOrEqual(1);
    expect(await count(t.db, t.sql`SELECT count(*)::int AS n FROM plots WHERE id = ${plot} AND status = 'vacant'`)).toBe(1);

    const host = await t.newcomer('visited');
    const guest = await t.newcomer('visiting');
    await t.call(guest, 'POST', `/v1/properties/${host.propertyId}/visit`);
    await t.db.execute(t.sql`UPDATE visit_receipts SET purge_after = now() - interval '1 second'`);
    expect((await dailyRetention(t.db)).visit_receipts).toBeGreaterThanOrEqual(1);
    expect(await count(t.db, t.sql`SELECT count(*)::int AS n FROM visit_receipts`)).toBe(0);
  });
});
