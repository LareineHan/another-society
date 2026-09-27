# Another Society
## Product & System Blueprint v0.3 — Coding Baseline

**Status:** FOUNDATION LOCKED / READY TO IMPLEMENT  
**Working product name:** Another Society  
**Document role:** Source of truth for product behavior, backend architecture, data model, client boundaries, economic invariants, scaling, and implementation order.  
**Research verified:** 2026-09-25

> **Implementation rule:** Do not reopen a foundation decision during ordinary feature work unless a measured technical constraint or a product-law conflict is demonstrated. If implementation requires a deviation, write an ADR first and preserve the invariants in this document.

---

## 0. Executive decision

Another Society is a **quiet, anonymous, persistent digital society**. A resident chooses a real place in a shared fictional city, claims a plot, creates a Mini, builds and decorates a property, moves through streets, visits other spaces, stays in them asynchronously, leaves gifts, discovers objects and makers, and eventually participates in an economy.

It is **not primarily a fantasy app**. Fantasy is one valid private use of the world, alongside ordinary self-expression, alternate lives, relationships, collecting, making, running a studio/shop, or simply keeping a quiet home. The product never requires a resident to label what is real versus imagined.

The implementation foundation is now locked as follows:

1. **World representation:** lightweight illustrated **2.5D built from 2D sprites**, with a fixed 3/4 camera. World logic is 2D. There is no 3D simulation, free camera, or physics requirement.
2. **iOS client:** SwiftUI for application UI + SpriteKit for world/property scenes. iOS is client #1, not the canonical world.
3. **Cross-platform rule:** all world semantics, IDs, layouts, asset manifests, economy, and ownership live behind a versioned server API. Web and Android can later render the same world with independent clients.
4. **Founding city:** an **authored macro-map with gated parcel activation**, not fully procedural generation. Roads and civic structure are designed; streets/plots are progressively activated as residents arrive.
5. **Backend:** Cloudflare Workers (TypeScript) + Hyperdrive + Neon Postgres + Cloudflare R2 + Cloudflare Queues.
6. **Canonical database:** one transactional Postgres database. Do not shard early. All schemas include world/city scope so sharding remains possible if actual scale eventually requires it.
7. **Authority:** server owns land, inventory, currency, transfers, transactions, stays, gifts, and canonical layouts. Clients render/cache and may edit optimistically only where conflicts are safe.
8. **Social:** no stranger-to-stranger text communication. Presence and objects are the communication layer.
9. **Economy:** immutable ledger; resident market plus bounded city procurement; money faucets and sinks are explicit; no grind, punitive rent, or speculative land economy.
10. **UGC safety:** v0.1 deliberately constrains public UGC. No arbitrary public image/audio uploads, no chat, system-safe gifts, and only approved modular creator parts when creation ships.
11. **Presence cost rule:** transient Visit is not globally live presence. A resident becomes publicly present in a foreign property only by choosing Stay. This avoids sockets/heartbeats while preserving the social meaning of presence.
12. **Real-money separation:** the resident economy uses earned soft world currency. Real-money purchases, if/when added, are separate platform-compliant premium entitlements/system-authored goods and never directly mint transferable creator-economy currency.

This architecture can start with a handful of residents at very low cost and grow through 100,000 registered residents without changing the product model or replacing the canonical data model. Scaling steps are capacity changes, caching/read-replica changes, and eventually optional partitioning—not a rewrite.

---

# Part I — Product Constitution

## 1. The product in one sentence

**A place where people quietly inhabit a shared world and become socially present through spaces, movement, staying, objects, making, and exchange rather than conversation or performance.**

## 2. Five locked laws

### L1 — No words between strangers
There is no DM, live chat, comment thread, follower messaging, guestbook text, or public stranger-to-stranger note system.

Text may exist for system UI, the resident's own private material, moderation/support, and tightly constrained public labels such as a display name. A future feature does not become acceptable merely because it calls itself a “note” instead of a message.

### L2 — Presence is communication
The primary social verbs are:

- wander
- travel
- arrive
- visit
- look
- sit
- stay
- leave
- gift
- discover
- buy
- make

A resident can feel another person without needing to speak to them.

### L3 — Your space is yours
Only the property owner controls permanent placement and arrangement. Visitors can temporarily exist in a space and leave an allowed gift, but they cannot move furniture, change walls, alter a scene, or reposition the owner's Mini/companion.

### L4 — Private meaning, visible world
Why a space or relationship exists may remain completely private. Visitors see the visible tableau, not the explanation behind it.

### L5 — Making, not grinding
Economic participation should reward designing, composing, arranging, making, exchanging, and running a place—not repetitive tapping, daily attendance, ad watching, streaks, XP farming, or mandatory chores.

## 3. Explicit non-goals

Another Society is not:

- a chat app with avatars;
- a follower/creator feed with rooms attached;
- a real-time MMORPG;
- a Sims-like needs-management simulator;
- a gacha economy;
- a land speculation or NFT economy;
- an idle-clicker;
- a dating/hookup service;
- a public diary;
- a 3D metaverse that requires high-end devices.

These exclusions are architectural constraints, not launch omissions.

---

# Part II — Visual World and Client Model

## 4. LOCKED: 2.5D made from 2D sprites

### 4.1 Why this is the correct representation

Choose **minimal illustrated 2.5D**, not 3D.

The emotional requirement does not depend on facial realism or free-camera 3D. Proximity, posture, object placement, weather, light, sound, and the fact that another Mini chose to stay can carry the emotional weight. A simpler visual system also gives Another Society a more distinctive identity in a market saturated with generic 3D social worlds.

2.5D here means:

- underlying coordinates and pathfinding are 2D;
- artwork is layered and depth-sorted to create a 3/4 miniature-world feeling;
- buildings, furniture, terrain, and Minis are pre-rendered 2D assets/sprites;
- there is no 3D mesh authoring requirement in the client;
- there is no free camera rotation;
- there is no physics simulation requirement.

### 4.2 Art direction lock

**Visual language:** a modern miniature paper-diorama / dollhouse world, soft and cute rather than pixel-retro or photorealistic.

Use:

- simple silhouettes with high readability at phone scale;
- restrained facial detail;
- expressive body poses and distances;
- small ambient loops: breathing, shifting weight, looking outside, sitting, sleeping;
- layered shadows and warm/cool lighting changes;
- small environmental motion: leaves, rain, steam, curtains, water, lights;
- strong object identity and arrangement;
- minimal UI chrome while inside the world.

Avoid:

- generic glossy 3D “metaverse” avatars;
- AI-gradient/orb branding;
- hyper-detailed character customization that becomes the product;
- physics-heavy furniture or ragdolls;
- camera controls that make navigation a game skill.

### 4.3 Camera and views

**City view:** fixed-angle 3/4 map. The user pans/zooms, taps destinations, and sees the Mini travel along the road graph in a short animation.

**Property view:** fixed 3/4 dollhouse/yard view. A property may contain multiple spaces later, but v0.1 can expose a single primary room/yard composition.

**No joystick/WASD requirement.** Travel is tap-to-travel and path-based. The road matters spatially without forcing the resident to manually walk every meter.

### 4.4 iOS rendering stack

