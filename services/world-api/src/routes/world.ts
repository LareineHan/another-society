import { Hono } from 'hono';
import { z } from 'zod';
import {
  DomainError, MAX_CHUNK_WINDOW, chunkWindowSize, RESERVATION_TTL_SECONDS, STARTER_STRUCTURE_ASSET_IDS, STARTER_GRANT_WORLD,
  STARTER_KIT_DEFINITION_KEYS, FLAGS, isPubliclyEnterable,
} from '@as/domain';
import { sql, rows, one, maybeOne, enqueueOutbox, getAllFlags, getFlag, type Tx } from '@as/db';
import { ASSET_PACKS, findAsset, rotationAllowed } from '@as/asset-manifest';
import { maybeActivateCity } from '@as/world-template';
import { parseBody, parseQuery, uuidParam, sha256Hex, type Vars, type Ctx } from '../http';
import { requireAuth, residentOf } from '../auth/middleware';
import { idempotent } from '../idempotency';
import { postLedger, residentWalletId, systemWalletId } from '../services/ledger';
import { cancelLiveReservations, effectivePlotStatus } from '../services/plots';
import { propertyOut, type ResidentRow } from '../services/serialize';
import { loadProperty } from '../services/social';
import { rateLimit } from './auth';

const Int = z.coerce.number().int().safe();
const ChunkQuery = z.object({ minX: Int, minY: Int, maxX: Int, maxY: Int });
const CityQuery = z.object({ city_id: z.string().uuid() });
const WanderQuery = z.object({ city_id: z.string().uuid(), x_u: Int.optional(), y_u: Int.optional(), limit: z.coerce.number().int().min(1).max(10).default(5) });
const ClaimBody = z.object({
  reservation_id: z.string().uuid(),
  structure_asset_id: z.string().min(1).max(128),
  structure_x_u: z.number().int().safe().default(0),
  structure_y_u: z.number().int().safe().default(0),
  structure_rot_q: z.number().int().min(0).max(3).default(0),
}).strict();

interface PlotRow {
  id: string;
  status: string;
  center_x_u: number;
  center_y_u: number;
  terrain_type: string;
  zone_type: string;
  scenic_tags: string[];
  build_bounds: { x_u: number; y_u: number }[];
  chunk_x: number;
  chunk_y: number;
  frontage_node_id: string;
  city_id: string;
}

const plotSelect = sql`
  SELECT p.id, ${effectivePlotStatus} AS status, p.center_x_u, p.center_y_u, p.terrain_type, p.zone_type, p.scenic_tags,
         p.build_bounds, c.chunk_x, c.chunk_y, p.frontage_node_id, p.city_id
    FROM plots p JOIN chunks c ON c.id = p.chunk_id`;

/**
 * Quiet map-fact labels (Blueprint §7.3) — derived from geometry/tags, never a recommendation score.
 */
function plotLabels(p: PlotRow, anchors: { kind: string; x_u: number; y_u: number }[], occupiedNear: boolean): string[] {
  const labels: string[] = [];
  const dist = (a: { x_u: number; y_u: number }) => Math.hypot(a.x_u - p.center_x_u, a.y_u - p.center_y_u);
  const civic = anchors.filter((a) => a.kind !== 'park');
  if (civic.length && Math.min(...civic.map(dist)) <= 20_000) labels.push('closer_to_town');
  const park = anchors.filter((a) => a.kind === 'park');
  if (park.length && Math.min(...park.map(dist)) <= 15_000) labels.push('near_park');
  if (occupiedNear) labels.push('near_neighbors');
  if (p.scenic_tags.includes('edge')) labels.push('quieter_edge');
  if (p.scenic_tags.includes('forest')) labels.push('forest_side');
  return labels;
}

function plotOut(p: PlotRow, extras: Record<string, unknown> = {}) {
  return {
    id: p.id,
    status: p.status,
    center_x_u: p.center_x_u,
    center_y_u: p.center_y_u,
    terrain_type: p.terrain_type,
    zone_type: p.zone_type,
    scenic_tags: p.scenic_tags,
    build_bounds: { points: p.build_bounds },
    chunk_x: p.chunk_x,
    chunk_y: p.chunk_y,
    ...extras,
  };
}

let packHashes: Promise<Map<string, string>> | undefined;
const manifestHashes = () =>
  (packHashes ??= Promise.all(ASSET_PACKS.map(async (p) => [p.pack_id, await sha256Hex(JSON.stringify(p))] as const)).then((e) => new Map(e)));

