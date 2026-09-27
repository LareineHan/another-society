import SwiftUI
import SpriteKit
import UIKit
import ASKit

/// Maps approved Mini part ids to placeholder colors/shapes. Replace with the Mini sprite set later.
struct MiniLook {
    let skin: UIColor
    let hair: UIColor
    let outfit: UIColor
    let hairStyle: String
    let outfitStyle: String
    let bodyWidth: CGFloat
    let accessory: String

    init(_ def: MiniDefinition) {
        let m = def.resolved
        let skins: [String: UInt32] = ["mini.skin.1": 0xF6DCC8, "mini.skin.2": 0xEBC4A4, "mini.skin.3": 0xD9A77F,
                                       "mini.skin.4": 0xB9825C, "mini.skin.5": 0x8D5B3E, "mini.skin.6": 0x5E3B28]
        let hairs: [String: UInt32] = ["mini.haircolor.black": 0x2E2A28, "mini.haircolor.brown": 0x6B4A33, "mini.haircolor.blond": 0xD8B36A,
                                       "mini.haircolor.red": 0xA8553A, "mini.haircolor.grey": 0x9A9690, "mini.haircolor.blue": 0x5E7FA8]
        let outfits: [String: UInt32] = ["mini.palette.oat": 0xE6D5B8, "mini.palette.moss": 0x7C9A6B, "mini.palette.clay": 0xC98B6B,
                                         "mini.palette.sky": 0x9DB8C9, "mini.palette.plum": 0x8E6F8F, "mini.palette.ink": 0x3F4552]
        skin = UIColor(hex: skins[m.skin ?? ""] ?? 0xD9A77F)
        hair = UIColor(hex: hairs[m.hairColor ?? ""] ?? 0x6B4A33)
        outfit = UIColor(hex: outfits[m.outfitColor ?? ""] ?? 0xE6D5B8)
        hairStyle = m.hair ?? "mini.hair.short"
        outfitStyle = m.outfit ?? "mini.outfit.sweater"
        bodyWidth = m.body == "mini.body.b" ? 1.15 : (m.body == "mini.body.c" ? 0.9 : 1)
        accessory = m.accessory ?? "mini.acc.none"
    }
}

