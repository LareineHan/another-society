import { sql, rows, one, maybeOne, withTx, pgArray, type Db } from '@as/db';
import { maybeActivateCity, releaseExpiredReservations } from '@as/world-template';
import { postLedger, systemWalletId, decryptToken, lockPresence, endStays, type AppleAuthProvider } from '@as/world-api';

export interface OutboxMessage {
  id: string;
  event_type: string;
  aggregate_type: string;
  aggregate_id: string | null;
  payload: Record<string, unknown>;
}

export interface JobDeps {
  db: Db;
  apple: AppleAuthProvider;
  tokenEncryptionKey: string;
  log(entry: Record<string, unknown>): void;
}

const LEASE_SECONDS = 300;
const MAX_ATTEMPTS = 10;

/**
 * Transactional-outbox publisher (Blueprint §49–50). Two-phase so no row lock is held across the
 * network send: (1) lease a batch with SKIP LOCKED, (2) send, (3) mark published or schedule a retry
 * with exponential backoff. A crash between (1) and (3) only delays: the lease expires and the row is
 * re-sent; consumers are idempotent by event id.
 */
export async function publishOutbox(db: Db, send: (msgs: OutboxMessage[]) => Promise<void>, limit = 100): Promise<{ published: number; failed: number }> {
  const batch = await withTx(db, (tx) =>
    rows<OutboxMessage>(tx, sql`
      WITH picked AS (
        SELECT id FROM outbox_events
         WHERE ((status IN ('pending','failed') AND available_at <= now()) OR (status = 'publishing' AND available_at <= now()))
           AND attempts < ${MAX_ATTEMPTS}
         ORDER BY created_at LIMIT ${limit} FOR UPDATE SKIP LOCKED)
      UPDATE outbox_events o SET status = 'publishing', attempts = o.attempts + 1,
             available_at = now() + make_interval(secs => ${LEASE_SECONDS})
        FROM picked WHERE o.id = picked.id
      RETURNING o.id, o.event_type, o.aggregate_type, o.aggregate_id, o.payload`),
  );
  if (!batch.length) return { published: 0, failed: 0 };
  const ids = batch.map((b) => b.id);
  try {
    await send(batch);
    await db.execute(sql`UPDATE outbox_events SET status = 'published', published_at = now(), last_error = NULL WHERE id = ANY(${pgArray(ids)}::uuid[])`);
    return { published: ids.length, failed: 0 };
  } catch (e) {
    await db.execute(sql`
      UPDATE outbox_events SET status = 'failed', last_error = ${String(e).slice(0, 500)},
             available_at = now() + make_interval(secs => least(3600, 5 * power(2, attempts)::int))
       WHERE id = ANY(${pgArray(ids)}::uuid[])`);
    return { published: 0, failed: ids.length };
  }
}

/** Idempotent consumer. Unknown event types are acknowledged (they exist for future consumers). */
export async function handleEvent(deps: JobDeps, msg: OutboxMessage): Promise<void> {
  switch (msg.event_type) {
    case 'account.deletion_requested':
      await processDeletion(deps, String(msg.payload.deletion_request_id));
      return;
    case 'plot.claimed':
      await maybeActivateCity(deps.db, String(msg.payload.city_id));
      return;
    default:
      return;
  }
}

/**
 * Account deletion worker (Blueprint §15). Runs after the API already revoked sessions, hid the
 * resident's properties and ended stays. Safe to re-run: every step is conditional.
 */
