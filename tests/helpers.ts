import pg from 'pg';
import { expect } from 'vitest';
import { createDb, sql, rows, one, type Db } from '@as/db';
import { createApp, devAppleProvider } from '@as/world-api';
import type { AppDeps, AppleAuthProvider } from '@as/world-api';
import { createResponseValidator } from '../packages/api-contract/src/validator';

const PG_BASE = process.env.TEST_PG_URL ?? 'postgres://postgres@127.0.0.1:5433';
const validator = createResponseValidator();

export interface Res<T = any> {
  status: number;
  body: T;
  headers: Headers;
}

export interface Resident {
  name: string;
  token: string;
  refreshToken: string;
  userId: string;
  residentId: string;
}

export interface TestWorld {
  db: Db;
  pool: pg.Pool;
  app: ReturnType<typeof createApp>;
  cityId: string;
  apple: AppleAuthProvider & { revoked: string[] };
  logs: Record<string, unknown>[];
  call<T = any>(who: Resident | null, method: string, path: string, body?: unknown, opts?: { idem?: string | boolean; headers?: Record<string, string> }): Promise<Res<T>>;
  signUp(name: string): Promise<Resident>;
  claimHome(r: Resident, plotId?: string): Promise<{ propertyId: string; spaceId: string; plotId: string }>;
  newcomer(name: string): Promise<Resident & { propertyId: string; spaceId: string; plotId: string }>;
  sql: typeof sql;
  close(): Promise<void>;
}

let counter = 0;
export const key = (label = 'k') => `${label}-${Date.now().toString(36)}-${(counter++).toString(36)}-${Math.random().toString(36).slice(2, 10)}`.padEnd(16, 'x');

