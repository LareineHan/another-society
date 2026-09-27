import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupTestWorld, count, key, type TestWorld } from './helpers';

let t: TestWorld;
beforeAll(async () => { t = await setupTestWorld({ poolSize: 60 }); });
afterAll(async () => { await t.close(); });

const buyGift = async (who: Parameters<TestWorld['call']>[0], defKey = 'gift.candle.001') => {
  const listing = (await t.call(who, 'GET', '/v1/catalog')).body.listings.find((l: { definition_key: string }) => l.definition_key === defKey);
  const r = await t.call(who, 'POST', '/v1/store/purchases', { listing_id: listing.id, quantity: 1 }, { idem: true });
  expect(r.status).toBe(201);
  return r.body.items[0].id as string;
};

describe('Milestone 4: quiet social loop', () => {
  it('Visit is anonymous to the owner; qualification is server-measured dwell; one per visitor/day', async () => {
    const host = await t.newcomer('host');
    const guest = await t.newcomer('guest');
    const v1 = await t.call(guest, 'POST', `/v1/properties/${host.propertyId}/visit`);
    expect(v1.status).toBe(200);
    expect(v1.body.visit.qualified).toBe(false);
    expect(v1.body.spaces).toHaveLength(1);
    // Simulate dwell ≥ threshold, then the client's second call qualifies the receipt.
    await t.db.execute(t.sql`UPDATE visit_receipts SET first_seen_at = now() - interval '10 seconds' WHERE property_id = ${host.propertyId}`);
    expect((await t.call(guest, 'POST', `/v1/properties/${host.propertyId}/visit`)).body.visit.qualified).toBe(true);
    await t.call(guest, 'POST', `/v1/properties/${host.propertyId}/visit`);
    const summary = await t.call(host, 'GET', `/v1/properties/${host.propertyId}/visits/summary`);
    expect(summary.status).toBe(200);
    expect(summary.body).toMatchObject({ band: 'someone', copy: 'Someone stopped by.' });
    const text = JSON.stringify(summary.body);
    expect(text).not.toContain(guest.residentId);
    expect(text).not.toContain('count'); // exact counts are an experiment flag, off by default
    expect((await t.call(guest, 'GET', `/v1/properties/${host.propertyId}/visits/summary`)).status).toBe(404);
    // Visit never creates globally visible presence.
    expect(await count(t.db, t.sql`SELECT count(*)::int AS n FROM presence WHERE resident_id = ${guest.residentId} AND state = 'home'`)).toBe(1);
  });

  it('locked property denies entry; away access applies only while the owner is staying elsewhere', async () => {
    const host = await t.newcomer('awayhost');
    const other = await t.newcomer('otherhome');
    const guest = await t.newcomer('curious');
    await t.call(host, 'PATCH', `/v1/properties/${host.propertyId}/access`, { away_access_mode: 'closed' });
    expect((await t.call(guest, 'POST', `/v1/properties/${host.propertyId}/visit`)).status).toBe(200);
    expect((await t.call(host, 'POST', `/v1/spaces/${other.spaceId}/stay`, undefined, { idem: true })).status).toBe(201);
    expect((await t.call(guest, 'POST', `/v1/properties/${host.propertyId}/visit`)).status).toBe(403);
    expect((await t.call(guest, 'POST', `/v1/spaces/${host.spaceId}/stay`, undefined, { idem: true })).body.code).toBe('stay_not_allowed');
    await t.call(host, 'DELETE', '/v1/stay', undefined, { idem: true });
    expect((await t.call(guest, 'POST', `/v1/properties/${host.propertyId}/visit`)).status).toBe(200);
    await t.call(host, 'PATCH', `/v1/properties/${host.propertyId}/access`, { access_mode: 'closed' });
    expect((await t.call(guest, 'POST', `/v1/properties/${host.propertyId}/visit`)).status).toBe(403);
    expect((await t.call(guest, 'GET', `/v1/spaces/${host.spaceId}`)).status).toBe(403);
    expect((await t.call(host, 'GET', `/v1/spaces/${host.spaceId}`)).status).toBe(200); // owner always enters
  });

  it('Stay persists as durable state, is visible in the space, and Leave clears it', async () => {
    const host = await t.newcomer('stayhost');
    const guest = await t.newcomer('stayer');
    const s = await t.call(guest, 'POST', `/v1/spaces/${host.spaceId}/stay`, undefined, { idem: true });
    expect(s.status).toBe(201);
    // "App termination": nothing is held in memory; a fresh read shows the stay.
    const me = await t.call(guest, 'GET', '/v1/me');
    expect(me.body.active_stay).toMatchObject({ id: s.body.stay_id, space_id: host.spaceId });
    const space = await t.call(host, 'GET', `/v1/spaces/${host.spaceId}`);
    expect(space.body.stayers.map((x: { resident_id: string }) => x.resident_id)).toEqual([guest.residentId]);
    expect((await t.call(host, 'GET', `/v1/properties/${host.propertyId}`)).body.has_active_stayers).toBe(true);
    expect((await t.call(guest, 'DELETE', '/v1/stay', undefined, { idem: true })).status).toBe(200);
    expect((await t.call(guest, 'GET', '/v1/me')).body.active_stay).toBeUndefined();
    expect(await count(t.db, t.sql`SELECT count(*)::int AS n FROM presence WHERE resident_id = ${guest.residentId} AND state = 'home' AND current_property_id = ${guest.propertyId}`)).toBe(1);
    expect((await t.call(guest, 'DELETE', '/v1/stay', undefined, { idem: true })).body.code).toBe('not_staying');
  });

  it('§73.6 Stay uniqueness: 10 concurrent stays in different homes -> exactly one active', async () => {
    const guest = await t.newcomer('wanderer');
    const hosts = await Promise.all(Array.from({ length: 10 }, (_, i) => t.newcomer(`uhost${i}`)));
    const rs = await Promise.all(hosts.map((h) => t.call(guest, 'POST', `/v1/spaces/${h.spaceId}/stay`, undefined, { idem: true })));
    expect(rs.every((r) => r.status === 201 || r.status === 409)).toBe(true);
    expect(await count(t.db, t.sql`SELECT count(*)::int AS n FROM stays WHERE resident_id = ${guest.residentId} AND ended_at IS NULL`)).toBe(1);
  });

  it('§73.7 Stay capacity: capacity 2 with 12 concurrent stayers -> exactly 2', async () => {
    const host = await t.newcomer('smallhouse');
    await t.call(host, 'PATCH', `/v1/properties/${host.propertyId}/access`, { stay_capacity: 2 });
    const guests = await Promise.all(Array.from({ length: 12 }, (_, i) => t.newcomer(`capguest${i}`)));
    const rs = await Promise.all(guests.map((g) => t.call(g, 'POST', `/v1/spaces/${host.spaceId}/stay`, undefined, { idem: true })));
    expect(rs.filter((r) => r.status === 201)).toHaveLength(2);
    expect(rs.filter((r) => r.status === 409).every((r) => r.body.code === 'stay_capacity_full')).toBe(true);
    expect(await count(t.db, t.sql`SELECT count(*)::int AS n FROM stays WHERE host_property_id = ${host.propertyId} AND ended_at IS NULL`)).toBe(2);
  });

  it('allow_stays=false permits visits but not stays; owner cannot stay at home', async () => {
    const host = await t.newcomer('visitsonly');
    const guest = await t.newcomer('visitor2');
    await t.call(host, 'PATCH', `/v1/properties/${host.propertyId}/access`, { allow_stays: false });
    expect((await t.call(guest, 'POST', `/v1/properties/${host.propertyId}/visit`)).status).toBe(200);
    expect((await t.call(guest, 'POST', `/v1/spaces/${host.spaceId}/stay`, undefined, { idem: true })).body.code).toBe('stay_not_allowed');
    expect((await t.call(host, 'POST', `/v1/spaces/${host.spaceId}/stay`, undefined, { idem: true })).body.code).toBe('stay_not_allowed');
  });

  it('owner Send Home ends a stay without any message; non-owners cannot', async () => {
    const host = await t.newcomer('sender');
    const guest = await t.newcomer('sent');
    const third = await t.newcomer('bystander');
    await t.call(guest, 'POST', `/v1/spaces/${host.spaceId}/stay`, undefined, { idem: true });
    expect((await t.call(third, 'DELETE', `/v1/spaces/${host.spaceId}/stays/${guest.residentId}`, undefined, { idem: true })).status).toBe(404);
    expect((await t.call(host, 'DELETE', `/v1/spaces/${host.spaceId}/stays/${guest.residentId}`, undefined, { idem: true })).status).toBe(200);
    expect((await t.call(guest, 'GET', '/v1/me')).body.active_stay).toBeUndefined();
    expect(await count(t.db, t.sql`SELECT count(*)::int AS n FROM stays WHERE resident_id = ${guest.residentId} AND end_reason = 'sent_home'`)).toBe(1);
  });
});