async function cityExists(c: Ctx, cityId: string) {
  const db = await c.get('getDb')();
  const city = await maybeOne<{ id: string; activation_revision: number; status: string }>(db, sql`
    SELECT id, activation_revision, status FROM cities WHERE id = ${cityId}`);
  if (!city) throw new DomainError('not_found', 'Not found.');
  return city;
}

export function worldRoutes() {
  const app = new Hono<{ Variables: Vars }>();
  for (const p of ['/world/*', '/cities/*', '/onboarding/*', '/plots/*', '/wander']) app.use(p, requireAuth());

  app.get('/world/bootstrap', async (c) => {
    const db = await c.get('getDb')();
    const world = await maybeOne<{ id: string; rules_version: number }>(db, sql`SELECT id, rules_version FROM worlds ORDER BY created_at LIMIT 1`);
    if (!world) throw new DomainError('not_found', 'World is not open yet.');
    const cities = await rows<{ id: string; display_name: string; status: string; activation_revision: number; theme: string | null }>(db, sql`
      SELECT c.id, c.display_name, c.status, c.activation_revision, c.theme
        FROM cities c JOIN regions r ON r.id = c.region_id WHERE r.world_id = ${world.id} ORDER BY c.created_at`);
    const flags = await getAllFlags(db);
    const hashes = await manifestHashes();
    const base = c.get('deps').config.assetBaseUrl.replace(/\/$/, '');
    return c.json({
      world_id: world.id,
      rules_version: world.rules_version,
      cities,
      asset_packs: ASSET_PACKS.map((p) => ({
        pack_id: p.pack_id,
        version: Number.parseInt(p.pack_version, 10),
        manifest_url: `${base}/packs/${p.pack_id}.v${p.pack_version}.json`,
        sha256: hashes.get(p.pack_id),
      })),
      features: Object.fromEntries(Object.entries(flags).map(([k, v]) => [k, v.enabled])),
      coordinate_system: { units_per_tile: 1000, chunk_size_u: 32000 },
    });
  });

  /** Dynamic state for a bounded chunk window only (Blueprint §9). Never the whole city. */
  app.get('/cities/:cityId/chunks', async (c) => {
    const cityId = uuidParam(c, 'cityId');
    const q = parseQuery(c, ChunkQuery);
    if (q.maxX < q.minX || q.maxY < q.minY) throw new DomainError('validation_error', 'Chunk window is inverted.');
    if (chunkWindowSize(q) > MAX_CHUNK_WINDOW) throw new DomainError('validation_error', `A chunk window may cover at most ${MAX_CHUNK_WINDOW} chunks.`);
    await cityExists(c, cityId);
    const viewer = residentOf(c.get('actor'));
    const db = await c.get('getDb')();
    const chunks = await rows<{ id: string; x: number; y: number; revision: number }>(db, sql`
      SELECT id, chunk_x AS x, chunk_y AS y, revision FROM chunks
       WHERE city_id = ${cityId} AND chunk_x BETWEEN ${q.minX} AND ${q.maxX} AND chunk_y BETWEEN ${q.minY} AND ${q.maxY}
       ORDER BY chunk_y, chunk_x`);
    if (!chunks.length) return c.json({ chunks: [] });
    const ids = chunks.map((ch) => ch.id);
    const plots = await rows<PlotRow & { chunk_id: string }>(db, sql`
      SELECT * FROM (${plotSelect} WHERE p.city_id = ${cityId} AND p.chunk_id = ANY(${sql.param(ids)}::uuid[]) AND p.status NOT IN ('latent','retired')) x`);
    const chunkByXY = new Map(chunks.map((ch) => [`${ch.x},${ch.y}`, ch.id]));
    const props = await rows<{ id: string; plot_id: string; structure_asset_id: string; access_mode: string; away_access_mode: string; has_active_stayers: boolean; chunk_id: string; structure_x_u: number; structure_y_u: number; structure_rot_q: number }>(db, sql`
      SELECT pr.id, pr.plot_id, pr.structure_asset_id, pr.access_mode, pr.away_access_mode, pr.structure_x_u, pr.structure_y_u, pr.structure_rot_q,
             pl.chunk_id, EXISTS (SELECT 1 FROM stays s WHERE s.host_property_id = pr.id AND s.ended_at IS NULL) AS has_active_stayers
        FROM properties pr
        JOIN plots pl ON pl.id = pr.plot_id
        JOIN residents r ON r.id = pr.owner_resident_id
        JOIN users u ON u.id = r.user_id AND u.status = 'active'
       WHERE pl.chunk_id = ANY(${sql.param(ids)}::uuid[]) AND pr.status = 'active'
         AND NOT EXISTS (SELECT 1 FROM blocks b
                          WHERE (b.blocker_resident_id = ${viewer} AND b.blocked_resident_id = pr.owner_resident_id)
                             OR (b.blocker_resident_id = pr.owner_resident_id AND b.blocked_resident_id = ${viewer}))`);
    return c.json({
      chunks: chunks.map((ch) => ({
        id: ch.id,
        x: ch.x,
        y: ch.y,
        revision: ch.revision,
        plots: plots.filter((p) => chunkByXY.get(`${p.chunk_x},${p.chunk_y}`) === ch.id).map((p) => plotOut(p)),
        properties: props.filter((p) => p.chunk_id === ch.id).map(({ chunk_id: _c, ...p }) => p),
      })),
    });
  });

  /** Active public road graph + civic anchors for client-side A* (Blueprint §6.3). ETag = activation revision. */
  app.get('/cities/:cityId/roads', async (c) => {
    const cityId = uuidParam(c, 'cityId');
    const city = await cityExists(c, cityId);
    const etag = `"roads-${city.activation_revision}"`;
    if (c.req.header('if-none-match') === etag) return c.body(null, 304, { ETag: etag });
    const db = await c.get('getDb')();
    const [nodes, edges, civic] = [
      await rows(db, sql`SELECT id, x_u, y_u, node_kind FROM road_nodes WHERE city_id = ${cityId} AND active ORDER BY stable_template_key`),
      await rows(db, sql`SELECT id, from_node_id, to_node_id, edge_kind, weight_milli, geometry_points FROM road_edges WHERE city_id = ${cityId} AND active ORDER BY stable_template_key`),
      await rows(db, sql`SELECT a.id, a.kind, a.x_u, a.y_u, a.road_node_id FROM civic_anchors a WHERE a.city_id = ${cityId} ORDER BY a.stable_template_key`),
    ];
    c.header('ETag', etag);
    return c.json({ city_id: cityId, activation_revision: city.activation_revision, nodes, edges, civic_anchors: civic });
  });

  /** Every active vacant plot, so the newcomer chooses the exact place (Blueprint §7.3). */
  app.get('/onboarding/plots', async (c) => {
    const { city_id } = parseQuery(c, CityQuery);
    await cityExists(c, city_id);
    const actor = c.get('actor');
    const db = await c.get('getDb')();
    const plots = await rows<PlotRow & { reserved_by_me: boolean; neighbors: boolean }>(db, sql`
      SELECT x.*, EXISTS (SELECT 1 FROM plot_reservations r WHERE r.plot_id = x.id AND r.user_id = ${actor.userId}
                           AND r.claimed_at IS NULL AND r.cancelled_at IS NULL AND r.expires_at > now()) AS reserved_by_me,
             EXISTS (SELECT 1 FROM plots o WHERE o.city_id = x.city_id AND o.status = 'occupied'
                      AND abs(o.center_x_u - x.center_x_u) + abs(o.center_y_u - x.center_y_u) <= 12000) AS neighbors
        FROM (${plotSelect} WHERE p.city_id = ${city_id} AND p.status IN ('vacant','reserved')) x`);
    const anchors = await rows<{ kind: string; x_u: number; y_u: number }>(db, sql`SELECT kind, x_u, y_u FROM civic_anchors WHERE city_id = ${city_id}`);
    const visible = plots.filter((p) => p.status === 'vacant' || p.reserved_by_me);
    return c.json({
      plots: visible.map((p) => plotOut(p, { labels: plotLabels(p, anchors, p.neighbors), reserved_by_me: p.reserved_by_me })),
    });
  });

  app.post('/plots/:plotId/reserve', async (c) => {
    const plotId = uuidParam(c, 'plotId');
    const actor = c.get('actor');
    const rid = residentOf(actor);
    await rateLimit(c, 'plot', `user:${actor.userId}`);
    let reservedCity: string | undefined;
    const res = await idempotent(c, 'plot.reserve', async (tx) => {
      const resident = await one<{ onboarding_state: string }>(tx, sql`SELECT onboarding_state FROM residents WHERE id = ${rid} FOR UPDATE`);
      const home = await maybeOne(tx, sql`SELECT 1 AS x FROM properties WHERE owner_resident_id = ${rid} AND is_primary_home AND status <> 'archived'`);
      if (home || resident.onboarding_state !== 'choosing_plot') throw new DomainError('already_has_home', 'You already have a home.');

      // Lapsed reservation on this plot returns to vacancy first.
      await tx.execute(sql`
        WITH lapsed AS (
          UPDATE plot_reservations SET cancelled_at = now()
           WHERE plot_id = ${plotId} AND claimed_at IS NULL AND cancelled_at IS NULL AND expires_at <= now()
           RETURNING plot_id)
        UPDATE plots SET status = 'vacant', revision = revision + 1 WHERE id IN (SELECT plot_id FROM lapsed) AND status = 'reserved'`);

      const plot = await maybeOne<{ id: string; status: string; revision: number; frontage_active: boolean; city_status: string }>(tx, sql`
        SELECT p.id, p.status, p.revision, rn.active AS frontage_active, ci.status AS city_status
          FROM plots p JOIN road_nodes rn ON rn.id = p.frontage_node_id JOIN cities ci ON ci.id = p.city_id
         WHERE p.id = ${plotId} FOR UPDATE OF p`);
      if (!plot || plot.status === 'latent' || plot.status === 'retired') throw new DomainError('not_found', 'Not found.');

      const mine = await maybeOne<{ id: string; expires_at: Date }>(tx, sql`
        SELECT id, expires_at FROM plot_reservations
         WHERE plot_id = ${plotId} AND user_id = ${actor.userId} AND claimed_at IS NULL AND cancelled_at IS NULL AND expires_at > now()`);
      if (mine) {
        return { status: 201, body: { request_id: c.get('requestId'), resource_id: mine.id, reservation_id: mine.id, expires_at: new Date(mine.expires_at).toISOString(), revision: plot.revision }, resourceId: mine.id };
      }
      if (plot.status !== 'vacant' || !plot.frontage_active || plot.city_status !== 'open') {
        throw new DomainError('plot_unavailable', 'That place was just taken. Please choose another.');
      }
      await cancelLiveReservations(tx, actor.userId, plotId);
      const r = await one<{ id: string; expires_at: Date }>(tx, sql`
        INSERT INTO plot_reservations (plot_id, user_id, expires_at)
        VALUES (${plotId}, ${actor.userId}, now() + make_interval(secs => ${RESERVATION_TTL_SECONDS}))
        RETURNING id, expires_at`);
      const updated = await one<{ revision: number; city_id: string }>(tx, sql`
        UPDATE plots SET status = 'reserved', revision = revision + 1 WHERE id = ${plotId} RETURNING revision, city_id`);
      reservedCity = updated.city_id;
      return {
        status: 201,
        body: { request_id: c.get('requestId'), resource_id: r.id, reservation_id: r.id, expires_at: new Date(r.expires_at).toISOString(), revision: updated.revision },
        resourceId: r.id,
      };
    });
    // Reservations also reduce active vacancy; a burst of newcomers should still see real choice.
    if (reservedCity) await activateBestEffort(c, reservedCity);
    return res;
  });

  /**
   * Atomic claim (Blueprint §7.4): lock plot + reservation, create property + space, occupy plot,
   * place the resident home, post the starter grant through the ledger, hand out the starter kit,
   * all in ONE transaction. Two clients can never both own the same plot.
   */
  app.post('/plots/:plotId/claim', async (c) => {
    const plotId = uuidParam(c, 'plotId');
    const actor = c.get('actor');
    const rid = residentOf(actor);
    await rateLimit(c, 'plot', `user:${actor.userId}`);
    const body = await parseBody(c, ClaimBody);
    const structure = findAsset(body.structure_asset_id);
    if (!structure || structure.asset.kind !== 'structure' || !STARTER_STRUCTURE_ASSET_IDS.includes(body.structure_asset_id)) {
      throw new DomainError('validation_error', 'Unknown starter structure.', { field: 'structure_asset_id' });
    }
    if (!rotationAllowed(structure.asset, body.structure_rot_q)) {
      throw new DomainError('validation_error', 'That rotation is not available for this structure.', { field: 'structure_rot_q' });
    }
    let cityId: string | undefined;
    const res = await idempotent(c, 'plot.claim', async (tx) => {
      const plot = await maybeOne<{ id: string; status: string; city_id: string; center_x_u: number; center_y_u: number; build_bounds: { x_u: number; y_u: number }[] }>(tx, sql`
        SELECT id, status, city_id, center_x_u, center_y_u, build_bounds FROM plots WHERE id = ${plotId} FOR UPDATE`);
      if (!plot) throw new DomainError('not_found', 'Not found.');
      const reservation = await maybeOne<{ id: string; live: boolean }>(tx, sql`
        SELECT id, (claimed_at IS NULL AND cancelled_at IS NULL AND expires_at > now()) AS live
          FROM plot_reservations WHERE id = ${body.reservation_id} AND plot_id = ${plotId} AND user_id = ${actor.userId}
          FOR UPDATE`);
      if (!reservation || !reservation.live) throw new DomainError('reservation_invalid', 'Your reservation expired. Please choose the place again.');
      if (plot.status !== 'reserved') throw new DomainError('plot_unavailable', 'That place is no longer available.');

      const resident = await one<ResidentRow>(tx, sql`
        SELECT id, display_name, public_tag, mini_definition, onboarding_state FROM residents WHERE id = ${rid} FOR UPDATE`);
      const home = await maybeOne(tx, sql`SELECT 1 AS x FROM properties WHERE owner_resident_id = ${rid} AND is_primary_home AND status <> 'archived'`);
      if (home) throw new DomainError('already_has_home', 'You already have a home.');

      assertStructureFits(plot, structure.asset.footprint_u, body);

      const property = await one<{ id: string }>(tx, sql`
        INSERT INTO properties (plot_id, owner_resident_id, property_type, structure_asset_id, structure_x_u, structure_y_u, structure_rot_q, is_primary_home)
        VALUES (${plotId}, ${rid}, 'home', ${body.structure_asset_id}, ${body.structure_x_u}, ${body.structure_y_u}, ${body.structure_rot_q}, true)
        RETURNING id`);
      const space = await one<{ id: string }>(tx, sql`
        INSERT INTO spaces (property_id, space_kind, asset_shell_id) VALUES (${property.id}, 'main', 'default') RETURNING id`);
      await tx.execute(sql`UPDATE plots SET status = 'occupied', revision = revision + 1 WHERE id = ${plotId}`);
      await tx.execute(sql`UPDATE chunks SET revision = revision + 1 WHERE id = (SELECT chunk_id FROM plots WHERE id = ${plotId})`);
      await tx.execute(sql`UPDATE plot_reservations SET claimed_at = now() WHERE id = ${reservation.id}`);
      const miniSet = Object.keys(resident.mini_definition ?? {}).length > 0;
      await tx.execute(sql`UPDATE residents SET onboarding_state = ${miniSet ? 'complete' : 'claimed'}, updated_at = now() WHERE id = ${rid}`);
      await tx.execute(sql`
        UPDATE presence SET state = 'home', current_city_id = ${plot.city_id}, current_property_id = ${property.id},
               current_space_id = ${space.id}, destination_id = NULL, updated_at = now()
         WHERE resident_id = ${rid}`);

      await grantStarter(tx, rid);

      await enqueueOutbox(tx, { eventType: 'plot.claimed', aggregateType: 'plot', aggregateId: plotId, payload: { city_id: plot.city_id, property_id: property.id, resident_id: rid } });
      cityId = plot.city_id;
      const full = (await loadProperty(tx, property.id))!;
      return {
        status: 201,
        body: { request_id: c.get('requestId'), resource_id: property.id, revision: full.revision, property: { ...propertyOut(full, { hasActiveStayers: false }), space_ids: [space.id] } },
        resourceId: property.id,
      };
    });
    // Post-commit, best effort: keep enough vacant plots active. The jobs worker also reacts to plot.claimed.
    if (cityId) await activateBestEffort(c, cityId);
    return res;
  });

  /**
   * Wander (Blueprint §63 "Wander/nearby discovery"): a few publicly enterable homes, nearest-first
   * with jitter. Not a ranking; no counts are exposed.
   */
  app.get('/wander', async (c) => {
    const q = parseQuery(c, WanderQuery);
    await cityExists(c, q.city_id);
    const viewer = residentOf(c.get('actor'));
    const db = await c.get('getDb')();
    const x = q.x_u ?? 0;
    const y = q.y_u ?? 0;
    const candidates = await rows<{ id: string; plot_id: string; structure_asset_id: string; access_mode: 'open' | 'closed'; away_access_mode: 'open' | 'closed'; owner_away: boolean; has_active_stayers: boolean; center_x_u: number; center_y_u: number }>(db, sql`
      SELECT pr.id, pr.plot_id, pr.structure_asset_id, pr.access_mode, pr.away_access_mode, pl.center_x_u, pl.center_y_u,
             EXISTS (SELECT 1 FROM stays s WHERE s.resident_id = pr.owner_resident_id AND s.ended_at IS NULL) AS owner_away,
             EXISTS (SELECT 1 FROM stays s WHERE s.host_property_id = pr.id AND s.ended_at IS NULL) AS has_active_stayers
        FROM properties pr
        JOIN plots pl ON pl.id = pr.plot_id AND pl.city_id = ${q.city_id}
        JOIN residents r ON r.id = pr.owner_resident_id
        JOIN users u ON u.id = r.user_id AND u.status = 'active'
       WHERE pr.status = 'active' AND pr.access_mode = 'open' AND pr.owner_resident_id <> ${viewer}
         AND NOT EXISTS (SELECT 1 FROM blocks b
                          WHERE (b.blocker_resident_id = ${viewer} AND b.blocked_resident_id = pr.owner_resident_id)
                             OR (b.blocker_resident_id = pr.owner_resident_id AND b.blocked_resident_id = ${viewer}))
       ORDER BY (abs(pl.center_x_u - ${x}) + abs(pl.center_y_u - ${y})) * (0.6 + random() * 0.8)
       LIMIT 50`);
    const open = candidates.filter((p) => isPubliclyEnterable({ accessMode: p.access_mode, awayAccessMode: p.away_access_mode, ownerAway: p.owner_away }));
    return c.json({
      properties: open.slice(0, q.limit).map(({ owner_away: _o, ...p }) => p),
    });
  });

  return app;
}

