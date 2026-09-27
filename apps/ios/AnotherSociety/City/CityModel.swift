import SwiftUI
import SpriteKit
import ASKit

/// Owns the city scene and the data it shows. Loads only a bounded chunk window (Blueprint §9).
@MainActor
@Observable
final class CityModel {
    let scene: CityScene
    private(set) var graph: RoadGraph?
    private(set) var plots: [EntityID: PlotSummary] = [:]
    private(set) var loading = false
    var selectedPropertyId: EntityID?
    var traveling = false

    init(size: CGSize = CGSize(width: 390, height: 700)) {
        scene = CityScene(size: size)
    }

    func load(app: AppModel, around: WorldPoint? = nil) async {
        guard let city = app.city else { return }
        loading = true
        defer { loading = false }
        do {
            let payload = try await app.api.roads(cityId: city.id)
            let g = RoadGraph(payload)
            graph = g
            scene.setRoads(g)
            let center = around ?? homePoint(app) ?? g.civicAnchors.first?.point ?? .zero
            let chunks = try await app.api.chunks(cityId: city.id, window: .around(center, radius: 4))
            for p in chunks.chunks.flatMap(\.plots) { plots[p.id] = p }
            rememberChunks(chunks.chunks)
            scene.setChunks(chunks.chunks, highlightPropertyId: app.homePropertyId)
            if let res = app.resident, !traveling {
                scene.placeMyMini(res.miniDefinition, at: miniPosition(app) ?? center)
            }
        } catch {
            app.banner = Copy.errorMessage(error)
        }
    }

    func homePoint(_ app: AppModel) -> WorldPoint? {
        guard let plotId = app.resident?.primaryHome?.plotId, let p = plots[plotId] else { return nil }
        return p.center
    }

    /// Where the durable Mini is: home, or the home it is staying in.
    func miniPosition(_ app: AppModel) -> WorldPoint? {
        if let stay = app.activeStay, let plot = plotFor(propertyId: stay.hostPropertyId) { return plot.center }
        return homePoint(app)
    }

    func plotFor(propertyId: EntityID) -> PlotSummary? {
        propertyPlots[propertyId].flatMap { plots[$0] }
    }

    /// property id -> plot id, learned from chunk previews and wander results.
    private var propertyPlots: [EntityID: EntityID] = [:]
    func remember(propertyId: EntityID, plotId: EntityID) { propertyPlots[propertyId] = plotId }

    func rememberChunks(_ chunks: [ChunkSummary]) {
        for pr in chunks.flatMap(\.properties) { propertyPlots[pr.id] = pr.plotId }
    }

    /// Animate the Mini from where it is to a destination (plot center + its frontage node), then `arrived`.
    func travel(app: AppModel, to center: WorldPoint, frontageNodeId: EntityID?, arrived: @escaping () -> Void) {
        guard let graph, let from = miniPosition(app) ?? homePoint(app) else { arrived(); return }
        let fromNode = plots.values.first { $0.center == from }?.frontageNodeId
        let route = graph.route(from: from, fromNode: fromNode, to: center, toNode: frontageNodeId)
        traveling = true
        scene.travel(along: route) { [weak self] in
            Task { @MainActor in
                self?.traveling = false
                arrived()
            }
        }
    }
}

struct CityMapView: View {
    let model: CityModel

    var body: some View {
        GeometryReader { geo in
            SpriteView(scene: model.scene, preferredFramesPerSecond: 30, options: [.ignoresSiblingOrder])
                .onAppear { model.scene.size = geo.size }
                .onChange(of: geo.size) { _, s in model.scene.size = s }
        }
        .ignoresSafeArea()
    }
}
