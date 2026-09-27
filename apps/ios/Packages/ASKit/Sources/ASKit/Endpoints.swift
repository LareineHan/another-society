import Foundation

/// Typed wrappers for every v1 operation the client uses. Mutations that move ownership, money or
/// presence take an idempotency key created by the caller for one user intent.
public extension APIClient {
    // MARK: Auth / account

    func signInWithApple(identityToken: String, authorizationCode: String, rawNonce: String, deviceLabel: String?) async throws -> AuthResponse {
        let body = AppleAuthRequest(identityToken: identityToken, authorizationCode: authorizationCode, nonce: rawNonce, deviceLabel: deviceLabel)
        let auth: AuthResponse = try await send(.json("POST", "/v1/auth/apple", body, requiresAuth: false))
        store(auth)
        return auth
    }

    func signOut(allDevices: Bool = false) async {
        _ = try? await perform(Endpoint("POST", "/v1/auth/logout", query: allDevices ? [URLQueryItem(name: "all", value: "true")] : []), allowRefresh: false)
        clearSession()
    }

    func me() async throws -> MeResponse { try await send(Endpoint("GET", "/v1/me")) }

    func updateDisplayName(_ name: String) async throws -> Resident {
        try await send(.json("PATCH", "/v1/resident", ResidentPatch(displayName: name)))
    }

    func updateMini(_ mini: MiniDefinition) async throws -> Resident {
        try await send(.json("PUT", "/v1/resident/mini", MiniUpdate(definition: mini)))
    }

    /// Blueprint §15: sessions are revoked server-side immediately; clear local state too.
    func deleteAccount(key: String) async throws {
        _ = try await perform(Endpoint("DELETE", "/v1/account", idempotencyKey: key))
        clearSession()
    }

    // MARK: World

    func bootstrap() async throws -> WorldBootstrap { try await send(Endpoint("GET", "/v1/world/bootstrap")) }

    func chunks(cityId: EntityID, window: ChunkRect) async throws -> ChunksResponse {
        try await send(Endpoint("GET", "/v1/cities/\(cityId)/chunks", query: [
            URLQueryItem(name: "minX", value: String(window.minX)), URLQueryItem(name: "minY", value: String(window.minY)),
            URLQueryItem(name: "maxX", value: String(window.maxX)), URLQueryItem(name: "maxY", value: String(window.maxY)),
        ]))
    }

    /// Road graph with ETag caching keyed to the city's activation revision.
    func roads(cityId: EntityID) async throws -> RoadGraphPayload {
        let path = "/v1/cities/\(cityId)/roads"
        var ep = Endpoint("GET", path)
        if let cached = etags[path] { ep.headers["If-None-Match"] = cached.etag }
        let raw = try await perform(ep)
        let data: Data
        if raw.status == 304, let cached = etags[path] {
            data = cached.data
        } else {
            data = raw.data
            if let tag = raw.headers["etag"] { etags[path] = (tag, raw.data) }
        }
        do { return try ASJSON.decoder().decode(RoadGraphPayload.self, from: data) }
        catch { throw APIError.decoding("roads: \(error)") }
    }

    func onboardingPlots(cityId: EntityID) async throws -> [PlotSummary] {
        let r: OnboardingPlotsResponse = try await send(Endpoint("GET", "/v1/onboarding/plots", query: [URLQueryItem(name: "city_id", value: cityId)]))
        return r.plots
    }

    func reservePlot(_ plotId: EntityID, key: String) async throws -> ReserveResponse {
        try await send(Endpoint("POST", "/v1/plots/\(plotId)/reserve", idempotencyKey: key))
    }

    func claimPlot(_ plotId: EntityID, _ request: ClaimRequest, key: String) async throws -> ClaimResponse {
        try await send(.json("POST", "/v1/plots/\(plotId)/claim", request, idempotencyKey: key))
    }

    func wander(cityId: EntityID, near: WorldPoint?, limit: Int = 5) async throws -> [WanderItem] {
        var q = [URLQueryItem(name: "city_id", value: cityId), URLQueryItem(name: "limit", value: String(limit))]
        if let near { q += [URLQueryItem(name: "x_u", value: String(near.x)), URLQueryItem(name: "y_u", value: String(near.y))] }
        let r: WanderResponse = try await send(Endpoint("GET", "/v1/wander", query: q))
        return r.properties
    }

