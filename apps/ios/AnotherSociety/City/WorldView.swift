import SwiftUI
import ASKit

enum WorldRoute: Hashable {
    case property(EntityID)
}

/// In-world shell: the city is home base; everything else is a sheet or a pushed room.
/// Minimal chrome while inside the world (Blueprint §4.2).
struct WorldView: View {
    @Environment(AppModel.self) private var app
    @State private var city = CityModel()
    @State private var path: [WorldRoute] = []
    @State private var sheet: Sheet?
    /// Sheet payloads travel inside the item: a separate @State read only inside the sheet closure
    /// is captured stale on first presentation (SwiftUI does not track it as a body dependency).
    enum Sheet: Identifiable {
        case bag, gifts, settings, wander([WanderItem])
        var id: String {
            switch self {
            case .bag: return "bag"
            case .gifts: return "gifts"
            case .settings: return "settings"
            case .wander: return "wander"
            }
        }
    }

    var body: some View {
        NavigationStack(path: $path) {
            CityView(city: city, go: go(to:))
                .toolbar(.hidden, for: .navigationBar)
                .safeAreaInset(edge: .bottom) { bottomBar }
                .navigationDestination(for: WorldRoute.self) { route in
                    switch route {
                    case .property(let id):
                        PropertyView(propertyId: id, onLeft: { Task { await city.load(app: app) } })
                    }
                }
        }
        .sheet(item: $sheet) { s in
            switch s {
            case .bag: BagView().presentationDetents([.medium, .large])
            case .gifts: GiftInboxView().presentationDetents([.medium, .large])
            case .settings: SettingsView()
            case .wander(let results): WanderSheet(results: results) { item in
                sheet = nil
                city.remember(propertyId: item.id, plotId: item.plotId)
                travel(to: item.id, center: item.center, frontage: item.frontageNodeId)
            }.presentationDetents([.medium])
            }
        }
        .task {
            await city.load(app: app)
            await app.refreshSidebars()
        }
        .onChange(of: path) { _, p in if p.isEmpty { Task { await city.load(app: app) } } }
    }

    private var bottomBar: some View {
        HStack(spacing: 0) {
            barButton("Home", "house") { goHome() }
            barButton("Wander", "figure.walk") { Task { await wander() } }
            barButton("Bag", "bag") { sheet = .bag }
            barButton("Gifts", "gift", badge: app.pendingGiftCount) { sheet = .gifts }
            barButton("You", "person.crop.circle") { sheet = .settings }
        }
        .padding(.vertical, 8)
        .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 22, style: .continuous))
        .padding(.horizontal, 16)
        .padding(.bottom, 4)
        .overlay(alignment: .top) {
            if let stay = app.activeStay {
                StayingPill(stay: stay) { go(to: stay.hostPropertyId) }
                    .offset(y: -44)
            }
        }
    }

    private func barButton(_ title: String, _ icon: String, badge: Int = 0, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            VStack(spacing: 3) {
                Image(systemName: icon).font(.system(size: 18, weight: .medium))
                    .overlay(alignment: .topTrailing) {
                        if badge > 0 { Circle().fill(Theme.roofWarm).frame(width: 8, height: 8).offset(x: 6, y: -2) }
                    }
                Text(title).font(.caption2)
            }
            .frame(maxWidth: .infinity)
            .foregroundStyle(Theme.ink)
        }
        .buttonStyle(.plain)
        .disabled(city.traveling)
        .accessibilityLabel(badge > 0 ? "\(title), \(badge) new" : title)
    }

    private func goHome() {
        guard let home = app.resident?.primaryHome else { return }
        if let plot = city.plots[home.plotId] {
            travel(to: home.propertyId, center: plot.center, frontage: plot.frontageNodeId)
        } else {
            path.append(.property(home.propertyId))
        }
    }

    /// Route from the map: animate the Mini along the public roads, then enter the room.
    private func go(to propertyId: EntityID) {
        if let plot = city.plotFor(propertyId: propertyId) {
            travel(to: propertyId, center: plot.center, frontage: plot.frontageNodeId)
        } else {
            path.append(.property(propertyId))
        }
    }

    private func travel(to propertyId: EntityID, center: WorldPoint, frontage: EntityID?) {
        city.selectedPropertyId = nil
        city.travel(app: app, to: center, frontageNodeId: frontage) {
            path.append(.property(propertyId))
        }
    }

    private func wander() async {
        guard let c = app.city else { return }
        let near = city.miniPosition(app)
        if let items = await app.attempt({ try await app.api.wander(cityId: c.id, near: near, limit: 5) }) {
            sheet = .wander(items)
        }
    }
}

struct StayingPill: View {
    let stay: ActiveStay
    let open: () -> Void
    var body: some View {
        Button(action: open) {
            Label("You're staying somewhere", systemImage: "moon.zzz")
                .font(.footnote.weight(.medium))
                .padding(.horizontal, 14).padding(.vertical, 8)
                .background(.thinMaterial, in: Capsule())
        }
        .buttonStyle(.plain)
        .foregroundStyle(Theme.ink)
    }
}

struct WanderSheet: View {
    let results: [WanderItem]
    let pick: (WanderItem) -> Void
    var body: some View {
        NavigationStack {
            List {
                if results.isEmpty {
                    Text("Nobody's door is open nearby right now.").foregroundStyle(.secondary)
                }
                ForEach(results) { item in
                    Button { pick(item) } label: {
                        HStack {
                            Image(systemName: "house.fill").foregroundStyle(Color(uiColor: PlaceholderArt.roofColor(item.structureAssetId)))
                            Text(item.hasActiveStayers == true ? "A home with someone staying" : "A quiet home")
                            Spacer()
                            Image(systemName: "chevron.right").font(.caption).foregroundStyle(.tertiary)
                        }
                    }
                    .foregroundStyle(Theme.ink)
                }
            }
            .navigationTitle("Wander")
            .navigationBarTitleDisplayMode(.inline)
        }
    }
}