- **SwiftUI:** authentication, onboarding, settings, catalog, inventory, moderation UI, sheets, navigation chrome.
- **SpriteKit:** city scene, property scene, Mini animation, depth sorting, pan/zoom, route animation, ambient effects.
- **Swift Concurrency:** API and asset loading.
- **Local cache:** disposable cache only; never authoritative world state.

Do not put canonical ownership or economy in SwiftData/CloudKit.

### 4.5 Cross-platform rendering rule

Do **not** try to share rendering code between Swift, web, and Android now. Share **world semantics and asset specifications**.

A future web client can use Canvas/WebGL/PixiJS or equivalent. A future Android client can use a native 2D renderer. Both consume the same API payloads and asset manifests.

### 4.6 Platform-neutral asset manifest

Every renderable asset has a stable logical ID and versioned manifest. Example:

```json
{
  "asset_id": "furniture.chair.softwood.001",
  "pack_id": "core-furniture",
  "pack_version": 1,
  "kind": "furniture",
  "sprite_sheet": "core-furniture-v1/chair-softwood-001.png",
  "anchor": { "x": 0.5, "y": 0.88 },
  "footprint": { "w_u": 2000, "h_u": 2000 },
  "render_layer": "furniture",
  "rotations": [0, 90, 180, 270],
  "gift_eligible": true,
  "content_rating": "general",
  "sha256": "..."
}
```

**Coordinate rule:** canonical transforms use integers/fixed-point units, not floating-point world state. `1000 units = one layout tile`; a world chunk is **32 x 32 tiles = 32,000 x 32,000 units**. Clients may interpolate visually with floats but persist integer canonical values. Chunks are an addressing/loading boundary, not a visible grid.

### 4.7 Mini animation scope

v0.1 resident Mini animations:

- idle
- walk
- sit
- lie/sleep
- hold/give object
- look/turn
- calm ambient co-presence

**Consent lock:** intimate animations such as holding hands/kissing between two unrelated real resident accounts are not in v0.1. Owner-created non-account companion Minis may use restrained, non-explicit relationship animations. If cross-user intimacy is ever added, it requires explicit bilateral permission and an owner-controlled opt-out.

---

# Part III — Founding City and Spatial System

## 5. What “spatial generation” means

Do **not** procedurally invent roads every time a user places a house. That produces ugly topology, impossible routing, and costly migrations.

The founding city uses an **authored macro-map + gated parcel activation** model:

1. Designers author the permanent city skeleton.
2. The skeleton contains terrain, civic anchors, main roads, latent local streets, district boundaries, and many potential plots.
3. Only a small connected portion is active at launch.
4. As occupancy rises, the server activates the next pre-authored street bundle and its plots.
5. Vacant inactive land appears naturally as forest, meadow, hillside, undeveloped blocks, etc.—not a grid of empty numbered lots.

The city therefore feels intentionally designed with five residents and still has a deterministic path to hundreds.

## 6. Founding city geometry

The first city is a fictional **mountain town**: compact center, sloped/forest edges, civic core, residential lanes, park/trail elements. It can take visual inspiration from mountain towns but is never tied to the user's GPS or real address.

### 6.1 Immutable public skeleton

System-owned:

- terrain and water/forest masks;
- district boundaries;
- civic plaza/park;
- general store / furniture depot locations;
- main road graph;
- latent neighborhood street graph;
- plot polygons/frontages;
- public route nodes;
- future transit anchors.

Resident-owned:

- plot occupancy right;
- property structure configuration;
- yard/interior layout;
- inventory and objects;
- access settings.

### 6.2 Road rule

Every plot that can be offered must front an **already active public road/trail segment**.

When a resident places a structure, the client/server may create only a **private access path** from the plot frontage to the chosen entrance. Public roads do not bend themselves toward arbitrary houses.

This is a correction to any earlier “house creates road” interpretation. The street must exist/activate first; the house then connects to it.

### 6.3 Road graph

Canonical road data:

- `road_nodes`: stable node IDs + integer world coordinates;
- `road_edges`: from/to node, type, weight, active flag, geometry polyline;
- edges form a connected graph within each active settlement;
- route animation uses A* (or Dijkstra for tiny graphs) client-side on downloaded local graph data.

The server does **not** stream every walking step. It stores meaningful location state only: home, traveling-to, arrived/visiting, staying.

## 7. Plot activation: resident #1 through #100

The first 100 resident accounts all receive their first home in the Founding City.

### 7.1 Initial state

At world opening:

- city skeleton exists;
- civic core is active;
- first neighborhood street bundle is active;
- approximately **16 residential plots** are visible/claimable;
- the rest visually remains undeveloped world, not “locked slots.”

The exact count is configuration, not hard-coded business logic.

### 7.2 Vacancy target

The city keeps enough real choice without exposing a huge empty map.

Locked activation policy for the founding-city controller (values remain server configuration, not client constants):

```text
target_vacancy = clamp(ceil(max(1, occupied_first_homes) * 0.15), 8, 20)

if active_vacant_plots < target_vacancy:
    atomically activate the next connected street bundle
```

A bundle is normally **12–24 plots**. The production founding-city template must contain enough ordered bundles for at least **120 first-home plots**, giving operational headroom around the first-100 promise. Activation enables the bundle's public road nodes/edges first, then its plots. No plot becomes claimable without active frontage.

A street bundle contains roughly 12–24 plots and is authored in the city template. Activation is atomic and versioned.

### 7.3 What the newcomer sees

The newcomer can inspect **all currently active vacant plots** on the city map and choose the exact one. They are not secretly assigned a random location.

The UI can surface quiet labels such as:

- closer to town
- near neighbors
- quieter edge
- forest side
- near park

These are map facts, not algorithmic “recommendations.”

### 7.4 Reservation and claim

1. User taps a vacant plot.
2. Server creates a short reservation, default **10 minutes**.
3. Reservation makes the plot temporarily unavailable to others.
4. User authenticates/finishes Mini/property choice.
5. Client calls atomic `claim`.
6. Server locks plot row, checks reservation and state, creates ownership/property/wallet starter transaction, commits.
7. Expired reservations return to vacant state.

Two clients can never both own the same plot.

## 8. City growth after 100

At roughly resident 80, the world can visually foreshadow a road/rail/boat route to a second settlement.

After the first 100 residents:

- the Founding City **does not suddenly close**;
- new residents may choose newly activated Founding City districts while capacity remains;
- the system may also open a second settlement (coast, forest, valley, etc.);
- additional settlement templates are activated by demand, not pre-populated as giant empty worlds.

Recommended UX soft cap: approximately **1,000–2,000 resident properties per city/settlement** before additional settlements become the default. This is a social/geographic design choice, not a database ceiling.

At 100,000 registered residents the world should consist of many human-scale settlements, not one 100,000-house map.

## 9. Chunking and nearby loading

The map is partitioned into integer `chunk_x/chunk_y` regions. Every plot/property belongs to one chunk.

Client requests only visible/nearby chunks. A city with 100,000 historical records is never downloaded as one payload.

Static authored geometry can be bundled with the app or cached as versioned assets. Dynamic API payloads return:

- active/vacant plot states;
- property facade/config preview;
- public occupancy/presence summary;
- relevant object previews;
- road activation state.

## 10. City template versioning

City templates live in the repository as data, not imperative client code.

Example conceptual files:

```text
world-templates/
  founding-city/
    manifest.json
    terrain.json
    roads.json
    districts.json
    plots.json
    civic.json
```

