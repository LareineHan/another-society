import Foundation

// Codable mirrors of the OpenAPI v0.3.1 contract (packages/api-contract/openapi.yaml).
// Every type is verified against real server responses in Tests/ASKitTests/Fixtures.
// IDs stay opaque Strings (server UUIDs); never parse or derive meaning from them.

public typealias EntityID = String

// MARK: - Auth

public struct AuthResponse: Codable, Sendable {
    public let accessToken: String
    public let refreshToken: String
    public let expiresIn: Int
    public let userId: EntityID
    public let isNewAccount: Bool

    enum CodingKeys: String, CodingKey {
        case accessToken = "access_token", refreshToken = "refresh_token", expiresIn = "expires_in"
        case userId = "user_id", isNewAccount = "is_new_account"
    }
}

public struct AppleAuthRequest: Encodable, Sendable {
    public let identityToken: String
    public let authorizationCode: String
    public let nonce: String
    public let deviceLabel: String?

    enum CodingKeys: String, CodingKey {
        case identityToken = "identity_token", authorizationCode = "authorization_code", nonce, deviceLabel = "device_label"
    }
}

struct RefreshRequest: Encodable {
    let refreshToken: String
    enum CodingKeys: String, CodingKey { case refreshToken = "refresh_token" }
}

// MARK: - Account / resident

public enum AccountStatus: String, Codable, Sendable { case active, suspended, deleting, deleted }

public enum OnboardingState: String, Codable, Sendable {
    case choosingPlot = "choosing_plot", claimed, complete
}

/// A Mini assembled only from approved parts. Empty object for a brand-new resident.
public struct MiniDefinition: Codable, Hashable, Sendable {
    public var version: Int?
    public var body: String?
    public var skin: String?
    public var hair: String?
    public var hairColor: String?
    public var outfit: String?
    public var outfitColor: String?
    public var accessory: String?

    public init(version: Int? = 1, body: String? = nil, skin: String? = nil, hair: String? = nil, hairColor: String? = nil,
                outfit: String? = nil, outfitColor: String? = nil, accessory: String? = nil) {
        self.version = version; self.body = body; self.skin = skin; self.hair = hair; self.hairColor = hairColor
        self.outfit = outfit; self.outfitColor = outfitColor; self.accessory = accessory
    }

    public var isEmpty: Bool { body == nil && skin == nil && hair == nil && outfit == nil }

    enum CodingKeys: String, CodingKey {
        case version, body, skin, hair, hairColor = "hair_color", outfit, outfitColor = "outfit_color", accessory
    }
}

public struct PrimaryHome: Codable, Hashable, Sendable {
    public let propertyId: EntityID
    public let spaceId: EntityID
    public let plotId: EntityID
    public let cityId: EntityID
    enum CodingKeys: String, CodingKey { case propertyId = "property_id", spaceId = "space_id", plotId = "plot_id", cityId = "city_id" }
}

public struct Resident: Codable, Identifiable, Sendable {
    public let id: EntityID
    public let displayName: String
    public let publicTag: String
    public let miniDefinition: MiniDefinition
    public let onboardingState: OnboardingState
    public let primaryHome: PrimaryHome?

    enum CodingKeys: String, CodingKey {
        case id, displayName = "display_name", publicTag = "public_tag", miniDefinition = "mini_definition"
        case onboardingState = "onboarding_state", primaryHome = "primary_home"
    }
}

public struct ActiveStay: Codable, Hashable, Sendable {
    public let id: EntityID
    public let spaceId: EntityID
    public let hostPropertyId: EntityID
    public let startedAt: Date
    enum CodingKeys: String, CodingKey { case id, spaceId = "space_id", hostPropertyId = "host_property_id", startedAt = "started_at" }
}

public struct MeResponse: Codable, Sendable {
    public let userId: EntityID
    public let accountStatus: AccountStatus
    public let resident: Resident?
    public let activeStay: ActiveStay?
    enum CodingKeys: String, CodingKey { case userId = "user_id", accountStatus = "account_status", resident, activeStay = "active_stay" }
}

struct ResidentPatch: Encodable {
    let displayName: String
    enum CodingKeys: String, CodingKey { case displayName = "display_name" }
}

struct MiniUpdate: Encodable { let definition: MiniDefinition }

// MARK: - World

