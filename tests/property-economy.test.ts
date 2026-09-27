import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupTestWorld, count, key, type TestWorld } from './helpers';

let t: TestWorld;
beforeAll(async () => { t = await setupTestWorld({ poolSize: 60 }); });
afterAll(async () => { await t.close(); });

const listingFor = async (who: Parameters<TestWorld['call']>[0], defKey: string) =>
  (await t.call(who, 'GET', `/v1/catalog?city_id=${t.cityId}`)).body.listings.find((l: { definition_key: string }) => l.definition_key === defKey);

describe('Milestone 3: property and decorating', () => {
  it('owner places, moves and removes items with revision CAS; stale write is 409, not an overwrite', async () => {
    const a = await t.newcomer('decorator');
    const inv = (await t.call(a, 'GET', '/v1/inventory')).body.items;
    const bed = inv.find((i: { definition_key: string }) => i.definition_key === 'furniture.bed.simple.001');
    const lamp = inv.find((i: { definition_key: string }) => i.definition_key === 'decor.lamp.paper.001');
    const space = await t.call(a, 'GET', `/v1/spaces/${a.spaceId}`);
    expect(space.body.layout_revision).toBe(1);
    const save1 = await t.call(a, 'PUT', `/v1/spaces/${a.spaceId}/layout`, {
      expected_revision: 1,
      placements: [{ item_instance_id: bed.id, x_u: 2000, y_u: 3000, rotation_q: 1 }, { item_instance_id: lamp.id, x_u: 5000, y_u: 1000, rotation_q: 0 }],
    }, { idem: true });
    expect(save1.status).toBe(200);
    expect(save1.body.layout_revision).toBe(2);
    expect(save1.body.placements).toHaveLength(2);

    // Second device still believes revision 1.
    const stale = await t.call(a, 'PUT', `/v1/spaces/${a.spaceId}/layout`, { expected_revision: 1, placements: [] }, { idem: true });
    expect(stale.status).toBe(409);
    expect(stale.body).toMatchObject({ code: 'revision_conflict', details: { current_revision: 2 } });
    expect((await t.call(a, 'GET', `/v1/spaces/${a.spaceId}`)).body.placements).toHaveLength(2);

    // Move bed, remove lamp.
    const save2 = await t.call(a, 'PUT', `/v1/spaces/${a.spaceId}/layout`, { expected_revision: 2, placements: [{ item_instance_id: bed.id, x_u: 4000, y_u: 3000, rotation_q: 2 }] }, { idem: true });
    expect(save2.body.layout_revision).toBe(3);
    const states = (await t.call(a, 'GET', '/v1/inventory')).body.items.reduce((m: Record<string, string>, i: { id: string; state: string }) => ({ ...m, [i.id]: i.state }), {});
    expect(states[bed.id]).toBe('placed');
    expect(states[lamp.id]).toBe('inventory');
    // Reinstall/resync: canonical layout is fully reproducible from the server.
    const resync = await t.call(a, 'GET', `/v1/spaces/${a.spaceId}`);
    expect(resync.body.placements).toEqual([expect.objectContaining({ item_instance_id: bed.id, x_u: 4000, y_u: 3000, rotation_q: 2, asset_id: 'furniture.bed.simple.001' })]);
  });

  it('server validates bounds, rotation, ownership and duplicates', async () => {
    const a = await t.newcomer('validator');
    const b = await t.newcomer('stranger');
    const mine = (await t.call(a, 'GET', '/v1/inventory')).body.items;
    const theirs = (await t.call(b, 'GET', '/v1/inventory')).body.items;
    const put = (placements: unknown[]) => t.call(a, 'PUT', `/v1/spaces/${a.spaceId}/layout`, { expected_revision: 1, placements }, { idem: true });
    const chair = mine.find((i: { definition_key: string }) => i.definition_key === 'furniture.chair.softwood.001');
    expect((await put([{ item_instance_id: chair.id, x_u: 99_000, y_u: 0, rotation_q: 0 }])).status).toBe(422);
    expect((await put([{ item_instance_id: theirs[0].id, x_u: 1000, y_u: 1000, rotation_q: 0 }])).status).toBe(422);
    expect((await put([{ item_instance_id: chair.id, x_u: 1000, y_u: 1000, rotation_q: 0 }, { item_instance_id: chair.id, x_u: 2000, y_u: 1000, rotation_q: 0 }])).status).toBe(422);
    // Visitors can never write layout (Law L3): the space is "not found" to them for writes.
    expect((await t.call(b, 'PUT', `/v1/spaces/${a.spaceId}/layout`, { expected_revision: 1, placements: [] }, { idem: true })).status).toBe(404);
  });

  it('access settings: owner-only, revision-checked', async () => {
    const a = await t.newcomer('keeper');
    const b = await t.signUp('peeker');
    const p = await t.call(a, 'GET', `/v1/properties/${a.propertyId}`);
    expect(p.body).toMatchObject({ access_mode: 'open', away_access_mode: 'open', allow_stays: true, stay_capacity: 4, viewer: { is_owner: true } });
    const upd = await t.call(a, 'PATCH', `/v1/properties/${a.propertyId}/access`, { access_mode: 'closed', expected_revision: p.body.revision });
    expect(upd.status).toBe(200);
    expect(upd.body.access_mode).toBe('closed');
    expect((await t.call(a, 'PATCH', `/v1/properties/${a.propertyId}/access`, { allow_stays: false, expected_revision: p.body.revision })).status).toBe(409);
    expect((await t.call(b, 'PATCH', `/v1/properties/${a.propertyId}/access`, { access_mode: 'open' })).status).toBe(404);
    expect((await t.call(b, 'GET', `/v1/properties/${a.propertyId}`)).status).toBe(403);
    expect((await t.call(a, 'PATCH', `/v1/properties/${a.propertyId}/access`, { stay_capacity: 21 })).status).toBe(422);
  });
});