On deployment/import, the backend persists stable IDs. A `generator_version` is recorded. Once a plot or public road has become resident-visible/owned, its canonical identity and coordinates are not regenerated from a changed algorithm.

---

# Part IV — Social State

## 11. Visit, Stay, and Gift state model

### 11.1 Visit

A visit is a transient observation of another resident's property. **It does not move the visitor's globally visible durable Mini.** The visiting client may render its own Mini locally, but other residents do not receive a live visitor-presence stream. Public foreign presence begins only when the visitor chooses Stay. This is a deliberate privacy and cost boundary, not a temporary limitation.

Owner-visible rule:

- visitor identity is **not** revealed after an ordinary visit;
- the owner sees aggregate language or count only;
- the system may retain a short-lived identity-bearing receipt internally for abuse prevention and deduplication, but that identity is not exposed to the owner.

Recommended backend retention:

- raw `visit_receipt`: 7 days, server-only;
- daily aggregate: retained longer;
- dedupe: one qualified visit per visitor/property/day.

A “qualified visit” should require a small dwell threshold (for example 5 seconds) to avoid accidental tap noise. Threshold is configuration.

### 11.2 Stay

Stay means: **my Mini is currently choosing to remain in this space.**

Rules:

- one active foreign Stay per resident;
- Stay survives app close;
- Stay is visible while active;
- owner can disable future stays on their property;
- owner can **Send Home** any active stayer in their property without messaging them;
- space/property has a finite stay capacity;
- leaving or Send Home clears active foreign presence and returns the resident's durable Mini to their primary home;
- blocking immediately terminates/invalidates prohibited stays.

Stay is not a websocket session. It is durable application state.

### 11.3 Access settings

Per property:

- `access_mode`: `OPEN` or `CLOSED`;
- `away_access_mode`: `OPEN` or `CLOSED`, applied while the owner has an active foreign Stay;
- `allow_stays`: true/false;
- `stay_capacity`: system-bounded integer;
- owner is always allowed to enter their own property.

Effective public access is `access_mode == OPEN` and, when the owner is away, `away_access_mode == OPEN`. This directly supports both desired behaviors: lock my home while I stay elsewhere, or leave it open so others can visit/Stay. “Visits allowed, stays closed” is represented by `access_mode=OPEN` and `allow_stays=false`.

### 11.4 Gift

v0.1 gifts come only from a system-safe catalog.

Gift flow:

1. visitor owns a gift-eligible item instance;
2. visitor chooses Leave Gift;
3. server checks block/access rules and item ownership;
4. server transfers ownership to recipient inside one transaction;
5. gift becomes `pending_placement` at the visitor's temporary drop coordinate;
6. recipient sees who intentionally left it;
7. recipient chooses **Keep Here** or **Put Away**;
8. only recipient's later action creates/changes canonical placement.

Gift identity reveal is intentional. An ordinary visit remains anonymous.

## 12. Anonymous social pleasure without ranking

The product should preserve the satisfaction of “someone saw my place” without creating public status competition.

Backend stores exact aggregates because operations/analytics need them. Default owner-facing UI should use soft language bands, for example:

- “Someone stopped by.”
- “A few people stopped by.”
- “It was a little busy while you were away.”

Exact numerical counts can remain an experiment flag. Public visitor counts, rankings, “top homes,” and percentile badges are prohibited by the current product constitution.

## 13. Blocking

A block is bilateral invisibility for social operations, regardless of who initiated it.

When A blocks B:

- A and B cannot visit each other's properties;
- cannot Stay;
- cannot gift;
- cannot discover each other via Wander;
- active Stay between them is ended;
- existing owned items remain owned; provenance may be shown without a clickable profile link if necessary.

Every relevant server endpoint checks block state, not merely the UI.

---

# Part V — Identity and Authentication

## 14. Internal identity is not the visible name

### 14.1 Permanent account anchor

`users.id` is an opaque server UUID. It never changes and is never meaningful to the user.

### 14.2 Authentication identities

`auth_identities` stores one or more providers:

```text
provider = apple | google | ...
provider_subject = provider's stable subject ID
user_id = Another Society UUID
```

Never use email as the user key or as an automatic cross-provider linking key.

### 14.3 iOS v0.1 auth

Use Sign in with Apple.

Flow:

1. iOS requests Sign in with Apple.
2. iOS sends authorization code + identity token + nonce/state context to backend over TLS.
3. backend verifies token signature/claims and validates code as appropriate;
4. backend uses Apple's stable user identifier/provider subject;
5. backend creates or finds `users.id`;
6. backend returns Another Society session tokens.

Apple explicitly recommends using the user identifier rather than email for account identity.

### 14.4 Session model

- short-lived API access token: target 15 minutes;
- opaque refresh token: random, hashed at rest in `auth_sessions`;
- iOS refresh token stored in Keychain;
- future web refresh session stored in secure, httpOnly, same-site cookie;
- session revocation supported per device and globally.

Do not log identity tokens, authorization codes, refresh tokens, or private notes.

### 14.5 World identity

Resident chooses:

- `display_name`: non-unique, changeable, normalized Unicode, **1–24 grapheme clusters**;
- `public_tag`: server-generated stable 6-character disambiguator, e.g. `7Q2M5F`;
- Mini appearance.

Example display:

```text
Mori
```

Only show the short tag when two names must be disambiguated or in safety/account contexts. Do not create a scarce username marketplace.

### 14.6 Public-name moderation

For v0.1, display name is the main public free-text UGC surface. Enforce:

- Unicode NFC normalization;
- length limit by grapheme clusters;
- disallow control characters/bidi-control abuse;
- profanity/hate/sexual/slur screening;
- server-side moderation flagging;
- user report path.

No public property free-text descriptions in v0.1.

## 15. Account deletion

Account deletion is implemented from the start because Apple requires apps with account creation to allow users to initiate deletion in-app.

Deletion flow:

1. reauthenticate/confirm;
2. revoke active sessions immediately;
3. create `deletion_request`;
4. revoke Sign in with Apple tokens;
5. hide resident/properties from discovery immediately;
6. queue data deletion/anonymization;
7. delete or anonymize public UGC and personal records not legally required;
8. preserve only records that must be retained for security/accounting, stripped of public identity where possible.

Deleted account IDs are not recycled.

---

# Part VI — Backend Architecture

## 16. LOCKED backend stack

### 16.1 Components

**Cloudflare Workers (TypeScript)**  
Public API, authentication orchestration, authorization, server commands, response shaping.

**Cloudflare Hyperdrive**  
Connection pooling/caching layer from Workers to Postgres.

**Neon Postgres**  
Single canonical transactional database for identity, world ownership, property, inventory, ledger, economy, social state, moderation metadata.

**Cloudflare R2**  
Versioned sprite packs, thumbnails, creator asset artifacts later, exports/backups where appropriate.

**Cloudflare Queues**  
Asynchronous aggregation, moderation jobs, deletion work, asset processing, outbox consumers, non-critical notifications/maintenance.

### 16.2 Why Postgres instead of D1 as canonical DB

D1 is attractive and inexpensive, but it is intentionally designed around many small databases. As of 2026-09-25, each paid D1 database has a 10 GB maximum and each individual database is single-threaded and processes queries one at a time.

