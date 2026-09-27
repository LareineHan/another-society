import type { Context, MiddlewareHandler } from 'hono';
import { ZodError, type ZodType, type ZodTypeDef } from 'zod';
import { DomainError, isDomainError } from '@as/domain';
import { pgErrorCode } from '@as/db';
import type { Db } from '@as/db';
import type { AppDeps } from './deps';

export interface Actor {
  userId: string;
  sessionId: string;
  residentId: string | null;
  accountStatus: 'active' | 'suspended' | 'deleting' | 'deleted';
}

export type Vars = {
  requestId: string;
  deps: AppDeps;
  getDb: () => Promise<Db>;
  actor: Actor;
  bodyText: string | undefined;
};

export type Ctx = Context<{ Variables: Vars }>;

const B32 = 'abcdefghijklmnopqrstuvwxyz234567';
export function newRequestId(): string {
  const b = new Uint8Array(12);
  crypto.getRandomValues(b);
  let s = 'req_';
  for (const x of b) s += B32[x & 31];
  return s;
}

/** Per-request id, lazy DB handle (one Hyperdrive connection per request), structured access log. */
export function baseMiddleware(deps: AppDeps): MiddlewareHandler<{ Variables: Vars }> {
  return async (c, next) => {
    const started = Date.now();
    const requestId = newRequestId();
    c.set('requestId', requestId);
    c.set('deps', deps);
    let handle: Awaited<ReturnType<AppDeps['openDb']>> | undefined;
    let opening: Promise<Db> | undefined;
    c.set('getDb', () => (opening ??= deps.openDb().then((h) => ((handle = h), h.db))));
    try {
      await next();
    } finally {
      c.header('X-Request-Id', requestId);
      if (handle) {
        const closing = handle.close().catch(() => {});
        try {
          c.executionCtx.waitUntil(closing);
        } catch {
          await closing; // no ExecutionContext (tests / Node)
        }
      }
      deps.log({
        request_id: requestId,
        method: c.req.method,
        route: c.req.routePath,
        status: c.res.status,
        latency_ms: Date.now() - started,
      });
    }
  };
}

export function errorBody(requestId: string, code: string, message: string, details?: Record<string, unknown>) {
  return details ? { request_id: requestId, code, message, details } : { request_id: requestId, code, message };
}

/** Map any thrown error to the stable error envelope. Raw SQL/provider errors never leak. */
export function onError(err: Error, c: Ctx): Response {
  const requestId = c.get('requestId') ?? newRequestId();
  if (isDomainError(err)) {
    return c.json(errorBody(requestId, err.code, err.message, err.details), err.status as 400);
  }
  if (err instanceof ZodError) {
    return c.json(errorBody(requestId, 'validation_error', 'Request failed validation.', {
      issues: err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    }), 422);
  }
  const code = pgErrorCode(err);
  if (code === '40001' || code === '40P01') {
    return c.json(errorBody(requestId, 'conflict', 'The world was busy; please retry.'), 409);
  }
  c.get('deps')?.log({ request_id: requestId, level: 'error', error: err.name, pg_code: code, message: code ? undefined : err.message, stack: err.stack?.split('\n').slice(0, 4).join(' | ') });
  return c.json(errorBody(requestId, 'internal_error', 'Something went wrong.'), 500);
}

export async function readBodyText(c: Ctx): Promise<string> {
  let t = c.get('bodyText');
  if (t === undefined) {
    t = await c.req.text();
    c.set('bodyText', t);
  }
  return t;
}

export async function parseBody<T>(c: Ctx, schema: ZodType<T, ZodTypeDef, unknown>): Promise<T> {
  const text = await readBodyText(c);
  let json: unknown = {};
  if (text.trim().length) {
    try {
      json = JSON.parse(text);
    } catch {
      throw new DomainError('validation_error', 'Body must be valid JSON.');
    }
  }
  return schema.parse(json);
}

export function parseQuery<T>(c: Ctx, schema: ZodType<T, ZodTypeDef, unknown>): T {
  return schema.parse(c.req.query());
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export function uuidParam(c: Ctx, name: string): string {
  const v = c.req.param(name);
  if (!v || !UUID_RE.test(v)) throw new DomainError('not_found', 'Not found.');
  return v.toLowerCase();
}

export async function sha256Hex(text: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
