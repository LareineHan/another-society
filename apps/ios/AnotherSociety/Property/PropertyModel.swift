import SwiftUI
import ASKit

/// One room visit or one owner session. Layout edits are a local draft until Save, which sends
/// the whole canonical layout with `expected_revision` (Blueprint §52).
@MainActor
@Observable
final class PropertyModel {
    enum Mode: Equatable { case look, edit, giving(EntityID) }

    let propertyId: EntityID
    let scene = PropertyScene(size: CGSize(width: 390, height: 600))
    private(set) var property: Property?
    private(set) var space: Space?
    private(set) var loading = true
    private(set) var failed: String?
    var mode: Mode = .look { didSet { syncInteraction() } }
    var selectedItemId: EntityID?
    var draft: [Placement] = []
    private(set) var baseRevision = 0
    var dirty = false
    var dropSpot: WorldPoint?
    var summary: VisitSummary?
    var busy = false

    init(propertyId: EntityID) {
        self.propertyId = propertyId
        scene.onSelect = { [weak self] id in self?.selectedItemId = id }
        scene.onMove = { [weak self] id, p in self?.move(id, to: p) }
        scene.onRotate = { [weak self] id in self?.rotate(id) }
        scene.onTapFloor = { [weak self] p in
            self?.dropSpot = p
            self?.scene.showDropMarker(at: p)
        }
    }

    var isOwner: Bool { property?.viewer?.isOwner == true }
    var spaceId: EntityID? { space?.id }

    func isStayingHere(_ app: AppModel) -> Bool {
        guard let stay = app.activeStay else { return false }
        return stay.hostPropertyId == propertyId
    }

    // MARK: Loading

    /// Visitors enter through POST visit (anonymous receipt); owners just read.
    func load(app: AppModel) async {
        loading = true
        defer { loading = false }
        do {
            if propertyId == app.homePropertyId {
                let p = try await app.api.property(propertyId)
                property = p
                if let sid = p.spaceIds?.first { apply(space: try await app.api.space(sid), app: app) }
                summary = try? await app.api.visitSummary(propertyId)
            } else {
                let v = try await app.api.visit(propertyId)
                property = v.property
                if let s = v.spaces.first { apply(space: s, app: app) }
            }
            failed = nil
        } catch let e as APIError where e.code == "forbidden" || e.code == "not_found" {
            failed = e.code == "forbidden" ? "This home is closed right now." : "This home isn't here anymore."
        } catch {
            failed = Copy.errorMessage(error)
        }
    }

    /// Second visit call after the dwell threshold; the server decides whether it qualifies.
    func qualifyVisit(app: AppModel) async {
        guard !isOwner, failed == nil else { return }
        _ = try? await app.api.visit(propertyId)
    }

    func reloadSpace(app: AppModel) async {
        guard let sid = spaceId else { return }
        if let s = await app.attempt({ try await app.api.space(sid) }) { apply(space: s, app: app) }
    }

    private func apply(space s: Space, app: AppModel) {
        space = s
        if !dirty {
            draft = s.placements
            baseRevision = s.layoutRevision
        }
        scene.renderRoom(bounds: s.bounds ?? .default, structureAssetId: property?.structureAssetId ?? "")
        scene.renderPlacements(draft)
        renderPeople(app: app)
    }

    func renderPeople(app: AppModel) {
        let me = app.resident
        let visibleStayers = (space?.stayers ?? [])
        let meStaying = isStayingHere(app)
        // My own Mini is drawn locally when I'm here but not staying (visit is not public presence).
        let showMe = !meStaying && (isOwner ? property?.ownerAway != true : true)
        scene.renderPeople(stayers: visibleStayers, me: showMe ? me?.miniDefinition : nil, meAtDoor: !isOwner, pendingGifts: isOwner ? (space?.pendingGifts ?? []) : [])
    }

    private func syncInteraction() {
        switch mode {
        case .look: scene.interaction = .look; scene.showDropMarker(at: nil); dropSpot = nil
        case .edit: scene.interaction = .edit
        case .giving: scene.interaction = .chooseDropSpot
        }
    }

    // MARK: Owner layout editing (draft)

