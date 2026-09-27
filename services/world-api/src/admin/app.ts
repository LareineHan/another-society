import { Hono, type MiddlewareHandler } from 'hono';
import { z } from 'zod';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { DomainError } from '@as/domain';
import { sql, rows, one, maybeOne, withTx, reconcile, type Tx } from '@as/db';
import { baseMiddleware, onError, errorBody, parseBody, parseQuery, uuidParam, type Vars, type Ctx } from '../http';
import type { AppDeps } from '../deps';
import { endStays, lockPresence } from '../services/social';

/**
 * Admin moderation surface (Blueprint §24 Admin, §62). Deployed as a SEPARATE Worker behind
 * Cloudflare Access; never shares resident authorization and is never shipped in the iOS bundle.
 * Every action is written to moderation_actions.
 */
export interface AdminVerifier {
  verify(request: Request): Promise<{ email: string } | null>;
}

export function cloudflareAccessVerifier(opts: { teamDomain: string; audience: string; adminEmails: string[] }): AdminVerifier {
  const jwks = createRemoteJWKSet(new URL(`https://${opts.teamDomain}/cdn-cgi/access/certs`));
  const allow = new Set(opts.adminEmails.map((e) => e.trim().toLowerCase()).filter(Boolean));
  return {
    async verify(request) {
      const token = request.headers.get('cf-access-jwt-assertion');
      if (!token) return null;
      try {
        const { payload } = await jwtVerify(token, jwks, { issuer: `https://${opts.teamDomain}`, audience: opts.audience });
        const email = typeof payload.email === 'string' ? payload.email.toLowerCase() : '';
        return allow.has(email) ? { email } : null; // explicit admin role, not merely "passed Access"
      } catch {
        return null;
      }
    },
  };
}

const ReportsQuery = z.object({
  status: z.enum(['open', 'reviewing', 'resolved', 'dismissed']).default('open'),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});
const ReportStatusBody = z.object({ status: z.enum(['reviewing', 'resolved', 'dismissed']), note: z.string().max(2000).optional() }).strict();
const ModerationBody = z.object({
  target_type: z.enum(['resident', 'property', 'item_definition']),
  target_id: z.string().uuid(),
  action: z.enum(['suspend', 'unsuspend', 'hide', 'unhide']),
  reason: z.string().min(1).max(2000),
  report_id: z.string().uuid().optional(),
}).strict();

async function audit(tx: Tx, admin: string, a: { reportId?: string; targetType: string; targetId: string; action: string; reason?: string }) {
  await tx.execute(sql`
    INSERT INTO moderation_actions (report_id, target_type, target_id, action_type, reason, actor_admin_id)
    VALUES (${a.reportId ?? null}, ${a.targetType}, ${a.targetId}, ${a.action}, ${a.reason ?? null}, ${admin})`);
}

const adminOf = (c: Ctx) => (c as unknown as { get(k: 'admin'): { email: string } }).get('admin');

