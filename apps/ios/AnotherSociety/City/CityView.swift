import SwiftUI
import ASKit

/// The map with a quiet card for the tapped home.
struct CityView: View {
    @Environment(AppModel.self) private var app
    let city: CityModel
    let go: (EntityID) -> Void
    @State private var preview: Property?
    @State private var closed = false

    var body: some View {
        ZStack(alignment: .bottom) {
            CityMapView(model: city)
            if city.loading { ProgressView().padding().background(.thinMaterial, in: Circle()).frame(maxHeight: .infinity, alignment: .top).padding(.top, 60) }
            if let preview {
                PropertyCard(property: preview, closed: closed, isHome: preview.id == app.homePropertyId) {
                    self.preview = nil
                    go(preview.id)
                } dismiss: {
                    self.preview = nil
                }
                .padding(.horizontal, 16)
                .padding(.bottom, 96)
                .transition(.move(edge: .bottom).combined(with: .opacity))
            }
        }
        .animation(.spring(duration: 0.3), value: preview?.id)
        .onAppear {
            city.scene.mode = .browse
            city.scene.onTapProperty = { id in Task { await showPreview(id) } }
            city.scene.onTapPlot = nil
        }
    }

    private func showPreview(_ id: EntityID) async {
        do {
            preview = try await app.api.property(id)
            closed = false
        } catch let e as APIError where e.code == "forbidden" {
            closed = true
            preview = nil
            app.banner = "This home is closed right now."
        } catch {
            app.banner = Copy.errorMessage(error)
        }
    }
}

struct PropertyCard: View {
    let property: Property
    let closed: Bool
    let isHome: Bool
    let enter: () -> Void
    let dismiss: () -> Void

    var body: some View {
        HStack(spacing: 14) {
            RoundedRectangle(cornerRadius: 10).fill(Color(uiColor: PlaceholderArt.roofColor(property.structureAssetId)))
                .frame(width: 44, height: 44)
                .overlay(Image(systemName: "house.fill").foregroundStyle(.white.opacity(0.9)))
            VStack(alignment: .leading, spacing: 2) {
                Text(isHome ? "Your home" : (property.owner?.displayName ?? "A home")).font(.headline).foregroundStyle(Theme.ink)
                Text(subtitle).font(.footnote).foregroundStyle(Theme.ink.opacity(0.6))
            }
            Spacer()
            Button(isHome ? "Go home" : "Visit", action: enter)
                .buttonStyle(.borderedProminent)
                .tint(Theme.moss)
                .disabled(closed)
            Button(action: dismiss) { Image(systemName: "xmark").font(.caption) }
                .buttonStyle(.plain)
                .foregroundStyle(.secondary)
                .accessibilityLabel("Close")
        }
        .padding(14)
        .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
    }

    private var subtitle: String {
        if property.hasActiveStayers == true { return "Someone is staying here" }
        return property.accessMode == .open ? "Door open" : "Closed"
    }
}