public struct CitySummary: Codable, Identifiable, Hashable, Sendable {
    public let id: EntityID
    public let displayName: String
    public let status: String
    public let activationRevision: Int?
    public let theme: String?
    enum CodingKeys: String, CodingKey { case id, displayName = "display_name", status, activationRevision = "activation_revision", theme }
}

public struct AssetPackRef: Codable, Sendable {
    public let packId: String?
    public let version: Int?
    public let manifestUrl: String?
    public let sha256: String?
    enum CodingKeys: String, CodingKey { case packId = "pack_id", version, manifestUrl = "manifest_url", sha256 }
}

public struct WorldBootstrap: Codable, Sendable {
    public let worldId: EntityID
    public let rulesVersion: Int
    public let cities: [CitySummary]
    public let assetPacks: [AssetPackRef]
    public let features: [String: Bool]
    enum CodingKeys: String, CodingKey { case worldId = "world_id", rulesVersion = "rules_version", cities, assetPacks = "asset_packs", features }
}

/// Integer fixed-point world coordinate (1000 units = one tile).
public struct PointU: Codable, Hashable, Sendable {
    public var xU: Int
    public var yU: Int
    public init(xU: Int, yU: Int) { self.xU = xU; self.yU = yU }
    public var world: WorldPoint { WorldPoint(x: xU, y: yU) }
    enum CodingKeys: String, CodingKey { case xU = "x_u", yU = "y_u" }
}

public struct BuildBounds: Codable, Hashable, Sendable { public let points: [PointU] }

public enum PlotStatus: String, Codable, Sendable { case latent, vacant, reserved, occupied, retired }

public struct PlotSummary: Codable, Identifiable, Hashable, Sendable {
    public let id: EntityID
    public let status: PlotStatus
    public let centerXU: Int
    public let centerYU: Int
    public let terrainType: String
    public let zoneType: String
    public let scenicTags: [String]?
    public let buildBounds: BuildBounds?
    public let chunkX: Int?
    public let chunkY: Int?
    public let frontageNodeId: EntityID?
    public let labels: [String]?
    public let reservedByMe: Bool?

    public var center: WorldPoint { WorldPoint(x: centerXU, y: centerYU) }

    enum CodingKeys: String, CodingKey {
        case id, status, centerXU = "center_x_u", centerYU = "center_y_u", terrainType = "terrain_type", zoneType = "zone_type"
        case scenicTags = "scenic_tags", buildBounds = "build_bounds", chunkX = "chunk_x", chunkY = "chunk_y"
        case frontageNodeId = "frontage_node_id", labels, reservedByMe = "reserved_by_me"
    }
}

public enum AccessMode: String, Codable, Sendable, CaseIterable { case open, closed }

public struct PropertyPreview: Codable, Identifiable, Hashable, Sendable {
    public let id: EntityID
    public let plotId: EntityID
    public let structureAssetId: String
    public let accessMode: AccessMode
    public let awayAccessMode: AccessMode
    public let hasActiveStayers: Bool?
    public let structureXU: Int?
    public let structureYU: Int?
    public let structureRotQ: Int?

    enum CodingKeys: String, CodingKey {
        case id, plotId = "plot_id", structureAssetId = "structure_asset_id", accessMode = "access_mode"
        case awayAccessMode = "away_access_mode", hasActiveStayers = "has_active_stayers"
        case structureXU = "structure_x_u", structureYU = "structure_y_u", structureRotQ = "structure_rot_q"
    }
}

public struct ChunkSummary: Codable, Identifiable, Sendable {
    public let id: EntityID
    public let x: Int
    public let y: Int
    public let revision: Int
    public let plots: [PlotSummary]
    public let properties: [PropertyPreview]
}

public struct ChunksResponse: Codable, Sendable { public let chunks: [ChunkSummary] }
public struct OnboardingPlotsResponse: Codable, Sendable { public let plots: [PlotSummary] }

public struct RoadNode: Codable, Identifiable, Hashable, Sendable {
    public let id: EntityID
    public let xU: Int
    public let yU: Int
    public let nodeKind: String
    public var point: WorldPoint { WorldPoint(x: xU, y: yU) }
    enum CodingKeys: String, CodingKey { case id, xU = "x_u", yU = "y_u", nodeKind = "node_kind" }
}