export async function processDeletion(deps: JobDeps, deletionRequestId: string): Promise<'completed' | 'noop'> {
  const { db } = deps;
  const req = await maybeOne<{ id: string; user_id: string; status: string }>(db, sql`
    SELECT id, user_id, status FROM deletion_requests WHERE id = ${deletionRequestId}`);
  if (!req || req.status === 'completed' || req.status === 'cancelled') return 'noop';
  await db.execute(sql`UPDATE deletion_requests SET status = 'processing' WHERE id = ${req.id} AND status IN ('requested','failed')`);

  // 1) Revoke Sign in with Apple tokens (network; outside any transaction). Failure -> retried later.
  const identities = await rows<{ id: string; provider: string; token: Uint8Array | null }>(db, sql`
    SELECT id, provider, provider_refresh_token_enc AS token FROM auth_identities WHERE user_id = ${req.user_id}`);
  try {
    for (const i of identities) {
      if (i.provider === 'apple' && i.token) {
        await deps.apple.revokeRefreshToken(await decryptToken(deps.tokenEncryptionKey, new Uint8Array(i.token)));
      }
    }
  } catch (e) {
    await db.execute(sql`UPDATE deletion_requests SET status = 'failed', last_error = ${'apple_revoke: ' + String(e).slice(0, 300)} WHERE id = ${req.id}`);
    throw e;
  }

  // 2) Anonymize/delete in one transaction.
  await withTx(db, async (tx) => {
    const resident = await maybeOne<{ id: string }>(tx, sql`SELECT id FROM residents WHERE user_id = ${req.user_id} FOR UPDATE`);
    if (resident) {
      const rid = resident.id;
      const involved = await rows<{ resident_id: string }>(tx, sql`
        SELECT DISTINCT resident_id FROM stays WHERE ended_at IS NULL
           AND (resident_id = ${rid} OR host_property_id IN (SELECT id FROM properties WHERE owner_resident_id = ${rid}))`);
      await lockPresence(tx, [rid, ...involved.map((r) => r.resident_id)]);
      await endStays(tx, sql`resident_id = ${rid} OR host_property_id IN (SELECT id FROM properties WHERE owner_resident_id = ${rid})`, 'account_deleted');

      // Public UGC: name, Mini, property composition.
      await tx.execute(sql`UPDATE residents SET display_name = 'Former resident', display_name_norm = 'former resident',
                                  mini_definition = '{}'::jsonb, updated_at = now() WHERE id = ${rid}`);
      await tx.execute(sql`UPDATE placements SET removed_at = now()
                            WHERE removed_at IS NULL AND space_id IN (SELECT s.id FROM spaces s JOIN properties p ON p.id = s.property_id WHERE p.owner_resident_id = ${rid})`);
      const archived = await rows<{ plot_id: string }>(tx, sql`
        UPDATE properties SET status = 'archived', is_primary_home = false, revision = revision + 1, updated_at = now()
         WHERE owner_resident_id = ${rid} AND status <> 'archived' RETURNING plot_id`);
      if (archived.length) {
        // The place returns to the city for the next newcomer (no property loss for anyone else).
        await tx.execute(sql`UPDATE plots SET status = 'vacant', revision = revision + 1
                              WHERE id = ANY(${pgArray(archived.map((a) => a.plot_id))}::uuid[]) AND status = 'occupied'`);
        await tx.execute(sql`UPDATE chunks SET revision = revision + 1
                              WHERE id IN (SELECT chunk_id FROM plots WHERE id = ANY(${pgArray(archived.map((a) => a.plot_id))}::uuid[]))`);
      }

      // Gifts waiting for this resident go back to their givers when possible.
      const pending = await rows<{ id: string; item_instance_id: string; giver_resident_id: string; giver_active: boolean }>(tx, sql`
        SELECT g.id, g.item_instance_id, g.giver_resident_id, (u.status = 'active') AS giver_active
          FROM gifts g JOIN residents r ON r.id = g.giver_resident_id JOIN users u ON u.id = r.user_id
         WHERE g.recipient_resident_id = ${rid} AND g.status = 'pending_placement' FOR UPDATE OF g`);
      for (const g of pending) {
        if (g.giver_active) {
          await tx.execute(sql`UPDATE item_instances SET owner_resident_id = ${g.giver_resident_id}, state = 'inventory', updated_at = now() WHERE id = ${g.item_instance_id}`);
        }
        await tx.execute(sql`UPDATE gifts SET status = 'declined', resolved_at = now() WHERE id = ${g.id}`);
      }
      // Everything else the resident owned is retired (exactly-one-owner invariant preserved).
      await tx.execute(sql`UPDATE item_instances SET owner_resident_id = NULL, owner_system_code = 'RETIRED', state = 'retired', updated_at = now()
                            WHERE owner_resident_id = ${rid}`);

      // Remaining balance is swept to the sink through the ledger (never silently zeroed).
      const wallet = await maybeOne<{ id: string; balance: number }>(tx, sql`
        SELECT id, balance FROM wallets WHERE wallet_kind = 'resident' AND resident_id = ${rid} AND currency_code = 'WORLD' FOR UPDATE`);
      if (wallet && wallet.balance > 0) {
        await postLedger(tx, {
          idempotencyKey: `account_deletion_sweep:${req.id}`,
          type: 'account_deletion_sweep',
          relatedType: 'deletion_request',
          relatedId: req.id,
          entries: [
            { walletId: wallet.id, amount: -wallet.balance },
            { walletId: await systemWalletId(tx, 'SYSTEM_SINK'), amount: wallet.balance },
          ],
        });
      }
      await tx.execute(sql`UPDATE presence SET state = 'offline', current_city_id = NULL, current_property_id = NULL, current_space_id = NULL, updated_at = now()
                            WHERE resident_id = ${rid}`);
      await tx.execute(sql`DELETE FROM visit_receipts WHERE visitor_resident_id = ${rid}`);
      await tx.execute(sql`DELETE FROM blocks WHERE blocker_resident_id = ${rid} OR blocked_resident_id = ${rid}`);
      await tx.execute(sql`DELETE FROM companion_minis WHERE owner_resident_id = ${rid}`);
      await tx.execute(sql`DELETE FROM material_balances WHERE resident_id = ${rid}`);
    }
    // Personal records: provider identities (incl. email + Apple token), sessions, idempotency cache.
    // users.id is kept (FK anchor) but never recycled; a later Apple sign-in creates a new account.
    await tx.execute(sql`DELETE FROM auth_identities WHERE user_id = ${req.user_id}`);
    await tx.execute(sql`DELETE FROM auth_sessions WHERE user_id = ${req.user_id}`);
    await tx.execute(sql`DELETE FROM idempotency_keys WHERE user_id = ${req.user_id}`);
    await tx.execute(sql`UPDATE plot_reservations SET cancelled_at = now() WHERE user_id = ${req.user_id} AND claimed_at IS NULL AND cancelled_at IS NULL`);
    await tx.execute(sql`UPDATE users SET status = 'deleted', deleted_at = now(), updated_at = now() WHERE id = ${req.user_id}`);
    await tx.execute(sql`UPDATE deletion_requests SET status = 'completed', completed_at = now(), last_error = NULL WHERE id = ${req.id}`);
  });
  deps.log({ level: 'info', msg: 'account deletion completed', deletion_request_id: req.id });
  return 'completed';
}

