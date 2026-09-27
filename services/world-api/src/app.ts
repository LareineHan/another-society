import { Hono } from 'hono';
import { DomainError } from '@as/domain';
import { sql } from '@as/db';
import { baseMiddleware, onError, errorBody, type Vars } from './http';
import type { AppDeps } from './deps';
import { authRoutes } from './routes/auth';
import { residentRoutes } from './routes/resident';
import { worldRoutes } from './routes/world';
import { propertyRoutes } from './routes/property';
import { socialRoutes } from './routes/social';
import { economyRoutes } from './routes/economy';

/** Resident-facing API. Admin lives in a separate Worker (admin/app.ts) behind Cloudflare Access. */
export function createApp(deps: AppDeps) {
  const app = new Hono<{ Variables: Vars }>();
  app.use('*', baseMiddleware(deps));
  app.onError((err, c) => onError(err, c));
  app.notFound((c) => c.json(errorBody(c.get('requestId'), 'not_found', 'Not found.'), 404));

  // Milestone 0: Worker health + DB health.
  app.get('/health', async (c) => {
    const started = Date.now();
    const db = await c.get('getDb')();
    const r = await db.execute(sql`SELECT 1 AS ok, (SELECT max(version) FROM schema_migrations) AS schema_version`);
    const row = r.rows[0] as { ok: number; schema_version: string | null };
    return c.json({ ok: row.ok === 1, schema_version: row.schema_version, db_ms: Date.now() - started, environment: deps.config.environment });
  });

  const v1 = new Hono<{ Variables: Vars }>();
  v1.route('/', authRoutes());
  v1.route('/', residentRoutes());
  v1.route('/', worldRoutes());
  v1.route('/', propertyRoutes());
  v1.route('/', socialRoutes());
  v1.route('/', economyRoutes());
  app.route('/v1', v1);

  // Creator economy namespaces exist in the API family but are not surfaced in v0.1 (Blueprint §64).
  for (const path of ['/v1/designs', '/v1/craft', '/v1/procurement/*', '/v1/market/*']) {
    app.all(path, () => {
      throw new DomainError('not_found', 'Not available yet.');
    });
  }
  return app;
}
