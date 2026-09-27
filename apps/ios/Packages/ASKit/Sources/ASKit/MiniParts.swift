import Foundation

/// Approved Mini parts (mirrors packages/domain/src/mini.ts; the server rejects anything else).
/// DEV_PLACEHOLDER catalog until the Mini art set exists.
public enum MiniSlot: String, CaseIterable, Sendable, Identifiable {
    case body, skin, hair, hairColor = "hair_color", outfit, outfitColor = "outfit_color", accessory
    public var id: String { rawValue }

    public var title: String {
        switch self {
        case .body: return "Shape"
        case .skin: return "Skin"
        case .hair: return "Hair"
        case .hairColor: return "Hair color"
        case .outfit: return "Outfit"
        case .outfitColor: return "Outfit color"
        case .accessory: return "Extra"
        }
    }

    public var parts: [String] {
        switch self {
        case .body: return ["mini.body.a", "mini.body.b", "mini.body.c"]
        case .skin: return (1...6).map { "mini.skin.\($0)" }
        case .hair: return ["mini.hair.none", "mini.hair.short", "mini.hair.bob", "mini.hair.long", "mini.hair.bun", "mini.hair.curly"]
        case .hairColor: return ["mini.haircolor.black", "mini.haircolor.brown", "mini.haircolor.blond", "mini.haircolor.red", "mini.haircolor.grey", "mini.haircolor.blue"]
        case .outfit: return ["mini.outfit.sweater", "mini.outfit.coat", "mini.outfit.overalls", "mini.outfit.dress", "mini.outfit.hoodie"]
        case .outfitColor: return ["mini.palette.oat", "mini.palette.moss", "mini.palette.clay", "mini.palette.sky", "mini.palette.plum", "mini.palette.ink"]
        case .accessory: return ["mini.acc.none", "mini.acc.glasses", "mini.acc.scarf", "mini.acc.hat", "mini.acc.bag"]
        }
    }
}

public extension MiniDefinition {
    static let starter = MiniDefinition(version: 1, body: "mini.body.a", skin: "mini.skin.3", hair: "mini.hair.short",
                                        hairColor: "mini.haircolor.brown", outfit: "mini.outfit.sweater",
                                        outfitColor: "mini.palette.oat", accessory: "mini.acc.none")

    subscript(slot: MiniSlot) -> String? {
        get {
            switch slot {
            case .body: return body
            case .skin: return skin
            case .hair: return hair
            case .hairColor: return hairColor
            case .outfit: return outfit
            case .outfitColor: return outfitColor
            case .accessory: return accessory
            }
        }
        set {
            switch slot {
            case .body: body = newValue
            case .skin: skin = newValue
            case .hair: hair = newValue
            case .hairColor: hairColor = newValue
            case .outfit: outfit = newValue
            case .outfitColor: outfitColor = newValue
            case .accessory: accessory = newValue
            }
        }
    }

    /// Fill empty slots with the starter look (a brand-new resident has `{}`).
    var resolved: MiniDefinition {
        var m = self
        for slot in MiniSlot.allCases where m[slot] == nil { m[slot] = MiniDefinition.starter[slot] }
        m.version = 1
        return m
    }
}
