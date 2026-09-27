import SpriteKit
import UIKit
import ASKit

/// The city from the fixed 3/4 camera (Blueprint §4.3): pan/zoom, tap a home or a vacant plot,
/// and watch your Mini travel the public road graph. No free camera, no joystick.
final class CityScene: SKScene {
    enum Mode { case browse, pickPlot }

    var mode: Mode = .browse { didSet { restylePlots() } }
    var selectedPlotId: EntityID? { didSet { restylePlots() } }
    var onTapProperty: ((EntityID) -> Void)?
    var onTapPlot: ((EntityID) -> Void)?

    let projection = Projection(pointsPerUnit: 0.02, verticalSquash: 0.72)

    private let cam = SKCameraNode()
    private let groundLayer = SKNode()
    private let roadLayer = SKNode()
    private let plotLayer = SKNode()
    private let objectLayer = SKNode()
    private var plotNodes: [EntityID: SKShapeNode] = [:]
    private var plots: [EntityID: PlotSummary] = [:]
    private var propertyNodes: [EntityID: SKNode] = [:]
    private var treesPlanted = false
    private var roadPoints: [WorldPoint] = []
    private(set) var myMini: SKNode?
    private var pinchStartScale: CGFloat = 1

    override init(size: CGSize) {
        super.init(size: size)
        scaleMode = .resizeFill
        anchorPoint = CGPoint(x: 0.5, y: 0.5)
        backgroundColor = Theme.UI.ground
        addChild(cam)
        camera = cam
        // Painter's-order objects use z in roughly ±1500 (see Projection.zPosition); ground layers sit far below.
        groundLayer.zPosition = -30_000
        roadLayer.zPosition = -20_000
        plotLayer.zPosition = -10_000
        for layer in [groundLayer, roadLayer, plotLayer, objectLayer] { addChild(layer) }
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) is not supported") }

    // MARK: Gestures

