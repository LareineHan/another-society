import { sql, rows, type Executor, type SQL } from './client';

/**
 * Blueprint §58 integrity checks. Any non-empty result is an operator page, ahead of analytics.
 * Each check returns offending ids (capped) so the report is actionable.
 */
export const INTEGRITY_CHECKS: { name: string; query: SQL }[] = [
  { name: 'posted_ledger_balanced', query: sql`
      SELECT t.id FROM ledger_transactions t JOIN ledger_entries e ON e.transaction_id = t.id
       WHERE t.status = 'posted' GROUP BY t.id HAVING sum(e.amount) <> 0 LIMIT 20` },
  { name: 'wallet_cache_matches_ledger', query: sql`
      SELECT w.id FROM wallets w
        LEFT JOIN (SELECT e.wallet_id, sum(e.amount) AS s FROM ledger_entries e
                     JOIN ledger_transactions t ON t.id = e.transaction_id AND t.status = 'posted' GROUP BY e.wallet_id) l ON l.wallet_id = w.id
       WHERE w.balance <> COALESCE(l.s, 0) LIMIT 20` },
  { name: 'no_negative_resident_wallet', query: sql`SELECT id FROM wallets WHERE wallet_kind = 'resident' AND balance < 0 LIMIT 20` },
  { name: 'one_active_property_per_plot', query: sql`SELECT plot_id AS id FROM properties WHERE status = 'active' GROUP BY plot_id HAVING count(*) > 1 LIMIT 20` },
  { name: 'one_active_stay_per_resident', query: sql`SELECT resident_id AS id FROM stays WHERE ended_at IS NULL GROUP BY resident_id HAVING count(*) > 1 LIMIT 20` },
  { name: 'one_active_placement_per_item', query: sql`SELECT item_instance_id AS id FROM placements WHERE removed_at IS NULL GROUP BY item_instance_id HAVING count(*) > 1 LIMIT 20` },
  { name: 'placed_items_have_placement', query: sql`
      SELECT ii.id FROM item_instances ii WHERE ii.state = 'placed'
         AND NOT EXISTS (SELECT 1 FROM placements p WHERE p.item_instance_id = ii.id AND p.removed_at IS NULL) LIMIT 20` },
  { name: 'placements_owned_by_space_owner', query: sql`
      SELECT pl.id FROM placements pl JOIN spaces s ON s.id = pl.space_id JOIN properties p ON p.id = s.property_id
        JOIN item_instances ii ON ii.id = pl.item_instance_id
       WHERE pl.removed_at IS NULL AND ii.owner_resident_id IS DISTINCT FROM p.owner_resident_id LIMIT 20` },
  { name: 'stays_within_capacity', query: sql`
      SELECT p.id FROM properties p JOIN stays s ON s.host_property_id = p.id AND s.ended_at IS NULL
       GROUP BY p.id, p.stay_capacity HAVING count(*) > p.stay_capacity LIMIT 20` },
  { name: 'no_stay_across_block', query: sql`
      SELECT s.id FROM stays s JOIN properties p ON p.id = s.host_property_id
       WHERE s.ended_at IS NULL AND EXISTS (SELECT 1 FROM blocks b
         WHERE (b.blocker_resident_id = s.resident_id AND b.blocked_resident_id = p.owner_resident_id)
            OR (b.blocker_resident_id = p.owner_resident_id AND b.blocked_resident_id = s.resident_id)) LIMIT 20` },
  { name: 'occupied_plot_has_property', query: sql`
      SELECT pl.id FROM plots pl WHERE pl.status = 'occupied'
         AND NOT EXISTS (SELECT 1 FROM properties p WHERE p.plot_id = pl.id AND p.status IN ('active','hidden')) LIMIT 20` },
  { name: 'claimable_plots_front_active_roads', query: sql`
      SELECT pl.id FROM plots pl JOIN road_nodes rn ON rn.id = pl.frontage_node_id
       WHERE pl.status IN ('vacant','reserved','occupied') AND NOT rn.active LIMIT 20` },
  { name: 'pending_gift_items_owned_by_recipient', query: sql`
      SELECT g.id FROM gifts g JOIN item_instances ii ON ii.id = g.item_instance_id
       WHERE g.status = 'pending_placement' AND (ii.owner_resident_id IS DISTINCT FROM g.recipient_resident_id OR ii.state <> 'pending_placement') LIMIT 20` },
];

export interface ReconcileReport {
  ok: boolean;
  checked_at: string;
  failures: { check: string; ids: string[] }[];
}

export async function reconcile(db: Executor): Promise<ReconcileReport> {
  const failures: ReconcileReport['failures'] = [];
  for (const c of INTEGRITY_CHECKS) {
    const r = await rows<{ id: string }>(db, c.query);
    if (r.length) failures.push({ check: c.name, ids: r.map((x) => String(x.id)) });
  }
  return { ok: failures.length === 0, checked_at: new Date().toISOString(), failures };
}