/** Minute-level maintenance: lapsed reservations, vacancy controller. */
export async function minuteMaintenance(db: Db): Promise<{ released: number; activated: string[] }> {
  const released = await withTx(db, (tx) => releaseExpiredReservations(tx));
  const cities = await rows<{ id: string }>(db, sql`SELECT id FROM cities WHERE status = 'open'`);
  const activated: string[] = [];
  for (const c of cities) activated.push(...(await maybeActivateCity(db, c.id)).activated);
  return { released, activated };
}

/** Daily retention (Blueprint §11.1, §41): raw visits 7 days, expired idempotency keys, old published outbox. */
export async function dailyRetention(db: Db) {
  const visits = await one<{ n: number }>(db, sql`WITH d AS (DELETE FROM visit_receipts WHERE purge_after <= now() RETURNING 1) SELECT count(*)::int AS n FROM d`);
  const keys = await one<{ n: number }>(db, sql`WITH d AS (DELETE FROM idempotency_keys WHERE expires_at <= now() RETURNING 1) SELECT count(*)::int AS n FROM d`);
  const outbox = await one<{ n: number }>(db, sql`WITH d AS (DELETE FROM outbox_events WHERE status = 'published' AND published_at < now() - interval '14 days' RETURNING 1) SELECT count(*)::int AS n FROM d`);
  return { visit_receipts: visits.n, idempotency_keys: keys.n, outbox_events: outbox.n };
}
