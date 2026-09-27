import { DomainError, isPubliclyEnterable, type AccessMode } from '@as/domain';
import { sql, rows, maybeOne, pgArray, type Executor, type Tx } from '@as/db';

/** Block is bilateral invisibility regardless of who initiated it (Blueprint §13). */
export async function isBlockedEitherWay(db: Executor, a: string, b: string): Promise<boolean> {
  const r = await maybeOne<{ x: number }>(db, sql`
    SELECT 1 AS x FROM blocks
     WHERE (blocker_resident_id = ${a} AND blocked_resident_id = ${b})
        OR (blocker_resident_id = ${b} AND blocked_resident_id = ${a})
     LIMIT 1`);
  return !!r;
}

export interface PropertyRow {
  id: string;
  plot_id: string;
  owner_resident_id: string;
  property_type: string;
  structure_asset_id: string;
  structure_x_u: number;
  structure_y_u: number;
  structure_rot_q: number;
  access_mode: AccessMode;
  away_access_mode: AccessMode;
  allow_stays: boolean;
  stay_capacity: number;
  is_primary_home: boolean;
  status: 'active' | 'hidden' | 'archived';
  revision: number;
  owner_status: string;
}

export async function loadProperty(db: Executor, propertyId: string, opts: { lock?: boolean } = {}): Promise<PropertyRow | undefined> {
  // Lock only the properties row (FOR UPDATE OF) — it is the Stay capacity guard row.
  return maybeOne<PropertyRow>(db, sql`
    SELECT p.*, u.status AS owner_status
      FROM properties p
      JOIN residents r ON r.id = p.owner_resident_id
      JOIN users u ON u.id = r.user_id
     WHERE p.id = ${propertyId}
     ${opts.lock ? sql`FOR UPDATE OF p` : sql.empty()}`);
}

export async function ownerIsAway(db: Executor, ownerResidentId: string): Promise<boolean> {
  const r = await maybeOne<{ x: number }>(db, sql`SELECT 1 AS x FROM stays WHERE resident_id = ${ownerResidentId} AND ended_at IS NULL`);
  return !!r;
}

export interface EntryDecision {
  isOwner: boolean;
  canEnter: boolean;
  ownerAway: boolean;
}

/**
 * Who may see/enter a property. Hidden/archived properties, deleted/suspended owners, and block
 * relationships all read as "not found" to non-owners so nothing leaks through status codes.
 */
export async function decideEntry(db: Executor, p: PropertyRow, viewerResidentId: string): Promise<EntryDecision> {
  if (p.owner_resident_id === viewerResidentId) return { isOwner: true, canEnter: true, ownerAway: await ownerIsAway(db, p.owner_resident_id) };
  if (p.status !== 'active' || p.owner_status !== 'active') throw new DomainError('not_found', 'Not found.');
  if (await isBlockedEitherWay(db, p.owner_resident_id, viewerResidentId)) throw new DomainError('not_found', 'Not found.');
  const ownerAway = await ownerIsAway(db, p.owner_resident_id);
  return {
    isOwner: false,
    ownerAway,
    canEnter: isPubliclyEnterable({ accessMode: p.access_mode, awayAccessMode: p.away_access_mode, ownerAway }),
  };
}

export async function primaryHome(db: Executor, residentId: string): Promise<{ property_id: string; space_id: string; city_id: string; plot_id: string } | undefined> {
  return maybeOne(db, sql`
    SELECT p.id AS property_id, s.id AS space_id, pl.city_id, p.plot_id
      FROM properties p
      JOIN plots pl ON pl.id = p.plot_id
      JOIN LATERAL (SELECT id FROM spaces WHERE property_id = p.id ORDER BY created_at LIMIT 1) s ON true
     WHERE p.owner_resident_id = ${residentId} AND p.is_primary_home AND p.status IN ('active','hidden')`);
}

/** Lock presence rows in deterministic order (deadlock avoidance). */
export async function lockPresence(tx: Tx, residentIds: string[]): Promise<void> {
  const ids = [...new Set(residentIds)].sort();
  await tx.execute(sql`SELECT resident_id FROM presence WHERE resident_id = ANY(${pgArray(ids)}::uuid[]) ORDER BY resident_id FOR UPDATE`);
}

/** Return a resident's durable Mini to their primary home (after Leave / Send Home / block). */
export async function returnHome(tx: Tx, residentId: string): Promise<void> {
  const home = await primaryHome(tx, residentId);
  await tx.execute(sql`
    UPDATE presence SET state = 'home', current_city_id = ${home?.city_id ?? null}, current_property_id = ${home?.property_id ?? null},
           current_space_id = ${home?.space_id ?? null}, destination_id = NULL, updated_at = now()
     WHERE resident_id = ${residentId}`);
}

/** End active stays matching a predicate and send those residents home. Caller holds presence locks. */
export async function endStays(tx: Tx, where: ReturnType<typeof sql>, reason: string): Promise<{ id: string; resident_id: string; host_property_id: string }[]> {
  const ended = await rows<{ id: string; resident_id: string; host_property_id: string }>(tx, sql`
    UPDATE stays SET ended_at = now(), end_reason = ${reason}
     WHERE ended_at IS NULL AND (${where})
     RETURNING id, resident_id, host_property_id`);
  for (const s of ended) await returnHome(tx, s.resident_id);
  return ended;
}
