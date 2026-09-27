# Another Society v0.3 — START HERE

This package is the coding baseline for **Another Society**. Treat the blueprint, SQL schema, and API contract as the source of truth. Coding agents should not reinterpret the product into a chat app, feed, realtime MMO, 3D world, or iOS-only backend.

## Read in this order

1. `Another_Society_Blueprint_v0.3.docx` or `.md` — product, system, economy, scale, safety, and implementation decisions.
2. `ADR-0001_Another_Society_Foundation_Lock_v0.3.md` — short list of decisions that require an explicit future ADR to change.
3. `Another_Society_001_core_schema_v0.3.sql` — canonical PostgreSQL foundation schema.
4. `Another_Society_OpenAPI_v0.3.yaml` — v1 HTTP contract.
5. `Another_Society_WorldTemplate.schema.json` — offline city-template contract.
6. `founding-city-dev.v0.3.json` — engineering fixture only; it proves the importer/activation model and is **not final art or final city planning**.
7. `Another_Society_AssetManifest.schema.json` — portable 2.5D asset metadata contract.

## Implementation baseline

- Client #1: iOS, SwiftUI shell + SpriteKit world/property scenes.
- World representation: fixed-camera illustrated 2.5D assembled from 2D sprites; simulation coordinates remain 2D fixed-point.
- Backend: Cloudflare Workers (TypeScript) → Hyperdrive → Neon PostgreSQL.
- Assets: Cloudflare R2.
- Async work: Cloudflare Queues.
- Auth: server UUID + Sign in with Apple provider link first.
- API: versioned REST `/v1`, OpenAPI-first.
- ORM/query layer: Drizzle for schema/query ergonomics, **explicit PostgreSQL transactions and row locks for critical mutations**.
- Validation: Zod at API boundaries.
- No separate realtime service in v0.1. Ordinary Visit is not live presence; Stay is durable asynchronous presence.
- No D1 as canonical transactional database.
- No Redis, Kafka, Elasticsearch, CRDT, microservices, or Durable Objects unless measured evidence later requires one.

## First build sequence

1. Create monorepo and CI.
2. Provision dev Cloudflare + Neon projects.
3. Apply `001_core_schema_v0.3.sql`.
4. Generate typed API client/server types from OpenAPI.
5. Implement auth/provider linking and resident bootstrap.
6. Import `founding-city-dev.v0.3.json` through a world-template importer.
7. Implement atomic plot reservation/claim.
8. Implement property layout revision/sync and starter catalog.
9. Implement inventory + wallet + immutable ledger + idempotency.
10. Implement Wander/Visit aggregate/Stay/Leave/Send Home and access rules.
11. Implement safe gifts, block, report, and minimal admin review.
12. Run acceptance/race/retry tests before creator economy.

## Non-negotiable implementation rules

- Stable opaque IDs are canonical; names are never keys.
- Ownership, currency, land claims, inventory transfer, gifts, procurement, and marketplace settlement are server-authoritative.
- Every retryable critical mutation carries an `Idempotency-Key`.
- Posted ledger transactions are immutable and balanced.
- Plot claims use database transactions and row locking.
- One resident can own multiple properties in the schema even while v0.1 UI exposes one.
- Public roads are authored infrastructure. A new house only receives a private access path to existing frontage.
- The first city expands by activating pre-authored connected street/plot bundles.
- Visit does not create a globally broadcast live-presence stream.
- Stay is the durable public foreign-presence primitive.
- A property has normal access, away access, stay permission, and finite stay capacity as distinct controls.
- The owner can Send Home a stayer without messaging.
- Gifts never grant layout authority.
- `WORLD` currency is not directly purchasable for real money in the initial model.
- Arbitrary public image/audio/text uploads are out of v0.1.
- The renderer is replaceable; world semantics cannot depend on SpriteKit.

## Suggested repository layout

```text
another-society/
  apps/
    ios/
    web/                  # later
  services/
    world-api/            # Cloudflare Worker
    jobs/                 # queue consumers
  packages/
    api-contract/
    domain/
    db/
    world-template/
    asset-manifest/
  infra/
    cloudflare/
    neon/
  db/
    migrations/
  world/
    templates/
  docs/
    blueprint/
    adr/
```

## What remains intentionally non-blocking

These can be decided after coding begins without changing the foundation:

- final public product name,
- final Mini illustration style and exact sprite proportions,
- final first-city art/map composition,
- final soft-currency name,
- exact starter grant/prices,
- final second-settlement theme,
- later creator royalty percentages,
- whether visit aggregates use exact numbers or soft language.

Do not reopen the foundation for those questions.
