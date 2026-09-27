import { Hono } from 'hono';
import { z } from 'zod';
import { DomainError, FLAGS, MAX_PLACEMENTS_PER_SPACE, STAY_CAPACITY_MAX, inRect, visitBand, VISIT_BAND_COPY } from '@as/domain';
import { sql, rows, one, maybeOne, withTx, getFlag, pgArray, type Executor } from '@as/db';
import { parseBody, uuidParam, type Vars } from '../http';
import { requireAuth, residentOf } from '../auth/middleware';
import { idempotent } from '../idempotency';
import { decideEntry, loadProperty, type PropertyRow } from '../services/social';
import { propertyOut, hasActiveStayers, spaceOut, spaceBounds, type SpaceRow } from '../services/serialize';
import { rateLimit } from './auth';

const AccessBody = z.object({
  access_mode: z.enum(['open', 'closed']).optional(),
  away_access_mode: z.enum(['open', 'closed']).optional(),
  allow_stays: z.boolean().optional(),
  stay_capacity: z.number().int().min(0).max(STAY_CAPACITY_MAX).optional(),
  expected_revision: z.number().int().safe().optional(),
}).strict();

const PlacementInput = z.object({
  item_instance_id: z.string().uuid(),
  x_u: z.number().int().safe(),
  y_u: z.number().int().safe(),
  rotation_q: z.number().int().min(0).max(3),
  scale_milli: z.number().int().min(500).max(2000).default(1000),
  layer: z.number().int().min(-100).max(100).default(0),
}).strict();

const LayoutBody = z.object({
  expected_revision: z.number().int().safe(),
  placements: z.array(PlacementInput).max(MAX_PLACEMENTS_PER_SPACE),
}).strict();

async function spacesOf(db: Executor, propertyId: string) {
  return rows<SpaceRow>(db, sql`
    SELECT id, property_id, space_kind, asset_shell_id, visitor_capacity, layout_revision FROM spaces WHERE property_id = ${propertyId} ORDER BY created_at`);
}

export async function propertyView(db: Executor, p: PropertyRow, viewer: string, entry: { isOwner: boolean; canEnter: boolean; ownerAway: boolean }) {
  const owner = await one<{ id: string; display_name: string }>(db, sql`SELECT id, display_name FROM residents WHERE id = ${p.owner_resident_id}`);
  const spaces = await spacesOf(db, p.id);
  const stayers = await hasActiveStayers(db, p.id);
  return {
    ...propertyOut(p, { hasActiveStayers: stayers }),
    owner,
    space_ids: spaces.map((s) => s.id),
    viewer: {
      is_owner: entry.isOwner,
      can_enter: entry.canEnter,
      can_stay: !entry.isOwner && entry.canEnter && p.allow_stays && p.stay_capacity > 0,
    },
    ...(viewer === p.owner_resident_id ? { owner_away: entry.ownerAway } : {}),
  };
}