Another Society's hardest correctness boundary is not a local room document. It is cross-entity transactions:

- claim plot + create property + starter wallet;
- buy item + debit buyer + credit seller + transfer instance;
- procurement + city budget + creator credit + stock transfer;
- gift + ownership transfer + pending placement;
- future cross-city ownership/economy.

Sharding this across many D1 databases would make atomic economy/ownership operations substantially harder. A single Postgres canonical database is therefore the correct starting point. D1 may be used later only for measured derived/cache use cases, not canonical ownership.

### 16.3 Why this avoids vendor lock-in

The canonical data model is standard Postgres. If Neon ever becomes a poor fit, migration to another Postgres provider is materially simpler than rewriting a vendor-specific data layer. Workers speak to Postgres through normal SQL/driver semantics.

### 16.4 Do not add more infrastructure without evidence

v0.1 deliberately does **not** use:

- Durable Objects;
- Redis;
- Kafka;
- Elasticsearch;
- a dedicated realtime server;
- a second database;
- a microservice fleet.

Add only after metrics demonstrate a real need.

## 17. Environment layout

```text
another-society/
  apps/
    ios/
    web/                 # later
  services/
    api-worker/
    queue-worker/
  packages/
    contracts/           # OpenAPI + shared JSON schema sources
    world-template/
    asset-manifest/
  db/
    migrations/
    seeds/
  world-templates/
    founding-city/
  infra/
    wrangler/
  docs/
    Another_Society_Blueprint_v0.3.md
    ADR/
```

Environments:

- **local:** local Postgres or isolated Neon dev branch; local Worker dev;
- **staging:** separate Neon branch/project + staging Worker/R2 prefix;
- **production:** production Neon project + production Worker/R2 bucket.

No production secrets in source control.

## 18. API contract rule

- REST/JSON for v1;
- prefix all endpoints `/v1`;
- OpenAPI document is checked into repository;
- request/response schema changes are additive within v1 unless impossible;
- destructive/breaking changes require `/v2` or an explicit compatibility migration;
- every mutation returns canonical resulting revision/state;
- client never supplies authoritative prices/balances/owner IDs.

## 19. Mutation safety

All financially or ownership-sensitive mutations require an `Idempotency-Key` header:

- plot claim;
- purchase;
- gift;
- craft;
- procurement submission;
- listing purchase;
- property acquisition.

Server stores the key scoped to authenticated user + operation. Repeated identical requests return the original result. Reuse with a different request hash returns conflict.

Do not use Postgres advisory locks because Hyperdrive does not support them. Use row-level locks, unique constraints, and transaction isolation.

## 20. Recommended backend libraries

Lock these conventions, but treat exact package versions as dependency-management details:

- TypeScript;
- Cloudflare Workers runtime;
- `pg` through Hyperdrive;
- Drizzle schema/migrations for typed DDL/query ergonomics;
- explicit SQL/`pg` transactions for critical ledger/ownership commands;
- Zod or equivalent runtime request validation;
- OpenAPI as the public API contract.

Critical business logic must not be hidden in client code or ORM magic.

---

# Part VII — Canonical Data Model

## 21. Data model principles

1. IDs are UUIDs, never display names.
2. Expected one-to-many concepts are modeled as relations from day one (`properties`, not `user.house`).
3. Currency values are signed `BIGINT` minor world-currency units. Never floats.
4. Canonical transforms are fixed-point integers.
5. Soft delete/archive is used only where history/provenance matters; personal data deletion remains real deletion/anonymization.
6. All high-volume temporal tables have retention plans.
7. Every mutable resource that clients edit has a revision integer.

## 22. Core entities

### Accounts
- `users`
- `auth_identities`
- `auth_sessions`
- `residents`
- `companion_minis`

### World
- `worlds`
- `regions`
- `cities`
- `districts`
- `chunks`
- `road_nodes`
- `road_edges`
- `plots`

### Property
- `properties`
- `spaces`
- `placements`

### Items
- `item_definitions`
- `item_instances`
- `material_balances` (when crafting ships)

### Social
- `presence`
- `stays`
- `visit_receipts`
- `property_visit_daily`
- `gifts`
- `blocks`
- `reports`
- `moderation_actions`

### Economy
- `wallets`
- `ledger_transactions`
- `ledger_entries`
- `store_listings`
- `market_listings` (later)
- `procurement_orders`
- `procurement_submissions`

### Operations
- `idempotency_keys`
- `outbox_events`
- `deletion_requests`
- `feature_flags`

A concrete initial SQL schema accompanies this document.

## 23. Required indexes

At minimum:

- `plots(city_id, status)`;
- `plots(city_id, chunk_x, chunk_y)`;
- `properties(owner_resident_id)`;
- unique active property per `plot_id`;
- `spaces(property_id)`;
- `placements(space_id)`;
- `item_instances(owner_resident_id, state)`;
- unique one `presence` row per resident;
- `stays(space_id, ended_at)`;
- `visit_receipts(property_id, occurred_on)`;
- `property_visit_daily(property_id, day)`;
- `blocks(blocker_resident_id, blocked_resident_id)` and reverse lookup index;
- `ledger_entries(wallet_id, created_at desc)`;
- unique ledger transaction idempotency key;
- `procurement_orders(city_id, status, category)`;
- `outbox_events(status, available_at)`.

---

# Part VIII — API Boundary

## 24. v1 endpoint groups

### Auth/account

```text
POST   /v1/auth/apple
POST   /v1/auth/refresh
POST   /v1/auth/logout
GET    /v1/me
DELETE /v1/account
```

### Resident

```text
GET    /v1/resident
PATCH  /v1/resident
PUT    /v1/resident/mini
```

### World/onboarding

```text
GET    /v1/world/bootstrap
GET    /v1/cities/{cityId}/chunks?minX=&minY=&maxX=&maxY=
GET    /v1/onboarding/plots
POST   /v1/plots/{plotId}/reserve
POST   /v1/plots/{plotId}/claim
```

### Property/layout

```text
GET    /v1/properties/{propertyId}
PATCH  /v1/properties/{propertyId}/access
GET    /v1/spaces/{spaceId}
PUT    /v1/spaces/{spaceId}/layout
```

`PUT layout` includes `expected_revision`. Revision mismatch returns `409 Conflict` with current revision metadata.

### Social

```text
POST   /v1/properties/{propertyId}/visit
POST   /v1/spaces/{spaceId}/stay
DELETE /v1/stay
DELETE /v1/spaces/{spaceId}/stays/{residentId}   # owner Send Home
POST   /v1/gifts
GET    /v1/gifts/inbox
POST   /v1/gifts/{giftId}/resolve                 # keep_here | put_away | decline
POST   /v1/blocks
DELETE /v1/blocks/{residentId}
POST   /v1/reports
```

### Inventory/economy

```text
GET    /v1/inventory
GET    /v1/wallet
GET    /v1/catalog
POST   /v1/store/purchases
```

### Creator economy later, same API family

```text
POST   /v1/designs
POST   /v1/craft
GET    /v1/procurement/orders
POST   /v1/procurement/{orderId}/submissions
GET    /v1/market/listings
POST   /v1/market/listings
POST   /v1/market/listings/{listingId}/purchase
```

### Admin

Admin moderation does not share normal resident authorization. Protect a separate admin surface with Cloudflare Access and explicit admin roles.

