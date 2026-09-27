import { Hono } from 'hono';
import { z } from 'zod';
import { DomainError, VISIT_QUALIFY_DWELL_SECONDS, inRect } from '@as/domain';
import { sql, rows, one, maybeOne, enqueueOutbox, withTx, type Tx } from '@as/db';
import { parseBody, parseQuery, uuidParam, type Vars } from '../http';
import { requireAuth, residentOf } from '../auth/middleware';
import { idempotent } from '../idempotency';
import { decideEntry, endStays, isBlockedEitherWay, loadProperty, lockPresence, primaryHome } from '../services/social';
import { giftOut, spaceBounds, spaceOut, type GiftRow, type SpaceRow } from '../services/serialize';
import { propertyView } from './property';
import { rateLimit } from './auth';

const GiftBody = z.object({
  property_id: z.string().uuid(),
  space_id: z.string().uuid(),
  item_instance_id: z.string().uuid(),
  drop_x_u: z.number().int().safe(),
  drop_y_u: z.number().int().safe(),
}).strict();
const ResolveBody = z.object({ action: z.enum(['keep_here', 'put_away', 'decline']) }).strict();
const InboxQuery = z.object({
  status: z.enum(['pending_placement', 'kept_here', 'put_away', 'declined']).default('pending_placement'),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
const BlockBody = z.object({ resident_id: z.string().uuid() }).strict();
const ReportBody = z.object({
  target_type: z.enum(['resident', 'property', 'item']),
  target_id: z.string().uuid(),
  reason_code: z.string().min(1).max(64).regex(/^[a-z0-9_.-]+$/),
  details: z.string().max(2000).optional(),
}).strict();

async function loadGift(tx: Tx, giftId: string) {
  return maybeOne<GiftRow>(tx, sql`
    SELECT id, giver_resident_id, recipient_resident_id, item_instance_id, status, created_at, resolved_at, property_id, space_id, drop_x_u, drop_y_u
      FROM gifts WHERE id = ${giftId} FOR UPDATE`);
}

export function socialRoutes() {
  const app = new Hono<{ Variables: Vars }>();
  for (const p of ['/properties/:propertyId/visit', '/spaces/:spaceId/stay', '/stay', '/spaces/:spaceId/stays/:residentId', '/gifts', '/gifts/*', '/blocks', '/blocks/*', '/reports']) {
    app.use(p, requireAuth());
  }

  /**
   * Visit (Blueprint §11.1): transient observation, NOT live presence. Records a server-only receipt;
   * the owner only ever sees anonymous aggregates. Qualification is measured server-side: the client
   * calls again after the dwell threshold (e.g. on leaving) and the receipt qualifies if enough time passed.
   */
  app.post('/properties/:propertyId/visit', async (c) => {
    const id = uuidParam(c, 'propertyId');
    const viewer = residentOf(c.get('actor'));
    await rateLimit(c, 'visit', `resident:${viewer}`);
    const db = await c.get('getDb')();
    const p = await loadProperty(db, id);
    if (!p || p.status === 'archived') throw new DomainError('not_found', 'Not found.');
    const entry = await decideEntry(db, p, viewer);
    if (!entry.canEnter) throw new DomainError('forbidden', 'This home is closed right now.');
    let qualified = false;
    if (!entry.isOwner) {
      const r = await one<{ newly_qualified: boolean; qualified: boolean }>(db, sql`
        INSERT INTO visit_receipts (property_id, visitor_resident_id, occurred_on)
        VALUES (${id}, ${viewer}, CURRENT_DATE)
        ON CONFLICT (property_id, visitor_resident_id, occurred_on) DO UPDATE SET
          qualified_at = CASE
            WHEN visit_receipts.qualified_at IS NULL
             AND visit_receipts.first_seen_at <= now() - make_interval(secs => ${VISIT_QUALIFY_DWELL_SECONDS}) THEN now()
            ELSE visit_receipts.qualified_at END
        RETURNING (qualified_at IS NOT NULL AND qualified_at = now()) AS newly_qualified, (qualified_at IS NOT NULL) AS qualified`);
      qualified = r.qualified;
      if (r.newly_qualified) {
        // One qualified visit per visitor/property/day, so both counters move together.
        await db.execute(sql`
          INSERT INTO property_visit_daily (property_id, day, qualified_visits, unique_visitors) VALUES (${id}, CURRENT_DATE, 1, 1)
          ON CONFLICT (property_id, day) DO UPDATE SET qualified_visits = property_visit_daily.qualified_visits + 1,
                                                       unique_visitors = property_visit_daily.unique_visitors + 1`);
      }
    }
    const spaces = await rows<SpaceRow>(db, sql`
      SELECT id, property_id, space_kind, asset_shell_id, visitor_capacity, layout_revision FROM spaces WHERE property_id = ${id} ORDER BY created_at`);
    return c.json({
      request_id: c.get('requestId'),
      property: await propertyView(db, p, viewer, entry),
      spaces: await Promise.all(spaces.map((s) => spaceOut(db, s, { residentId: viewer, isOwner: entry.isOwner }))),
      visit: { qualified },
    });
  });

  /**
   * Stay (Blueprint §11.2): the durable public-presence commit. Capacity is enforced under the
   * property row lock, so capacity N can never become N+1; one active foreign Stay per resident is
   * enforced by the presence lock plus a partial unique index.
   */
  app.post('/spaces/:spaceId/stay', async (c) => {
    const spaceId = uuidParam(c, 'spaceId');
    const me = residentOf(c.get('actor'));
    await rateLimit(c, 'stay', `resident:${me}`);
    return idempotent(c, 'stay.start', async (tx) => {
      const space = await maybeOne<{ property_id: string; visitor_capacity: number }>(tx, sql`SELECT property_id, visitor_capacity FROM spaces WHERE id = ${spaceId}`);
      if (!space) throw new DomainError('not_found', 'Not found.');
      // Lock order everywhere: property -> presence rows (sorted) -> stays.
      const p = await loadProperty(tx, space.property_id, { lock: true });
      if (!p || p.status === 'archived') throw new DomainError('not_found', 'Not found.');
      if (p.owner_resident_id === me) throw new DomainError('stay_not_allowed', 'You are already home.');
      if (!(await primaryHome(tx, me))) throw new DomainError('stay_not_allowed', 'Claim a home before staying elsewhere.');
      await lockPresence(tx, [me]);
      const entry = await decideEntry(tx, p, me);
      if (!entry.canEnter || !p.allow_stays) throw new DomainError('stay_not_allowed', 'Stays are not open here right now.');

      const current = await maybeOne<{ id: string; space_id: string }>(tx, sql`SELECT id, space_id FROM stays WHERE resident_id = ${me} AND ended_at IS NULL`);
      if (current?.space_id === spaceId) {
        return { status: 201, body: { request_id: c.get('requestId'), stay_id: current.id, resource_id: current.id }, resourceId: current.id };
      }
      const counts = await one<{ in_property: number; in_space: number }>(tx, sql`
        SELECT count(*)::int AS in_property, count(*) FILTER (WHERE space_id = ${spaceId})::int AS in_space
          FROM stays WHERE host_property_id = ${p.id} AND ended_at IS NULL`);
      if (counts.in_property >= p.stay_capacity || counts.in_space >= space.visitor_capacity) {
        throw new DomainError('stay_capacity_full', 'There is no room to stay here right now.');
      }
      if (current) await endStays(tx, sql`id = ${current.id}`, 'moved');
      const stay = await one<{ id: string }>(tx, sql`
        INSERT INTO stays (resident_id, host_property_id, space_id) VALUES (${me}, ${p.id}, ${spaceId}) RETURNING id`);
      const city = await one<{ city_id: string }>(tx, sql`SELECT city_id FROM plots WHERE id = ${p.plot_id}`);
      await tx.execute(sql`
        UPDATE presence SET state = 'staying', current_city_id = ${city.city_id}, current_property_id = ${p.id},
               current_space_id = ${spaceId}, destination_id = NULL, updated_at = now()
         WHERE resident_id = ${me}`);
      await enqueueOutbox(tx, { eventType: 'stay.started', aggregateType: 'property', aggregateId: p.id, payload: { stay_id: stay.id } });
      return { status: 201, body: { request_id: c.get('requestId'), stay_id: stay.id, resource_id: stay.id }, resourceId: stay.id };
    });
  });

  app.delete('/stay', async (c) => {
    const me = residentOf(c.get('actor'));
    await rateLimit(c, 'stay', `resident:${me}`);
    return idempotent(c, 'stay.end', async (tx) => {
      await lockPresence(tx, [me]);
      const ended = await endStays(tx, sql`resident_id = ${me}`, 'left');
      if (!ended.length) throw new DomainError('not_staying', 'You are not staying anywhere.');
      return { status: 200, body: { request_id: c.get('requestId'), resource_id: ended[0]!.id }, resourceId: ended[0]!.id };
    });
  });

  /** Owner Send Home (Blueprint §11.2): safety/control action, sends no message. */
  app.delete('/spaces/:spaceId/stays/:residentId', async (c) => {
    const spaceId = uuidParam(c, 'spaceId');
    const stayer = uuidParam(c, 'residentId');
    const me = residentOf(c.get('actor'));
    return idempotent(c, 'stay.send_home', async (tx) => {
      const space = await maybeOne<{ property_id: string }>(tx, sql`SELECT property_id FROM spaces WHERE id = ${spaceId}`);
      if (!space) throw new DomainError('not_found', 'Not found.');
      const p = await loadProperty(tx, space.property_id, { lock: true });
      if (!p || p.owner_resident_id !== me) throw new DomainError('not_found', 'Not found.');
      await lockPresence(tx, [stayer]);
      const ended = await endStays(tx, sql`resident_id = ${stayer} AND space_id = ${spaceId}`, 'sent_home');
      if (!ended.length) throw new DomainError('not_found', 'Nobody by that id is staying here.');
      await enqueueOutbox(tx, { eventType: 'stay.sent_home', aggregateType: 'property', aggregateId: p.id, payload: { stay_id: ended[0]!.id } });
      return { status: 200, body: { request_id: c.get('requestId'), resource_id: ended[0]!.id }, resourceId: ended[0]!.id };
    });
  });

  /**
   * Leave Gift (Blueprint §11.4): system-safe catalog items only; ownership moves to the recipient
   * in one transaction and the item waits as pending_placement. Gifts never grant layout authority.
   */
  app.post('/gifts', async (c) => {
    const me = residentOf(c.get('actor'));
    await rateLimit(c, 'gift', `resident:${me}`);
    const body = await parseBody(c, GiftBody);
    return idempotent(c, 'gift.leave', async (tx) => {
      const item = await maybeOne<{ id: string; owner_resident_id: string | null; state: string; gift_eligible: boolean; moderation_status: string; provenance: Record<string, unknown> }>(tx, sql`
        SELECT ii.id, ii.owner_resident_id, ii.state, d.gift_eligible, d.moderation_status, ii.provenance
          FROM item_instances ii JOIN item_definitions d ON d.id = ii.definition_id
         WHERE ii.id = ${body.item_instance_id} FOR UPDATE OF ii`);
      if (!item || item.owner_resident_id !== me) throw new DomainError('gift_not_allowed', 'You can only give items you own.');
      if (item.state !== 'inventory') throw new DomainError('gift_not_allowed', 'Put the item away before giving it.');
      if (!item.gift_eligible || item.moderation_status !== 'approved') throw new DomainError('gift_not_allowed', 'This item cannot be given as a gift.');

      const space = await maybeOne<{ id: string; property_id: string; asset_shell_id: string | null }>(tx, sql`
        SELECT id, property_id, asset_shell_id FROM spaces WHERE id = ${body.space_id}`);
      if (!space || space.property_id !== body.property_id) throw new DomainError('not_found', 'Not found.');
      const p = await loadProperty(tx, body.property_id);
      if (!p || p.status === 'archived') throw new DomainError('not_found', 'Not found.');
      if (p.owner_resident_id === me) throw new DomainError('gift_not_allowed', 'You cannot give a gift to yourself.');
      await lockPresence(tx, [me, p.owner_resident_id]); // serializes against a concurrent block
      const entry = await decideEntry(tx, p, me);
      if (!entry.canEnter) throw new DomainError('gift_not_allowed', 'This home is closed right now.');
      if (!inRect(body.drop_x_u, body.drop_y_u, spaceBounds(space.asset_shell_id))) {
        throw new DomainError('validation_error', 'That spot is outside the room.');
      }
      const gift = await one<GiftRow>(tx, sql`
        INSERT INTO gifts (giver_resident_id, recipient_resident_id, property_id, space_id, item_instance_id, drop_x_u, drop_y_u)
        VALUES (${me}, ${p.owner_resident_id}, ${p.id}, ${space.id}, ${item.id}, ${body.drop_x_u}, ${body.drop_y_u})
        RETURNING id, giver_resident_id, recipient_resident_id, item_instance_id, status, created_at, resolved_at, property_id, space_id, drop_x_u, drop_y_u`);
      await tx.execute(sql`
        UPDATE item_instances SET owner_resident_id = ${p.owner_resident_id}, state = 'pending_placement', updated_at = now(),
               provenance = provenance || jsonb_build_object('gifted_by', ${me}::text, 'gift_id', ${gift.id}::text)
         WHERE id = ${item.id}`);
      await enqueueOutbox(tx, { eventType: 'gift.created', aggregateType: 'gift', aggregateId: gift.id, payload: { recipient_resident_id: p.owner_resident_id } });
      return { status: 201, body: { request_id: c.get('requestId'), ...giftOut(gift) }, resourceId: gift.id };
    });
  });

  app.get('/gifts/inbox', async (c) => {
    const me = residentOf(c.get('actor'));
    const q = parseQuery(c, InboxQuery);
    const db = await c.get('getDb')();
    const list = await rows<GiftRow & { giver_name: string; giver_tag: string; giver_active: boolean; blocked: boolean; asset_id: string; definition_key: string }>(db, sql`
      SELECT g.id, g.giver_resident_id, g.recipient_resident_id, g.item_instance_id, g.status, g.created_at, g.resolved_at,
             g.property_id, g.space_id, g.drop_x_u, g.drop_y_u,
             r.display_name AS giver_name, r.public_tag AS giver_tag, (u.status = 'active') AS giver_active,
             EXISTS (SELECT 1 FROM blocks b WHERE (b.blocker_resident_id = ${me} AND b.blocked_resident_id = g.giver_resident_id)
                                               OR (b.blocker_resident_id = g.giver_resident_id AND b.blocked_resident_id = ${me})) AS blocked,
             d.visual_definition->>'asset_id' AS asset_id, d.definition_key
        FROM gifts g
        JOIN residents r ON r.id = g.giver_resident_id
        JOIN users u ON u.id = r.user_id
        JOIN item_instances ii ON ii.id = g.item_instance_id
        JOIN item_definitions d ON d.id = ii.definition_id
       WHERE g.recipient_resident_id = ${me} AND g.status = ${q.status}
       ORDER BY g.created_at DESC
       LIMIT ${q.limit}`);
    return c.json({
      items: list.map((g) =>
        giftOut(g, {
          // Gift identity reveal is intentional (Blueprint §11.4); provenance stays visible without a profile link after block/deletion.
          giver: { display_name: g.giver_active ? g.giver_name : 'Former resident', linkable: g.giver_active && !g.blocked },
          asset_id: g.asset_id,
          definition_key: g.definition_key,
        }),
      ),
    });
  });

  app.post('/gifts/:giftId/resolve', async (c) => {
    const giftId = uuidParam(c, 'giftId');
    const me = residentOf(c.get('actor'));
    const body = await parseBody(c, ResolveBody);
    return idempotent(c, 'gift.resolve', async (tx) => {
      const g = await loadGift(tx, giftId);
      if (!g || g.recipient_resident_id !== me) throw new DomainError('not_found', 'Not found.');
      if (g.status !== 'pending_placement') throw new DomainError('conflict', 'This gift was already resolved.', { status: g.status });
      const item = await one<{ owner_resident_id: string | null; state: string }>(tx, sql`
        SELECT owner_resident_id, state FROM item_instances WHERE id = ${g.item_instance_id} FOR UPDATE`);
      if (item.owner_resident_id !== me || item.state !== 'pending_placement') throw new Error('gift item ownership invariant violated');

      let status: string;
      if (body.action === 'keep_here') {
        // Only the recipient's own action creates canonical placement.
        const space = await maybeOne<{ id: string; owner: string; property_status: string }>(tx, sql`
          SELECT s.id, p.owner_resident_id AS owner, p.status AS property_status
            FROM spaces s JOIN properties p ON p.id = s.property_id WHERE s.id = ${g.space_id} FOR UPDATE OF s`);
        if (!space || space.owner !== me || space.property_status === 'archived') {
          throw new DomainError('conflict', 'That room is no longer available; put the gift away instead.');
        }
        await tx.execute(sql`INSERT INTO placements (space_id, item_instance_id, x_u, y_u) VALUES (${g.space_id}, ${g.item_instance_id}, ${g.drop_x_u}, ${g.drop_y_u})`);
        await tx.execute(sql`UPDATE spaces SET layout_revision = layout_revision + 1, updated_at = now() WHERE id = ${g.space_id}`);
        await tx.execute(sql`UPDATE item_instances SET state = 'placed', updated_at = now() WHERE id = ${g.item_instance_id}`);
        status = 'kept_here';
      } else if (body.action === 'put_away') {
        await tx.execute(sql`UPDATE item_instances SET state = 'inventory', updated_at = now() WHERE id = ${g.item_instance_id}`);
        status = 'put_away';
      } else {
        const giver = await maybeOne<{ active: boolean }>(tx, sql`
          SELECT (u.status = 'active') AS active FROM residents r JOIN users u ON u.id = r.user_id WHERE r.id = ${g.giver_resident_id}`);
        const canReturn = giver?.active && !(await isBlockedEitherWay(tx, me, g.giver_resident_id));
        if (canReturn) {
          await tx.execute(sql`UPDATE item_instances SET owner_resident_id = ${g.giver_resident_id}, state = 'inventory', updated_at = now()
                                WHERE id = ${g.item_instance_id}`);
        } else {
          // Cannot return: retire under system ownership (exactly one owner is a schema invariant).
          await tx.execute(sql`UPDATE item_instances SET owner_resident_id = NULL, owner_system_code = 'RETIRED', state = 'retired', updated_at = now()
                                WHERE id = ${g.item_instance_id}`);
        }
        status = 'declined';
      }
      const updated = await one<GiftRow>(tx, sql`
        UPDATE gifts SET status = ${status}, resolved_at = now() WHERE id = ${giftId}
        RETURNING id, giver_resident_id, recipient_resident_id, item_instance_id, status, created_at, resolved_at, property_id, space_id, drop_x_u, drop_y_u`);
      await enqueueOutbox(tx, { eventType: 'gift.resolved', aggregateType: 'gift', aggregateId: giftId, payload: { status } });
      return { status: 200, body: { request_id: c.get('requestId'), ...giftOut(updated) }, resourceId: giftId };
    });
  });

  /**
   * Block (Blueprint §13): bilateral. Ends any active Stay between the two in the same transaction.
   * Presence rows of both residents are locked first, which serializes against concurrent Stay/Gift
   * so nothing can slip in after the block commits.
   */
  app.post('/blocks', async (c) => {
    const me = residentOf(c.get('actor'));
    await rateLimit(c, 'write', `resident:${me}`);
    const body = await parseBody(c, BlockBody);
    if (body.resident_id === me) throw new DomainError('validation_error', 'You cannot block yourself.');
    const db = await c.get('getDb')();
    await withTx(db, async (tx) => {
      const target = await maybeOne(tx, sql`SELECT 1 AS x FROM residents WHERE id = ${body.resident_id}`);
      if (!target) throw new DomainError('not_found', 'Not found.');
      await lockPresence(tx, [me, body.resident_id]);
      await tx.execute(sql`INSERT INTO blocks (blocker_resident_id, blocked_resident_id) VALUES (${me}, ${body.resident_id}) ON CONFLICT DO NOTHING`);
      await endStays(tx, sql`
        (resident_id = ${me} AND host_property_id IN (SELECT id FROM properties WHERE owner_resident_id = ${body.resident_id}))
        OR (resident_id = ${body.resident_id} AND host_property_id IN (SELECT id FROM properties WHERE owner_resident_id = ${me}))`, 'blocked');
    });
    return c.body(null, 204);
  });

  app.delete('/blocks/:residentId', async (c) => {
    const me = residentOf(c.get('actor'));
    const target = uuidParam(c, 'residentId');
    const db = await c.get('getDb')();
    await db.execute(sql`DELETE FROM blocks WHERE blocker_resident_id = ${me} AND blocked_resident_id = ${target}`);
    return c.body(null, 204);
  });

  app.post('/reports', async (c) => {
    const me = residentOf(c.get('actor'));
    await rateLimit(c, 'report', `resident:${me}`);
    const body = await parseBody(c, ReportBody);
    const db = await c.get('getDb')();
    const r = await withTx(db, async (tx) => {
      const row = await one<{ id: string }>(tx, sql`
        INSERT INTO reports (reporter_resident_id, target_type, target_id, reason_code, details)
        VALUES (${me}, ${body.target_type}, ${body.target_id}, ${body.reason_code}, ${body.details?.trim() || null})
        RETURNING id`);
      await enqueueOutbox(tx, { eventType: 'report.created', aggregateType: 'report', aggregateId: row.id, payload: { target_type: body.target_type } });
      return row;
    });
    return c.json({ request_id: c.get('requestId'), resource_id: r.id }, 201);
  });

  return app;
}
