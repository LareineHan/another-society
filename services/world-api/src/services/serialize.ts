import { SPACE_BOUNDS } from '@as/domain';
import { sql, rows, maybeOne, type Executor } from '@as/db';
import type { PropertyRow } from './social';

const iso = (d: Date | string | null | undefined) => (d == null ? undefined : new Date(d).toISOString());

export interface ResidentRow {
  id: string;
  display_name: string;
  public_tag: string;
  mini_definition: Record<string, unknown>;
  onboarding_state: 'choosing_plot' | 'claimed' | 'complete';
}

export async function residentOut(db: Executor, r: ResidentRow) {
  const home = await maybeOne<{ property_id: string; space_id: string; plot_id: string; city_id: string }>(db, sql`
    SELECT p.id AS property_id, s.id AS space_id, p.plot_id, pl.city_id
      FROM properties p JOIN plots pl ON pl.id = p.plot_id
      JOIN LATERAL (SELECT id FROM spaces WHERE property_id = p.id ORDER BY created_at LIMIT 1) s ON true
     WHERE p.owner_resident_id = ${r.id} AND p.is_primary_home AND p.status IN ('active','hidden')`);
  return {
    id: r.id,
    display_name: r.display_name,
    public_tag: r.public_tag,
    mini_definition: r.mini_definition,
    onboarding_state: r.onboarding_state,
    ...(home ? { primary_home: home } : {}),
  };
}

export async function loadResident(db: Executor, residentId: string): Promise<ResidentRow> {
  const r = await maybeOne<ResidentRow>(db, sql`
    SELECT id, display_name, public_tag, mini_definition, onboarding_state FROM residents WHERE id = ${residentId}`);
  if (!r) throw new Error('resident missing');
  return r;
}

export function propertyOut(p: PropertyRow, extras: { hasActiveStayers: boolean }) {
  return {
    id: p.id,
    plot_id: p.plot_id,
    owner_resident_id: p.owner_resident_id,
    property_type: p.property_type,
    structure_asset_id: p.structure_asset_id,
    structure_x_u: p.structure_x_u,
    structure_y_u: p.structure_y_u,
    structure_rot_q: p.structure_rot_q,
    access_mode: p.access_mode,
    away_access_mode: p.away_access_mode,
    allow_stays: p.allow_stays,
    stay_capacity: p.stay_capacity,
    is_primary_home: p.is_primary_home,
    has_active_stayers: extras.hasActiveStayers,
    revision: p.revision,
  };
}

export async function hasActiveStayers(db: Executor, propertyId: string): Promise<boolean> {
  return !!(await maybeOne(db, sql`SELECT 1 AS x FROM stays WHERE host_property_id = ${propertyId} AND ended_at IS NULL LIMIT 1`));
}

export interface SpaceRow {
  id: string;
  property_id: string;
  space_kind: string;
  asset_shell_id: string | null;
  visitor_capacity: number;
  layout_revision: number;
}

export async function loadPlacements(db: Executor, spaceId: string) {
  return rows<{ id: string; item_instance_id: string; x_u: number; y_u: number; rotation_q: number; scale_milli: number; layer: number; definition_key: string; asset_id: string }>(db, sql`
    SELECT pl.id, pl.item_instance_id, pl.x_u, pl.y_u, pl.rotation_q, pl.scale_milli, pl.layer,
           d.definition_key, d.visual_definition->>'asset_id' AS asset_id
      FROM placements pl
      JOIN item_instances ii ON ii.id = pl.item_instance_id
      JOIN item_definitions d ON d.id = ii.definition_id
     WHERE pl.space_id = ${spaceId} AND pl.removed_at IS NULL AND d.moderation_status = 'approved'
     ORDER BY pl.layer, pl.y_u, pl.x_u, pl.id`);
}

/**
 * Space payload. Stayers are the public presence commit (Blueprint §11.2) and are visible to anyone
 * who may view the space, minus residents in a block relationship with the viewer.
 * Pending gifts are shown to the owner only.
 */