## 25. Standard response envelope

Mutation responses include:

```json
{
  "request_id": "req_...",
  "data": {},
  "revision": 12
}
```

Errors include a stable machine code plus human-safe message. Never expose raw SQL/provider errors to clients.

---

# Part IX — Economy and Ledger

## 26. Economic goals

The economy must:

- work when only five people exist;
- not require another human to buy your first creation;
- prevent infinite money creation;
- create reasons to spend without punishing absence;
- let geography and making drive commerce;
- remain auditable when real users disagree about balances/items;
- keep real-money complexity out of v0.1.

## 27. Wallet and ledger invariant

`wallets.balance` is a fast materialized balance, not the historical source of truth.

Every logical movement of currency creates:

- one `ledger_transaction`;
- two or more immutable `ledger_entries`;
- entry amounts sum to zero before the transaction becomes `POSTED`;
- wallet balance updates happen in the same Postgres transaction.

System wallets include:

- `MINT` — explicit currency source;
- `CITY_TREASURY:{city}` — bounded civic spending;
- `SYSTEM_SINK` — currency destroyed from spend sinks;
- store operating wallets if needed.

Resident wallets are never allowed to go below zero.

## 28. Purchase transaction algorithm

For a store/user purchase:

1. begin DB transaction;
2. resolve idempotency key;
3. lock listing/item instance;
4. lock buyer wallet and seller/system wallet rows in deterministic ID order;
5. validate listing still active, price server-side, buyer balance, ownership/block rules;
6. create pending ledger transaction;
7. insert balanced ledger entries;
8. update cached wallet balances;
9. transfer item instance owner;
10. mark listing/stock state;
11. assert ledger sum = 0;
12. mark ledger transaction posted;
13. write outbox event;
14. commit;
15. queue downstream side effects asynchronously.

A client retry with the same idempotency key cannot create a second purchase.

## 29. Faucets: how money enters

Allowed faucets for the **soft world currency (`WORLD`)**:

- starter grant;
- bounded city procurement;
- limited civic system rewards introduced later only with explicit budget.

Resident-to-resident sales are **not** a faucet; they transfer existing money. **Real money is not a `WORLD` faucet.**

### 29.1 Locked real-money separation

The resident economy and future monetization are two different rails:

- `WORLD`: earned/issued by world rules, transferable through allowed resident/city transactions, never cash-out, and **not directly purchasable with real money in the initial business model**;
- premium monetization later: platform-compliant StoreKit/web purchases for IMPLEMON-authored cosmetics, property shells, packs, or entitlements. Premium goods are non-tradable unless a future App Store/legal review explicitly approves a different model.

A StoreKit receipt must never directly credit a creator's `WORLD` wallet. This prevents pay-to-print-money inflation, arbitrage, and accidental coupling between App Store purchases and the internal creator economy. The schema keeps `currency_code` extensible, but adding any purchasable currency requires a separate ADR and payment-policy review.

## 30. Sinks: how money leaves

Healthy sinks:

- system catalog purchases;
- crafting materials;
- home/property upgrade modules;
- additional property acquisition;
- studio/shop acquisition;
- optional transport/convenience services;
- marketplace fee;
- future cosmetic customization.

Do not use:

- punitive rent;
- property loss due to inactivity;
- daily tax that forces logins;
- arbitrary decay of purchased objects;
- expiring purchased currency.

## 31. City procurement

City procurement solves the cold-start economy.

### 31.1 Order structure

Each order defines:

```text
city_id
category
allowed_recipe_family
quantity_total
quantity_remaining
unit_price
per_creator_limit
budget_total
starts_at
ends_at
status
```

Example visible language:

> Furniture Depot is currently buying small lamps.

Not:

> QUEST: Craft 10 lamps for 500 XP!

### 31.2 Procurement invariants

- finite quantity;
- finite city budget;
- per-creator cap;
- item must be a real owned instance;
- accepted item transfers to city ownership;
- exact and near-duplicate submission spam is limited by definition/content hash, recipe-family constraints, per-creator caps, and cooldowns;
- crafting itself has material cost once creator tools ship;
- closed order cannot accept late submissions;
- city does not silently mint beyond configured budget.

### 31.3 City budget policy

Do not hard-code an economic formula into clients. Server configuration determines weekly city procurement budget using:

- active resident population band;
- previous sink revenue;
- city treasury balance;
- hard maximum issuance cap.

A safe conceptual form is:

```text
weekly_budget = min(
  hard_cap,
  base_population_allowance + share_of_recent_system_sink
)
```

The coefficients are economy-tuning data, not schema decisions.

### 31.4 What the city does with purchased goods

Initially, procurement accepts **physical item instances**, not infinitely reproducible designs.

Accepted goods may:

- enter limited civic store stock at markup;
- decorate civic buildings;
- rotate out/recycle after a long unsold period.

Later, approved design licensing/royalty can be added as a distinct mechanism without changing physical ownership semantics.

## 32. Making system

### 32.1 Item definition vs instance

`ItemDefinition` is the recipe/appearance/provenance of a design.  
`ItemInstance` is an actual owned copy in the world.

This distinction is required from day one even when all v0.1 definitions are made by IMPLEMON.

### 32.2 Creator tool philosophy

Creator tools use safe modular grammars.

Example furniture grammar:

```text
chair
  seat: [round, soft-square, long]
  back: [none, low, tall, curved]
  legs: [block, four-leg, sled]
  material: [wood, painted, soft]
  pattern: approved texture/palette
  proportions: bounded sliders
```

The resulting design is deterministic JSON plus approved asset references. It is not executable code and does not contain arbitrary external URLs.

### 32.3 No real-money creator payout in v1

Do not promise creator cash-out, revenue share, or real-money resale in the first product. That introduces Store policies, fraud, tax reporting, KYC/payout infrastructure, refunds, territory restrictions, and support obligations.

The first creator economy is **world-currency only**.

---

# Part X — Moderation and App Store Safety

## 33. Public UGC surface is deliberately narrow in v0.1

Public user-controlled content:

- display name;
- Mini assembled from approved parts;
- placement of approved objects;
- property composition;
- presence/Stay;
- approved gifts.

Not public in v0.1:

- arbitrary image uploads;
- arbitrary audio uploads;
- public free-text descriptions;
- custom message boards;
- public private notes.

This is not only safer; it gives the world a coherent visual identity.

## 34. Required moderation mechanisms

Apple's current UGC rules require objectionable-content filtering, reporting, blocking, and published contact information. Another Society therefore ships moderation foundations before public App Store release.

Required capabilities:

- filter public display names;
- Report Resident;
- Report Property;
- Report Item (when creators ship);
- Block Resident;
- admin report queue;
- moderation status/action records;
- hide/suspend resident/property/item;
- visible support/contact path;
- community standards/Terms.

### 34.1 Payment-policy boundary

Apple currently requires in-app purchase for digital features, digital goods, and in-game currencies used in an iOS app. Purchased credits/in-game currency may not expire. Multi-platform access to items acquired elsewhere has additional App Store conditions. Therefore v0.x avoids using real money to seed the transferable resident economy. Future paid digital content is implemented as a separate premium entitlement/catalog rail with StoreKit on iOS and server-side entitlement verification. This is a business/compliance boundary, not merely a checkout implementation detail.

## 35. Public intimacy rules

