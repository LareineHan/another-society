import XCTest
import ASKit
@testable import AnotherSociety

/// Integration tests: the app's own models drive the REAL API (Node dev server with DEV_AUTH,
/// started by CI on this Mac at http://127.0.0.1:8787). They exercise the same code paths the
/// screens use: sign-in, onboarding reserve/claim, city load + routing, room load, layout save
/// (including a stale-revision conflict), visit, stay, gift, inbox, leave.
@MainActor
final class AppFlowTests: XCTestCase {
    let base = URL(string: ProcessInfo.processInfo.environment["AS_TEST_API"] ?? "http://127.0.0.1:8787")!

    override func setUp() async throws {
        let (_, response) = try await URLSession.shared.data(from: base.appendingPathComponent("/health"))
        try XCTSkipUnless((response as? HTTPURLResponse)?.statusCode == 200, "API not running at \(base)")
    }

    private func newResident(_ name: String) async throws -> AppModel {
        let app = AppModel(tokenStore: InMemoryTokenStore(), baseURL: base)
        await app.devSignIn(name: "\(name)-\(UUID().uuidString.prefix(8))")
        XCTAssertNil(app.banner, app.banner ?? "")
        XCTAssertEqual(app.phase, .onboarding)
        return app
    }

    /// Mirrors OnboardingView: name, Mini, reserve an open plot, claim with a cottage.
    private func onboard(_ app: AppModel, name: String) async throws {
        _ = try await app.api.updateDisplayName(name)
        _ = try await app.api.updateMini(MiniDefinition.starter)
        let cityId = try XCTUnwrap(app.city?.id)
        for _ in 0..<5 {
            let plots = try await app.api.onboardingPlots(cityId: cityId).filter { $0.status == .vacant }
            let plot = try XCTUnwrap(plots.randomElement())
            do {
                let r = try await app.api.reservePlot(plot.id, key: IdempotencyKey.make())
                _ = try await app.api.claimPlot(plot.id, ClaimRequest(reservationId: r.reservationId, structureAssetId: "structure.home.cottage.b"), key: IdempotencyKey.make())
                break
            } catch let e as APIError where e.code == "plot_unavailable" { continue }
        }
        await app.refreshSession()
        XCTAssertEqual(app.phase, .inWorld)
        XCTAssertNotNil(app.homePropertyId)
    }

    func testOnboardingCityAndOwnerLayout() async throws {
        let app = try await newResident("owner")
        try await onboard(app, name: "Mori")

        // City: road graph + bounded chunks, and a route from home to the civic core.
        let city = CityModel()
        await city.load(app: app)
        let graph = try XCTUnwrap(city.graph)
        XCTAssertGreaterThan(graph.nodes.count, 3)
        let home = try XCTUnwrap(city.homePoint(app))
        let civic = try XCTUnwrap(graph.civicAnchors.first)
        let route = graph.route(from: home, to: civic.point, toNode: civic.roadNodeId)
        XCTAssertGreaterThanOrEqual(route.count, 3)

        // Room: owner loads, adds an item to the draft, saves (revision 1 -> 2).
        let room = PropertyModel(propertyId: try XCTUnwrap(app.homePropertyId))
        await room.load(app: app)
        XCTAssertTrue(room.isOwner)
        XCTAssertEqual(room.space?.layoutRevision, 1)
        let inventory = try await app.api.inventory()
        let bed = try XCTUnwrap(inventory.first { $0.definitionKey == "furniture.bed.simple.001" })
        room.mode = .edit
        room.add(bed)
        room.rotate(bed.id)
        await room.save(app: app)
        XCTAssertFalse(room.dirty)
        XCTAssertEqual(room.space?.layoutRevision, 2)
        XCTAssertEqual(room.space?.placements.first?.rotationQ, 1)

        // Another device saves first; our stale save must not overwrite it, and our draft survives.
        let lamp = try XCTUnwrap(inventory.first { $0.definitionKey == "decor.lamp.paper.001" })
        let sid = try XCTUnwrap(room.spaceId)
        _ = try await app.api.saveLayout(spaceId: sid, expectedRevision: 2, placements: [], key: IdempotencyKey.make())
        room.mode = .edit
        room.add(lamp)
        await room.save(app: app)
        XCTAssertTrue(room.dirty, "stale save keeps the draft")
        XCTAssertNotNil(app.banner)
        app.banner = nil
        await room.save(app: app)
        XCTAssertFalse(room.dirty)
        XCTAssertEqual(room.space?.layoutRevision, 4)
        XCTAssertEqual(Set(room.space?.placements.map(\.itemInstanceId) ?? []), [bed.id, lamp.id])
    }

    func testVisitStayGiftAndLeave() async throws {
        let host = try await newResident("host")
        try await onboard(host, name: "Juniper")
        let guest = try await newResident("guest")
        try await onboard(guest, name: "Birch")
        let hostHome = try XCTUnwrap(host.homePropertyId)

        // Visit: not the owner, sees the room, can stay.
        let visit = PropertyModel(propertyId: hostHome)
        await visit.load(app: guest)
        XCTAssertNil(visit.failed)
        XCTAssertFalse(visit.isOwner)
        XCTAssertEqual(visit.property?.viewer?.canStay, true)

        // Stay persists as durable presence and is visible to the host.
        await visit.stay(app: guest)
        XCTAssertEqual(guest.activeStay?.hostPropertyId, hostHome)
        XCTAssertTrue(visit.isStayingHere(guest))
        let hostRoom = PropertyModel(propertyId: hostHome)
        await hostRoom.load(app: host)
        XCTAssertEqual(hostRoom.space?.stayers?.map(\.displayName), ["Birch"])

        // Gift: buy a gift-safe item, choose a spot, leave it; host sees it and keeps it here.
        let listing = try XCTUnwrap(try await guest.api.catalog(cityId: nil).first { $0.giftEligible == true })
        let bought = try await guest.api.purchase(listingId: listing.id, quantity: 1, key: IdempotencyKey.make())
        visit.mode = .giving(try XCTUnwrap(bought.items.first?.id))
        visit.dropSpot = WorldPoint(x: 4_000, y: 5_000)
        let left = await visit.leaveGift(app: guest)
        XCTAssertTrue(left, guest.banner ?? "")
        let inbox = try await host.api.giftInbox()
        XCTAssertEqual(inbox.first?.giver?.displayName, "Birch")
        _ = try await host.api.resolveGift(try XCTUnwrap(inbox.first?.id), .keepHere, key: IdempotencyKey.make())
        await hostRoom.reloadSpace(app: host)
        XCTAssertEqual(hostRoom.space?.placements.count, 1)

        // Owner sends the guest home; the guest's durable Mini is back home.
        await hostRoom.sendHome(try XCTUnwrap(hostRoom.space?.stayers?.first?.residentId), app: host)
        await guest.refreshMe()
        XCTAssertNil(guest.activeStay)
    }
}