export async function spaceOut(db: Executor, s: SpaceRow, viewer: { residentId: string; isOwner: boolean }) {
  const placements = await loadPlacements(db, s.id);
  const stayers = await rows<{ resident_id: string; display_name: string; mini_definition: Record<string, unknown>; started_at: Date }>(db, sql`
    SELECT st.resident_id, r.display_name, r.mini_definition, st.started_at
      FROM stays st
      JOIN residents r ON r.id = st.resident_id
      JOIN users u ON u.id = r.user_id AND u.status = 'active'
     WHERE st.space_id = ${s.id} AND st.ended_at IS NULL
       AND NOT EXISTS (SELECT 1 FROM blocks b
                        WHERE (b.blocker_resident_id = ${viewer.residentId} AND b.blocked_resident_id = st.resident_id)
                           OR (b.blocker_resident_id = st.resident_id AND b.blocked_resident_id = ${viewer.residentId}))
     ORDER BY st.started_at`);
  const out: Record<string, unknown> = {
    id: s.id,
    property_id: s.property_id,
    space_kind: s.space_kind,
    layout_revision: s.layout_revision,
    visitor_capacity: s.visitor_capacity,
    bounds: spaceBounds(s.asset_shell_id),
    placements,
    stayers: stayers.map((x) => ({ ...x, started_at: iso(x.started_at) })),
  };
  if (viewer.isOwner) {
    const gifts = await rows<{ id: string; item_instance_id: string; drop_x_u: number; drop_y_u: number; asset_id: string; definition_key: string }>(db, sql`
      SELECT g.id, g.item_instance_id, g.drop_x_u, g.drop_y_u, d.visual_definition->>'asset_id' AS asset_id, d.definition_key
        FROM gifts g JOIN item_instances ii ON ii.id = g.item_instance_id JOIN item_definitions d ON d.id = ii.definition_id
       WHERE g.space_id = ${s.id} AND g.status = 'pending_placement' ORDER BY g.created_at`);
    out.pending_gifts = gifts;
  }
  return out;
}

export function spaceBounds(shell: string | null) {
  return SPACE_BOUNDS[shell ?? 'default'] ?? SPACE_BOUNDS.default!;
}

export interface ItemRow {
  id: string;
  definition_id: string;
  state: string;
  provenance: Record<string, unknown>;
  definition_key: string;
  asset_id: string;
  category: string;
  gift_eligible: boolean;
}

export const itemSelect = sql`
  SELECT ii.id, ii.definition_id, ii.state, ii.provenance, d.definition_key, d.visual_definition->>'asset_id' AS asset_id,
         d.category, d.gift_eligible
    FROM item_instances ii JOIN item_definitions d ON d.id = ii.definition_id`;

export function itemOut(i: ItemRow) {
  return {
    id: i.id,
    definition_id: i.definition_id,
    state: i.state,
    provenance: i.provenance,
    definition_key: i.definition_key,
    asset_id: i.asset_id,
    category: i.category,
    gift_eligible: i.gift_eligible,
  };
}

export interface GiftRow {
  id: string;
  giver_resident_id: string;
  recipient_resident_id: string;
  item_instance_id: string;
  status: string;
  created_at: Date;
  resolved_at: Date | null;
  property_id: string;
  space_id: string;
  drop_x_u: number;
  drop_y_u: number;
}

export function giftOut(g: GiftRow, extras: Record<string, unknown> = {}) {
  return {
    id: g.id,
    giver_resident_id: g.giver_resident_id,
    recipient_resident_id: g.recipient_resident_id,
    item_instance_id: g.item_instance_id,
    status: g.status,
    created_at: iso(g.created_at)!,
    ...(g.resolved_at ? { resolved_at: iso(g.resolved_at) } : {}),
    property_id: g.property_id,
    space_id: g.space_id,
    drop_x_u: g.drop_x_u,
    drop_y_u: g.drop_y_u,
    ...extras,
  };
}

export { iso };
