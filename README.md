# Another Society

A quiet, anonymous, persistent digital society. Residents claim a real place in a shared city, build a
home, visit, stay, and leave gifts. Presence and objects are the communication layer; there is no chat.

The product and architecture are locked by the v0.3 coding pack:

- [`docs/blueprint/Another_Society_Blueprint_v0.3.md`](docs/blueprint/Another_Society_Blueprint_v0.3.md) (source of truth)
- [`docs/adr/ADR-0001_Another_Society_Foundation_Lock_v0.3.md`](docs/adr/ADR-0001_Another_Society_Foundation_Lock_v0.3.md) (16 locked decisions)
- [`docs/adr/ADR-0002_contract_alignment.md`](docs/adr/ADR-0002_contract_alignment.md) (expand-only fixes found while implementing)
- [`docs/STATUS.md`](docs/STATUS.md) (what is built, what is open)

## Layout

```text
db/migrations/            canonical SQL (001 verbatim from the pack, 002 additive)
world/templates/          founding-city-dev.v0.3.json (engineering fixture, not final art)
packages/
  domain/                 pure rules: activation policy, access, display name, Mini parts, config
  db/                     pg + Drizzle, transactions with retry, migrations, seed, outbox, integrity checks
  world-template/         template validation, idempotent importer, bundle activation controller
  asset-manifest/         platform-neutral asset pack (core-dev v1) + validator
  api-contract/           openapi.yaml (v0.3.1, additive over v0.3.0), generated TS types, response validator
services/
  world-api/              resident API Worker (Hono) + admin Worker (Cloudflare Access)
  jobs/                   outbox publisher, queue consumer, crons (deletion, retention, reconciliation)
tests/                    acceptance tests against real Postgres; every response is checked against OpenAPI
apps/ios/                 SwiftUI + SpriteKit client (next)
```

## Run locally

Requirements: Node 22, pnpm 10, PostgreSQL 16.

```bash
pnpm install

# a database for local dev
createdb as_dev
export DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5433/as_dev
pnpm db:migrate && pnpm db:seed && pnpm world:import

# API in the real Workers runtime (Hyperdrive localConnectionString -> local Postgres)
cp services/world-api/.dev.vars.example services/world-api/.dev.vars
cd services/world-api && npx wrangler dev
# in another shell: end-to-end smoke of the core loop
node scripts/workerd-smoke.mjs http://127.0.0.1:8787
```

`DEV_AUTH=true` (local only) accepts identity tokens of the form `dev:<anything>` so you can sign in
without Apple. The Worker refuses to start with `DEV_AUTH` in production.

## Test

```bash
TEST_PG_URL=postgres://postgres:postgres@127.0.0.1:5433 pnpm test
pnpm ci   # typecheck + contract lint + template validation + tests
```

Tests clone a migrated, seeded, imported template database per file, so they run in parallel.
After each file the Blueprint §58 integrity checks run (ledger balanced, wallets reconcile, one owner
per plot/item, one active stay per resident, capacity, no stay across a block).

## Deploy (first time)

1. Neon: create project (Launch plan for public beta), set `autoscaling_limit_max_cu` conservatively,
   enable spending alerts. Run `pnpm db:migrate && pnpm db:seed && pnpm world:import` against it.
2. Cloudflare: create a Hyperdrive config pointing at Neon; put its id in the `env.staging` /
   `env.production` blocks of `services/*/wrangler*.toml`.
3. Queues: `wrangler queues create as-events` and `as-events-dlq`.
4. Secrets per env: `JWT_SECRET`, `TOKEN_ENCRYPTION_KEY` (32 random bytes, base64), `APPLE_TEAM_ID`,
   `APPLE_KEY_ID`, `APPLE_PRIVATE_KEY` (Sign in with Apple .p8).
5. Admin Worker: its own hostname behind a Cloudflare Access application; set `ACCESS_TEAM_DOMAIN`,
   `ACCESS_AUD`, `ADMIN_EMAILS`.
6. Billing alerts on Cloudflare and Neon (informational; ledger correctness is never auto-disabled).