    private func move(_ id: EntityID, to p: WorldPoint) {
        guard let i = draft.firstIndex(where: { $0.itemInstanceId == id }) else { return }
        draft[i].xU = p.x
        draft[i].yU = p.y
        dirty = true
        scene.renderPlacements(draft)
    }

    func rotate(_ id: EntityID) {
        guard let i = draft.firstIndex(where: { $0.itemInstanceId == id }) else { return }
        let asset = AssetCatalog.shared.asset(draft[i].assetId)
        draft[i].rotationQ = asset?.nextRotation(after: draft[i].rotationQ) ?? (draft[i].rotationQ + 1) % 4
        dirty = true
        scene.renderPlacements(draft)
    }

    func removeSelected() {
        guard let id = selectedItemId else { return }
        draft.removeAll { $0.itemInstanceId == id }
        scene.select(nil)
        dirty = true
        scene.renderPlacements(draft)
    }

    func add(_ item: ItemInstance) {
        guard !draft.contains(where: { $0.itemInstanceId == item.id }) else { return }
        let b = space?.bounds ?? .default
        let spot = WorldPoint(x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2).snapped()
        draft.append(Placement(itemInstanceId: item.id, xU: spot.x, yU: spot.y, rotationQ: 0, definitionKey: item.definitionKey, assetId: item.assetId))
        dirty = true
        scene.renderPlacements(draft)
        scene.select(item.id)
    }

    func discardDraft(app: AppModel) {
        dirty = false
        if let s = space { apply(space: s, app: app) }
        mode = .look
    }

    /// Save with optimistic revision. On 409 the canonical layout is refetched and the owner's
    /// unsaved draft is re-applied on top, so nothing is silently lost or overwritten.
    func save(app: AppModel) async {
        guard let sid = spaceId, !busy else { return }
        busy = true
        defer { busy = false }
        let key = IdempotencyKey.make()
        do {
            let saved = try await app.api.saveLayout(spaceId: sid, expectedRevision: baseRevision, placements: draft, key: key)
            dirty = false
            apply(space: saved, app: app)
            mode = .look
        } catch let e as APIError where e.code == "revision_conflict" {
            if let fresh = try? await app.api.space(sid) {
                let inventory = (try? await app.api.inventory()) ?? []
                let stillMine = Set(inventory.filter(\.isPlaceable).map(\.id))
                draft = draft.filter { stillMine.contains($0.itemInstanceId) }
                baseRevision = fresh.layoutRevision
                space = fresh
                scene.renderPlacements(draft)
                app.banner = "This room changed on another device. Your arrangement is kept; tap Save again to use it."
            }
        } catch {
            app.banner = Copy.errorMessage(error)
        }
    }

    // MARK: Social

    func stay(app: AppModel) async {
        guard let sid = spaceId else { return }
        busy = true
        defer { busy = false }
        if await app.attempt({ try await app.api.stay(spaceId: sid, key: IdempotencyKey.make()) }) != nil {
            await app.refreshMe()
            await reloadSpace(app: app)
        }
    }

    func leave(app: AppModel) async {
        busy = true
        defer { busy = false }
        if await app.attempt({ try await app.api.leaveStay(key: IdempotencyKey.make()) }) != nil {
            await app.refreshMe()
            await reloadSpace(app: app)
        }
    }

    func sendHome(_ residentId: EntityID, app: AppModel) async {
        guard let sid = spaceId else { return }
        if await app.attempt({ try await app.api.sendHome(spaceId: sid, residentId: residentId, key: IdempotencyKey.make()) }) != nil {
            await reloadSpace(app: app)
        }
    }

    func leaveGift(app: AppModel) async -> Bool {
        guard case .giving(let itemId) = mode, let sid = spaceId, let spot = dropSpot else { return false }
        busy = true
        defer { busy = false }
        let ok = await app.attempt({ try await app.api.leaveGift(propertyId: propertyId, spaceId: sid, itemId: itemId, drop: spot, key: IdempotencyKey.make()) }) != nil
        if ok { mode = .look }
        return ok
    }

    func updateAccess(_ update: AccessUpdate, app: AppModel) async {
        var u = update
        u.expectedRevision = property?.revision
        if let p = await app.attempt({ try await app.api.updateAccess(propertyId, u) }) { property = p }
    }
}