Public world content is non-explicit.

Allowed aesthetic examples for owner-created companions may include restrained affection (holding hands, hugging, a simple kiss), but no explicit sexual animation or pornographic depiction.

Two real resident accounts cannot trigger intimate pair animations in v0.1. This avoids ambiguity and coercive use. Future mutual interactions require explicit opt-in by both residents.

---

# Part XI — Cost Architecture and Vendor Choice

## 36. Cost objective

The infrastructure should be almost trivial when the world has only a few people, grow with actual use, and contain enough guardrails that a bug cannot silently create a catastrophic bill.

## 37. Cloudflare Workers

Current verified public pricing (2026-09-25):

- Workers Paid base: **$5/month**;
- 10 million requests/month included;
- $0.30/additional million requests;
- 30 million CPU-ms/month included;
- $0.02/additional million CPU-ms;
- configurable per-invocation CPU limits.

Decision:

- local/early closed development may use Free;
- **public beta switches to Workers Paid** so a daily free-limit failure does not take the world offline;
- set a conservative Worker CPU limit;
- keep handlers I/O-oriented, move heavy jobs to Queue consumers.

## 38. Neon Postgres

Current verified Launch pricing baseline:

- no monthly minimum;
- compute: **$0.106 per CU-hour** (Launch; price reduced November 3, 2025); 
- storage: **$0.35/GB-month**;
- paid plans include **500 GB/month data transfer** as of June 2026;
- autoscaling and scale-to-zero supported;
- default idle suspend behavior can reduce compute cost for very small/quiet environments.

Scenario arithmetic (not a Neon quote):

- if a 0.25-CU compute stayed active 730 hours/month: about **$19.35 compute/month**;
- 0.5 CU always active: about **$38.69**;
- 1 CU always active: about **$77.38**.

A tiny world that sleeps frequently can cost materially less. A busy world will cost more because compute is genuinely active. This is why cost control must be based on real metrics, not optimistic user-count estimates.

### Production compute policy

- development/closed test: Free plan where practical;
- public beta: Launch plan;
- start production autoscaling conservatively (target min 0.25 CU; max 1 CU if current plan/region supports it);
- keep autosuspend enabled while the workload still has quiet periods;
- raise maximum only from measured CPU/query pressure;
- do not add a read replica until read load justifies it.

## 39. R2

Verified Standard pricing:

- 10 GB-month free tier;
- $0.015/GB-month after free tier;
- 1M Class A + 10M Class B operations free/month;
- no Internet egress charge directly from R2.

Use R2 for immutable/versioned visual assets. Put core launch assets in the app bundle too so the first experience does not depend on downloading the world shell.

## 40. Queues

Verified Workers Paid allowance:

- 1M operations/month included;
- $0.40 per additional million operations;
- typical successfully delivered small message is approximately three operations (write/read/delete);
- no egress charge.

Use queues only for asynchronous work. Never make a purchase depend on a queue consumer finishing.

## 41. Cost guardrails

Infrastructure settings:

- Cloudflare billing alerts at low thresholds (**informational; currently processed after usage, not a hard cap**);
- Neon organization spending alerts at low thresholds;
- configure a conservative Neon `autoscaling_limit_max_cu`; for early production also use Neon project consumption quotas (compute time/write/transfer/storage) where operationally acceptable, so runaway application behavior has a provider-side ceiling;
- Worker per-invocation CPU limit;
- R2 upload size/content-type limits;
- API rate limits by user/IP/operation;
- creator upload and heavy processing behind feature flags;
- strict pagination/chunk window limits;
- visit raw-event retention 7 days;
- logs have retention limits;
- no frame-by-frame presence writes.

Application kill switches:

- disable new creator uploads;
- pause procurement refresh;
- pause nonessential asset processing;
- reduce analytics detail;
- preserve core login/home/visit ownership operations.

Budget alarms should never auto-disable ownership or ledger correctness.

## 42. Why this should not create a “backend bill bomb” at low usage

The chosen system has no always-on app server. Worker API compute is request/CPU based. R2 has a meaningful free tier and no direct egress fee. Neon can scale/suspend compute during quiet periods and Launch has no monthly minimum.

The main cost risk at scale is database compute caused by inefficient queries or genuinely high usage, not idle infrastructure. The architecture therefore makes database query counts/latency visible from the first beta and caps query scope by city/chunk.

---

# Part XII — Scaling Plan

## 43. Scale is based on measured concurrency, not registered-user count

100,000 registered residents do not imply 100,000 simultaneous users. Another Society also avoids the two most expensive social patterns:

- continuous websocket presence for everyone;
- high-frequency position writes.

Most persistent state changes only when a resident claims, edits, arrives, stays, gifts, buys, or makes something.

## 44. Stage A: 1–100 residents

Architecture:

- one Neon primary;
- Workers + Hyperdrive;
- R2 core remote packs;
- Queue for aggregates/deletion/moderation jobs;
- no read replica;
- one Founding City;
- raw visits retained briefly.

Operational target: correctness and product feel, not optimization.

## 45. Stage B: 100–5,000 residents

Add only when metrics justify:

- refine indexes from real query plans;
- scheduled procurement/visit aggregate queue jobs;
- stronger rate limits;
- admin moderation console;
- asset caching and thumbnails;
- increase Neon max autoscale if p95 DB wait rises.

## 46. Stage C: 5,000–25,000 residents

Possible changes:

- Neon read replica for public chunk/property/catalog reads if primary read pressure is material;
- write/read-your-write traffic remains on primary;
- more aggressive static/public preview caching;
- partition or archive raw visit/event data if table growth warrants it.

Neon read replicas share underlying storage rather than duplicating it, and can scale separately.

## 47. Stage D: 25,000–100,000 residents

Possible changes based on metrics:

- one or more read replicas;
- monthly partitioning for high-volume temporal tables;
- materialized city/chunk preview cache rebuilt asynchronously;
- asset pack CDN/cache tuning;
- more formal anti-fraud/economy anomaly detection;
- expand settlements so each remains human-scale.

Still keep a single canonical transactional Postgres database unless database measurements demonstrate the need to split it.

## 48. Beyond target: only then consider sharding

If the system truly exceeds a single Postgres write domain:

- keep global account/economy coordination in a canonical core;
- shard world-state by `world_id/city_id`;
- cross-shard workflows use transactional outbox + saga/compensation;
- never retrofit client authority.

This is intentionally **not implemented now**. Premature sharding would increase bugs and cost more than it saves.

---

# Part XIII — Reliability, Recovery, and Migration

## 49. Transactional outbox

Any database mutation that requires an asynchronous side effect also writes an `outbox_event` in the same Postgres transaction.

A publisher/consumer moves pending events to Cloudflare Queues. Consumers are idempotent by event ID.

This prevents “DB committed but queue message was lost” and “queue message fired but DB rolled back” inconsistencies.

## 50. Queue failure policy

- exponential retry;
- bounded attempts;
- dead-letter queue;
- admin visibility for DLQ count;
- replay command by event ID;
- side effects must be idempotent.

## 51. R2 asset upload lifecycle

Later creator asset processing:

1. upload to temporary object key;
2. validate size/type/manifest and moderation constraints;
3. process/derive thumbnails if needed;
4. write immutable final version key;
5. create DB definition referencing final object;
6. delete temporary object.