async function activateBestEffort(c: Ctx, cityId: string) {
  try {
    await maybeActivateCity(await c.get('getDb')(), cityId);
  } catch (e) {
    c.get('deps').log({ request_id: c.get('requestId'), level: 'warn', msg: 'activation check failed', error: String(e) });
  }
}

function assertStructureFits(
  plot: { center_x_u: number; center_y_u: number; build_bounds: { x_u: number; y_u: number }[] },
  footprint: { w: number; d: number },
  body: { structure_x_u: number; structure_y_u: number; structure_rot_q: number },
) {
  const xs = plot.build_bounds.map((p) => p.x_u);
  const ys = plot.build_bounds.map((p) => p.y_u);
  const [w, d] = body.structure_rot_q % 2 === 0 ? [footprint.w, footprint.d] : [footprint.d, footprint.w];
  const cx = plot.center_x_u + body.structure_x_u;
  const cy = plot.center_y_u + body.structure_y_u;
  if (cx - w / 2 < Math.min(...xs) || cx + w / 2 > Math.max(...xs) || cy - d / 2 < Math.min(...ys) || cy + d / 2 > Math.max(...ys)) {
    throw new DomainError('validation_error', 'The home does not fit there.', { field: 'structure_x_u' });
  }
}

/** Starter grant (MINT -> resident) + starter kit, exactly once per resident. */
async function grantStarter(tx: Tx, residentId: string) {
  const key = `starter_grant:${residentId}`;
  const already = await maybeOne(tx, sql`SELECT 1 AS x FROM ledger_transactions WHERE idempotency_key = ${key}`);
  if (already) return;
  const flag = await getFlag(tx, FLAGS.starterGrant);
  const amount = flag?.enabled && typeof flag.config.amount === 'number' ? flag.config.amount : STARTER_GRANT_WORLD;
  if (amount > 0) {
    await postLedger(tx, {
      idempotencyKey: key,
      type: 'starter_grant',
      actorResidentId: residentId,
      relatedType: 'resident',
      relatedId: residentId,
      entries: [
        { walletId: await systemWalletId(tx, 'MINT'), amount: -amount },
        { walletId: await residentWalletId(tx, residentId), amount },
      ],
    });
  }
  await tx.execute(sql`
    INSERT INTO item_instances (definition_id, owner_resident_id, state, provenance)
    SELECT d.id, ${residentId}, 'inventory', jsonb_build_object('source', 'starter_kit')
      FROM item_definitions d WHERE d.definition_key = ANY(${sql.param(STARTER_KIT_DEFINITION_KEYS)}::text[])`);
}