/// SwiftUI rendering of a Mini (editor, lists).
struct MiniFigure: View {
    let definition: MiniDefinition
    var body: some View {
        Canvas { ctx, size in
            let look = MiniLook(definition)
            let u = min(size.width, size.height) / 100
            let cx = size.width / 2
            // shadow
            ctx.fill(Path(ellipseIn: CGRect(x: cx - 22 * u, y: 90 * u, width: 44 * u, height: 8 * u)), with: .color(.black.opacity(0.1)))
            // body
            let bw = 36 * u * look.bodyWidth
            let bodyRect = CGRect(x: cx - bw / 2, y: 48 * u, width: bw, height: 44 * u)
            let bodyPath = look.outfitStyle.contains("dress")
                ? Path { p in p.move(to: CGPoint(x: cx - bw / 2 + 6 * u, y: 48 * u)); p.addLine(to: CGPoint(x: cx + bw / 2 - 6 * u, y: 48 * u)); p.addLine(to: CGPoint(x: cx + bw / 2 + 4 * u, y: 92 * u)); p.addLine(to: CGPoint(x: cx - bw / 2 - 4 * u, y: 92 * u)); p.closeSubpath() }
                : Path(roundedRect: bodyRect, cornerRadius: 12 * u)
            ctx.fill(bodyPath, with: .color(Color(uiColor: look.outfit)))
            if look.accessory.contains("scarf") {
                ctx.fill(Path(roundedRect: CGRect(x: cx - bw / 2 + 2 * u, y: 46 * u, width: bw - 4 * u, height: 8 * u), cornerRadius: 4 * u), with: .color(Color(hex: 0xC98B6B)))
            }
            // head
            let head = CGRect(x: cx - 20 * u, y: 10 * u, width: 40 * u, height: 40 * u)
            ctx.fill(Path(ellipseIn: head), with: .color(Color(uiColor: look.skin)))
            // hair
            if !look.hairStyle.contains("none") {
                var hair = Path()
                hair.addArc(center: CGPoint(x: cx, y: 30 * u), radius: 21 * u, startAngle: .degrees(190), endAngle: .degrees(350), clockwise: false)
                if look.hairStyle.contains("long") || look.hairStyle.contains("bob") {
                    let drop: CGFloat = look.hairStyle.contains("long") ? 40 : 22
                    hair.addRect(CGRect(x: cx - 21 * u, y: 26 * u, width: 6 * u, height: drop * u))
                    hair.addRect(CGRect(x: cx + 15 * u, y: 26 * u, width: 6 * u, height: drop * u))
                }
                if look.hairStyle.contains("bun") { hair.addEllipse(in: CGRect(x: cx - 8 * u, y: 0, width: 16 * u, height: 14 * u)) }
                if look.hairStyle.contains("curly") {
                    for i in 0..<5 { hair.addEllipse(in: CGRect(x: cx - 22 * u + CGFloat(i) * 9 * u, y: 6 * u, width: 12 * u, height: 12 * u)) }
                }
                ctx.fill(hair, with: .color(Color(uiColor: look.hair)))
            }
            // face (restrained detail)
            for dx in [-7.0, 7.0] { ctx.fill(Path(ellipseIn: CGRect(x: cx + dx * u - 2 * u, y: 30 * u, width: 4 * u, height: 4 * u)), with: .color(Theme.ink)) }
            if look.accessory.contains("glasses") {
                for dx in [-7.0, 7.0] { ctx.stroke(Path(ellipseIn: CGRect(x: cx + dx * u - 5 * u, y: 27 * u, width: 10 * u, height: 10 * u)), with: .color(Theme.ink), lineWidth: 1.2 * u) }
            }
            if look.accessory.contains("hat") {
                ctx.fill(Path(roundedRect: CGRect(x: cx - 24 * u, y: 10 * u, width: 48 * u, height: 6 * u), cornerRadius: 3 * u), with: .color(Color(hex: 0x6F7C85)))
                ctx.fill(Path(roundedRect: CGRect(x: cx - 14 * u, y: 0, width: 28 * u, height: 12 * u), cornerRadius: 4 * u), with: .color(Color(hex: 0x6F7C85)))
            }
            if look.accessory.contains("bag") {
                ctx.fill(Path(roundedRect: CGRect(x: cx + bw / 2 - 4 * u, y: 66 * u, width: 12 * u, height: 14 * u), cornerRadius: 3 * u), with: .color(Color(hex: 0xB78C5A)))
            }
        }
        .aspectRatio(1, contentMode: .fit)
        .accessibilityLabel("Mini")
    }
}

/// SpriteKit rendering of a Mini (city travel, rooms). Small ambient breathing loop only.
enum MiniSprite {
    static func node(_ def: MiniDefinition, scale: CGFloat = 1, sitting: Bool = false) -> SKNode {
        let look = MiniLook(def)
        let n = SKNode()
        let shadow = SKShapeNode(ellipseOf: CGSize(width: 16 * scale, height: 5 * scale))
        shadow.fillColor = Theme.UI.shadow
        shadow.strokeColor = .clear
        n.addChild(shadow)
        let figure = SKNode()
        let bodyH: CGFloat = sitting ? 9 : 14
        let body = SKShapeNode(rect: CGRect(x: -6 * scale * look.bodyWidth, y: 0, width: 12 * scale * look.bodyWidth, height: bodyH * scale), cornerRadius: 4 * scale)
        body.fillColor = look.outfit
        body.strokeColor = look.outfit.withBrightness(0.8)
        figure.addChild(body)
        let head = SKShapeNode(circleOfRadius: 6.5 * scale)
        head.fillColor = look.skin
        head.strokeColor = look.skin.withBrightness(0.85)
        head.position = CGPoint(x: 0, y: (bodyH + 5) * scale)
        figure.addChild(head)
        if !look.hairStyle.contains("none") {
            let hair = SKShapeNode(path: {
                let p = CGMutablePath()
                p.addArc(center: .zero, radius: 7 * scale, startAngle: 0.1, endAngle: .pi - 0.1, clockwise: false)
                p.closeSubpath()
                return p
            }())
            hair.fillColor = look.hair
            hair.strokeColor = .clear
            hair.position = head.position
            figure.addChild(hair)
        }
        n.addChild(figure)
        figure.run(.repeatForever(.sequence([.scaleY(to: 1.03, duration: 1.4), .scaleY(to: 1, duration: 1.4)])))
        return n
    }
}
