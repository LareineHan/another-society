#if DEBUG
import Foundation
import ASKit

/// Debug-only: builds a small lived-in scene against a DEV_AUTH server for screenshots and demos.
/// Launch with env AS_DEMO_NAME=<anything>. Never compiled into Release.
@MainActor
enum DemoSeeder {
    static var name: String? { ProcessInfo.processInfo.environment["AS_DEMO_NAME"] }

    static func run(_ app: AppModel) async {
        guard let name else { return }
        await app.devSignIn(name: name)
        if app.phase == .onboarding, let cityId = app.city?.id {
            await onboard(app.api, displayName: "Mori", mini: .starter, structure: "structure.home.cottage.a", cityId: cityId)
            await app.refreshSession()
        }
        guard let home = app.resident?.primaryHome else { return }

        // Furnish the room with the starter kit.
        if let space = try? await app.api.space(home.spaceId), space.placements.isEmpty,
           let items = try? await app.api.inventory() {
            let spots: [String: (Int, Int, Int)] = [
                "furniture.bed.simple.001": (2_500, 9_000, 1), "furniture.table.round.001": (6_500, 5_500, 0),
                "furniture.chair.softwood.001": (8_000, 5_500, 3), "decor.lamp.paper.001": (10_500, 9_500, 0),
            ]
            let placements = items.compactMap { item -> Placement? in
                guard let key = item.definitionKey, let s = spots[key] else { return nil }
                return Placement(itemInstanceId: item.id, xU: s.0, yU: s.1, rotationQ: s.2)
            }
            _ = try? await app.api.saveLayout(spaceId: home.spaceId, expectedRevision: space.layoutRevision, placements: placements, key: IdempotencyKey.make())
        }

        // A neighbor who chose to stay, and left a gift.
        let neighbor = APIClient(baseURL: app.api.baseURL, tokenStore: InMemoryTokenStore())
        if (try? await neighbor.signInWithApple(identityToken: "dev:\(name)-neighbor", authorizationCode: "dev", rawNonce: "dev-nonce-000", deviceLabel: nil)) != nil {
            let look = MiniDefinition(version: 1, body: "mini.body.b", skin: "mini.skin.5", hair: "mini.hair.bun", hairColor: "mini.haircolor.black",
                                      outfit: "mini.outfit.coat", outfitColor: "mini.palette.moss", accessory: "mini.acc.scarf")
            if let me = try? await neighbor.me(), me.resident?.primaryHome == nil, let cityId = app.city?.id {
                await onboard(neighbor, displayName: "Juniper", mini: look, structure: "structure.home.cottage.b", cityId: cityId)
            }
            _ = try? await neighbor.stay(spaceId: home.spaceId, key: IdempotencyKey.make())
            if let listing = try? await neighbor.catalog(cityId: nil).first(where: { $0.definitionKey == "gift.flower.vase.001" }),
               let bought = try? await neighbor.purchase(listingId: listing.id, quantity: 1, key: IdempotencyKey.make()),
               let item = bought.items.first {
                _ = try? await neighbor.leaveGift(propertyId: home.propertyId, spaceId: home.spaceId, itemId: item.id, drop: WorldPoint(x: 6_000, y: 2_500), key: IdempotencyKey.make())
            }
        }
        await app.refreshSession()
    }

    private static func onboard(_ api: APIClient, displayName: String, mini: MiniDefinition, structure: String, cityId: EntityID) async {
        _ = try? await api.updateDisplayName(displayName)
        _ = try? await api.updateMini(mini)
        for _ in 0..<5 {
            guard let plot = try? await api.onboardingPlots(cityId: cityId).filter({ $0.status == .vacant }).randomElement() else { return }
            if let r = try? await api.reservePlot(plot.id, key: IdempotencyKey.make()),
               (try? await api.claimPlot(plot.id, ClaimRequest(reservationId: r.reservationId, structureAssetId: structure), key: IdempotencyKey.make())) != nil {
                return
            }
        }
    }
}
#endif
