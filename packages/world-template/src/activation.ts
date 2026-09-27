import { sql, rows, one, maybeOne, withTx, enqueueOutbox, getFlag, pgArray, type Db, type Tx } from '@as/db';
import { DEFAULT_ACTIVATION_POLICY, FLAGS, shouldActivate, targetVacancy, type ActivationPolicy } from '@as/domain';

/**
 * Activate one pre-authored bundle atomically: public roads first, then plots.
 * Caller must hold the city row lock (SELECT ... FOR UPDATE on cities).
 */
export async function activateBundle(tx: Tx, cityId: string, bundleKey: string, reason: string): Promise<{ plots: number }> {
  const bundle = await maybeOne<{ status: string }>(tx, sql`
    SELECT status FROM city_activation_bundles WHERE city_id = ${cityId} AND stable_key = ${bundleKey} FOR UPDATE`);
  if (!bundle) throw new Error(`unknown bundle ${bundleKey}`);
  if (bundle.status === 'active') return { plots: 0 };

  await tx.execute(sql`UPDATE road_nodes SET active = true WHERE city_id = ${cityId} AND activation_bundle = ${bundleKey}`);
  await tx.execute(sql`UPDATE road_edges SET active = true WHERE city_id = ${cityId} AND activation_bundle = ${bundleKey}`);

  // Invariant: no plot becomes claimable without active frontage (Blueprint §6.2 / §7.2).
  const orphan = await one<{ n: number }>(tx, sql`
    SELECT count(*)::int AS n FROM plots p JOIN road_nodes rn ON rn.id = p.frontage_node_id
     WHERE p.city_id = ${cityId} AND p.activation_bundle = ${bundleKey} AND NOT rn.active`);
  if (orphan.n > 0) throw new Error(`bundle ${bundleKey}: ${orphan.n} plots front inactive roads`);

  const activated = await rows<{ id: string; chunk_id: string; district_id: string }>(tx, sql`
    UPDATE plots SET status = 'vacant', activated_at = now(), revision = revision + 1
     WHERE city_id = ${cityId} AND activation_bundle = ${bundleKey} AND status = 'latent'
     RETURNING id, chunk_id, district_id`);

  if (activated.length) {
    const chunkIds = [...new Set(activated.map((r) => r.chunk_id))];
    const districtIds = [...new Set(activated.map((r) => r.district_id))];
    await tx.execute(sql`UPDATE chunks SET revision = revision + 1 WHERE id = ANY(${pgArray(chunkIds)}::uuid[])`);
    await tx.execute(sql`UPDATE districts SET status = 'active', activated_at = COALESCE(activated_at, now())
                          WHERE id = ANY(${pgArray(districtIds)}::uuid[]) AND status = 'latent'`);
  }
  await tx.execute(sql`UPDATE city_activation_bundles SET status = 'active', activated_at = now(), activation_reason = ${reason}
                        WHERE city_id = ${cityId} AND stable_key = ${bundleKey}`);
  await tx.execute(sql`UPDATE cities SET activation_revision = activation_revision + 1 WHERE id = ${cityId}`);
  await enqueueOutbox(tx, {
    eventType: 'city.bundle_activated', aggregateType: 'city', aggregateId: cityId,
    payload: { bundle: bundleKey, plots: activated.length, reason },
  });
  return { plots: activated.length };
}

export async function loadActivationPolicy(db: Db | Tx): Promise<ActivationPolicy> {
  const flag = await getFlag(db, FLAGS.activationPolicy);
  if (!flag?.enabled) return DEFAULT_ACTIVATION_POLICY;
  const c = flag.config as Partial<ActivationPolicy>;
  return {
    ratio: typeof c.ratio === 'number' ? c.ratio : DEFAULT_ACTIVATION_POLICY.ratio,
    min: typeof c.min === 'number' ? c.min : DEFAULT_ACTIVATION_POLICY.min,
    max: typeof c.max === 'number' ? c.max : DEFAULT_ACTIVATION_POLICY.max,
  };
}

/** Return reservations whose TTL passed to vacancy. Safe to call often (indexed). */
export async function releaseExpiredReservations(tx: Db | Tx, cityId?: string): Promise<number> {
  const released = await rows<{ plot_id: string }>(tx, sql`
    UPDATE plot_reservations r SET cancelled_at = now()
      FROM plots p
     WHERE r.plot_id = p.id
       AND r.claimed_at IS NULL AND r.cancelled_at IS NULL AND r.expires_at <= now()
       ${cityId ? sql`AND p.city_id = ${cityId}` : sql.empty()}
     RETURNING r.plot_id`);
  if (released.length) {
    await tx.execute(sql`
      UPDATE plots SET status = 'vacant', revision = revision + 1
       WHERE id = ANY(${pgArray(released.map((r) => r.plot_id))}::uuid[]) AND status = 'reserved'`);
  }
  return released.length;
}

export interface ActivationResult { activated: string[]; vacant: number; occupied: number; target: number }

/**
 * Founding-city controller (Blueprint §7.2). Serialized per city by locking the cities row.
 * Activates the next connected bundle(s) while active vacancy is below target.
 */
export async function maybeActivateCity(db: Db, cityId: string): Promise<ActivationResult> {
  return withTx(db, async (tx) => {
    const city = await maybeOne<{ status: string }>(tx, sql`SELECT status FROM cities WHERE id = ${cityId} FOR UPDATE`);
    if (!city) throw new Error(`unknown city ${cityId}`);
    await releaseExpiredReservations(tx, cityId);
    const policy = await loadActivationPolicy(tx);
    const activated: string[] = [];
    for (;;) {
      const c = await one<{ vacant: number; occupied: number }>(tx, sql`
        SELECT count(*) FILTER (WHERE status = 'vacant')::int AS vacant,
               (SELECT count(*)::int FROM properties pr JOIN plots pl ON pl.id = pr.plot_id
                 WHERE pl.city_id = ${cityId} AND pr.is_primary_home AND pr.status = 'active') AS occupied
          FROM plots WHERE city_id = ${cityId}`);
      const target = targetVacancy(c.occupied, policy);
      if (city.status !== 'open' || !shouldActivate(c.vacant, c.occupied, policy)) {
        return { activated, vacant: c.vacant, occupied: c.occupied, target };
      }
      const next = await maybeOne<{ stable_key: string }>(tx, sql`
        SELECT stable_key FROM city_activation_bundles
         WHERE city_id = ${cityId} AND status = 'latent' ORDER BY activation_order LIMIT 1`);
      if (!next) return { activated, vacant: c.vacant, occupied: c.occupied, target };
      await activateBundle(tx, cityId, next.stable_key, `vacancy ${c.vacant} < target ${target}`);
      activated.push(next.stable_key);
    }
  });
}
