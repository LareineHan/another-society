import XCTest
@testable import ASKit

/// Every fixture is a REAL response captured from the TypeScript API (scripts/capture-ios-fixtures.mts).
/// If the server contract drifts, these fail before the app does.
final class FixtureDecodingTests: XCTestCase {
    func fixture(_ name: String) throws -> Data {
        let url = try XCTUnwrap(Bundle.module.url(forResource: name, withExtension: "json", subdirectory: "Fixtures"), "missing fixture \(name)")
        return try Data(contentsOf: url)
    }

    func decode<T: Decodable>(_ type: T.Type, _ name: String, file: StaticString = #filePath, line: UInt = #line) throws -> T {
        do { return try ASJSON.decoder().decode(T.self, from: try fixture(name)) }
        catch { XCTFail("\(name) -> \(T.self): \(error)", file: file, line: line); throw error }
    }

    func testAuthAndAccount() throws {
        let auth = try decode(AuthResponse.self, "auth_apple")
        XCTAssertTrue(auth.isNewAccount)
        XCTAssertFalse(try decode(AuthResponse.self, "auth_refresh").isNewAccount)
        let fresh = try decode(MeResponse.self, "me_new")
        XCTAssertEqual(fresh.resident?.onboardingState, .choosingPlot)
        XCTAssertTrue(fresh.resident?.miniDefinition.isEmpty ?? false)
        let staying = try decode(MeResponse.self, "me_staying")
        XCTAssertNotNil(staying.activeStay)
        XCTAssertNotNil(staying.resident?.primaryHome)
        let mini = try decode(Resident.self, "resident_mini")
        XCTAssertEqual(mini.miniDefinition.hair, "mini.hair.bob")
        XCTAssertEqual(mini.miniDefinition.hairColor, "mini.haircolor.brown")
    }

    func testWorld() throws {
        let boot = try decode(WorldBootstrap.self, "bootstrap")
        XCTAssertEqual(boot.cities.count, 1)
        XCTAssertEqual(boot.features["creator.enabled"], false)
        let plots = try decode(OnboardingPlotsResponse.self, "onboarding_plots").plots
        XCTAssertFalse(plots.isEmpty)
        XCTAssertNotNil(plots[0].frontageNodeId)
        XCTAssertEqual(plots[0].buildBounds?.points.count, 4)
        _ = try decode(ChunksResponse.self, "chunks")
        let roads = try decode(RoadGraphPayload.self, "roads")
        XCTAssertEqual(roads.civicAnchors.count, 3)
        let reserve = try decode(ReserveResponse.self, "reserve")
        XCTAssertGreaterThan(reserve.expiresAt.timeIntervalSince1970, 1_700_000_000)
        let claim = try decode(ClaimResponse.self, "claim")
        XCTAssertEqual(claim.property.spaceIds?.count, 1)
        XCTAssertFalse(try decode(WanderResponse.self, "wander").properties.isEmpty)
    }

    func testPropertyAndSpace() throws {
        let owner = try decode(Property.self, "property_owner")
        XCTAssertEqual(owner.viewer?.isOwner, true)
        XCTAssertEqual(try decode(Property.self, "property_visitor").viewer?.canStay, true)
        XCTAssertEqual(try decode(Property.self, "property_access").awayAccessMode, .closed)
        let space = try decode(Space.self, "space_owner")
        XCTAssertEqual(space.placements.count, 2)
        XCTAssertEqual(space.stayers?.count, 1)
        XCTAssertEqual(space.pendingGifts?.count, 1)
        XCTAssertEqual(space.bounds, .default)
        let saved = try decode(Space.self, "layout_saved")
        XCTAssertEqual(saved.layoutRevision, 2)
        let visit = try decode(VisitResponse.self, "visit")
        XCTAssertEqual(visit.spaces.count, 1)
        _ = try decode(VisitSummary.self, "visit_summary")
    }

    func testSocialAndEconomy() throws {
        XCTAssertNotNil(try decode(StayResponse.self, "stay").stayId)
        _ = try decode(MutationResponse.self, "stay_ended")
        XCTAssertEqual(try decode(Gift.self, "gift").status, .pendingPlacement)
        let inbox = try decode(GiftInbox.self, "gift_inbox")
        XCTAssertEqual(inbox.items.first?.giver?.linkable, true)
        XCTAssertEqual(try decode(Gift.self, "gift_resolved").status, .keptHere)
        XCTAssertEqual(try decode(InventoryResponse.self, "inventory").items.count, 4)
        XCTAssertEqual(try decode(Wallet.self, "wallet").currencyCode, "WORLD")
        XCTAssertEqual(try decode(CatalogResponse.self, "catalog").listings.count, 22)
        let purchase = try decode(PurchaseResponse.self, "purchase")
        XCTAssertEqual(purchase.items.first?.giftEligible, true)
    }

    func testErrorEnvelope() throws {
        let conflict = try decode(APIErrorBody.self, "error_revision_conflict")
        XCTAssertEqual(conflict.code, "revision_conflict")
        XCTAssertEqual(conflict.details?["current_revision"]?.intValue, 2)
        XCTAssertEqual(try decode(APIErrorBody.self, "error_idempotency_required").code, "idempotency_key_required")
    }
}
