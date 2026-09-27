import { readFileSync } from 'node:fs';
import pg from 'pg';
import { createDb } from '@as/db';
import { validateTemplate } from './validate';
import { importWorldTemplate } from './importer';

async function main() {
  const [cmd, file, ...rest] = process.argv.slice(2);
  if (!cmd || !file) {
    console.error('usage: cli.ts <validate|import> <template.json> [--production]');
    process.exit(2);
  }
  const json = JSON.parse(readFileSync(file, 'utf8'));
  const report = validateTemplate(json, { production: rest.includes('--production') });
  for (const w of report.warnings) console.warn(`warn: ${w}`);
  if (report.errors.length || !report.template) {
    for (const e of report.errors) console.error(`error: ${e}`);
    process.exit(1);
  }
  console.log(`ok: ${file} (${report.template.plots.length} plots, ${report.template.activation_bundles.length} bundles)`);
  if (cmd === 'validate') return;
  if (cmd !== 'import') throw new Error(`unknown command ${cmd}`);
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is required');
  const pool = new pg.Pool({ connectionString: url, max: 2 });
  try {
    const res = await importWorldTemplate(createDb(pool), report.template);
    console.log(JSON.stringify(res, null, 2));
  } finally {
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
