import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupTestWorld, count, key, type TestWorld } from './helpers';
import { createResponseValidator } from '../packages/api-contract/src/validator';

let t: TestWorld;
beforeAll(async () => { t = await setupTestWorld({ poolSize: 60 }); });
afterAll(async () => { await t.close(); });

describe('Milestone 2: city and plot claim', () => {
  it('contract validator actually rejects a malformed body (guards the guard)', () => {
    const v = createResponseValidator();
    const r = v.validate('GET', '/v1/wallet', 200, { currency_code: 'WORLD', balance: 'lots' });
    expect(r.operation).not.toBeNull();
    expect((r as { errors: string[] }).errors.length).toBeGreaterThan(0);
  });

  it('bootstrap lists the founding city, asset packs and features', async () => {
    const a = await t.signUp('boot');
    const r = await t.call(a, 'GET', '/v1/world/bootstrap');
    expect(r.status).toBe(200);
    expect(r.body.cities).toHaveLength(1);
    expect(r.body.asset_packs[0]).toMatchObject({ pack_id: 'core-dev', version: 1, manifest_url: 'https://assets.example.test/packs/core-dev.v1.json' });
    expect(r.body.features).toMatchObject({ 'creator.enabled': false, 'market.enabled': false });
  });

  it('onboarding shows exactly the 16 initially active plots with quiet map-fact labels', async () => {
    const a = await t.signUp('chooser');
    const r = await t.call(a, 'GET', `/v1/onboarding/plots?city_id=${t.cityId}`);
    expect(r.body.plots).toHaveLength(16);
    expect(r.body.plots.every((p: { status: string }) => p.status === 'vacant')).toBe(true);
    expect(r.body.plots.some((p: { labels: string[] }) => p.labels.length > 0)).toBe(true);
  });

  it('chunk window is bounded (≤100 chunks) and never returns latent plots', async () => {
    const a = await t.signUp('mapper');
    expect((await t.call(a, 'GET', `/v1/cities/${t.cityId}/chunks?minX=-10&minY=-10&maxX=10&maxY=10`)).status).toBe(422);
    expect((await t.call(a, 'GET', `/v1/cities/${t.cityId}/chunks?minX=1&minY=0&maxX=0&maxY=0`)).status).toBe(422);
    const r = await t.call(a, 'GET', `/v1/cities/${t.cityId}/chunks?minX=-1&minY=-4&maxX=0&maxY=3`);
    expect(r.status).toBe(200);
    const plots = r.body.chunks.flatMap((ch: { plots: unknown[] }) => ch.plots);
    expect(plots).toHaveLength(16);
    const one = await t.call(a, 'GET', `/v1/cities/${t.cityId}/chunks?minX=-1&minY=0&maxX=-1&maxY=0`);
    expect(one.body.chunks).toHaveLength(1);
    expect(one.body.chunks[0]).toMatchObject({ x: -1, y: 0 });
  });

  it('road graph: only active roads, with ETag keyed to activation revision', async () => {
    const a = await t.signUp('router');
    const r = await t.call(a, 'GET', `/v1/cities/${t.cityId}/roads`);
    expect(r.body.nodes).toHaveLength(19); // 3 skeleton + 16 b0 frontage nodes
    expect(r.body.edges).toHaveLength(18);
    expect(r.body.civic_anchors).toHaveLength(3);
    const etag = r.headers.get('etag')!;
    const again = await t.app.request(`/v1/cities/${t.cityId}/roads`, { headers: { authorization: `Bearer ${a.token}`, 'if-none-match': etag } });
    expect(again.status).toBe(304);
  });

  it('§73.1 plot race: 50 concurrent reservations -> exactly one; 50 concurrent claims -> exactly one owner', async () => {
    const people = await Promise.all(Array.from({ length: 50 }, (_, i) => t.signUp(`racer${i}`)));
    const plots = await t.call(people[0]!, 'GET', `/v1/onboarding/plots?city_id=${t.cityId}`);
    const target = plots.body.plots[0].id;
    const reservations = await Promise.all(people.map((p) => t.call(p, 'POST', `/v1/plots/${target}/reserve`, undefined, { idem: true })));
    const won = reservations.filter((r) => r.status === 201);
    expect(won).toHaveLength(1);
    expect(reservations.filter((r) => r.status === 409).every((r) => r.body.code === 'plot_unavailable')).toBe(true);
    const winner = people[reservations.findIndex((r) => r.status === 201)]!;
    const claims = await Promise.all(Array.from({ length: 50 }, () =>
      t.call(winner, 'POST', `/v1/plots/${target}/claim`, { reservation_id: won[0]!.body.reservation_id, structure_asset_id: 'structure.home.cottage.b' }, { idem: true })));
    expect(claims.filter((r) => r.status === 201)).toHaveLength(1);
    expect(claims.filter((r) => r.status === 409)).toHaveLength(49);
    expect(await count(t.db, t.sql`SELECT count(*)::int AS n FROM properties WHERE plot_id = ${target}`)).toBe(1);
    expect(await count(t.db, t.sql`SELECT count(*)::int AS n FROM ledger_transactions WHERE transaction_type = 'starter_grant' AND actor_resident_id = ${winner.residentId}`)).toBe(1);
  });

  it('claim creates home, starter grant through the ledger, starter kit, presence home', async () => {
    const a = await t.newcomer('settler');
    const me = await t.call(a, 'GET', '/v1/me');
    expect(me.body.resident.onboarding_state).toBe('claimed');
    expect(me.body.resident.primary_home.property_id).toBe(a.propertyId);
    expect((await t.call(a, 'GET', '/v1/wallet')).body.balance).toBe(500);
    const inv = await t.call(a, 'GET', '/v1/inventory');
    expect(inv.body.items).toHaveLength(4);
    const presence = await count(t.db, t.sql`SELECT count(*)::int AS n FROM presence WHERE resident_id = ${a.residentId} AND state = 'home' AND current_property_id = ${a.propertyId}`);
    expect(presence).toBe(1);
    // Second home in onboarding is refused (v0.1 UI exposes one; schema allows many later).
    const other = (await t.call(a, 'GET', `/v1/onboarding/plots?city_id=${t.cityId}`)).body.plots[0].id;
    expect((await t.call(a, 'POST', `/v1/plots/${other}/reserve`, undefined, { idem: true })).body.code).toBe('already_has_home');
  });

  it('claim idempotency: same key replays the same property; same key + different body is a 409', async () => {
    const a = await t.signUp('replayer');
    const plot = (await t.call(a, 'GET', `/v1/onboarding/plots?city_id=${t.cityId}`)).body.plots[0].id;
    const res = await t.call(a, 'POST', `/v1/plots/${plot}/reserve`, undefined, { idem: true });
    const k = key('claim');
    const body = { reservation_id: res.body.reservation_id, structure_asset_id: 'structure.home.cottage.c' };
    const first = await t.call(a, 'POST', `/v1/plots/${plot}/claim`, body, { idem: k });
    const replay = await t.call(a, 'POST', `/v1/plots/${plot}/claim`, body, { idem: k });
    expect(first.status).toBe(201);
    expect(replay.status).toBe(201);
    expect(replay.headers.get('idempotent-replayed')).toBe('true');
    expect(replay.body.property.id).toBe(first.body.property.id);
    const mismatch = await t.call(a, 'POST', `/v1/plots/${plot}/claim`, { ...body, structure_asset_id: 'structure.home.cottage.a' }, { idem: k });
    expect(mismatch.body.code).toBe('idempotency_mismatch');
    expect((await t.call(a, 'POST', `/v1/plots/${plot}/claim`, body)).body.code).toBe('idempotency_key_required');
  });

  it('reservation expiry returns the plot; an expired reservation cannot claim', async () => {
    const a = await t.signUp('slow');
    const b = await t.signUp('fast');
    const plot = (await t.call(a, 'GET', `/v1/onboarding/plots?city_id=${t.cityId}`)).body.plots[0].id;
    const res = await t.call(a, 'POST', `/v1/plots/${plot}/reserve`, undefined, { idem: true });
    expect((await t.call(b, 'POST', `/v1/plots/${plot}/reserve`, undefined, { idem: true })).status).toBe(409);
    await t.db.execute(t.sql`UPDATE plot_reservations SET expires_at = now() - interval '1 second' WHERE id = ${res.body.reservation_id}`);
    // Lapsed reservation reads as vacant immediately and can be taken.
    const visible = (await t.call(b, 'GET', `/v1/onboarding/plots?city_id=${t.cityId}`)).body.plots.map((p: { id: string }) => p.id);
    expect(visible).toContain(plot);
    expect((await t.call(b, 'POST', `/v1/plots/${plot}/reserve`, undefined, { idem: true })).status).toBe(201);
    const late = await t.call(a, 'POST', `/v1/plots/${plot}/claim`, { reservation_id: res.body.reservation_id, structure_asset_id: 'structure.home.cottage.a' }, { idem: true });
    expect(late.body.code).toBe('reservation_invalid');
  });

  it('structure must fit the plot build bounds', async () => {
    const a = await t.signUp('builder');
    const plot = (await t.call(a, 'GET', `/v1/onboarding/plots?city_id=${t.cityId}`)).body.plots[0].id;
    const res = await t.call(a, 'POST', `/v1/plots/${plot}/reserve`, undefined, { idem: true });
    const bad = await t.call(a, 'POST', `/v1/plots/${plot}/claim`, { reservation_id: res.body.reservation_id, structure_asset_id: 'structure.home.cottage.a', structure_x_u: 50_000 }, { idem: true });
    expect(bad.status).toBe(422);
    const unknown = await t.call(a, 'POST', `/v1/plots/${plot}/claim`, { reservation_id: res.body.reservation_id, structure_asset_id: 'furniture.chair.softwood.001' }, { idem: true });
    expect(unknown.status).toBe(422);
  });

  it('growth: vacancy below target activates the next connected bundle (roads first, then plots)', async () => {
    // Claim until vacancy drops below the target of 8 (clamp(ceil(n*0.15), 8, 20)).
    for (let i = 0; ; i++) {
      const vacant = await count(t.db, t.sql`SELECT count(*)::int AS n FROM plots WHERE status = 'vacant'`);
      const b1 = await count(t.db, t.sql`SELECT count(*)::int AS n FROM city_activation_bundles WHERE stable_key = 'b1' AND status = 'active'`);
      if (b1) {
        expect(vacant).toBeGreaterThanOrEqual(8);
        break;
      }
      expect(i).toBeLessThan(16);
      await t.newcomer(`grower${i}`);
    }
    expect(await count(t.db, t.sql`SELECT count(*)::int AS n FROM road_nodes WHERE activation_bundle = 'b1' AND NOT active`)).toBe(0);
    expect(await count(t.db, t.sql`SELECT count(*)::int AS n FROM plots WHERE activation_bundle = 'b1' AND status = 'latent'`)).toBe(0);
    expect(await count(t.db, t.sql`SELECT count(*)::int AS n FROM outbox_events WHERE event_type = 'city.bundle_activated' AND payload->>'bundle' = 'b1'`)).toBe(1);
  });
});
