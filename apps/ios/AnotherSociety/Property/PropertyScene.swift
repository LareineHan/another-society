import SpriteKit
import UIKit
import ASKit

/// A property's main space as a fixed 3/4 dollhouse (Blueprint §4.3). Visitors only look;
/// only the owner can move things (Law L3), and even the owner's edits stay a draft until saved.
final class PropertyScene: SKScene {
    enum Interaction: Equatable { case look, edit, chooseDropSpot }

    var interaction: Interaction = .look { didSet { if interaction != .edit { select(nil) } } }
    var onSelect: ((EntityID?) -> Void)?
    var onMove: ((EntityID, WorldPoint) -> Void)?
    var onRotate: ((EntityID) -> Void)?
    var onTapFloor: ((WorldPoint) -> Void)?
    var onTapGift: ((EntityID) -> Void)?
    var onTapStayer: ((EntityID) -> Void)?

    private(set) var roomBounds = SpaceBounds.default
    let projection = Projection(pointsPerUnit: 0.028, verticalSquash: 0.72)
    private let cam = SKCameraNode()
    private let room = SKNode()
    private let items = SKNode()
    private let people = SKNode()
    private var itemNodes: [EntityID: SKNode] = [:]
    private var selectedId: EntityID?
    private var dragging: (id: EntityID, offset: CGPoint)?
    private var dropMarker: SKNode?

    override init(size: CGSize) {
        super.init(size: size)
        scaleMode = .resizeFill
        anchorPoint = CGPoint(x: 0.5, y: 0.5)
        backgroundColor = Theme.UI.paper
        addChild(cam)
        camera = cam
        room.zPosition = -10_000
        addChild(room)
        addChild(items)
        addChild(people)
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) is not supported") }

    override func didChangeSize(_ oldSize: CGSize) {
        super.didChangeSize(oldSize)
        fitCamera()
    }

    private func fitCamera() {
        let roomSize = projection.size(roomBounds.maxX - roomBounds.minX, roomBounds.maxY - roomBounds.minY)
        guard size.width > 0, roomSize.width > 0 else { return }
        let scale = max((roomSize.width + 60) / size.width, (roomSize.height + 200) / max(1, size.height))
        cam.setScale(max(0.6, scale))
        let c = projection.scenePoint(WorldPoint(x: (roomBounds.minX + roomBounds.maxX) / 2, y: (roomBounds.minY + roomBounds.maxY) / 2))
        cam.position = CGPoint(x: c.x, y: c.y + 30)
    }

    // MARK: Rendering

    func renderRoom(bounds: SpaceBounds, structureAssetId: String) {
        self.roomBounds = bounds
        room.removeAllChildren()
        let origin = projection.scenePoint(WorldPoint(x: roomBounds.minX, y: roomBounds.minY))
        let size = projection.size(roomBounds.maxX - roomBounds.minX, roomBounds.maxY - roomBounds.minY)
        let floorRect = CGRect(origin: origin, size: size)

        let back = SKShapeNode(rect: CGRect(x: floorRect.minX, y: floorRect.maxY, width: floorRect.width, height: 120), cornerRadius: 4)
        back.fillColor = Theme.UI.wall
        back.strokeColor = Theme.UI.wallShade
        room.addChild(back)
        let trim = SKShapeNode(rect: CGRect(x: floorRect.minX, y: floorRect.maxY + 116, width: floorRect.width, height: 10))
        trim.fillColor = PlaceholderArt.roofColor(structureAssetId)
        trim.strokeColor = .clear
        room.addChild(trim)
        let window = SKShapeNode(rect: CGRect(x: floorRect.midX - 40, y: floorRect.maxY + 38, width: 80, height: 52), cornerRadius: 6)
        window.fillColor = UIColor(hex: 0xCFE0EA)
        window.strokeColor = Theme.UI.wallShade
        window.lineWidth = 3
        room.addChild(window)

        let floor = SKShapeNode(rect: floorRect, cornerRadius: 6)
        floor.fillColor = Theme.UI.floor
        floor.strokeColor = Theme.UI.floorLine
        floor.lineWidth = 2
        floor.name = "floor"
        room.addChild(floor)
        var x = roomBounds.minX + 2_000
        while x < roomBounds.maxX {
            let path = CGMutablePath()
            path.move(to: projection.scenePoint(WorldPoint(x: x, y: roomBounds.minY)))
            path.addLine(to: projection.scenePoint(WorldPoint(x: x, y: roomBounds.maxY)))
            let board = SKShapeNode(path: path)
            board.strokeColor = Theme.UI.floorLine.withAlphaComponent(0.6)
            board.lineWidth = 1
            room.addChild(board)
            x += 2_000
        }
        fitCamera()
    }

    func renderPlacements(_ placements: [Placement]) {
        let live = Set(placements.map(\.itemInstanceId))
        for (id, n) in itemNodes where !live.contains(id) { n.removeFromParent(); itemNodes[id] = nil }
        for p in placements {
            itemNodes[p.itemInstanceId]?.removeFromParent()
            let n = PlaceholderArt.item(assetId: p.assetId, rotationQ: p.rotationQ, projection: projection)
            n.name = "item:\(p.itemInstanceId)"
            n.position = projection.scenePoint(p.point)
            n.zPosition = projection.zPosition(p.point, layer: p.layer ?? 0)
            items.addChild(n)
            itemNodes[p.itemInstanceId] = n
        }
        if let s = selectedId { highlight(s, on: itemNodes[s] != nil) }
    }

