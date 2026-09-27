import Foundation

/// Platform-neutral asset manifest (packages/asset-manifest). The core pack ships in the app bundle so
/// the first experience never depends on downloading the world shell (Blueprint §39).
public struct AssetEntry: Codable, Hashable, Sendable {
    public struct Anchor: Codable, Hashable, Sendable { public let x: Double; public let y: Double }
    public struct Footprint: Codable, Hashable, Sendable { public let w: Int; public let d: Int }

    public let assetId: String
    public let kind: String
    public let spriteKey: String
    public let anchor: Anchor
    public let footprintU: Footprint
    public let renderLayer: Int
    public let rotations: [Int]
    public let giftEligible: Bool
    public let contentRating: String

    /// Placements persist quarter turns; a turn is allowed only if the manifest lists it in degrees.
    public func allows(rotationQ: Int) -> Bool { rotations.contains(rotationQ * 90) }

    /// Next allowed quarter turn after `current` (wraps). Returns current if the asset cannot turn.
    public func nextRotation(after current: Int) -> Int {
        for step in 1...4 {
            let q = (current + step) % 4
            if allows(rotationQ: q) { return q }
        }
        return current
    }

    enum CodingKeys: String, CodingKey {
        case assetId = "asset_id", kind, spriteKey = "sprite_key", anchor, footprintU = "footprint_u"
        case renderLayer = "render_layer", rotations, giftEligible = "gift_eligible", contentRating = "content_rating"
    }
}

public struct AssetPack: Codable, Sendable {
    public let packId: String
    public let packVersion: String
    public let assets: [AssetEntry]
    enum CodingKeys: String, CodingKey { case packId = "pack_id", packVersion = "pack_version", assets }
}

public final class AssetCatalog: Sendable {
    public static let shared = AssetCatalog()
    public let pack: AssetPack?
    private let byId: [String: AssetEntry]

    public init(bundle: Bundle? = nil, resource: String = "core-dev.v1") {
        if let url = (bundle ?? Bundle.module).url(forResource: resource, withExtension: "json"),
           let data = try? Data(contentsOf: url),
           let pack = try? JSONDecoder().decode(AssetPack.self, from: data) {
            self.pack = pack
            var m: [String: AssetEntry] = [:]
            for a in pack.assets { m[a.assetId] = a }
            byId = m
        } else {
            pack = nil
            byId = [:]
        }
    }

    public func asset(_ id: String?) -> AssetEntry? { id.flatMap { byId[$0] } }
    public var structures: [AssetEntry] { pack?.assets.filter { $0.kind == "structure" } ?? [] }
}