describe('Milestone 5: gifts', () => {
  it('gift transfers atomically, reveals giver intentionally, owner resolves Keep Here', async () => {
    const host = await t.newcomer('recipient');
    const giver = await t.newcomer('giver');
    await t.call(giver, 'PATCH', '/v1/resident', { display_name: 'Juniper' });
    const item = await buyGift(giver);
    const g = await t.call(giver, 'POST', '/v1/gifts', { property_id: host.propertyId, space_id: host.spaceId, item_instance_id: item, drop_x_u: 3000, drop_y_u: 4000 }, { idem: true });
    expect(g.status).toBe(201);
    expect(g.body.status).toBe('pending_placement');
    expect((await t.call(giver, 'GET', '/v1/inventory')).body.items.map((i: { id: string }) => i.id)).not.toContain(item);
    const inbox = await t.call(host, 'GET', '/v1/gifts/inbox');
    expect(inbox.body.items).toHaveLength(1);
    expect(inbox.body.items[0]).toMatchObject({ giver_resident_id: giver.residentId, giver: { display_name: 'Juniper', linkable: true } });
    // Pending gift is visible to the owner in the room but is not a placement until resolved.
    const space = await t.call(host, 'GET', `/v1/spaces/${host.spaceId}`);
    expect(space.body.pending_gifts).toHaveLength(1);
    expect(space.body.placements).toHaveLength(0);
    const kept = await t.call(host, 'POST', `/v1/gifts/${g.body.id}/resolve`, { action: 'keep_here' }, { idem: true });
    expect(kept.body.status).toBe('kept_here');
    const after = await t.call(host, 'GET', `/v1/spaces/${host.spaceId}`);
    expect(after.body.placements).toEqual([expect.objectContaining({ item_instance_id: item, x_u: 3000, y_u: 4000 })]);
    expect(after.body.layout_revision).toBe(2);
    expect((await t.call(host, 'POST', `/v1/gifts/${g.body.id}/resolve`, { action: 'put_away' }, { idem: true })).status).toBe(409);
  });

  it('§73.3 gift retry: 60 retries with one key -> one transfer', async () => {
    const host = await t.newcomer('retryhost');
    const giver = await t.newcomer('retrygiver');
    const item = await buyGift(giver, 'gift.pebble.smooth.001');
    const k = key('gift');
    const body = { property_id: host.propertyId, space_id: host.spaceId, item_instance_id: item, drop_x_u: 1000, drop_y_u: 1000 };
    const rs = await Promise.all(Array.from({ length: 30 }, () => t.call(giver, 'POST', '/v1/gifts', body, { idem: k })));
    for (let i = 0; i < 30; i++) rs.push(await t.call(giver, 'POST', '/v1/gifts', body, { idem: k }));
    expect(rs.every((r) => r.status === 201)).toBe(true);
    expect(new Set(rs.map((r) => r.body.id)).size).toBe(1);
    expect(await count(t.db, t.sql`SELECT count(*)::int AS n FROM gifts WHERE item_instance_id = ${item}`)).toBe(1);
    // A new key for the already-given item is refused (the giver no longer owns it).
    expect((await t.call(giver, 'POST', '/v1/gifts', body, { idem: true })).body.code).toBe('gift_not_allowed');
  });

  it('only gift-eligible, owned, unplaced items; decline returns the item to the giver', async () => {
    const host = await t.newcomer('declinehost');
    const giver = await t.newcomer('declinegiver');
    const chair = (await t.call(giver, 'GET', '/v1/inventory')).body.items.find((i: { definition_key: string }) => i.definition_key === 'furniture.chair.softwood.001');
    const base = { property_id: host.propertyId, space_id: host.spaceId, drop_x_u: 1000, drop_y_u: 1000 };
    expect((await t.call(giver, 'POST', '/v1/gifts', { ...base, item_instance_id: chair.id }, { idem: true })).body.code).toBe('gift_not_allowed');
    const item = await buyGift(giver, 'gift.book.stack.001');
    expect((await t.call(giver, 'POST', '/v1/gifts', { ...base, item_instance_id: item, drop_x_u: 999_999 }, { idem: true })).status).toBe(422);
    expect((await t.call(giver, 'POST', '/v1/gifts', { ...base, property_id: giver.propertyId, space_id: giver.spaceId, item_instance_id: item }, { idem: true })).body.code).toBe('gift_not_allowed');
    const g = await t.call(giver, 'POST', '/v1/gifts', { ...base, item_instance_id: item }, { idem: true });
    expect((await t.call(giver, 'POST', `/v1/gifts/${g.body.id}/resolve`, { action: 'decline' }, { idem: true })).status).toBe(404);
    expect((await t.call(host, 'POST', `/v1/gifts/${g.body.id}/resolve`, { action: 'decline' }, { idem: true })).body.status).toBe('declined');
    const back = (await t.call(giver, 'GET', '/v1/inventory')).body.items.find((i: { id: string }) => i.id === item);
    expect(back).toMatchObject({ state: 'inventory' });
  });
});