    /// Stayers (public presence), plus pending gifts for the owner, plus my own local Mini.
    func renderPeople(stayers: [Stayer], me: MiniDefinition?, meAtDoor: Bool, pendingGifts: [PendingGiftPreview]) {
        people.removeAllChildren()
        let spacing = (roomBounds.maxX - roomBounds.minX) / max(2, stayers.count + 1)
        for (i, s) in stayers.enumerated() {
            let p = WorldPoint(x: roomBounds.minX + spacing * (i + 1), y: roomBounds.maxY - 1_600 - (i % 2) * 900)
            let n = MiniSprite.node(s.miniDefinition, scale: 1.4)
            n.name = "stayer:\(s.residentId)"
            n.position = projection.scenePoint(p)
            n.zPosition = projection.zPosition(p) + 1
            let tag = SKLabelNode(text: s.displayName)
            tag.fontName = "AvenirNext-Medium"
            tag.fontSize = 10
            tag.fontColor = Theme.UI.ink.withAlphaComponent(0.6)
            tag.position = CGPoint(x: 0, y: -16)
            n.addChild(tag)
            people.addChild(n)
        }
        if let me {
            let p = meAtDoor
                ? WorldPoint(x: (roomBounds.minX + roomBounds.maxX) / 2, y: roomBounds.minY + 900)
                : WorldPoint(x: roomBounds.minX + 2_500, y: (roomBounds.minY + roomBounds.maxY) / 2)
            let n = MiniSprite.node(me, scale: 1.4)
            n.position = projection.scenePoint(p)
            n.zPosition = projection.zPosition(p) + 1
            people.addChild(n)
        }
        for g in pendingGifts {
            let p = WorldPoint(x: g.dropXU, y: g.dropYU)
            let n = PlaceholderArt.item(assetId: g.assetId, rotationQ: 0, projection: projection)
            n.name = "gift:\(g.id)"
            n.position = projection.scenePoint(p)
            n.zPosition = projection.zPosition(p) + 2
            n.run(.repeatForever(.sequence([.moveBy(x: 0, y: 3, duration: 0.8), .moveBy(x: 0, y: -3, duration: 0.8)])))
            let sparkle = SKLabelNode(text: "✦")
            sparkle.fontSize = 12
            sparkle.fontColor = Theme.UI.glow
            sparkle.position = CGPoint(x: 12, y: 24)
            n.addChild(sparkle)
            people.addChild(n)
        }
    }

    func showDropMarker(at p: WorldPoint?) {
        dropMarker?.removeFromParent()
        guard let p else { return }
        let ring = SKShapeNode(ellipseOf: CGSize(width: 34, height: 18))
        ring.strokeColor = Theme.UI.plotSelected
        ring.lineWidth = 2
        ring.fillColor = Theme.UI.plotSelected.withAlphaComponent(0.15)
        ring.position = projection.scenePoint(p)
        ring.zPosition = 5_000
        addChild(ring)
        dropMarker = ring
    }

    func select(_ id: EntityID?) {
        if let old = selectedId { highlight(old, on: false) }
        selectedId = id
        if let id { highlight(id, on: true) }
        onSelect?(id)
    }

    private func highlight(_ id: EntityID, on: Bool) {
        guard let n = itemNodes[id] else { return }
        n.childNode(withName: "sel")?.removeFromParent()
        guard on else { return }
        let ring = SKShapeNode(ellipseOf: CGSize(width: 54, height: 22))
        ring.name = "sel"
        ring.strokeColor = Theme.UI.plotSelected
        ring.lineWidth = 2
        ring.zPosition = -1
        n.addChild(ring)
    }

    // MARK: Touch

    private func hit(_ location: CGPoint, prefix: String) -> EntityID? {
        for node in nodes(at: location) {
            var cur: SKNode? = node
            while let c = cur {
                if let name = c.name, name.hasPrefix(prefix) { return String(name.dropFirst(prefix.count)) }
                cur = c.parent
            }
        }
        return nil
    }

    override func touchesBegan(_ touches: Set<UITouch>, with event: UIEvent?) {
        guard interaction == .edit, let t = touches.first else { return }
        let loc = t.location(in: self)
        if let id = hit(loc, prefix: "item:"), let n = itemNodes[id] {
            if t.tapCount == 2 { onRotate?(id); return }
            select(id)
            dragging = (id, CGPoint(x: n.position.x - loc.x, y: n.position.y - loc.y))
        } else {
            select(nil)
        }
    }

    override func touchesMoved(_ touches: Set<UITouch>, with event: UIEvent?) {
        guard interaction == .edit, let d = dragging, let t = touches.first, let n = itemNodes[d.id] else { return }
        let loc = t.location(in: self)
        let w = roomBounds.clamp(projection.worldPoint(CGPoint(x: loc.x + d.offset.x, y: loc.y + d.offset.y)).snapped())
        n.position = projection.scenePoint(w)
        n.zPosition = projection.zPosition(w)
    }

    override func touchesEnded(_ touches: Set<UITouch>, with event: UIEvent?) {
        guard let t = touches.first else { return }
        let loc = t.location(in: self)
        switch interaction {
        case .edit:
            if let d = dragging, let n = itemNodes[d.id] {
                onMove?(d.id, roomBounds.clamp(projection.worldPoint(n.position).snapped()))
            }
            dragging = nil
        case .chooseDropSpot:
            let w = projection.worldPoint(loc)
            if roomBounds.contains(w) { onTapFloor?(w.snapped()) }
        case .look:
            if let g = hit(loc, prefix: "gift:") { onTapGift?(g); return }
            if let s = hit(loc, prefix: "stayer:") { onTapStayer?(s) }
        }
    }

    override func touchesCancelled(_ touches: Set<UITouch>, with event: UIEvent?) { dragging = nil }
}
