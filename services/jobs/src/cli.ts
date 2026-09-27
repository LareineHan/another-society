import pg from 'pg';
import { createDb } from '@as/db';
import { reconcile } from '@as/db';

const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL is required');
const pool = new pg.Pool({ connectionString: url, max: 2 });
const report = await reconcile(createDb(pool));
console.log(JSON.stringify(report, null, 2));
await pool.end();
process.exit(report.ok ? 0 : 1);
