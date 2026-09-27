// Local API without wrangler: the same Hono app, served by Node, against DATABASE_URL.
// DEV AUTH ONLY (accepts `dev:<name>` identity tokens). Used by iOS integration tests in CI and
// handy for Simulator work:  DATABASE_URL=postgres://... pnpm dev:server
import { serve } from '@hono/node-server';
import pg from 'pg';
import { createDb } from '@as/db';
import { createApp, devAppleProvider } from '@as/world-api';

const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL is required');
const pool = new pg.Pool({ connectionString: url, max: 20 });
pool.on('error', () => {});
const db = createDb(pool);
const app = createApp({
  config: {
    environment: 'local',
    jwtSecret: process.env.JWT_SECRET ?? 'local-dev-secret-local-dev-secret-0000',
    tokenEncryptionKey: process.env.TOKEN_ENCRYPTION_KEY ?? 'BwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwc=',
    assetBaseUrl: 'http://127.0.0.1:8787/assets',
  },
  openDb: async () => ({ db, close: async () => {} }),
  apple: devAppleProvider,
  rateLimiter: { allow: async () => true },
  log: (e) => { if (process.env.LOG_REQUESTS) console.log(JSON.stringify(e)); },
});
const port = Number(process.env.PORT ?? 8787);
serve({ fetch: app.fetch, port, hostname: '127.0.0.1' });
console.log(`another-society dev API on http://127.0.0.1:${port} (DEV_AUTH)`);
