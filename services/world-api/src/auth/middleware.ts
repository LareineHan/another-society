import type { MiddlewareHandler } from 'hono';
import { DomainError } from '@as/domain';
import { sql, maybeOne } from '@as/db';
import type { Vars, Actor } from '../http';
import { verifyAccessToken } from './tokens';

/**
 * Bearer auth. Identity always comes from the verified session, never from client-supplied ids
 * (Blueprint §60). The session row is checked on every request so revocation and account
 * deletion take effect immediately rather than at access-token expiry.
 */
export function requireAuth(opts: { allowSuspended?: boolean } = {}): MiddlewareHandler<{ Variables: Vars }> {
  return async (c, next) => {
    const header = c.req.header('authorization') ?? '';
    const m = /^Bearer\s+(.+)$/i.exec(header);
    if (!m) throw new DomainError('unauthorized', 'Authentication required.');
    const claims = await verifyAccessToken(c.get('deps').config.jwtSecret, m[1]!);
    if (!claims) throw new DomainError('unauthorized', 'Authentication required.');
    const db = await c.get('getDb')();
    const row = await maybeOne<{ status: Actor['accountStatus']; revoked_at: Date | null; expires_at: Date; resident_id: string | null }>(db, sql`
      SELECT u.status, s.revoked_at, s.expires_at, r.id AS resident_id
        FROM auth_sessions s
        JOIN users u ON u.id = s.user_id
        LEFT JOIN residents r ON r.user_id = u.id
       WHERE s.id = ${claims.sessionId} AND s.user_id = ${claims.userId}`);
    if (!row || row.revoked_at || new Date(row.expires_at).getTime() <= Date.now()) {
      throw new DomainError('unauthorized', 'Session is no longer valid.');
    }
    if (row.status === 'deleting' || row.status === 'deleted') throw new DomainError('unauthorized', 'Session is no longer valid.');
    if (row.status === 'suspended' && !opts.allowSuspended) throw new DomainError('account_inactive', 'This account is suspended.');
    c.set('actor', { userId: claims.userId, sessionId: claims.sessionId, residentId: row.resident_id, accountStatus: row.status });
    await next();
  };
}

export function residentOf(actor: Actor): string {
  if (!actor.residentId) throw new DomainError('forbidden', 'Resident profile is missing.');
  return actor.residentId;
}
