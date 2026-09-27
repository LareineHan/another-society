# Implementation status

Backend foundation (Milestones 0 to 6, server side) and the first iOS client.

## Built and tested

| Milestone | Scope | Evidence |
|-----------|-------|----------|
| 0 Repo and contracts | pnpm monorepo, CI, migrations 001 + 002, `/health` with DB + schema version, OpenAPI lint + generated types | `tests/auth.test.ts`, `.github/workflows/ci.yml` |
| 1 Account and resident | Sign in with Apple (JWKS + nonce + code exchange), rotating refresh sessions, immediate revocation, resident bootstrap, display name rules, Mini from approved parts, account deletion | `tests/auth.test.ts`, `tests/account-jobs.test.ts` |
| 2 City and plot claim | Template importer (idempotent, drift-refusing), bundle activation (roads before plots), chunk window API, road graph with ETag, 10-minute reservation, atomic claim | `tests/world.test.ts` |
| 3 Property and decorating | Layout replace with revision CAS (409 on stale), bounds/rotation/ownership validation, access settings | `tests/property-economy.test.ts` |
| 4 Quiet social loop | Visit receipts (server-measured dwell, anonymous soft-language aggregate), Stay/Leave, away access, capacity, Send Home, Wander, block | `tests/social.test.ts` |
| 5 Gift and economy | Balanced immutable ledger (DB-enforced), starter grant, system store, idempotent purchase, gift transfer and resolve | `tests/property-economy.test.ts`, `tests/social.test.ts` |
| 6 Moderation | Reports, admin Worker behind Cloudflare Access (queue, hide/suspend, audit), integrity + ops endpoints | `tests/admin.test.ts` |
| Jobs | Two-phase outbox publisher, idempotent consumer, deletion worker with Apple revocation retry, reservation release, retention, daily reconciliation | `tests/account-jobs.test.ts` |

Blueprint §73 must-pass tests: 1 plot race, 2 purchase retry, 3 gift retry, 4 insufficient funds,
5 stale layout, 6 stay uniqueness, 7 stay capacity race, 8 block race, 9 account deletion,
10 chunk window, 11 ledger sums, 12 single ownership: all covered and passing.

The API bundle also runs end to end inside real `workerd` via `wrangler dev` against Postgres
(`scripts/workerd-smoke.mjs`).

## Open product values (DEV_PLACEHOLDER, non-blocking per Blueprint Part XX)

- Starter grant (500), item prices, starter kit (4 items), catalog (22 items, 10 gift-safe)
- Mini part catalog, starter structures (3 cottage variants), interior bounds (12 x 12 tiles)
- Soft-language visit thresholds, display-name screening list (needs a real multilingual list)
- Currency display name, city name (`Founding City DEV`), bundle ID `com.implemon.anothersociety`

## iOS client (apps/ios)

| Area | Built | Evidence |
|------|-------|----------|
| Core (ASKit) | Codable models for every endpoint, API client (single-flight refresh, idempotent retries), fixed-point geometry + 3/4 projection, road-graph A*, bundled asset manifest | 15 `swift test` cases in CI, decoding real captured API responses |
| Sign in | Sign in with Apple with nonce, Keychain session; Debug dev sign-in | `AppFlowTests` |
| Onboarding | Name, Mini from approved parts, choose the exact plot on the map (10 min hold), cottage variant, atomic claim | `AppFlowTests`, screenshots |
| City | Pan/zoom 3/4 map, roads, homes, forest on undeveloped land, stay glow, tap-to-travel along A* route, Wander | screenshots |
| Home | Dollhouse room, owner Arrange (drag, turn, add, put away), revision-safe Save that keeps the draft on 409, Door settings, Guests with Send Home, pending gifts | `AppFlowTests` (incl. stale-save conflict), screenshots |
| Visiting | Anonymous visit + dwell qualification, Stay/Leave, Leave a gift at a chosen spot, report, block | `AppFlowTests` |
| Other | Bag (inventory + general store), gift inbox, settings, account deletion | screenshots |

CI (`.github/workflows/ios.yml`, macOS): XcodeGen, unsigned Simulator build, ASKit tests, app
integration tests against the real API (Postgres + Node dev server on the runner), and a UI screenshot
tour published to the `ci-screenshots` branch.

## Next

1. Run it in Xcode on your Mac with your signing team; try two Simulators with two dev names.
2. Provision staging (Neon + Hyperdrive + Queues + secrets) and point a device build at it.
3. Art: replace `PlaceholderArt.swift` / `MiniLook.swift` with the illustrated sprite packs.
4. Load test shapes from Blueprint §74 before public beta.