public struct RoadEdge: Codable, Identifiable, Hashable, Sendable {
    public let id: EntityID
    public let fromNodeId: EntityID
    public let toNodeId: EntityID
    public let edgeKind: String?
    public let weightMilli: Int
    public let geometryPoints: [PointU]?
    enum CodingKeys: String, CodingKey {
        case id, fromNodeId = "from_node_id", toNodeId = "to_node_id", edgeKind = "edge_kind"
        case weightMilli = "weight_milli", geometryPoints = "geometry_points"
    }
}

public struct CivicAnchor: Codable, Identifiable, Hashable, Sendable {
    public let id: EntityID
    public let kind: String
    public let xU: Int
    public let yU: Int
    public let roadNodeId: EntityID
    public var point: WorldPoint { WorldPoint(x: xU, y: yU) }
    enum CodingKeys: String, CodingKey { case id, kind, xU = "x_u", yU = "y_u", roadNodeId = "road_node_id" }
}

public struct RoadGraphPayload: Codable, Sendable {
    public let cityId: EntityID
    public let activationRevision: Int
    public let nodes: [RoadNode]
    public let edges: [RoadEdge]
    public let civicAnchors: [CivicAnchor]
    enum CodingKeys: String, CodingKey {
        case cityId = "city_id", activationRevision = "activation_revision", nodes, edges, civicAnchors = "civic_anchors"
    }
}

public struct ReserveResponse: Codable, Sendable {
    public let requestId: String
    public let reservationId: EntityID
    public let expiresAt: Date
    public let revision: Int?
    enum CodingKeys: String, CodingKey { case requestId = "request_id", reservationId = "reservation_id", expiresAt = "expires_at", revision }
}

public struct ClaimRequest: Encodable, Sendable {
    public let reservationId: EntityID
    public let structureAssetId: String
    public let structureXU: Int
    public let structureYU: Int
    public let structureRotQ: Int
    public init(reservationId: EntityID, structureAssetId: String, structureXU: Int = 0, structureYU: Int = 0, structureRotQ: Int = 0) {
        self.reservationId = reservationId; self.structureAssetId = structureAssetId
        self.structureXU = structureXU; self.structureYU = structureYU; self.structureRotQ = structureRotQ
    }
    enum CodingKeys: String, CodingKey {
        case reservationId = "reservation_id", structureAssetId = "structure_asset_id"
        case structureXU = "structure_x_u", structureYU = "structure_y_u", structureRotQ = "structure_rot_q"
    }
}

public struct ClaimResponse: Codable, Sendable {
    public let requestId: String
    public let revision: Int?
    public let property: Property
    enum CodingKeys: String, CodingKey { case requestId = "request_id", revision, property }
}

// MARK: - Property / space

public struct PropertyOwner: Codable, Hashable, Sendable {
    public let id: EntityID
    public let displayName: String
    enum CodingKeys: String, CodingKey { case id, displayName = "display_name" }
}

public struct PropertyViewer: Codable, Hashable, Sendable {
    public let isOwner: Bool
    public let canEnter: Bool
    public let canStay: Bool
    enum CodingKeys: String, CodingKey { case isOwner = "is_owner", canEnter = "can_enter", canStay = "can_stay" }
}

public struct Property: Codable, Identifiable, Hashable, Sendable {
    public let id: EntityID
    public let plotId: EntityID
    public let ownerResidentId: EntityID
    public let propertyType: String?
    public let structureAssetId: String
    public let structureXU: Int?
    public let structureYU: Int?
    public let structureRotQ: Int?
    public let accessMode: AccessMode
    public let awayAccessMode: AccessMode
    public let allowStays: Bool
    public let stayCapacity: Int
    public let isPrimaryHome: Bool?
    public let hasActiveStayers: Bool?
    public let revision: Int
    public let owner: PropertyOwner?
    public let spaceIds: [EntityID]?
    public let viewer: PropertyViewer?
    public let ownerAway: Bool?

    enum CodingKeys: String, CodingKey {
        case id, plotId = "plot_id", ownerResidentId = "owner_resident_id", propertyType = "property_type"
        case structureAssetId = "structure_asset_id", structureXU = "structure_x_u", structureYU = "structure_y_u"
        case structureRotQ = "structure_rot_q", accessMode = "access_mode", awayAccessMode = "away_access_mode"
        case allowStays = "allow_stays", stayCapacity = "stay_capacity", isPrimaryHome = "is_primary_home"
        case hasActiveStayers = "has_active_stayers", revision, owner, spaceIds = "space_ids", viewer, ownerAway = "owner_away"
    }
}

