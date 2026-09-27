import { sql, maybeOne, type Executor } from './client';

export interface FlagRow { enabled: boolean; config: Record<string, unknown> }

export async function getFlag(db: Executor, key: string): Promise<FlagRow | undefined> {
  return maybeOne<FlagRow>(db, sql`SELECT enabled, config FROM feature_flags WHERE key = ${key}`);
}

export async function getAllFlags(db: Executor): Promise<Record<string, FlagRow>> {
  const res = await db.execute(sql`SELECT key, enabled, config FROM feature_flags ORDER BY key`);
  const out: Record<string, FlagRow> = {};
  for (const r of res.rows as { key: string; enabled: boolean; config: Record<string, unknown> }[]) out[r.key] = { enabled: r.enabled, config: r.config };
  return out;
}
