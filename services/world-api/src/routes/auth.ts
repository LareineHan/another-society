import { Hono } from 'hono';
import { z } from 'zod';
import {
  DomainError, ACCESS_TOKEN_TTL_SECONDS, REFRESH_TOKEN_TTL_SECONDS, DEFAULT_DISPLAY_NAME, normalizeForMatch, generatePublicTag,
} from '@as/domain';
import { sql, maybeOne, one, withTx, enqueueOutbox, type Tx } from '@as/db';
import { parseBody, type Vars, type Ctx } from '../http';
import { requireAuth } from '../auth/middleware';
import { signAccessToken, newRefreshToken, hashRefreshToken } from '../auth/tokens';
import { encryptToken } from '../auth/cipher';
import { idempotent } from '../idempotency';
import { endStays, lockPresence } from '../services/social';
import { residentOut, loadResident, iso } from '../services/serialize';
import { cancelLiveReservations } from '../services/plots';

const AppleAuthBody = z.object({
  identity_token: z.string().min(1).max(8192),
  authorization_code: z.string().min(1).max(4096),
  nonce: z.string().min(8).max(256),
  device_label: z.string().max(120).optional(),
});

const RefreshBody = z.object({ refresh_token: z.string().min(32).max(256) });

function clientIp(c: Ctx) {
  return c.req.header('cf-connecting-ip') ?? 'unknown';
}

async function rateLimit(c: Ctx, cls: Parameters<Vars['deps']['rateLimiter']['allow']>[0], key: string) {
  if (!(await c.get('deps').rateLimiter.allow(cls, key))) throw new DomainError('rate_limited', 'Too many requests. Please slow down.');
}
export { rateLimit };

async function createSession(tx: Tx, c: Ctx, userId: string, deviceLabel?: string) {
  const refresh = newRefreshToken();
  const session = await one<{ id: string }>(tx, sql`
    INSERT INTO auth_sessions (user_id, refresh_token_hash, device_label, expires_at, last_used_at)
    VALUES (${userId}, ${await hashRefreshToken(refresh)}, ${deviceLabel ?? null}, now() + make_interval(secs => ${REFRESH_TOKEN_TTL_SECONDS}), now())
    RETURNING id`);
  const access = await signAccessToken(c.get('deps').config.jwtSecret, userId, session.id);
  return { access_token: access, refresh_token: refresh, expires_in: ACCESS_TOKEN_TTL_SECONDS };
}

/** Resident bootstrap: every account gets exactly one resident, presence row, and WORLD wallet. */
async function bootstrapResident(tx: Tx, userId: string): Promise<string> {
  const world = await maybeOne<{ id: string }>(tx, sql`SELECT id FROM worlds ORDER BY created_at LIMIT 1`);
  if (!world) throw new Error('no world imported (run world:import)');
  for (let attempt = 0; attempt < 8; attempt++) {
    const r = await maybeOne<{ id: string }>(tx, sql`
      INSERT INTO residents (user_id, world_id, display_name, display_name_norm, public_tag)
      VALUES (${userId}, ${world.id}, ${DEFAULT_DISPLAY_NAME}, ${normalizeForMatch(DEFAULT_DISPLAY_NAME)}, ${generatePublicTag()})
      ON CONFLICT (public_tag) DO NOTHING RETURNING id`);
    if (r) {
      await tx.execute(sql`INSERT INTO presence (resident_id, state) VALUES (${r.id}, 'home')`);
      await tx.execute(sql`INSERT INTO wallets (wallet_kind, resident_id) VALUES ('resident', ${r.id})`);
      return r.id;
    }
  }
  throw new Error('could not allocate a public tag');
}

