import Foundation

/// Human-facing strings for server codes. Quiet, factual language (no scores, no ranking).
public enum Copy {
    public static func plotLabel(_ code: String) -> String {
        switch code {
        case "closer_to_town": return "Closer to town"
        case "near_park": return "Near the park"
        case "near_neighbors": return "Near neighbors"
        case "quieter_edge": return "Quieter edge"
        case "forest_side": return "Forest side"
        default: return code.replacingOccurrences(of: "_", with: " ").capitalized
        }
    }

    private static let itemNames: [String: String] = [
        "furniture.bed.simple.001": "Simple bed",
        "furniture.chair.softwood.001": "Softwood chair",
        "furniture.table.round.001": "Round table",
        "decor.lamp.paper.001": "Paper lamp",
        "furniture.sofa.small.001": "Small sofa",
        "furniture.shelf.low.001": "Low shelf",
        "furniture.desk.writing.001": "Writing desk",
        "decor.rug.woven.001": "Woven rug",
        "furniture.bench.garden.001": "Garden bench",
        "decor.clock.wall.001": "Wall clock",
        "plant.monstera.001": "Monstera",
        "decor.stove.wood.001": "Wood stove",
        "gift.flower.vase.001": "Flowers in a vase",
        "gift.teacup.001": "Teacup",
        "gift.candle.001": "Candle",
        "gift.book.stack.001": "Stack of books",
        "gift.fern.potted.001": "Potted fern",
        "gift.cushion.001": "Cushion",
        "gift.lantern.small.001": "Small lantern",
        "gift.music-box.001": "Music box",
        "gift.pebble.smooth.001": "Smooth pebble",
        "gift.snow-globe.001": "Snow globe",
        "structure.home.cottage.a": "Cottage (warm)",
        "structure.home.cottage.b": "Cottage (moss)",
        "structure.home.cottage.c": "Cottage (slate)",
    ]

    public static func itemName(_ key: String?) -> String {
        guard let key else { return "Something" }
        if let n = itemNames[key] { return n }
        let parts = key.split(separator: ".")
        let core = parts.count >= 3 ? parts[parts.count - 2] : parts.last ?? Substring(key)
        return core.replacingOccurrences(of: "-", with: " ").capitalized
    }

    public static func errorMessage(_ error: Error) -> String {
        (error as? APIError)?.userMessage ?? "Something went wrong."
    }

    public static let currencyName = "coins" // DEV_PLACEHOLDER: world currency name is an open product value
}
