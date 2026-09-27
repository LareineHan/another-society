import { DomainError, IDEMPOTENCY_TTL_SECONDS } from '@as/domain';
import { sql, maybeOne, withTx, type Tx } from '@as/db';
import { readBodyText, sha256Hex, type Ctx } from './http';

export interface MutationResult<T> {
  status: number;
  body: T;
  resourceId?: string | null;
}

export function idempotencyKeyOf(c: Ctx): string {
  const key = c.req.header('idempotency-key');
  if (!key || key.length < 16 || key.length > 128 || !/^[\x21-\x7e]+$/.test(key)) {
    throw new DomainError('idempotency_key_required', 'An Idempotency-Key header (16–128 visible ASCII chars) is required.');
  }
  return key;
}

/**
 * Blueprint §19: key scoped to (authenticated user, operation). The key row is written in the
 * SAME transaction as the mutation, so a committed mutation always has its stored response and a
 * rolled-back one leaves no key behind (a retry re-evaluates).
 *
 * Concurrency: two in-flight requests with one key race on the primary key. `ON CONFLICT DO NOTHING`
 * makes the second wait for the first to commit, then it replays the stored response.
 * Same key + different request body => 409 idempotency_mismatch.
 */
export async function idempotent<T>(c: Ctx, operation: string, fn: (tx: Tx) => Promise<MutationResult<T>>): Promise<Response> {
  const actor = c.get('actor');
  const key = idempotencyKeyOf(c);
  const body = await readBodyText(c);
  const requestHash = await sha256Hex(`${c.req.method} ${new URL(c.req.url).pathname}\n${body}`);
  const db = await c.get('getDb')();

  const out = await withTx(db, async (tx) => {
    const inserted = await maybeOne<{ ok: number }>(tx, sql`
      INSERT INTO idempotency_keys (user_id, operation, idempotency_key, request_hash, expires_at)
      VALUES (${actor.userId}, ${operation}, ${key}, ${requestHash}, now() + make_interval(secs => ${IDEMPOTENCY_TTL_SECONDS}))
      ON CONFLICT (user_id, operation, idempotency_key) DO NOTHING
      RETURNING 1 AS ok`);

    if (!inserted) {
      const prior = await maybeOne<{ request_hash: string; response_status: number | null; response_body: unknown; expired: boolean }>(tx, sql`
        SELECT request_hash, response_status, response_body, expires_at <= now() AS expired
          FROM idempotency_keys
         WHERE user_id = ${actor.userId} AND operation = ${operation} AND idempotency_key = ${key}
         FOR UPDATE`);
      if (prior && !prior.expired) {
        if (prior.request_hash !== requestHash) {
          throw new DomainError('idempotency_mismatch', 'This Idempotency-Key was already used with a different request.');
        }
        if (prior.response_status != null) {
          return { replayed: true as const, status: prior.response_status, body: prior.response_body as T };
        }
      }
      // Expired (not yet purged) or orphaned: take the key over for this request.
      await tx.execute(sql`
        UPDATE idempotency_keys SET request_hash = ${requestHash}, response_status = NULL, response_body = NULL,
               resource_id = NULL, created_at = now(), expires_at = now() + make_interval(secs => ${IDEMPOTENCY_TTL_SECONDS})
         WHERE user_id = ${actor.userId} AND operation = ${operation} AND idempotency_key = ${key}`);
    }

    const result = await fn(tx);
    await tx.execute(sql`
      UPDATE idempotency_keys
         SET response_status = ${result.status}, response_body = ${JSON.stringify(result.body)}::jsonb, resource_id = ${result.resourceId ?? null}
       WHERE user_id = ${actor.userId} AND operation = ${operation} AND idempotency_key = ${key}`);
    return { replayed: false as const, status: result.status, body: result.body };
  });

  if (out.replayed) c.header('Idempotent-Replayed', 'true');
  return c.json(out.body as object, out.status as 200);
}