describe('Milestone 5: wallet, ledger, store', () => {
  it('§73.2 purchase retry: same key x100 (concurrent + sequential) -> one ledger transaction, one item', async () => {
    const a = await t.newcomer('shopper');
    const listing = await listingFor(a, 'gift.teacup.001');
    const k = key('buy');
    const burst = await Promise.all(Array.from({ length: 50 }, () => t.call(a, 'POST', '/v1/store/purchases', { listing_id: listing.id, quantity: 1 }, { idem: k })));
    for (let i = 0; i < 50; i++) burst.push(await t.call(a, 'POST', '/v1/store/purchases', { listing_id: listing.id, quantity: 1 }, { idem: k }));
    expect(burst.every((r) => r.status === 201)).toBe(true);
    expect(new Set(burst.map((r) => r.body.transaction_id)).size).toBe(1);
    expect(await count(t.db, t.sql`SELECT count(*)::int AS n FROM ledger_transactions WHERE transaction_type = 'store_purchase' AND actor_resident_id = ${a.residentId}`)).toBe(1);
    expect(await count(t.db, t.sql`SELECT count(*)::int AS n FROM item_instances ii JOIN item_definitions d ON d.id = ii.definition_id WHERE ii.owner_resident_id = ${a.residentId} AND d.definition_key = 'gift.teacup.001'`)).toBe(1);
    expect((await t.call(a, 'GET', '/v1/wallet')).body.balance).toBe(500 - 10);
  });

  it('§73.4 insufficient funds leaves no partial ledger or item state', async () => {
    const a = await t.newcomer('broke');
    const sofa = await listingFor(a, 'furniture.sofa.small.001'); // 140
    const before = await count(t.db, t.sql`SELECT count(*)::int AS n FROM item_instances WHERE owner_resident_id = ${a.residentId}`);
    const r = await t.call(a, 'POST', '/v1/store/purchases', { listing_id: sofa.id, quantity: 4 }, { idem: true });
    expect(r.status).toBe(422);
    expect(r.body.code).toBe('insufficient_funds');
    expect(await count(t.db, t.sql`SELECT count(*)::int AS n FROM item_instances WHERE owner_resident_id = ${a.residentId}`)).toBe(before);
    expect(await count(t.db, t.sql`SELECT count(*)::int AS n FROM ledger_transactions WHERE transaction_type = 'store_purchase' AND actor_resident_id = ${a.residentId}`)).toBe(0);
    expect((await t.call(a, 'GET', '/v1/wallet')).body.balance).toBe(500);
  });

  it('concurrent distinct purchases can never overdraw the wallet', async () => {
    const a = await t.newcomer('spender');
    const bed = await listingFor(a, 'furniture.bed.simple.001'); // 120 -> at most 4 of 500
    const rs = await Promise.all(Array.from({ length: 10 }, () => t.call(a, 'POST', '/v1/store/purchases', { listing_id: bed.id, quantity: 1 }, { idem: true })));
    expect(rs.filter((r) => r.status === 201)).toHaveLength(4);
    expect(rs.filter((r) => r.status === 422).every((r) => r.body.code === 'insufficient_funds')).toBe(true);
    expect((await t.call(a, 'GET', '/v1/wallet')).body.balance).toBe(20);
  });

  it('client cannot set prices, owners or balances (unknown fields rejected)', async () => {
    const a = await t.newcomer('cheater');
    const bed = await listingFor(a, 'furniture.bed.simple.001');
    expect((await t.call(a, 'POST', '/v1/store/purchases', { listing_id: bed.id, quantity: 1, unit_price: 0 }, { idem: true })).status).toBe(422);
  });

  it('§73.11 posted ledger is immutable at the database level', async () => {
    const a = await t.newcomer('auditor');
    const tx = await t.db.execute(t.sql`SELECT id FROM ledger_transactions WHERE actor_resident_id = ${a.residentId} AND status = 'posted' LIMIT 1`);
    const id = (tx.rows[0] as { id: string }).id;
    await expect(t.db.execute(t.sql`UPDATE ledger_entries SET amount = amount + 1 WHERE transaction_id = ${id}`)).rejects.toThrow();
    await expect(t.db.execute(t.sql`DELETE FROM ledger_entries WHERE transaction_id = ${id}`)).rejects.toThrow();
    await expect(t.db.execute(t.sql`UPDATE ledger_transactions SET metadata = '{"x":1}' WHERE id = ${id}`)).rejects.toThrow();
  });
});
