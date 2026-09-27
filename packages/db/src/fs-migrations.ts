// Node-only helper (CLI/tests). Not imported by Workers code.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { MigrationFile } from './migrate';

export function loadMigrationsFromDir(dir: string): MigrationFile[] {
  return readdirSync(dir)
    .filter((f) => /^\d{3}_.+\.sql$/.test(f))
    .sort()
    .map((f) => ({ version: f.replace(/\.sql$/, ''), sql: readFileSync(join(dir, f), 'utf8') }));
}