export function authRoutes() {
  const app = new Hono<{ Variables: Vars }>();

  app.post('/auth/apple', async (c) => {
    await rateLimit(c, 'auth', `ip:${clientIp(c)}`);
    const body = await parseBody(c, AppleAuthBody);
    const deps = c.get('deps');
    const identity = await deps.apple.verifyIdentityToken(body.identity_token, body.nonce);

    // Network call to Apple happens before the DB transaction (never hold row locks across I/O).
    let appleRefresh: string | undefined;
    let exchangeFailed = false;
    try {
      appleRefresh = (await deps.apple.exchangeAuthorizationCode(body.authorization_code)).refreshToken;
    } catch {
      exchangeFailed = true;
    }
    const encrypted = appleRefresh ? await encryptToken(deps.config.tokenEncryptionKey, appleRefresh) : null;

    const db = await c.get('getDb')();
    const result = await withTx(db, async (tx) => {
      const existing = await maybeOne<{ user_id: string; status: string }>(tx, sql`
        SELECT ai.user_id, u.status FROM auth_identities ai JOIN users u ON u.id = ai.user_id
         WHERE ai.provider = 'apple' AND ai.provider_subject = ${identity.subject}
         FOR UPDATE OF ai`);
      let userId: string;
      let isNew = false;
      if (existing) {
        if (existing.status === 'deleting' || existing.status === 'deleted') {
          throw new DomainError('account_inactive', 'This account is being deleted.');
        }
        userId = existing.user_id;
        await tx.execute(sql`
          UPDATE auth_identities SET last_used_at = now()
                 ${encrypted ? sql`, provider_refresh_token_enc = ${encrypted}, provider_token_updated_at = now()` : sql.empty()}
           WHERE provider = 'apple' AND provider_subject = ${identity.subject}`);
      } else {
        // New accounts must have a revocable Apple token (account deletion requirement).
        if (exchangeFailed || !encrypted) throw new DomainError('unauthorized', 'Sign in with Apple could not be completed. Please try again.');
        const u = await one<{ id: string }>(tx, sql`INSERT INTO users DEFAULT VALUES RETURNING id`);
        userId = u.id;
        isNew = true;
        // Email is stored for support only; it is never an identity or linking key (Blueprint §14.2).
        await tx.execute(sql`
          INSERT INTO auth_identities (user_id, provider, provider_subject, provider_email, last_used_at, provider_refresh_token_enc, provider_token_updated_at)
          VALUES (${userId}, 'apple', ${identity.subject}, ${identity.email ?? null}, now(), ${encrypted}, now())`);
        const residentId = await bootstrapResident(tx, userId);
        await enqueueOutbox(tx, { eventType: 'account.created', aggregateType: 'user', aggregateId: userId, payload: { resident_id: residentId } });
      }
      const tokens = await createSession(tx, c, userId, body.device_label);
      return { ...tokens, user_id: userId, is_new_account: isNew };
    });
    return c.json(result, result.is_new_account ? 201 : 200);
  });

  app.post('/auth/refresh', async (c) => {
    await rateLimit(c, 'auth', `ip:${clientIp(c)}`);
    const body = await parseBody(c, RefreshBody);
    const db = await c.get('getDb')();
    const hash = await hashRefreshToken(body.refresh_token);
    const result = await withTx(db, async (tx) => {
      const s = await maybeOne<{ id: string; user_id: string; status: string }>(tx, sql`
        SELECT s.id, s.user_id, u.status FROM auth_sessions s JOIN users u ON u.id = s.user_id
         WHERE s.refresh_token_hash = ${hash} AND s.revoked_at IS NULL AND s.expires_at > now()
         FOR UPDATE OF s`);
      if (!s || s.status === 'deleting' || s.status === 'deleted') throw new DomainError('unauthorized', 'Session is no longer valid.');
      // Rotate: the presented refresh token stops working immediately.
      const refresh = newRefreshToken();
      await tx.execute(sql`
        UPDATE auth_sessions SET refresh_token_hash = ${await hashRefreshToken(refresh)}, last_used_at = now(),
               expires_at = now() + make_interval(secs => ${REFRESH_TOKEN_TTL_SECONDS})
         WHERE id = ${s.id}`);
      const access = await signAccessToken(c.get('deps').config.jwtSecret, s.user_id, s.id);
      return { access_token: access, refresh_token: refresh, expires_in: ACCESS_TOKEN_TTL_SECONDS, user_id: s.user_id, is_new_account: false };
    });
    return c.json(result, 200);
  });

  app.post('/auth/logout', requireAuth({ allowSuspended: true }), async (c) => {
    const actor = c.get('actor');
    const db = await c.get('getDb')();
    const all = c.req.query('all') === 'true';
    await db.execute(all
      ? sql`UPDATE auth_sessions SET revoked_at = now() WHERE user_id = ${actor.userId} AND revoked_at IS NULL`
      : sql`UPDATE auth_sessions SET revoked_at = now() WHERE id = ${actor.sessionId} AND revoked_at IS NULL`);
    return c.body(null, 204);
  });

  app.get('/me', requireAuth({ allowSuspended: true }), async (c) => {
    const actor = c.get('actor');
    const db = await c.get('getDb')();
    const out: Record<string, unknown> = { user_id: actor.userId, account_status: actor.accountStatus };
    if (actor.residentId) {
      out.resident = await residentOut(db, await loadResident(db, actor.residentId));
      const stay = await maybeOne<{ id: string; space_id: string; host_property_id: string; started_at: Date }>(db, sql`
        SELECT id, space_id, host_property_id, started_at FROM stays WHERE resident_id = ${actor.residentId} AND ended_at IS NULL`);
      if (stay) out.active_stay = { ...stay, started_at: iso(stay.started_at) };
    }
    return c.json(out);
  });

  /**
   * Blueprint §15: revoke sessions now, hide from discovery now, end stays now;
   * Apple token revocation and data anonymization run asynchronously via the outbox.
   */
  app.delete('/account', requireAuth({ allowSuspended: true }), (c) =>
    idempotent(c, 'account.delete', async (tx) => {
      const actor = c.get('actor');
      const user = await one<{ status: string }>(tx, sql`SELECT status FROM users WHERE id = ${actor.userId} FOR UPDATE`);
      const existing = await maybeOne<{ id: string }>(tx, sql`
        SELECT id FROM deletion_requests WHERE user_id = ${actor.userId} AND status IN ('requested','processing') LIMIT 1`);
      if (user.status === 'deleting' && existing) {
        return { status: 202, body: { request_id: c.get('requestId'), resource_id: existing.id }, resourceId: existing.id };
      }
      await tx.execute(sql`UPDATE users SET status = 'deleting', updated_at = now() WHERE id = ${actor.userId}`);
      await tx.execute(sql`UPDATE auth_sessions SET revoked_at = now() WHERE user_id = ${actor.userId} AND revoked_at IS NULL`);
      const req = await one<{ id: string }>(tx, sql`INSERT INTO deletion_requests (user_id) VALUES (${actor.userId}) RETURNING id`);
      if (actor.residentId) {
        const rid = actor.residentId;
        await tx.execute(sql`UPDATE properties SET status = 'hidden', updated_at = now(), revision = revision + 1
                              WHERE owner_resident_id = ${rid} AND status = 'active'`);
        const involved = await tx.execute(sql`
          SELECT DISTINCT resident_id FROM stays s
           WHERE s.ended_at IS NULL AND (s.resident_id = ${rid} OR s.host_property_id IN (SELECT id FROM properties WHERE owner_resident_id = ${rid}))`);
        await lockPresence(tx, [rid, ...(involved.rows as { resident_id: string }[]).map((r) => r.resident_id)]);
        await endStays(tx, sql`resident_id = ${rid} OR host_property_id IN (SELECT id FROM properties WHERE owner_resident_id = ${rid})`, 'account_deleted');
      }
      await cancelLiveReservations(tx, actor.userId);
      await enqueueOutbox(tx, { eventType: 'account.deletion_requested', aggregateType: 'user', aggregateId: actor.userId, payload: { deletion_request_id: req.id } });
      return { status: 202, body: { request_id: c.get('requestId'), resource_id: req.id }, resourceId: req.id };
    }),
  );

  return app;
}
