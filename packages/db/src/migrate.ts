import pg from 'pg';

export interface MigrationFile {
  version: string;
  sql: string;
}

async function sha256Hex(text: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Minimal forward-only migration runner. Each file is self-transactional (BEGIN/COMMIT inside).
 * Applied files are checksummed; editing an applied migration is an error — write a new one.
 */
export async function runMigrations(client: pg.Client | pg.PoolClient, files: MigrationFile[], log: (m: string) => void = () => {}): Promise<string[]> {
  await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version text PRIMARY KEY,
    checksum text NOT NULL,
    applied_at timestamptz NOT NULL DEFAULT now()
  )`);
  const { rows } = await client.query<{ version: string; checksum: string }>('SELECT version, checksum FROM schema_migrations');
  const applied = new Map(rows.map((r) => [r.version, r.checksum]));
  const done: string[] = [];
  for (const f of [...files].sort((a, b) => a.version.localeCompare(b.version))) {
    const checksum = await sha256Hex(f.sql);
    const prev = applied.get(f.version);
    if (prev) {
      if (prev !== checksum) throw new Error(`Migration ${f.version} was edited after being applied (checksum mismatch). Write a new migration instead.`);
      continue;
    }
    log(`applying ${f.version}`);
    await client.query(f.sql);
    await client.query('INSERT INTO schema_migrations(version, checksum) VALUES ($1, $2)', [f.version, checksum]);
    done.push(f.version);
  }
  return done;
}
