// Used only for `drizzle-kit pull` (typed table definitions from the canonical SQL migrations).
// SQL files in db/migrations remain the source of truth; never use drizzle-kit to generate migrations.
import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dialect: 'postgresql',
  out: './packages/db/src/generated',
  dbCredentials: { url: process.env.DATABASE_URL ?? 'postgres://postgres@127.0.0.1:5433/as_dev' },
  tablesFilter: ['!schema_migrations'],
});