public struct AccessUpdate: Encodable, Sendable {
    public var accessMode: AccessMode?
    public var awayAccessMode: AccessMode?
    public var allowStays: Bool?
    public var stayCapacity: Int?
    public var expectedRevision: Int?
    public init(accessMode: AccessMode? = nil, awayAccessMode: AccessMode? = nil, allowStays: Bool? = nil, stayCapacity: Int? = nil, expectedRevision: Int? = nil) {
        self.accessMode = accessMode; self.awayAccessMode = awayAccessMode; self.allowStays = allowStays
        self.stayCapacity = stayCapacity; self.expectedRevision = expectedRevision
    }
    enum CodingKeys: String, CodingKey {
        case accessMode = "access_mode", awayAccessMode = "away_access_mode", allowStays = "allow_stays"
        case stayCapacity = "stay_capacity", expectedRevision = "expected_revision"
    }
}

public struct SpaceBounds: Codable, Hashable, Sendable {
    public let minX: Int
    public let minY: Int
    public let maxX: Int
    public let maxY: Int
    public static let `default` = SpaceBounds(minX: 0, minY: 0, maxX: 12_000, maxY: 12_000)
    public init(minX: Int, minY: Int, maxX: Int, maxY: Int) { self.minX = minX; self.minY = minY; self.maxX = maxX; self.maxY = maxY }
    public func contains(_ p: WorldPoint) -> Bool { p.x >= minX && p.x <= maxX && p.y >= minY && p.y <= maxY }
    public func clamp(_ p: WorldPoint) -> WorldPoint { WorldPoint(x: min(max(p.x, minX), maxX), y: min(max(p.y, minY), maxY)) }
}

public struct Placement: Codable, Identifiable, Hashable, Sendable {
    public let placementId: EntityID?
    public var itemInstanceId: EntityID
    public var xU: Int
    public var yU: Int
    public var rotationQ: Int
    public var scaleMilli: Int?
    public var layer: Int?
    public var definitionKey: String?
    public var assetId: String?

    /// One active placement per item instance, so the item id is a stable identity.
    public var id: EntityID { itemInstanceId }
    public var point: WorldPoint { WorldPoint(x: xU, y: yU) }

    public init(itemInstanceId: EntityID, xU: Int, yU: Int, rotationQ: Int = 0, scaleMilli: Int? = 1000, layer: Int? = 0, definitionKey: String? = nil, assetId: String? = nil) {
        self.placementId = nil; self.itemInstanceId = itemInstanceId; self.xU = xU; self.yU = yU; self.rotationQ = rotationQ
        self.scaleMilli = scaleMilli; self.layer = layer; self.definitionKey = definitionKey; self.assetId = assetId
    }

    public var input: PlacementInput {
        PlacementInput(itemInstanceId: itemInstanceId, xU: xU, yU: yU, rotationQ: rotationQ, scaleMilli: scaleMilli ?? 1000, layer: layer ?? 0)
    }

    enum CodingKeys: String, CodingKey {
        case placementId = "id", itemInstanceId = "item_instance_id", xU = "x_u", yU = "y_u", rotationQ = "rotation_q"
        case scaleMilli = "scale_milli", layer, definitionKey = "definition_key", assetId = "asset_id"
    }
}

public struct PlacementInput: Codable, Hashable, Sendable {
    public let itemInstanceId: EntityID
    public let xU: Int
    public let yU: Int
    public let rotationQ: Int
    public let scaleMilli: Int
    public let layer: Int
    enum CodingKeys: String, CodingKey {
        case itemInstanceId = "item_instance_id", xU = "x_u", yU = "y_u", rotationQ = "rotation_q", scaleMilli = "scale_milli", layer
    }
}

struct LayoutRequest: Encodable {
    let expectedRevision: Int
    let placements: [PlacementInput]
    enum CodingKeys: String, CodingKey { case expectedRevision = "expected_revision", placements }
}