    // MARK: Property / space

    func property(_ id: EntityID) async throws -> Property { try await send(Endpoint("GET", "/v1/properties/\(id)")) }

    func updateAccess(_ propertyId: EntityID, _ update: AccessUpdate) async throws -> Property {
        try await send(.json("PATCH", "/v1/properties/\(propertyId)/access", update))
    }

    func space(_ id: EntityID) async throws -> Space { try await send(Endpoint("GET", "/v1/spaces/\(id)")) }

    /// Owner-only canonical layout replace. Throws `revision_conflict` (with currentRevision) on a stale save.
    func saveLayout(spaceId: EntityID, expectedRevision: Int, placements: [Placement], key: String) async throws -> Space {
        try await send(.json("PUT", "/v1/spaces/\(spaceId)/layout", LayoutRequest(expectedRevision: expectedRevision, placements: placements.map(\.input)), idempotencyKey: key))
    }

    func visitSummary(_ propertyId: EntityID) async throws -> VisitSummary {
        try await send(Endpoint("GET", "/v1/properties/\(propertyId)/visits/summary"))
    }

    // MARK: Social

    /// Call on entering, and again after the dwell threshold; the server qualifies the visit.
    func visit(_ propertyId: EntityID) async throws -> VisitResponse {
        try await send(Endpoint("POST", "/v1/properties/\(propertyId)/visit"))
    }

    func stay(spaceId: EntityID, key: String) async throws -> StayResponse {
        try await send(Endpoint("POST", "/v1/spaces/\(spaceId)/stay", idempotencyKey: key))
    }

    func leaveStay(key: String) async throws { _ = try await perform(Endpoint("DELETE", "/v1/stay", idempotencyKey: key)) }

    func sendHome(spaceId: EntityID, residentId: EntityID, key: String) async throws {
        _ = try await perform(Endpoint("DELETE", "/v1/spaces/\(spaceId)/stays/\(residentId)", idempotencyKey: key))
    }

    func leaveGift(propertyId: EntityID, spaceId: EntityID, itemId: EntityID, drop: WorldPoint, key: String) async throws -> Gift {
        try await send(.json("POST", "/v1/gifts", GiftRequest(propertyId: propertyId, spaceId: spaceId, itemInstanceId: itemId, dropXU: drop.x, dropYU: drop.y), idempotencyKey: key))
    }

    func giftInbox(status: GiftStatus = .pendingPlacement) async throws -> [Gift] {
        let r: GiftInbox = try await send(Endpoint("GET", "/v1/gifts/inbox", query: [URLQueryItem(name: "status", value: status.rawValue)]))
        return r.items
    }

    func resolveGift(_ giftId: EntityID, _ action: GiftAction, key: String) async throws -> Gift {
        try await send(.json("POST", "/v1/gifts/\(giftId)/resolve", GiftResolveRequest(action: action), idempotencyKey: key))
    }

    func block(_ residentId: EntityID) async throws { _ = try await perform(.json("POST", "/v1/blocks", BlockRequest(residentId: residentId))) }
    func unblock(_ residentId: EntityID) async throws { _ = try await perform(Endpoint("DELETE", "/v1/blocks/\(residentId)")) }

    func report(_ target: ReportTarget, id: EntityID, reasonCode: String, details: String?) async throws {
        _ = try await perform(.json("POST", "/v1/reports", ReportRequest(targetType: target, targetId: id, reasonCode: reasonCode, details: details)))
    }

    // MARK: Economy

    func inventory() async throws -> [ItemInstance] { (try await send(Endpoint("GET", "/v1/inventory"), as: InventoryResponse.self)).items }
    func wallet() async throws -> Wallet { try await send(Endpoint("GET", "/v1/wallet")) }

    func catalog(cityId: EntityID?) async throws -> [StoreListing] {
        let q = cityId.map { [URLQueryItem(name: "city_id", value: $0)] } ?? []
        return (try await send(Endpoint("GET", "/v1/catalog", query: q), as: CatalogResponse.self)).listings
    }

    func purchase(listingId: EntityID, quantity: Int, key: String) async throws -> PurchaseResponse {
        try await send(.json("POST", "/v1/store/purchases", PurchaseRequest(listingId: listingId, quantity: quantity), idempotencyKey: key))
    }
}
