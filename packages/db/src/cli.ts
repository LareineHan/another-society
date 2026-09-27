import { resolve } from 'node:path';
import pg from 'pg';
import { runMigrations } from './migrate';
import { loadMigrationsFromDir } from './fs-migrations';
import { createDb } from './client';
import { seedBase } from './seed';

async function main() {
  const cmd = process.argv[2];
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is required');
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    if (cmd === 'migrate') {
      const applied = await runMigrations(client, loadMigrationsFromDir(resolve(process.cwd(), 'db/migrations')), console.log);
      console.log(applied.length ? `applied: ${applied.join(', ')}` : 'up to date');
    } else if (cmd === 'seed') {
      console.log(await seedBase(createDb(client)));
    } else {
      throw new Error('usage: cli.ts <migrate|seed>');
    }
  } finally {
    await client.end();
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