    override func didMove(to view: SKView) {
        view.isMultipleTouchEnabled = true
        let pan = UIPanGestureRecognizer(target: self, action: #selector(handlePan(_:)))
        pan.maximumNumberOfTouches = 1
        let pinch = UIPinchGestureRecognizer(target: self, action: #selector(handlePinch(_:)))
        view.addGestureRecognizer(pan)
        view.addGestureRecognizer(pinch)
    }

    override func willMove(from view: SKView) {
        view.gestureRecognizers?.forEach { view.removeGestureRecognizer($0) }
    }

    @objc private func handlePan(_ g: UIPanGestureRecognizer) {
        guard let view = g.view else { return }
        let t = g.translation(in: view)
        cam.position = CGPoint(x: cam.position.x - t.x * cam.xScale, y: cam.position.y + t.y * cam.yScale)
        g.setTranslation(.zero, in: view)
    }

    @objc private func handlePinch(_ g: UIPinchGestureRecognizer) {
        if g.state == .began { pinchStartScale = cam.xScale }
        let s = min(3.0, max(0.35, pinchStartScale / g.scale))
        cam.setScale(s)
    }

    override func touchesEnded(_ touches: Set<UITouch>, with event: UIEvent?) {
        guard touches.count == 1, let touch = touches.first, touch.tapCount >= 1 else { return }
        let location = touch.location(in: self)
        for node in nodes(at: location) {
            var cur: SKNode? = node
            while let c = cur {
                if let name = c.name {
                    if name.hasPrefix("prop:") { onTapProperty?(String(name.dropFirst(5))); return }
                    if name.hasPrefix("plot:") {
                        let id = String(name.dropFirst(5))
                        if plots[id]?.status == .vacant || plots[id]?.reservedByMe == true { onTapPlot?(id); return }
                    }
                }
                cur = c.parent
            }
        }
    }

    // MARK: Content

    func setRoads(_ graph: RoadGraph) {
        roadLayer.removeAllChildren()
        roadPoints = graph.nodes.values.map(\.point)
        for edge in graph.edges.values {
            let pts = (edge.geometryPoints?.map(\.world)).flatMap { $0.count >= 2 ? $0 : nil }
                ?? [graph.nodes[edge.fromNodeId]?.point, graph.nodes[edge.toNodeId]?.point].compactMap { $0 }
            guard pts.count >= 2 else { continue }
            let path = CGMutablePath()
            path.move(to: projection.scenePoint(pts[0]))
            for p in pts.dropFirst() { path.addLine(to: projection.scenePoint(p)) }
            let arterial = edge.edgeKind == "arterial"
            let edgeLine = SKShapeNode(path: path)
            edgeLine.strokeColor = Theme.UI.roadEdge
            edgeLine.lineWidth = arterial ? 16 : 11
            edgeLine.lineCap = .round
            edgeLine.lineJoin = .round
            roadLayer.addChild(edgeLine)
            let line = SKShapeNode(path: path)
            line.strokeColor = arterial ? Theme.UI.arterial : Theme.UI.road
            line.lineWidth = arterial ? 12 : 8
            line.lineCap = .round
            line.lineJoin = .round
            roadLayer.addChild(line)
        }
        for anchor in graph.civicAnchors {
            let n = civicNode(anchor.kind)
            n.position = projection.scenePoint(anchor.point)
            n.zPosition = projection.zPosition(anchor.point)
            objectLayer.addChild(n)
        }
        plantTreesIfNeeded()
    }

    /// Plots: vacant ones are quiet outlines (never a grid of numbered lots); occupied ones get a home.
    func setPlots(_ list: [PlotSummary]) {
        for p in list {
            plots[p.id] = p
            if plotNodes[p.id] == nil, let pts = p.buildBounds?.points, pts.count >= 3 {
                let path = CGMutablePath()
                path.addLines(between: pts.map { projection.scenePoint($0.world) })
                path.closeSubpath()
                let shape = SKShapeNode(path: path)
                shape.name = "plot:\(p.id)"
                shape.lineWidth = 1.5
                plotLayer.addChild(shape)
                plotNodes[p.id] = shape
            }
        }
        restylePlots()
        plantTreesIfNeeded()
    }

    func setChunks(_ chunks: [ChunkSummary], highlightPropertyId: EntityID?) {
        setPlots(chunks.flatMap(\.plots))
        let previews = chunks.flatMap(\.properties)
        let live = Set(previews.map(\.id))
        for (id, node) in propertyNodes where !live.contains(id) { node.removeFromParent(); propertyNodes[id] = nil }
        for pr in previews {
            guard let plot = plots[pr.plotId] else { continue }
            let at = WorldPoint(x: plot.centerXU + (pr.structureXU ?? 0), y: plot.centerYU + (pr.structureYU ?? 0))
            let node = propertyNodes[pr.id] ?? {
                let n = PlaceholderArt.house(structureAssetId: pr.structureAssetId)
                n.name = "prop:\(pr.id)"
                objectLayer.addChild(n)
                propertyNodes[pr.id] = n
                return n
            }()
            node.position = projection.scenePoint(at)
            node.zPosition = projection.zPosition(at)
            node.childNode(withName: "stayGlow")?.removeFromParent()
            node.childNode(withName: "homeMark")?.removeFromParent()
            if pr.hasActiveStayers == true {
                // Someone chose to stay: presence is the communication (Blueprint L2).
                let glow = SKShapeNode(circleOfRadius: 5)
                glow.name = "stayGlow"
                glow.fillColor = Theme.UI.glow
                glow.strokeColor = .clear
                glow.position = CGPoint(x: 26, y: 38)
                glow.run(.repeatForever(.sequence([.fadeAlpha(to: 0.4, duration: 1.2), .fadeAlpha(to: 1, duration: 1.2)])))
                node.addChild(glow)
            }
            if pr.id == highlightPropertyId {
                let mark = SKLabelNode(text: "home")
                mark.name = "homeMark"
                mark.fontName = "AvenirNext-DemiBold"
                mark.fontSize = 10
                mark.fontColor = Theme.UI.ink.withAlphaComponent(0.7)
                mark.position = CGPoint(x: 0, y: -14)
                node.addChild(mark)
            }
        }
        restylePlots()
    }

    private func restylePlots() {
        for (id, shape) in plotNodes {
            guard let p = plots[id] else { continue }
            let vacant = p.status == .vacant || p.reservedByMe == true
            let selected = id == selectedPlotId
            if selected {
                shape.fillColor = Theme.UI.plotSelected.withAlphaComponent(0.35)
                shape.strokeColor = Theme.UI.plotSelected
                shape.lineWidth = 2.5
            } else if vacant {
                shape.fillColor = Theme.UI.plotVacant.withAlphaComponent(mode == .pickPlot ? 0.18 : 0.06)
                shape.strokeColor = Theme.UI.plotVacant.withAlphaComponent(mode == .pickPlot ? 0.8 : 0.25)
                shape.lineWidth = mode == .pickPlot ? 1.5 : 1
            } else {
                shape.fillColor = Theme.UI.groundShade.withAlphaComponent(0.35)
                shape.strokeColor = .clear
            }
        }
    }

    /// Undeveloped land reads as forest and meadow, not locked slots (Blueprint §5).
    private func plantTreesIfNeeded() {
        guard !treesPlanted, !plots.isEmpty, !roadPoints.isEmpty else { return }
        treesPlanted = true
        let centers = plots.values.map(\.center)
        let xs = centers.map(\.x) + roadPoints.map(\.x), ys = centers.map(\.y) + roadPoints.map(\.y)
        guard let minX = xs.min(), let maxX = xs.max(), let minY = ys.min(), let maxY = ys.max() else { return }
        let step = 3_000
        var x = minX - 12_000
        while x <= maxX + 12_000 {
            var y = minY - 12_000
            while y <= maxY + 12_000 {
                let seed = (x &* 73_856_093) ^ (y &* 19_349_663)
                if abs(seed) % 3 == 0 {
                    let p = WorldPoint(x: x + (abs(seed) % 1_700) - 850, y: y + (abs(seed >> 3) % 1_700) - 850)
                    let nearPlot = centers.contains { $0.distance(to: p) < 3_800 }
                    let nearRoad = roadPoints.contains { $0.distance(to: p) < 2_400 }
                    if !nearPlot && !nearRoad {
                        let t = PlaceholderArt.tree(seed: seed)
                        t.position = projection.scenePoint(p)
                        t.zPosition = projection.zPosition(p)
                        objectLayer.addChild(t)
                    }
                }
                y += step
            }
            x += step
        }
    }

    private func civicNode(_ kind: String) -> SKNode {
        let n = SKNode()
        if kind == "park" {
            let lawn = SKShapeNode(ellipseOf: CGSize(width: 90, height: 40))
            lawn.fillColor = Theme.UI.forest.withAlphaComponent(0.55)
            lawn.strokeColor = .clear
            n.addChild(lawn)
            for dx in [-26.0, 0, 26] {
                let t = PlaceholderArt.tree(seed: Int(dx) + 7, scale: 0.8)
                t.position = CGPoint(x: dx, y: 4)
                n.addChild(t)
            }
        } else {
            let b = SKShapeNode(rect: CGRect(x: -30, y: 0, width: 60, height: 36), cornerRadius: 3)
            b.fillColor = Theme.UI.wall
            b.strokeColor = Theme.UI.wallShade
            n.addChild(b)
            let awning = SKShapeNode(rect: CGRect(x: -34, y: 30, width: 68, height: 10), cornerRadius: 2)
            awning.fillColor = kind == "market_hall" ? Theme.UI.civic : UIColor(hex: 0x9DB8C9)
            awning.strokeColor = .clear
            n.addChild(awning)
        }
        let label = SKLabelNode(text: kind == "general_store" ? "General store" : kind == "market_hall" ? "Market hall" : kind == "park" ? "Park" : kind)
        label.fontName = "AvenirNext-Medium"
        label.fontSize = 10
        label.fontColor = Theme.UI.ink.withAlphaComponent(0.65)
        label.position = CGPoint(x: 0, y: -16)
        n.addChild(label)
        return n
    }

    // MARK: Camera + Mini

    func focus(on p: WorldPoint, animated: Bool = true) {
        let target = projection.scenePoint(p)
        if animated { cam.run(.move(to: target, duration: 0.45), withKey: "focus") } else { cam.position = target }
    }

    func placeMyMini(_ def: MiniDefinition, at p: WorldPoint) {
        myMini?.removeFromParent()
        let n = MiniSprite.node(def, scale: 1.1)
        n.position = projection.scenePoint(p)
        n.zPosition = projection.zPosition(p) + 1
        objectLayer.addChild(n)
        myMini = n
    }

    /// Short, tap-to-travel animation along the road route. Purely local: nothing is streamed.
    func travel(along route: [WorldPoint], completion: @escaping () -> Void) {
        guard let mini = myMini, route.count >= 2 else { completion(); return }
        let total = PathMath.length(route)
        let seconds = PathMath.travelSeconds(route)
        var actions: [SKAction] = []
        for (a, b) in zip(route, route.dropFirst()) {
            let d = total > 0 ? seconds * a.distance(to: b) / total : 0
            let z = projection.zPosition(b) + 1
            actions.append(.move(to: projection.scenePoint(b), duration: max(0.01, d)))
            actions.append(.run { mini.zPosition = z })
        }
        cam.run(.sequence(zip(route, route.dropFirst()).map { a, b in
            SKAction.move(to: projection.scenePoint(b), duration: max(0.01, total > 0 ? seconds * a.distance(to: b) / total : 0))
        }), withKey: "follow")
        mini.run(.sequence(actions + [.run(completion)]), withKey: "travel")
    }
}