export async function setupTestWorld(opts: { poolSize?: number } = {}): Promise<TestWorld> {
  const dbName = `as_test_${process.pid}_${Math.random().toString(36).slice(2, 8)}`;
  const admin = new pg.Client({ connectionString: `${PG_BASE}/postgres` });
  await admin.connect();
  await admin.query(`CREATE DATABASE ${dbName} TEMPLATE as_test_template`);
  await admin.end();
  const pool = new pg.Pool({ connectionString: `${PG_BASE}/${dbName}`, max: opts.poolSize ?? 20 });
  pool.on('error', () => {}); // idle clients are terminated when the test DB is dropped
  const db = createDb(pool);
  const logs: Record<string, unknown>[] = [];
  const revoked: string[] = [];
  const apple = { ...devAppleProvider, revoked, async revokeRefreshToken(t: string) { revoked.push(t); } };
  const deps: AppDeps = {
    config: {
      environment: 'test',
      jwtSecret: 'test-secret-test-secret-test-secret-000',
      tokenEncryptionKey: btoa(String.fromCharCode(...new Uint8Array(32).fill(7))),
      assetBaseUrl: 'https://assets.example.test',
    },
    openDb: async () => ({ db, close: async () => {} }),
    apple,
    rateLimiter: { allow: async () => true },
    log: (e) => logs.push(e),
  };
  const app = createApp(deps);
  const city = await one<{ id: string }>(db, sql`SELECT id FROM cities LIMIT 1`);

  const call: TestWorld['call'] = async (who, method, path, body, o = {}) => {
    const headers: Record<string, string> = { ...(o.headers ?? {}) };
    if (who) headers.authorization = `Bearer ${who.token}`;
    if (body !== undefined) headers['content-type'] = 'application/json';
    if (o.idem) headers['idempotency-key'] = typeof o.idem === 'string' ? o.idem : key(method.toLowerCase());
    const res = await app.request(path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await res.text();
    const parsed = text ? JSON.parse(text) : null;
    // Every response is checked against the OpenAPI contract.
    const v = validator.validate(method, path, res.status, parsed);
    if (v.operation && v.errors.length) {
      throw new Error(`contract violation ${v.operation}: ${v.errors.join('; ')}\nbody=${text.slice(0, 500)}`);
    }
    if (res.status >= 400) {
      expect(parsed, `error envelope for ${method} ${path}`).toMatchObject({ code: expect.any(String), message: expect.any(String), request_id: expect.stringMatching(/^req_/) });
    }
    return { status: res.status, body: parsed, headers: res.headers };
  };

  const signUp = async (name: string): Promise<Resident> => {
    const r = await call(null, 'POST', '/v1/auth/apple', { identity_token: `dev:${name}-${key('u')}`, authorization_code: 'code', nonce: 'nonce-123456' });
    expect(r.status).toBe(201);
    const me = { name, token: r.body.access_token, refreshToken: r.body.refresh_token, userId: r.body.user_id, residentId: '' };
    const m = await call(me as Resident, 'GET', '/v1/me');
    me.residentId = m.body.resident.id;
    return me as Resident;
  };

  const claimHome: TestWorld['claimHome'] = async (r, plotId) => {
    // Concurrent newcomers may pick the same plot; like a real client, pick another on plot_unavailable.
    for (let attempt = 0; attempt < 20; attempt++) {
      let pid = plotId;
      if (!pid) {
        const plots = (await call(r, 'GET', `/v1/onboarding/plots?city_id=${city.id}`)).body.plots.filter((p: { status: string; reserved_by_me: boolean }) => p.status === 'vacant' && !p.reserved_by_me);
        if (!plots.length) {
          await new Promise((res) => setTimeout(res, 50));
          continue;
        }
        pid = plots[Math.floor(Math.random() * plots.length)].id;
      }
      const res = await call(r, 'POST', `/v1/plots/${pid}/reserve`, undefined, { idem: true });
      if (res.status === 409 && res.body.code === 'plot_unavailable' && !plotId) continue;
      expect(res.status, JSON.stringify(res.body)).toBe(201);
      const claim = await call(r, 'POST', `/v1/plots/${pid}/claim`, { reservation_id: res.body.reservation_id, structure_asset_id: 'structure.home.cottage.a' }, { idem: true });
      expect(claim.status, JSON.stringify(claim.body)).toBe(201);
      return { propertyId: claim.body.property.id, spaceId: claim.body.property.space_ids[0], plotId: pid! };
    }
    throw new Error('could not claim a plot after 20 attempts');
  };

  return {
    db, pool, app, cityId: city.id, apple, logs, call, signUp, claimHome, sql,
    async newcomer(name) {
      const r = await signUp(name);
      return { ...r, ...(await claimHome(r)) };
    },
    async close() {
      await assertInvariants(db);
      await pool.end();
      const a = new pg.Client({ connectionString: `${PG_BASE}/postgres` });
      await a.connect();
      await a.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
      await a.end();
    },
  };
}

/** Blueprint §58 integrity checks, run after every test file. */
export async function assertInvariants(db: Db) {
  const q = async (label: string, query: ReturnType<typeof sql>) => {
    const r = await rows<Record<string, unknown>>(db, query);
    expect(r, label).toEqual([]);
  };
  await q('posted ledger transactions sum to zero', sql`
    SELECT t.id FROM ledger_transactions t JOIN ledger_entries e ON e.transaction_id = t.id
     WHERE t.status = 'posted' GROUP BY t.id HAVING sum(e.amount) <> 0`);
  await q('wallet cache reconciles to ledger', sql`
    SELECT w.id FROM wallets w LEFT JOIN (SELECT wallet_id, sum(amount) s FROM ledger_entries e JOIN ledger_transactions t ON t.id = e.transaction_id AND t.status = 'posted' GROUP BY wallet_id) l ON l.wallet_id = w.id
     WHERE w.balance <> COALESCE(l.s, 0)`);
  await q('no negative resident wallet', sql`SELECT id FROM wallets WHERE wallet_kind = 'resident' AND balance < 0`);
  await q('no plot with two active properties', sql`SELECT plot_id FROM properties WHERE status = 'active' GROUP BY plot_id HAVING count(*) > 1`);
  await q('no resident with two active stays', sql`SELECT resident_id FROM stays WHERE ended_at IS NULL GROUP BY resident_id HAVING count(*) > 1`);
  await q('no item with two active placements', sql`SELECT item_instance_id FROM placements WHERE removed_at IS NULL GROUP BY item_instance_id HAVING count(*) > 1`);
  await q('placed items have exactly one active placement', sql`
    SELECT ii.id FROM item_instances ii WHERE ii.state = 'placed'
       AND NOT EXISTS (SELECT 1 FROM placements p WHERE p.item_instance_id = ii.id AND p.removed_at IS NULL)`);
  await q('placements only in the owner\'s own spaces', sql`
    SELECT pl.id FROM placements pl JOIN spaces s ON s.id = pl.space_id JOIN properties p ON p.id = s.property_id
      JOIN item_instances ii ON ii.id = pl.item_instance_id
     WHERE pl.removed_at IS NULL AND ii.owner_resident_id IS DISTINCT FROM p.owner_resident_id`);
  await q('stays never exceed capacity', sql`
    SELECT p.id FROM properties p JOIN stays s ON s.host_property_id = p.id AND s.ended_at IS NULL
     GROUP BY p.id, p.stay_capacity HAVING count(*) > p.stay_capacity`);
  await q('no active stay between blocked residents', sql`
    SELECT s.id FROM stays s JOIN properties p ON p.id = s.host_property_id
     WHERE s.ended_at IS NULL AND EXISTS (SELECT 1 FROM blocks b
       WHERE (b.blocker_resident_id = s.resident_id AND b.blocked_resident_id = p.owner_resident_id)
          OR (b.blocker_resident_id = p.owner_resident_id AND b.blocked_resident_id = s.resident_id))`);
  await q('occupied plots have an active property', sql`
    SELECT pl.id FROM plots pl WHERE pl.status = 'occupied' AND NOT EXISTS (SELECT 1 FROM properties p WHERE p.plot_id = pl.id AND p.status IN ('active','hidden'))`);
  await q('claimable plots front active roads', sql`
    SELECT pl.id FROM plots pl JOIN road_nodes rn ON rn.id = pl.frontage_node_id WHERE pl.status IN ('vacant','reserved','occupied') AND NOT rn.active`);
}

export async function count(db: Db, query: ReturnType<typeof sql>): Promise<number> {
  return (await one<{ n: number }>(db, query)).n;
}
