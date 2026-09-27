import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import pg from 'pg';
import { runMigrations, createDb, seedBase } from '@as/db';
import { loadMigrationsFromDir } from '../packages/db/src/fs-migrations';
import { importWorldTemplate } from '@as/world-template';
import { validateTemplate } from '../packages/world-template/src/validate';

export const PG_BASE = process.env.TEST_PG_URL ?? 'postgres://postgres@127.0.0.1:5433';
export const TEMPLATE_DB = 'as_test_template';

/** Build one fully migrated + seeded + imported template DB; each test file clones it. */
export default async function setup() {
  const admin = new pg.Client({ connectionString: `${PG_BASE}/postgres` });
  await admin.connect();
  await admin.query(`SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname LIKE 'as_test_%' AND pid <> pg_backend_pid()`);
  const { rows } = await admin.query(`SELECT datname FROM pg_database WHERE datname LIKE 'as_test_%'`);
  for (const r of rows) await admin.query(`DROP DATABASE IF EXISTS "${r.datname}"`);
  await admin.query(`CREATE DATABASE ${TEMPLATE_DB}`);
  await admin.end();

  const client = new pg.Client({ connectionString: `${PG_BASE}/${TEMPLATE_DB}` });
  await client.connect();
  await runMigrations(client, loadMigrationsFromDir(resolve(process.cwd(), 'db/migrations')));
  const db = createDb(client);
  await seedBase(db);
  const report = validateTemplate(JSON.parse(readFileSync(resolve(process.cwd(), 'world/templates/founding-city-dev.v0.3.json'), 'utf8')));
  if (!report.template) throw new Error(report.errors.join('\n'));
  await importWorldTemplate(db, report.template);
  await client.end();
}