export function createAdminApp(deps: AppDeps, verifier: AdminVerifier) {
  const app = new Hono<{ Variables: Vars }>();
  app.use('*', baseMiddleware(deps));
  app.onError((err, c) => onError(err, c));
  app.notFound((c) => c.json(errorBody(c.get('requestId'), 'not_found', 'Not found.'), 404));
  const requireAdmin: MiddlewareHandler<{ Variables: Vars }> = async (c, next) => {
    const admin = await verifier.verify(c.req.raw);
    if (!admin) throw new DomainError('forbidden', 'Admin access required.');
    (c as unknown as { set(k: 'admin', v: { email: string }): void }).set('admin', admin);
    await next();
  };
  app.use('/admin/*', requireAdmin);

  app.get('/admin/v1/reports', async (c) => {
    const q = parseQuery(c, ReportsQuery);
    const db = await c.get('getDb')();
    const list = await rows(db, sql`
      SELECT r.id, r.target_type, r.target_id, r.reason_code, r.details, r.status, r.created_at, r.resolved_at, r.reporter_resident_id,
             (SELECT count(*)::int FROM reports o WHERE o.target_type = r.target_type AND o.target_id = r.target_id) AS reports_on_target
        FROM reports r WHERE r.status = ${q.status} ORDER BY r.created_at LIMIT ${q.limit}`);
    return c.json({ items: list });
  });

  app.post('/admin/v1/reports/:reportId/status', async (c) => {
    const id = uuidParam(c, 'reportId');
    const body = await parseBody(c, ReportStatusBody);
    const db = await c.get('getDb')();
    const out = await withTx(db, async (tx) => {
      const r = await maybeOne<{ id: string; target_type: string; target_id: string }>(tx, sql`SELECT id, target_type, target_id FROM reports WHERE id = ${id} FOR UPDATE`);
      if (!r) throw new DomainError('not_found', 'Not found.');
      await tx.execute(sql`UPDATE reports SET status = ${body.status},
                             resolved_at = CASE WHEN ${body.status}::text IN ('resolved','dismissed') THEN now() ELSE NULL END WHERE id = ${id}`);
      await audit(tx, adminOf(c).email, { reportId: id, targetType: r.target_type, targetId: r.target_id, action: `report_${body.status}`, reason: body.note });
      return { id, status: body.status };
    });
    return c.json({ request_id: c.get('requestId'), ...out });
  });

  app.post('/admin/v1/moderation', async (c) => {
    const body = await parseBody(c, ModerationBody);
    const db = await c.get('getDb')();
    await withTx(db, async (tx) => {
      if (body.target_type === 'resident') {
        if (body.action !== 'suspend' && body.action !== 'unsuspend') throw new DomainError('validation_error', 'Residents are suspended or unsuspended.');
        const r = await maybeOne<{ user_id: string }>(tx, sql`SELECT user_id FROM residents WHERE id = ${body.target_id}`);
        if (!r) throw new DomainError('not_found', 'Not found.');
        const status = body.action === 'suspend' ? 'suspended' : 'active';
        await tx.execute(sql`UPDATE users SET status = ${status}, updated_at = now() WHERE id = ${r.user_id} AND status IN ('active','suspended')`);
        if (body.action === 'suspend') {
          // A suspended owner's properties read as not-found; end stays in both directions now.
          const involved = await rows<{ resident_id: string }>(tx, sql`
            SELECT DISTINCT resident_id FROM stays WHERE ended_at IS NULL
               AND (resident_id = ${body.target_id} OR host_property_id IN (SELECT id FROM properties WHERE owner_resident_id = ${body.target_id}))`);
          await lockPresence(tx, [body.target_id, ...involved.map((x) => x.resident_id)]);
          await endStays(tx, sql`resident_id = ${body.target_id} OR host_property_id IN (SELECT id FROM properties WHERE owner_resident_id = ${body.target_id})`, 'moderation');
        }
      } else if (body.target_type === 'property') {
        if (body.action !== 'hide' && body.action !== 'unhide') throw new DomainError('validation_error', 'Properties are hidden or unhidden.');
        const p = await maybeOne<{ id: string }>(tx, sql`SELECT id FROM properties WHERE id = ${body.target_id} AND status <> 'archived' FOR UPDATE`);
        if (!p) throw new DomainError('not_found', 'Not found.');
        await tx.execute(sql`UPDATE properties SET status = ${body.action === 'hide' ? 'hidden' : 'active'}, revision = revision + 1, updated_at = now() WHERE id = ${p.id}`);
        if (body.action === 'hide') {
          const stayers = await rows<{ resident_id: string }>(tx, sql`SELECT resident_id FROM stays WHERE host_property_id = ${p.id} AND ended_at IS NULL`);
          await lockPresence(tx, stayers.map((s) => s.resident_id));
          await endStays(tx, sql`host_property_id = ${p.id}`, 'moderation');
        }
      } else {
        if (body.action !== 'hide' && body.action !== 'unhide') throw new DomainError('validation_error', 'Items are hidden or unhidden.');
        const d = await maybeOne(tx, sql`SELECT id FROM item_definitions WHERE id = ${body.target_id}`);
        if (!d) throw new DomainError('not_found', 'Not found.');
        await tx.execute(sql`UPDATE item_definitions SET moderation_status = ${body.action === 'hide' ? 'hidden' : 'approved'}, updated_at = now() WHERE id = ${body.target_id}`);
      }
      await audit(tx, adminOf(c).email, { reportId: body.report_id, targetType: body.target_type, targetId: body.target_id, action: body.action, reason: body.reason });
    });
    return c.json({ request_id: c.get('requestId'), ok: true });
  });

  app.get('/admin/v1/moderation/:targetId', async (c) => {
    const id = uuidParam(c, 'targetId');
    const db = await c.get('getDb')();
    return c.json({ items: await rows(db, sql`SELECT * FROM moderation_actions WHERE target_id = ${id} ORDER BY created_at DESC LIMIT 100`) });
  });

  /** Ledger/ownership integrity (Blueprint §58) on demand. */
  app.get('/admin/v1/integrity', async (c) => c.json(await reconcile(await c.get('getDb')())));

  /** Operational counters: outbox backlog/failures (DLQ proxy), deletion backlog, open reports. */
  app.get('/admin/v1/ops', async (c) => {
    const db = await c.get('getDb')();
    const r = await one(db, sql`
      SELECT (SELECT count(*)::int FROM outbox_events WHERE status IN ('pending','publishing')) AS outbox_backlog,
             (SELECT count(*)::int FROM outbox_events WHERE status = 'failed') AS outbox_failed,
             (SELECT min(created_at) FROM outbox_events WHERE status IN ('pending','failed')) AS outbox_oldest,
             (SELECT count(*)::int FROM deletion_requests WHERE status IN ('requested','processing','failed')) AS deletion_backlog,
             (SELECT count(*)::int FROM reports WHERE status IN ('open','reviewing')) AS open_reports`);
    return c.json(r);
  });

  return app;
}