Never commit a public DB asset reference before the final object exists.

## 52. Layout conflict strategy

A layout has `revision`.

Client saves with `expected_revision`.

- match → save + increment;
- mismatch → `409 Conflict`;
- client refetches canonical layout and can reapply unsaved owner changes.

Because only the owner edits permanently, conflicts should mainly represent a second device, not collaborative editing. Do not build CRDT complexity.

## 53. Database restore and backup

Production policy:

- enable Neon restore history appropriate to the plan (target 7 days on Launch while affordable);
- keep an additional scheduled encrypted logical backup/export to R2 or another controlled backup destination;
- test restore at least monthly before public scale;
- never consider “backup exists” valid without a restore test.

## 54. Schema migration discipline

Use expand/contract migrations:

1. add new nullable/backward-compatible fields/tables;
2. deploy server that can read old + new;
3. backfill in bounded jobs;
4. switch writes/read path;
5. remove old fields only in a later release.

Never combine destructive schema removal with the client release that first stops using it. Old iOS clients can exist in the wild.

## 55. Provider migration strategy

Canonical Postgres means moving providers is an operational migration, not a product rewrite.

Keep:

- SQL migrations provider-neutral where practical;
- no Neon-only business logic in application schema;
- R2 references behind storage adapter/interface;
- all provider configuration in environment/infra files.

---

# Part XIV — Observability and Economic Health

## 56. Request tracing

Every API request gets `request_id`.

Structured logs include:

- request ID;
- endpoint/template;
- status;
- latency;
- database time;
- retry count;
- city ID where useful;
- user UUID only in protected logs when operationally needed.

Never log:

- Apple identity token;
- authorization code;
- refresh token;
- private notes;
- sensitive moderation text unless explicitly required in protected tooling.

## 57. Technical metrics

Monitor:

- API request rate;
- p50/p95/p99 latency;
- 4xx/5xx rate;
- DB query p95 and slow-query count;
- Hyperdrive/DB connection errors;
- transaction retry/deadlock count;
- plot claim conflict rate;
- queue backlog/oldest message;
- DLQ size;
- R2 storage/operations;
- monthly provider spend;
- account deletion backlog.

## 58. Ledger integrity metrics

At least daily:

- every `POSTED` transaction sums to zero;
- wallet cached balance reconciles to ledger;
- no user wallet is negative;
- no item instance has two owners;
- no plot has two active properties;
- no resident has more than one active foreign Stay.

Integrity failures page the operator before product analytics.

## 59. Internal economic health metrics

These are not public rankings:

- total money supply;
- faucet vs sink ratio;
- median/percentile resident balance;
- city procurement spend/fill rate;
- civic store sell-through;
- resident-to-resident sales volume;
- creator income concentration;
- item creation vs destruction/storage rate;
- property acquisition rate;
- unsold stock age.

These metrics tune the economy without turning users into a leaderboard.

---

# Part XV — Security Rules

## 60. Authorization

Every server command derives actor identity from authenticated session. Never trust a `sender_id`, `owner_id`, or wallet ID supplied by the client for authorization.

Server checks:

- actor owns source item/property;
- target is accessible;
- block state;
- balance;
- listing/order active;
- capacity;
- revision/idempotency.

## 61. Rate limits

Separate rate classes:

- authentication;
- plot reservation/claim;
- visit;
- Stay transitions;
- gifts;
- purchases;
- reports;
- creator uploads later.

Economy mutations have stricter limits and abuse logging.

## 62. Admin security

- admin site behind Cloudflare Access;
- separate role claim;
- all moderation/economic manual actions audited;
- no admin endpoint in the normal resident app bundle;
- no direct production DB editing as routine support workflow.

---

# Part XVI — v0.1 Implementation Scope

## 63. Build now

### Backend foundation

- repository/CI environments;
- Workers API;
- Hyperdrive → Neon connection;
- migration system;
- request IDs/logging;
- feature flags;
- idempotency store;
- outbox + Queue worker.

### Identity

- Sign in with Apple;
- server UUID;
- sessions/refresh;
- display name/public tag;
- Mini definition;
- account deletion.

### World

- Founding City template;
- city/chunk/road/plot import;
- plot activation state;
- map/chunk API;
- plot reservation/atomic claim;
- starter home creation.

### Property

- one starter property family (visual variants allowed);
- one primary interior/yard space;
- ~20 core item definitions;
- inventory;
- placement/layout editing with revision.

### Social

- Wander/nearby discovery;
- route animation;
- Visit;
- anonymous visit aggregate;
- Stay/Leave;
- Open/Closed;
- allow_stays/capacity;
- 10 safe gift items;
- Block;
- Report.

### Economy foundation

- resident wallet;
- starter grant through ledger;
- system store;
- store purchase through ledger + item transfer;
- daily reconciliation.

### Moderation

- display-name filtering;
- report records;
- basic admin moderation view/action;
- published support contact.

## 64. Architected, but feature-flagged/not surfaced in v0.1

- second properties/moving;
- creator design grammar;
- crafting/materials;
- city procurement;
- resident marketplace;
- resident shops/studios;
- second city;
- web client;
- Android client;
- design licensing/royalties.

The schema/API namespaces are ready for these, but implementation should wait until the basic social loop is proven.

## 65. Explicitly not in v0.1

- chat/DM/comments;
- likes/followers/rankings;
- arbitrary public image/audio upload;
- real-money world currency;
- creator cash payouts;
- land resale/speculation;
- daily chores/streaks;
- real-time multiplayer walking;
- 3D renderer;
- CRDT collaborative room editing.

---

# Part XVII — Implementation Order

## 66. Milestone 0 — Repo and contracts

Exit criteria:

- monorepo skeleton;
- `/v1` OpenAPI checked in;
- DB migration 001 applies cleanly to blank Postgres;
- Worker health endpoint and DB health check;
- CI runs schema/API validation and tests.

## 67. Milestone 1 — Account and resident

Exit criteria:

- Sign in with Apple creates/returns same `users.id` on repeat login;
- session refresh/revocation works;
- display name/public tag/Mini persist;
- account deletion can be initiated.

## 68. Milestone 2 — City and plot claim

Exit criteria:

- Founding City template renders in iOS;
- active plots visible;
- two concurrent users cannot claim same plot;
- reservation expiry works;
- property created on successful claim;
- route graph loads only relevant chunks.

## 69. Milestone 3 — Property and decorating

Exit criteria:

- owner enters property;
- inventory objects can be placed/moved/removed;
- server validates bounds/ownership;
- layout revision conflict returns 409;
- reinstall/resync recreates canonical layout.

## 70. Milestone 4 — Quiet social loop

Exit criteria:

- resident can Wander/visit another accessible property;
- owner receives anonymous aggregate only;
- Stay persists after app termination;
- Leave clears it;
- locked property denies entry;
- capacity enforced;
- block ends/denies interaction.

## 71. Milestone 5 — Gift and basic economy

Exit criteria:

- starter grant appears via ledger;
- store purchase is idempotent;
- item transfer is atomic;
- gift transfer is atomic;
- repeated network retry cannot duplicate money/item;
- recipient can Keep Here/Put Away;
- daily ledger reconciliation passes.

## 72. Milestone 6 — Moderation and closed test

Exit criteria:

- report/block/admin hide/suspend flows work;
- account deletion data workflow works;
- 5–20 test residents can inhabit city for multiple days without manual DB repair;
- cost dashboard and alerts configured;
- no critical invariant violation.

Only after this milestone should creator economy implementation begin.

---

# Part XVIII — Acceptance and Load Tests

## 73. Must-pass correctness tests

1. **Plot race:** 50 concurrent claim requests for one plot → exactly one owner.
2. **Purchase retry:** same idempotency key repeated 100 times → one ledger transaction + one transferred item.
3. **Gift retry:** repeated network retry → one transfer.
4. **Insufficient funds:** no partial ledger/item state.
5. **Layout stale revision:** second-device stale write → 409, no silent overwrite.
6. **Stay uniqueness:** resident cannot have two active foreign stays.
7. **Stay capacity:** capacity N cannot become N+1 through race.
8. **Block race:** after block commit, new visit/stay/gift denied.
9. **Account deletion:** hidden immediately; queued deletion eventually completes; Apple token revocation attempted/retried.
10. **Chunk query:** visible region fetch does not scan/load whole city.
11. **Ledger:** every posted transaction sums to zero.
12. **Ownership:** every item instance has exactly one canonical owner state.

## 74. Performance test shapes

Before public beta, load test at least:

- chunk reads;
- property reads;
- Visit writes;
- Stay transitions;
- store purchase transaction;
- concurrent plot claim;
- gift transaction.

Do not optimize around synthetic “100,000 simultaneous residents.” Measure realistic concurrency and maintain headroom.

## 75. Mobile performance targets

- city/property scene maintains device-appropriate smoothness without heating from continuous expensive effects;
- offscreen sprites/nodes culled;
- ambient animations are low-cost and paused when invisible/backgrounded;
- asset packs are memory-budgeted;
- no polling faster than product behavior requires.

---

# Part XIX — Concrete Invariants for Coding Agents

The following are **MUST NOT BREAK** rules.

1. A plot cannot have two active owners/properties.
2. A resident may own many properties eventually; never hard-code `user.house`.
3. A resident may have at most one active foreign Stay.
4. A visitor never gains permanent placement authority in another resident's space.
5. Ordinary visit identity is not exposed to the owner.
6. Gift is an intentional identity-bearing transfer.
7. Client never authoritatively sets wallet balance, item owner, plot owner, or price.
8. Every currency mutation has a ledger transaction.
9. Posted ledger entries are immutable.
10. Every sensitive mutation is idempotent.
11. Public world logic does not depend on iOS/CloudKit/SwiftData semantics.
12. World coordinates/layout state are platform-neutral fixed-point/integer values.
13. Public UGC remains constrained until moderation capability grows with it.
14. No chat/follower/like/feed system may be introduced as a “temporary solution” to discovery.
15. No real-time position synchronization is required for core product behavior.
16. The first 100 first-home residents belong to the Founding City.
17. Roads are public authored infrastructure; houses connect to them, not vice versa.
18. City procurement is bounded by quota + budget; it is not an infinite buyer.
19. Real-money creator payouts are not part of v0.1.
20. A new platform must consume the existing world API rather than fork the world.
21. Ordinary Visit never requires a websocket, heartbeat, or globally visible transient presence row; **Stay is the public presence commit**.
22. `away_access_mode` determines whether an owner's property remains publicly enterable while that owner has a foreign Stay.
23. Property owner can terminate a stayer with Send Home; this is a safety/control action, not messaging.
24. `WORLD` soft currency is not directly purchasable with real money in the initial business model.
25. Production world templates activate authored road/plot bundles; public roads are never procedurally rerouted around resident houses after ownership exists.

---

# Part XX — Non-blocking Questions That May Remain Open

These choices do **not** require foundational architecture changes and may be decided during art/product implementation:

- final product name (Another Society is working title);
- final fictional name of the Founding City;
- exact palette, line weight, and non-pixel illustration style inside the locked 2.5D system;
- final Mini proportions and clothing art direction;
- world-currency name;
- exact starter grant and item prices;
- exact procurement formula coefficients;
- exact soft-language thresholds for visit counts;
- exact first civic-store names;
- when the creator economy is activated after closed testing;
- final App Store age rating, provided public v0.1 remains non-explicit and moderation-compliant.

Everything else necessary to start foundation coding is decided in this document.

---

# Part XXI — Research Basis (verified 2026-09-25)

These URLs are included so later coding agents can re-check time-sensitive infrastructure assumptions rather than treating pricing as permanent truth.

### Cloudflare Workers pricing
https://developers.cloudflare.com/workers/platform/pricing/

Verified baseline: Workers Paid $5/month; 10M requests/month included; 30M CPU-ms/month included; overage pricing and CPU limits documented there.

### Cloudflare Hyperdrive pricing
https://developers.cloudflare.com/hyperdrive/platform/pricing/

Verified baseline: Hyperdrive included in Workers plans; paid Workers has unlimited database queries under current pricing and includes connection pooling/query caching.

### Cloudflare D1 limits
https://developers.cloudflare.com/d1/platform/limits/

Verified baseline: 10 GB maximum per paid database; individual database processes queries serially/single-threaded; designed for horizontal scale across many small databases.

### Cloudflare R2 pricing
https://developers.cloudflare.com/r2/pricing/

Verified baseline: Standard $0.015/GB-month, free 10 GB-month, operation allowances, Internet egress free.

### Cloudflare Queues pricing
https://developers.cloudflare.com/queues/platform/pricing/

Verified baseline: Workers Paid includes 1M operations/month; $0.40/million thereafter; no egress charge.

### Neon current compute pricing
https://neon.com/blog/major-compute-price-reduction-on-neon
https://neon.com/blog/new-usage-based-pricing

Verified baseline: Launch usage-based/no monthly minimum; Launch compute reduced to **$0.106/CU-hour** on 2025-11-03; storage baseline $0.35/GB-month; scale-to-zero/autoscaling supported.

### Neon paid data-transfer update
https://neon.com/blog/more-data-transfer-on-paid-plans

Verified baseline: 500 GB/month data transfer included in paid plans beginning June 1, 2026.

### Neon scale-to-zero / autoscaling / quotas
https://neon.com/docs/manage/endpoints/
https://neon.com/blog/neon-autoscaling-is-generally-available
https://neon.com/blog/provision-postgres-neon-api

Verified baseline: configurable min/max autoscaling, scale-to-zero, and provider-side project consumption quotas for compute time, writes, transfer, and storage.

### Apple Sign in with Apple cross-platform + identity guidance
https://developer.apple.com/sign-in-with-apple/usage-guidelines-for-websites-and-other-platforms/
https://developer.apple.com/documentation/signinwithapplejs
https://developer.apple.com/documentation/signinwithapple/receiving-a-users-identity-token
https://developer.apple.com/documentation/signinwithapple/verifying-a-user

### Apple account deletion requirement
https://developer.apple.com/support/offering-account-deletion-in-your-app

### Apple App Review Guidelines — UGC / creator content / payments
https://developer.apple.com/app-store/review/guidelines/

---

# Final gate

**Foundation status: READY TO CODE.**

Do not wait for creator economy, a second city, web, or Android to begin. Build the iOS client as the first renderer of the already cross-platform world, and build the authoritative backend/data model first enough that every visible action is backed by the same canonical system future clients will use.