public struct Stayer: Codable, Identifiable, Hashable, Sendable {
    public let residentId: EntityID
    public let displayName: String
    public let miniDefinition: MiniDefinition
    public let startedAt: Date
    public var id: EntityID { residentId }
    enum CodingKeys: String, CodingKey { case residentId = "resident_id", displayName = "display_name", miniDefinition = "mini_definition", startedAt = "started_at" }
}

public struct PendingGiftPreview: Codable, Identifiable, Hashable, Sendable {
    public let id: EntityID
    public let itemInstanceId: EntityID
    public let dropXU: Int
    public let dropYU: Int
    public let assetId: String?
    public let definitionKey: String?
    enum CodingKeys: String, CodingKey {
        case id, itemInstanceId = "item_instance_id", dropXU = "drop_x_u", dropYU = "drop_y_u", assetId = "asset_id", definitionKey = "definition_key"
    }
}

public struct Space: Codable, Identifiable, Sendable {
    public let id: EntityID
    public let propertyId: EntityID
    public let spaceKind: String?
    public let layoutRevision: Int
    public let visitorCapacity: Int
    public let bounds: SpaceBounds?
    public let placements: [Placement]
    public let stayers: [Stayer]?
    public let pendingGifts: [PendingGiftPreview]?

    enum CodingKeys: String, CodingKey {
        case id, propertyId = "property_id", spaceKind = "space_kind", layoutRevision = "layout_revision"
        case visitorCapacity = "visitor_capacity", bounds, placements, stayers, pendingGifts = "pending_gifts"
    }
}

// MARK: - Social

public struct VisitInfo: Codable, Sendable { public let qualified: Bool }

public struct VisitResponse: Codable, Sendable {
    public let requestId: String
    public let property: Property
    public let spaces: [Space]
    public let visit: VisitInfo?
    enum CodingKeys: String, CodingKey { case requestId = "request_id", property, spaces, visit }
}

public struct VisitDay: Codable, Hashable, Sendable {
    public let day: String?
    public let band: String?
    public let count: Int?
}

public struct VisitSummary: Codable, Sendable {
    public let propertyId: EntityID
    public let windowDays: Int?
    public let band: String
    public let copy: String
    public let count: Int?
    public let days: [VisitDay]
    enum CodingKeys: String, CodingKey { case propertyId = "property_id", windowDays = "window_days", band, copy, count, days }
}

public struct MutationResponse: Codable, Sendable {
    public let requestId: String
    public let revision: Int?
    public let resourceId: EntityID?
    enum CodingKeys: String, CodingKey { case requestId = "request_id", revision, resourceId = "resource_id" }
}

public struct StayResponse: Codable, Sendable {
    public let requestId: String
    public let stayId: EntityID?
    public let resourceId: EntityID?
    enum CodingKeys: String, CodingKey { case requestId = "request_id", stayId = "stay_id", resourceId = "resource_id" }
}

public enum GiftStatus: String, Codable, Sendable {
    case pendingPlacement = "pending_placement", keptHere = "kept_here", putAway = "put_away", declined
}

public enum GiftAction: String, Encodable, Sendable {
    case keepHere = "keep_here", putAway = "put_away", decline
}

public struct GiftGiver: Codable, Hashable, Sendable {
    public let displayName: String
    public let linkable: Bool
    enum CodingKeys: String, CodingKey { case displayName = "display_name", linkable }
}

public struct Gift: Codable, Identifiable, Hashable, Sendable {
    public let id: EntityID
    public let giverResidentId: EntityID
    public let recipientResidentId: EntityID
    public let itemInstanceId: EntityID
    public let status: GiftStatus
    public let createdAt: Date
    public let resolvedAt: Date?
    public let propertyId: EntityID
    public let spaceId: EntityID
    public let dropXU: Int
    public let dropYU: Int
    public let giver: GiftGiver?
    public let assetId: String?
    public let definitionKey: String?

    enum CodingKeys: String, CodingKey {
        case id, giverResidentId = "giver_resident_id", recipientResidentId = "recipient_resident_id"
        case itemInstanceId = "item_instance_id", status, createdAt = "created_at", resolvedAt = "resolved_at"
        case propertyId = "property_id", spaceId = "space_id", dropXU = "drop_x_u", dropYU = "drop_y_u"
        case giver, assetId = "asset_id", definitionKey = "definition_key"
    }
}

public struct GiftInbox: Codable, Sendable { public let items: [Gift] }

