# ADR-0001 — Another Society Foundation Lock

**Status:** Accepted for v0.3 implementation baseline.

## Context

Another Society must feel socially meaningful with very few residents, avoid the cost profile of realtime multiplayer, preserve future web/Android clients, and allow a later creator economy without rewriting identity, ownership, land, or money.

## Decisions

1. **World representation:** illustrated fixed-camera 2.5D made from 2D sprites; 2D fixed-point world coordinates.
2. **Spatial model:** authored public macro-map + connected activation bundles; no per-house procedural public-road generation.
3. **Land:** server-authoritative Plot → Property ownership with atomic reservation/claim.
4. **Social model:** Visit is anonymous and non-live; Stay is durable asynchronous foreign presence.
5. **Communication:** no stranger chat/DM/comments; social verbs are presence, objects, gifting, discovery, commerce, block/report.
6. **Property authority:** only owner controls permanent layout. Gift placement is provisional until owner resolves it.
7. **Identity:** permanent server UUID, provider links separate, Sign in with Apple first, public display identity separate.
8. **Backend:** Cloudflare Workers + Hyperdrive + Neon PostgreSQL + R2 + Queues.
9. **Canonical database:** one transactional PostgreSQL database initially. D1 is not canonical.
10. **Transactions:** critical mutations use PostgreSQL transactions, row locks, unique constraints, and idempotency keys.
11. **Economy:** auditable immutable balanced ledger; bounded system procurement can supply baseline demand; explicit faucets/sinks.
12. **Real money:** initial WORLD soft currency is not directly purchasable; future monetization is separate platform-compliant entitlement/cosmetic commerce.
13. **UGC:** v0.1 public UGC is constrained composition, not arbitrary uploads.
14. **Scaling:** scale by spatial/query partitioning and many human-scale settlements before considering database sharding.
15. **Cross-platform:** iOS is first client, not the data model. Renderers may differ; API/domain semantics do not.
16. **Reliability:** transactional outbox, idempotent queue consumers, immutable/versioned assets, optimistic layout revisions, expand/contract DB migrations.

## Consequences

- Product can launch cheaply with a small population.
- The core social loop does not require WebSockets or frame-by-frame position sync.
- Creator economy and multiple properties can be enabled later without schema inversion.
- The city can visibly grow while keeping public infrastructure coherent.
- Web/Android can join the same world through the same API.
- More sophisticated realtime behavior, arbitrary UGC, land speculation, or cash-out creator economy require separate ADRs and policy review.

## Change policy

Any future proposal that changes one of the 16 decisions above must include:
- the measured problem,
- alternatives considered,
- migration plan,
- cost impact,
- abuse/safety impact,
- backwards-compatibility impact,
- a new ADR.