export function propertyRoutes() {
  const app = new Hono<{ Variables: Vars }>();
  app.use('/properties/*', requireAuth());
  app.use('/spaces/*', requireAuth());

  app.get('/properties/:propertyId', async (c) => {
    const id = uuidParam(c, 'propertyId');
    const viewer = residentOf(c.get('actor'));
    const db = await c.get('getDb')();
    const p = await loadProperty(db, id);
    if (!p || p.status === 'archived') throw new DomainError('not_found', 'Not found.');
    const entry = await decideEntry(db, p, viewer);
    if (!entry.canEnter) throw new DomainError('forbidden', 'This home is closed right now.');
    return c.json(await propertyView(db, p, viewer, entry));
  });

  app.patch('/properties/:propertyId/access', async (c) => {
    const id = uuidParam(c, 'propertyId');
    const viewer = residentOf(c.get('actor'));
    await rateLimit(c, 'write', `resident:${viewer}`);
    const body = await parseBody(c, AccessBody);
    const db = await c.get('getDb')();
    const out = await withTx(db, async (tx) => {
      const p = await loadProperty(tx, id, { lock: true });
      if (!p || p.owner_resident_id !== viewer || p.status === 'archived') throw new DomainError('not_found', 'Not found.');
      if (body.expected_revision !== undefined && body.expected_revision !== p.revision) {
        throw new DomainError('revision_conflict', 'Access settings changed on another device.', { current_revision: p.revision });
      }
      await tx.execute(sql`
        UPDATE properties SET
          access_mode = COALESCE(${body.access_mode ?? null}, access_mode),
          away_access_mode = COALESCE(${body.away_access_mode ?? null}, away_access_mode),
          allow_stays = COALESCE(${body.allow_stays ?? null}::boolean, allow_stays),
          stay_capacity = COALESCE(${body.stay_capacity ?? null}::smallint, stay_capacity),
          revision = revision + 1, updated_at = now()
        WHERE id = ${id}`);
      const updated = (await loadProperty(tx, id))!;
      return propertyView(tx, updated, viewer, await decideEntry(tx, updated, viewer));
    });
    return c.json(out);
  });

  /** Owner-only anonymous visit aggregate in soft language (Blueprint §11.1, §12). */
  app.get('/properties/:propertyId/visits/summary', async (c) => {
    const id = uuidParam(c, 'propertyId');
    const viewer = residentOf(c.get('actor'));
    const db = await c.get('getDb')();
    const p = await loadProperty(db, id);
    if (!p || p.owner_resident_id !== viewer) throw new DomainError('not_found', 'Not found.');
    const exact = (await getFlag(db, FLAGS.visitExactCounts))?.enabled === true;
    const days = await rows<{ day: string; qualified_visits: number }>(db, sql`
      SELECT day::text AS day, qualified_visits FROM property_visit_daily
       WHERE property_id = ${id} AND day >= CURRENT_DATE - 6 ORDER BY day DESC`);
    const total = days.reduce((a, d) => a + d.qualified_visits, 0);
    const band = visitBand(total);
    return c.json({
      property_id: id,
      window_days: 7,
      band,
      copy: VISIT_BAND_COPY[band],
      days: days.map((d) => ({ day: d.day, band: visitBand(d.qualified_visits), ...(exact ? { count: d.qualified_visits } : {}) })),
      ...(exact ? { count: total } : {}),
    });
  });

  app.get('/spaces/:spaceId', async (c) => {
    const id = uuidParam(c, 'spaceId');
    const viewer = residentOf(c.get('actor'));
    const db = await c.get('getDb')();
    const s = await maybeOne<SpaceRow>(db, sql`
      SELECT id, property_id, space_kind, asset_shell_id, visitor_capacity, layout_revision FROM spaces WHERE id = ${id}`);
    if (!s) throw new DomainError('not_found', 'Not found.');
    const p = await loadProperty(db, s.property_id);
    if (!p || p.status === 'archived') throw new DomainError('not_found', 'Not found.');
    const entry = await decideEntry(db, p, viewer);
    if (!entry.canEnter) throw new DomainError('forbidden', 'This home is closed right now.');
    return c.json(await spaceOut(db, s, { residentId: viewer, isOwner: entry.isOwner }));
  });

  /**
   * Owner-only canonical layout replace with optimistic revision (Blueprint §52).
   * Stale expected_revision => 409 with the current revision; nothing is silently overwritten.
   */
  app.put('/spaces/:spaceId/layout', async (c) => {
    const id = uuidParam(c, 'spaceId');
    const viewer = residentOf(c.get('actor'));
    await rateLimit(c, 'write', `resident:${viewer}`);
    const body = await parseBody(c, LayoutBody);
    return idempotent(c, 'space.layout', async (tx) => {
      const s = await maybeOne<SpaceRow & { owner_resident_id: string; property_status: string }>(tx, sql`
        SELECT s.id, s.property_id, s.space_kind, s.asset_shell_id, s.visitor_capacity, s.layout_revision,
               p.owner_resident_id, p.status AS property_status
          FROM spaces s JOIN properties p ON p.id = s.property_id WHERE s.id = ${id} FOR UPDATE OF s`);
      // Only the owner controls permanent placement (Law L3).
      if (!s || s.owner_resident_id !== viewer || s.property_status === 'archived') throw new DomainError('not_found', 'Not found.');
      if (body.expected_revision !== s.layout_revision) {
        throw new DomainError('revision_conflict', 'This room was changed on another device.', { current_revision: s.layout_revision });
      }
      const ids = body.placements.map((p) => p.item_instance_id);
      if (new Set(ids).size !== ids.length) throw new DomainError('validation_error', 'An item can only be placed once.');
      const items = ids.length
        ? await rows<{ id: string; owner_resident_id: string | null; state: string; rotations: number[] | null; moderation_status: string; placed_space: string | null }>(tx, sql`
            SELECT ii.id, ii.owner_resident_id, ii.state, (d.visual_definition->'rotations') AS rotations, d.moderation_status,
                   (SELECT pl.space_id FROM placements pl WHERE pl.item_instance_id = ii.id AND pl.removed_at IS NULL) AS placed_space
              FROM item_instances ii JOIN item_definitions d ON d.id = ii.definition_id
             WHERE ii.id = ANY(${pgArray(ids)}::uuid[])
             ORDER BY ii.id FOR UPDATE OF ii`)
        : [];
      const byId = new Map(items.map((i) => [i.id, i]));
      const bounds = spaceBounds(s.asset_shell_id);
      for (const [idx, p] of body.placements.entries()) {
        const it = byId.get(p.item_instance_id);
        if (!it || it.owner_resident_id !== viewer) throw new DomainError('validation_error', 'You can only place items you own.', { index: idx });
        const placeable = it.state === 'inventory' || (it.state === 'placed' && it.placed_space === id);
        if (!placeable || it.moderation_status !== 'approved') throw new DomainError('validation_error', 'That item cannot be placed right now.', { index: idx, state: it.state });
        if (!(it.rotations ?? [0]).includes(p.rotation_q * 90)) throw new DomainError('validation_error', 'That rotation is not available for this item.', { index: idx });
        if (!inRect(p.x_u, p.y_u, bounds)) throw new DomainError('validation_error', 'That spot is outside the room.', { index: idx });
      }
      const previouslyPlaced = await rows<{ item_instance_id: string }>(tx, sql`
        UPDATE placements SET removed_at = now() WHERE space_id = ${id} AND removed_at IS NULL RETURNING item_instance_id`);
      const keep = new Set(ids);
      const removed = previouslyPlaced.map((r) => r.item_instance_id).filter((x) => !keep.has(x));
      if (removed.length) {
        await tx.execute(sql`UPDATE item_instances SET state = 'inventory', updated_at = now() WHERE id = ANY(${pgArray(removed)}::uuid[]) AND state = 'placed'`);
      }
      for (const p of body.placements) {
        await tx.execute(sql`
          INSERT INTO placements (space_id, item_instance_id, x_u, y_u, rotation_q, scale_milli, layer)
          VALUES (${id}, ${p.item_instance_id}, ${p.x_u}, ${p.y_u}, ${p.rotation_q}, ${p.scale_milli}, ${p.layer})`);
      }
      if (ids.length) await tx.execute(sql`UPDATE item_instances SET state = 'placed', updated_at = now() WHERE id = ANY(${pgArray(ids)}::uuid[])`);
      const updated = await one<SpaceRow>(tx, sql`
        UPDATE spaces SET layout_revision = layout_revision + 1, updated_at = now() WHERE id = ${id}
        RETURNING id, property_id, space_kind, asset_shell_id, visitor_capacity, layout_revision`);
      return { status: 200, body: { request_id: c.get('requestId'), ...(await spaceOut(tx, updated, { residentId: viewer, isOwner: true })) }, resourceId: id };
    });
  });

  return app;
}