struct GiftRequest: Encodable {
    let propertyId: EntityID
    let spaceId: EntityID
    let itemInstanceId: EntityID
    let dropXU: Int
    let dropYU: Int
    enum CodingKeys: String, CodingKey {
        case propertyId = "property_id", spaceId = "space_id", itemInstanceId = "item_instance_id", dropXU = "drop_x_u", dropYU = "drop_y_u"
    }
}

struct GiftResolveRequest: Encodable { let action: GiftAction }
struct BlockRequest: Encodable {
    let residentId: EntityID
    enum CodingKeys: String, CodingKey { case residentId = "resident_id" }
}

public enum ReportTarget: String, Encodable, Sendable { case resident, property, item }

struct ReportRequest: Encodable {
    let targetType: ReportTarget
    let targetId: EntityID
    let reasonCode: String
    let details: String?
    enum CodingKeys: String, CodingKey { case targetType = "target_type", targetId = "target_id", reasonCode = "reason_code", details }
}

public struct WanderItem: Codable, Identifiable, Hashable, Sendable {
    public let id: EntityID
    public let plotId: EntityID
    public let structureAssetId: String
    public let accessMode: AccessMode
    public let awayAccessMode: AccessMode
    public let hasActiveStayers: Bool?
    public let centerXU: Int
    public let centerYU: Int
    public let frontageNodeId: EntityID?
    public var center: WorldPoint { WorldPoint(x: centerXU, y: centerYU) }
    enum CodingKeys: String, CodingKey {
        case id, plotId = "plot_id", structureAssetId = "structure_asset_id", accessMode = "access_mode"
        case awayAccessMode = "away_access_mode", hasActiveStayers = "has_active_stayers"
        case centerXU = "center_x_u", centerYU = "center_y_u", frontageNodeId = "frontage_node_id"
    }
}

public struct WanderResponse: Codable, Sendable { public let properties: [WanderItem] }

// MARK: - Economy

public struct ItemInstance: Codable, Identifiable, Hashable, Sendable {
    public let id: EntityID
    public let definitionId: EntityID
    public let state: String
    public let provenance: [String: JSONValue]?
    public let definitionKey: String?
    public let assetId: String?
    public let category: String?
    public let giftEligible: Bool?

    public var isPlaceable: Bool { state == "inventory" || state == "placed" }
    public var canGift: Bool { state == "inventory" && giftEligible == true }

    enum CodingKeys: String, CodingKey {
        case id, definitionId = "definition_id", state, provenance, definitionKey = "definition_key"
        case assetId = "asset_id", category, giftEligible = "gift_eligible"
    }
}

public struct InventoryResponse: Codable, Sendable { public let items: [ItemInstance] }

public struct Wallet: Codable, Hashable, Sendable {
    public let currencyCode: String
    public let balance: Int
    enum CodingKeys: String, CodingKey { case currencyCode = "currency_code", balance }
}

public struct StoreListing: Codable, Identifiable, Hashable, Sendable {
    public let id: EntityID
    public let itemDefinitionId: EntityID
    public let unitPrice: Int
    public let stockQuantity: Int?
    public let status: String
    public let definitionKey: String?
    public let assetId: String?
    public let category: String?
    public let giftEligible: Bool?
    enum CodingKeys: String, CodingKey {
        case id, itemDefinitionId = "item_definition_id", unitPrice = "unit_price", stockQuantity = "stock_quantity", status
        case definitionKey = "definition_key", assetId = "asset_id", category, giftEligible = "gift_eligible"
    }
}

public struct CatalogResponse: Codable, Sendable { public let listings: [StoreListing] }

struct PurchaseRequest: Encodable {
    let listingId: EntityID
    let quantity: Int
    enum CodingKeys: String, CodingKey { case listingId = "listing_id", quantity }
}

public struct PurchaseResponse: Codable, Sendable {
    public let requestId: String
    public let transactionId: EntityID
    public let wallet: Wallet
    public let items: [ItemInstance]
    enum CodingKeys: String, CodingKey { case requestId = "request_id", transactionId = "transaction_id", wallet, items }
}

// MARK: - Errors

public struct APIErrorBody: Codable, Sendable {
    public let requestId: String?
    public let code: String
    public let message: String
    public let details: [String: JSONValue]?
    enum CodingKeys: String, CodingKey { case requestId = "request_id", code, message, details }
}
