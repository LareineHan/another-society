import SpriteKit
import UIKit
import ASKit

/// Placeholder renderer for manifest assets until the illustrated sprite packs exist.
/// Everything is keyed by stable asset_id + footprint, so swapping in real sprites later means
/// replacing `node(for:)` only; world semantics never depend on this file (Blueprint §4.5).
enum PlaceholderArt {
    static func color(for assetId: String?) -> UIColor {
        guard let id = assetId else { return UIColor(hex: 0xB9A58A) }
        let table: [String: UInt32] = [
            "bed": 0xD9B8A0, "chair": 0xB78C5A, "table": 0xA97E52, "lamp": 0xF2D59B, "sofa": 0x9DB8C9, "shelf": 0x9C7A56,
            "desk": 0x8F6D4C, "rug": 0xC98B6B, "bench": 0x8C6B4A, "clock": 0x6F7C85, "monstera": 0x6F8F5E, "stove": 0x5E5A57,
            "flower": 0xE3A1A8, "teacup": 0xF1E4D0, "candle": 0xF6E7C1, "book": 0x8E6FA8, "fern": 0x7C9A6B, "cushion": 0xE0B06A,
            "lantern": 0xF2C572, "music-box": 0xB98E6E, "pebble": 0xA7A39C, "snow-globe": 0xBFD8E6,
        ]
        for (k, v) in table where id.contains(k) { return UIColor(hex: v) }
        return UIColor(hex: 0xB9A58A)
    }

    static func roofColor(_ structureAssetId: String) -> UIColor {
        if structureAssetId.hasSuffix(".b") { return UIColor(hex: 0x6F8F5E) }
        if structureAssetId.hasSuffix(".c") { return UIColor(hex: 0x5E6E7E) }
        return UIColor(hex: 0xC9785B)
    }

    /// A furniture/decor/gift piece: a soft block with a top face, sized by its footprint.
    static func item(assetId: String?, rotationQ: Int, projection: Projection, height: CGFloat = 16) -> SKNode {
        let entry = AssetCatalog.shared.asset(assetId)
        var w = entry?.footprintU.w ?? 1000, d = entry?.footprintU.d ?? 1000
        if rotationQ % 2 == 1 { swap(&w, &d) }
        let size = projection.size(w, d)
        let base = color(for: assetId)
        let node = SKNode()

        let shadow = SKShapeNode(ellipseOf: CGSize(width: size.width * 1.05, height: max(6, size.height * 0.6)))
        shadow.fillColor = Theme.UI.shadow
        shadow.strokeColor = .clear
        shadow.position = CGPoint(x: 0, y: -2)
        node.addChild(shadow)

        let isFlat = assetId?.contains("rug") == true
        let h = isFlat ? 2 : (entry?.kind == "gift" ? height * 0.7 : height)
        let front = SKShapeNode(rect: CGRect(x: -size.width / 2, y: 0, width: size.width, height: h), cornerRadius: 3)
        front.fillColor = base.withBrightness(0.86)
        front.strokeColor = base.withBrightness(0.7)
        front.lineWidth = 1
        node.addChild(front)

        let top = SKShapeNode(rect: CGRect(x: -size.width / 2, y: h, width: size.width, height: max(4, size.height)), cornerRadius: 4)
        top.fillColor = base
        top.strokeColor = base.withBrightness(0.75)
        top.lineWidth = 1
        node.addChild(top)

        if entry?.kind == "gift" {
            let ribbon = SKShapeNode(rect: CGRect(x: -1.5, y: 0, width: 3, height: h + max(4, size.height)))
            ribbon.fillColor = UIColor(hex: 0xC9785B)
            ribbon.strokeColor = .clear
            node.addChild(ribbon)
        }
        if assetId?.contains("lamp") == true || assetId?.contains("lantern") == true || assetId?.contains("candle") == true {
            let glow = SKShapeNode(circleOfRadius: max(10, size.width * 0.8))
            glow.fillColor = Theme.UI.glow.withAlphaComponent(0.18)
            glow.strokeColor = .clear
            glow.position = CGPoint(x: 0, y: h + size.height / 2)
            glow.zPosition = -1
            glow.run(.repeatForever(.sequence([.fadeAlpha(to: 0.6, duration: 1.6), .fadeAlpha(to: 1, duration: 1.6)])))
            node.addChild(glow)
        }
        return node
    }

    /// A cottage seen from the fixed 3/4 camera.
    static func house(structureAssetId: String, scale: CGFloat = 1) -> SKNode {
        let n = SKNode()
        let w: CGFloat = 46 * scale, h: CGFloat = 30 * scale
        let shadow = SKShapeNode(ellipseOf: CGSize(width: w * 1.3, height: h * 0.5))
        shadow.fillColor = Theme.UI.shadow
        shadow.strokeColor = .clear
        n.addChild(shadow)
        let body = SKShapeNode(rect: CGRect(x: -w / 2, y: 0, width: w, height: h), cornerRadius: 2)
        body.fillColor = Theme.UI.wall
        body.strokeColor = Theme.UI.wallShade
        n.addChild(body)
        let roof = SKShapeNode(path: {
            let p = CGMutablePath()
            p.move(to: CGPoint(x: -w / 2 - 5 * scale, y: h))
            p.addLine(to: CGPoint(x: 0, y: h + 22 * scale))
            p.addLine(to: CGPoint(x: w / 2 + 5 * scale, y: h))
            p.closeSubpath()
            return p
        }())
        roof.fillColor = roofColor(structureAssetId)
        roof.strokeColor = roofColor(structureAssetId).withBrightness(0.8)
        n.addChild(roof)
        let door = SKShapeNode(rect: CGRect(x: -4 * scale, y: 0, width: 8 * scale, height: 14 * scale), cornerRadius: 2)
        door.fillColor = Theme.UI.ink.withAlphaComponent(0.75)
        door.strokeColor = .clear
        n.addChild(door)
        for x in [-14 * scale, 14 * scale] {
            let win = SKShapeNode(rect: CGRect(x: x - 4 * scale, y: 12 * scale, width: 8 * scale, height: 8 * scale), cornerRadius: 1.5)
            win.fillColor = Theme.UI.glow.withAlphaComponent(0.85)
            win.strokeColor = .clear
            n.addChild(win)
        }
        return n
    }

    static func tree(seed: Int, scale: CGFloat = 1) -> SKNode {
        let n = SKNode()
        let r = CGFloat(9 + abs(seed) % 7) * scale
        let trunk = SKShapeNode(rect: CGRect(x: -1.5 * scale, y: 0, width: 3 * scale, height: 7 * scale))
        trunk.fillColor = UIColor(hex: 0x8C6B4A)
        trunk.strokeColor = .clear
        n.addChild(trunk)
        let crown = SKShapeNode(ellipseOf: CGSize(width: r * 2, height: r * 2.3))
        crown.fillColor = seed % 3 == 0 ? Theme.UI.forestDark : Theme.UI.forest
        crown.strokeColor = .clear
        crown.position = CGPoint(x: 0, y: 7 * scale + r)
        n.addChild(crown)
        return n
    }
}

extension UIColor {
    func withBrightness(_ factor: CGFloat) -> UIColor {
        var h: CGFloat = 0, s: CGFloat = 0, b: CGFloat = 0, a: CGFloat = 0
        guard getHue(&h, saturation: &s, brightness: &b, alpha: &a) else { return self }
        return UIColor(hue: h, saturation: s, brightness: min(1, b * factor), alpha: a)
    }
}
