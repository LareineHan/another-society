import pg from 'pg';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { sql, type SQL } from 'drizzle-orm';

// ---------------------------------------------------------------------------
// Type parsing. BIGINT (int8) values in this schema are currency minor units and
// revisions; they stay far below 2^53, so parse to number but refuse silent precision loss.
// DATE stays a plain 'YYYY-MM-DD' string (no timezone shifting).
// ---------------------------------------------------------------------------
const parseInt8 = (v: string): number => {
  const n = Number(v);
  if (!Number.isSafeInteger(n)) throw new Error('int8 value exceeds safe integer range');
  return n;
};
pg.types.setTypeParser(20, parseInt8); // int8
pg.types.setTypeParser(1082, (v: string) => v); // date

export type Db = NodePgDatabase<Record<string, never>>;
/** Anything that can run `execute(sql)`: the root db or a transaction handle. */
export type Executor = Pick<Db, 'execute'>;

export function createDb(client: pg.Pool | pg.Client | pg.PoolClient): Db {
  return drizzle(client as pg.Pool);
}

export { sql, type SQL };

/**
 * Bind a JS array as ONE Postgres array parameter. (Interpolating a bare array into drizzle's
 * `sql` template expands it into a parenthesized list, which is wrong for `= ANY($1::uuid[])`.)
 */
export const pgArray = (values: readonly unknown[]) => sql.param(values);

/** Bind a JS value as a jsonb parameter. */
export const pgJson = (value: unknown) => sql`${JSON.stringify(value)}::jsonb`;

/** Run a query and return typed rows. */
export async function rows<T>(db: Executor, query: SQL): Promise<T[]> {
  const res = await db.execute(query);
  return res.rows as T[];
}

/** Run a query expected to return at most one row. */
export async function maybeOne<T>(db: Executor, query: SQL): Promise<T | undefined> {
  const r = await rows<T>(db, query);
  return r[0];
}

/** Run a query that must return exactly one row. */
export async function one<T>(db: Executor, query: SQL): Promise<T> {
  const r = await rows<T>(db, query);
  if (r.length !== 1) throw new Error(`expected exactly one row, got ${r.length}`);
  return r[0] as T;
}

export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

const RETRYABLE = new Set(['40001', '40P01']); // serialization_failure, deadlock_detected

export function pgErrorCode(e: unknown): string | undefined {
  let cur: unknown = e;
  for (let i = 0; i < 4 && cur; i++) {
    const code = (cur as { code?: unknown }).code;
    if (typeof code === 'string' && /^[0-9A-Z]{5}$/.test(code)) return code;
    cur = (cur as { cause?: unknown }).cause;
  }
  return undefined;
}

export function pgConstraint(e: unknown): string | undefined {
  let cur: unknown = e;
  for (let i = 0; i < 4 && cur; i++) {
    const c = (cur as { constraint?: unknown }).constraint;
    if (typeof c === 'string') return c;
    cur = (cur as { cause?: unknown }).cause;
  }
  return undefined;
}

/**
 * Explicit PostgreSQL transaction (READ COMMITTED + row locks) with bounded retry on
 * serialization failures/deadlocks. Business logic inside must be safe to re-run.
 * No advisory locks: Hyperdrive does not support them (Blueprint §19).
 */
export async function withTx<T>(db: Db, fn: (tx: Tx) => Promise<T>, opts: { retries?: number } = {}): Promise<T> {
  const retries = opts.retries ?? 3;
  for (let attempt = 0; ; attempt++) {
    try {
      return await db.transaction(fn);
    } catch (e) {
      const code = pgErrorCode(e);
      if (code && RETRYABLE.has(code) && attempt < retries) {
        await new Promise((r) => setTimeout(r, 5 * 2 ** attempt + Math.random() * 10));
        continue;
      }
      throw e;
    }
  }
}
