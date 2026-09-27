# Another Society iOS

SwiftUI shell + SpriteKit world, iOS 17+. The app is a renderer of the server's world: every
canonical fact (land, items, money, stays, gifts, layouts) comes from the API; local state is cache.

```text
apps/ios/
  project.yml                 XcodeGen spec (the .xcodeproj is generated, not committed)
  Packages/ASKit/             platform-neutral core: models, API client, geometry, routing, asset manifest
  AnotherSociety/
    App/                      AppModel (session + routing), config, Keychain, debug demo seeder
    Auth/                     Sign in with Apple (nonce), Debug dev sign-in
    Onboarding/               name, Mini, choose a plot on the map (reserve), cottage, atomic claim
    City/                     CityScene (3/4 map, pan/zoom, travel animation), world shell, Wander
    Property/                 PropertyScene (dollhouse room), owner layout editing, visit/stay/gift, sheets
    Bag/ Gifts/ Settings/ Mini/ Shared/
  AnotherSocietyTests/        app models against the real API (runs in CI on the Simulator)
  AnotherSocietyUITests/      screenshot tour (CI publishes to the `ci-screenshots` branch)
```

## Open in Xcode

```bash
brew install xcodegen
cd apps/ios && xcodegen generate && open AnotherSociety.xcodeproj
```

In **Signing & Capabilities** pick the IMPLEMON team. Sign in with Apple is already in the
entitlements; the bundle id is `com.implemon.anothersociety` (change it in `project.yml` if needed,
then regenerate).

## Run against a local API (Simulator)

```bash
# from the repo root, with Postgres running
export DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5432/as_dev
pnpm db:migrate && pnpm db:seed && pnpm world:import
pnpm dev:server            # http://127.0.0.1:8787, DEV_AUTH on
```

Run the app in the Simulator. On the sign-in screen, the **Local server (DEV_AUTH)** field signs
you in as `dev:<name>`; use a second name in another Simulator to see two residents meet.

Debug extras:

- **You > Developer** changes the API URL (for a phone on the same Wi-Fi use your Mac's LAN IP).
- Launch environment `AS_DEMO_NAME=anything` builds a lived-in scene (furnished home, a neighbor
  staying, a gift waiting). `AS_RESET=1` signs out at launch.

Release builds never include dev sign-in or the demo seeder, and the API refuses `DEV_AUTH` in production.

## Tests

- `cd Packages/ASKit && swift test`: models decode real captured API responses
  (`Tests/ASKitTests/Fixtures`, refresh with `scripts/capture-ios-fixtures.mts`), A* on the real
  road graph, fixed-point geometry, client refresh/idempotency behavior.
- Xcode test action: `AppFlowTests` drive AppModel/CityModel/PropertyModel against `pnpm dev:server`
  (skipped if it isn't running); `ScreenshotTests` walks the main screens.

## Placeholder art

Everything visual is drawn from `Shared/PlaceholderArt.swift` and `Mini/MiniLook.swift`, keyed by the
stable asset ids in the bundled manifest (`core-dev.v1.json`). When the illustrated sprite packs
exist, replace those two files; world semantics do not depend on them (Blueprint §4.5).
