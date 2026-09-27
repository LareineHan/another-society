import { sql, rows, pgArray, type Tx } from '@as/db';

/** Cancel a user's live reservation(s) and return those plots to vacancy. */
export async function cancelLiveReservations(tx: Tx, userId: string, exceptPlotId?: string): Promise<string[]> {
  const cancelled = await rows<{ plot_id: string }>(tx, sql`
    UPDATE plot_reservations SET cancelled_at = now()
     WHERE user_id = ${userId} AND claimed_at IS NULL AND cancelled_at IS NULL
       ${exceptPlotId ? sql`AND plot_id <> ${exceptPlotId}` : sql.empty()}
     RETURNING plot_id`);
  if (cancelled.length) {
    await tx.execute(sql`UPDATE plots SET status = 'vacant', revision = revision + 1
                          WHERE id = ANY(${pgArray(cancelled.map((c) => c.plot_id))}::uuid[]) AND status = 'reserved'`);
  }
  return cancelled.map((c) => c.plot_id);
}

/**
 * Effective plot status for reads: a 'reserved' plot whose reservation lapsed reads as 'vacant'
 * even before the cleanup job runs, so GETs stay read-only.
 */
export const effectivePlotStatus = sql`
  CASE WHEN p.status = 'reserved' AND NOT EXISTS (
         SELECT 1 FROM plot_reservations r
          WHERE r.plot_id = p.id AND r.claimed_at IS NULL AND r.cancelled_at IS NULL AND r.expires_at > now())
       THEN 'vacant' ELSE p.status END`;
