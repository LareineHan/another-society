import XCTest
@testable import ASKit

final class RoutingGeometryTests: XCTestCase {
    func roads() throws -> RoadGraphPayload {
        let url = try XCTUnwrap(Bundle.module.url(forResource: "roads", withExtension: "json", subdirectory: "Fixtures"))
        return try ASJSON.decoder().decode(RoadGraphPayload.self, from: Data(contentsOf: url))
    }

    func testChunkIndexUsesFloorDivision() {
        XCTAssertEqual(WorldUnits.chunkIndex(0), 0)
        XCTAssertEqual(WorldUnits.chunkIndex(31_999), 0)
        XCTAssertEqual(WorldUnits.chunkIndex(32_000), 1)
        XCTAssertEqual(WorldUnits.chunkIndex(-1), -1)
        XCTAssertEqual(WorldUnits.chunkIndex(-32_000), -1)
        XCTAssertEqual(WorldUnits.chunkIndex(-32_001), -2)
    }

    func testChunkWindowNeverExceedsApiLimit() {
        let r = ChunkRect.around(WorldPoint(x: -10_500, y: 6_000), radius: 50)
        XCTAssertLessThanOrEqual(r.count, WorldUnits.maxChunkWindow)
        XCTAssertEqual(r.minX, -5)
    }

    func testProjectionRoundTripAndDepth() {
        let p = Projection()
        let w = WorldPoint(x: 12_345, y: -6_789)
        let back = p.worldPoint(p.scenePoint(w))
        XCTAssertLessThanOrEqual(abs(back.x - w.x), 1)
        XCTAssertLessThanOrEqual(abs(back.y - w.y), 1)
        XCTAssertGreaterThan(p.zPosition(WorldPoint(x: 0, y: 0)), p.zPosition(WorldPoint(x: 0, y: 5_000)))
        XCTAssertEqual(WorldPoint(x: 1_130, y: -1_120).snapped(), WorldPoint(x: 1_250, y: -1_000))
    }

    func testAStarFindsConnectedRoutesOnTheRealCityGraph() throws {
        let graph = RoadGraph(try roads())
        XCTAssertEqual(graph.nodes.count, 19)
        let frontage = try XCTUnwrap(graph.nodes.values.first { $0.nodeKind == "frontage" })
        let civic = try XCTUnwrap(graph.nodes.values.first { $0.nodeKind == "civic" })
        let path = try XCTUnwrap(graph.shortestPath(from: frontage.id, to: civic.id))
        XCTAssertEqual(path.first, frontage.id)
        XCTAssertEqual(path.last, civic.id)
        let line = graph.polyline(path)
        XCTAssertEqual(line.first, frontage.point)
        XCTAssertEqual(line.last, civic.point)
        // Every frontage node is reachable from every other (active graph is connected).
        let all = graph.nodes.values.filter { $0.nodeKind == "frontage" }
        for n in all { XCTAssertNotNil(graph.shortestPath(from: all[0].id, to: n.id)) }
        XCTAssertNil(graph.shortestPath(from: frontage.id, to: "not-a-node"))
        XCTAssertGreaterThan(PathMath.travelSeconds(line), 0.7)
    }

    func testAssetCatalogAndRotations() throws {
        let catalog = AssetCatalog()
        let bed = try XCTUnwrap(catalog.asset("furniture.bed.simple.001"))
        XCTAssertEqual(bed.footprintU.w, 2000)
        XCTAssertTrue(bed.allows(rotationQ: 3))
        let rug = try XCTUnwrap(catalog.asset("decor.rug.woven.001"))
        XCTAssertEqual(rug.nextRotation(after: 1), 0) // rug allows 0 and 90 only
        XCTAssertEqual(catalog.structures.count, 3)
    }

    func testMiniResolvesToApprovedParts() {
        let m = MiniDefinition(version: nil).resolved
        for slot in MiniSlot.allCases { XCTAssertTrue(slot.parts.contains(m[slot] ?? ""), "\(slot)") }
    }
}