describe('Block and report', () => {
  it('block is bilateral: ends active stays and denies visit, stay, gift, wander and map discovery', async () => {
    const a = await t.newcomer('blocker');
    const b = await t.newcomer('blocked');
    await t.call(b, 'POST', `/v1/spaces/${a.spaceId}/stay`, undefined, { idem: true });
    const item = await buyGift(b);
    expect((await t.call(a, 'POST', '/v1/blocks', { resident_id: b.residentId })).status).toBe(204);
    expect((await t.call(b, 'GET', '/v1/me')).body.active_stay).toBeUndefined();
    for (const [who, target] of [[b, a], [a, b]] as const) {
      expect((await t.call(who, 'POST', `/v1/properties/${target.propertyId}/visit`)).status).toBe(404);
      expect((await t.call(who, 'GET', `/v1/properties/${target.propertyId}`)).status).toBe(404);
      expect((await t.call(who, 'POST', `/v1/spaces/${target.spaceId}/stay`, undefined, { idem: true })).status).toBe(404);
    }
    expect((await t.call(b, 'POST', '/v1/gifts', { property_id: a.propertyId, space_id: a.spaceId, item_instance_id: item, drop_x_u: 1, drop_y_u: 1 }, { idem: true })).status).toBe(404);
    const wander = await t.call(b, 'GET', `/v1/wander?city_id=${t.cityId}&limit=10`);
    expect(wander.body.properties.map((p: { id: string }) => p.id)).not.toContain(a.propertyId);
    const chunks = await t.call(b, 'GET', `/v1/cities/${t.cityId}/chunks?minX=-1&minY=-4&maxX=0&maxY=3`);
    expect(chunks.body.chunks.flatMap((c: { properties: { id: string }[] }) => c.properties.map((p) => p.id))).not.toContain(a.propertyId);
    // Unblock restores access.
    expect((await t.call(a, 'DELETE', `/v1/blocks/${b.residentId}`)).status).toBe(204);
    expect((await t.call(b, 'POST', `/v1/properties/${a.propertyId}/visit`)).status).toBe(200);
  });

  it('§73.8 block race: concurrent stays/gifts vs. block never leave a live interaction after the block', async () => {
    for (let round = 0; round < 5; round++) {
      const a = await t.newcomer(`rblocker${round}`);
      const b = await t.newcomer(`rblocked${round}`);
      const item = await buyGift(b, 'gift.teacup.001');
      await Promise.all([
        t.call(b, 'POST', `/v1/spaces/${a.spaceId}/stay`, undefined, { idem: true }),
        t.call(a, 'POST', '/v1/blocks', { resident_id: b.residentId }),
        t.call(b, 'POST', '/v1/gifts', { property_id: a.propertyId, space_id: a.spaceId, item_instance_id: item, drop_x_u: 1, drop_y_u: 1 }, { idem: true }),
      ]);
      expect(await count(t.db, t.sql`SELECT count(*)::int AS n FROM stays WHERE resident_id = ${b.residentId} AND ended_at IS NULL`)).toBe(0);
      // A gift that committed before the block is legitimate (like a stay the block then ended);
      // what must hold is serialization: once the block is committed nothing new gets through.
      // After the block commits, new attempts are denied.
      expect((await t.call(b, 'POST', `/v1/spaces/${a.spaceId}/stay`, undefined, { idem: true })).status).toBe(404);
      const second = await buyGift(b, 'gift.pebble.smooth.001');
      expect((await t.call(b, 'POST', '/v1/gifts', { property_id: a.propertyId, space_id: a.spaceId, item_instance_id: second, drop_x_u: 1, drop_y_u: 1 }, { idem: true })).status).toBe(404);
      expect((await t.call(b, 'POST', `/v1/properties/${a.propertyId}/visit`)).status).toBe(404);
    }
  });

  it('reports are accepted with a stable id', async () => {
    const a = await t.newcomer('reporter');
    const b = await t.newcomer('reported');
    const r = await t.call(a, 'POST', '/v1/reports', { target_type: 'property', target_id: b.propertyId, reason_code: 'inappropriate_name', details: 'x' });
    expect(r.status).toBe(201);
    expect(r.body.resource_id).toBeTruthy();
    expect((await t.call(a, 'POST', '/v1/reports', { target_type: 'planet', target_id: b.propertyId, reason_code: 'x' })).status).toBe(422);
  });

  it('wander returns only enterable homes, never my own', async () => {
    const me = await t.newcomer('explorer');
    const w = await t.call(me, 'GET', `/v1/wander?city_id=${t.cityId}&limit=10`);
    expect(w.status).toBe(200);
    expect(w.body.properties.length).toBeGreaterThan(0);
    expect(w.body.properties.map((p: { id: string }) => p.id)).not.toContain(me.propertyId);
    expect(w.body.properties.every((p: { access_mode: string }) => p.access_mode === 'open')).toBe(true);
  });
});
