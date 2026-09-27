import SwiftUI
import ASKit

/// Onboarding (Blueprint §7.3–7.4): name, Mini, choose the exact place on the map,
/// short reservation, pick a cottage, atomic claim.
struct OnboardingView: View {
    @Environment(AppModel.self) private var app
    @State private var step: Step = .name
    @State private var name = ""
    @State private var mini = MiniDefinition.starter
    @State private var plots: [PlotSummary] = []
    @State private var selected: PlotSummary?
    @State private var reservation: ReserveResponse?
    @State private var structure = "structure.home.cottage.a"
    @State private var busy = false
    @State private var city = CityModel()
    /// One key per user intent; a retry of the same tap reuses it.
    @State private var claimKey = IdempotencyKey.make()

    enum Step: Int { case name, mini, place, home }

    var body: some View {
        ZStack {
            Theme.paper.ignoresSafeArea()
            switch step {
            case .name: nameStep
            case .mini: miniStep
            case .place: placeStep
            case .home: homeStep
            }
        }
        .animation(.easeInOut, value: step)
        .onChange(of: structure) { _, _ in claimKey = IdempotencyKey.make() }
        .onAppear {
            if let r = app.resident {
                if r.displayName != "Newcomer" { name = r.displayName }
                if !r.miniDefinition.isEmpty { mini = r.miniDefinition.resolved }
            }
        }
    }

    // MARK: Steps

    private var nameStep: some View {
        VStack(alignment: .leading, spacing: 20) {
            Spacer()
            Text("What should people see?").font(.system(.title, design: .serif).weight(.semibold))
            Text("A short name. It doesn't need to be unique or real.").foregroundStyle(.secondary)
            TextField("Name", text: $name)
                .font(.title3)
                .padding(14)
                .background(.white.opacity(0.7), in: RoundedRectangle(cornerRadius: 12))
                .textInputAutocapitalization(.words)
                .submitLabel(.next)
                .onSubmit { Task { await saveName() } }
            Spacer()
            primary("Continue", enabled: !name.trimmingCharacters(in: .whitespaces).isEmpty) { await saveName() }
        }
        .padding(24)
    }

    private var miniStep: some View {
        VStack(spacing: 12) {
            Text("Your Mini").font(.system(.title2, design: .serif).weight(.semibold)).padding(.top, 20)
            ScrollView { MiniEditorView(mini: $mini).padding(.horizontal, 20) }
            primary("Looks right") {
                if await app.attempt({ try await app.api.updateMini(mini) }) != nil { await loadPlots(); step = .place }
            }
            .padding(.horizontal, 24)
            .padding(.bottom, 12)
        }
    }

    private var placeStep: some View {
        ZStack(alignment: .bottom) {
            CityMapView(model: city)
            VStack(spacing: 10) {
                if let s = selected {
                    VStack(alignment: .leading, spacing: 6) {
                        Text("This place").font(.headline)
                        if let labels = s.labels, !labels.isEmpty {
                            Text(labels.map(Copy.plotLabel).joined(separator: " · ")).font(.footnote).foregroundStyle(.secondary)
                        }
                        if let r = reservation {
                            Text("Held for you until \(r.expiresAt.formatted(date: .omitted, time: .shortened))").font(.caption).foregroundStyle(.secondary)
                        }
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    primary("Live here", enabled: reservation != nil) { step = .home }
                } else {
                    Text("Tap any open place. Everything you see is really available.")
                        .font(.footnote)
                        .frame(maxWidth: .infinity, alignment: .leading)
                }
            }
            .padding(16)
            .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 20, style: .continuous))
            .padding(16)
        }
        .overlay(alignment: .top) {
            Text("Choose where you live").font(.headline).padding(10).background(.thinMaterial, in: Capsule()).padding(.top, 8)
        }
        .onAppear {
            city.scene.mode = .pickPlot
            city.scene.onTapProperty = nil
            city.scene.onTapPlot = { id in Task { await choose(id) } }
        }
    }

    private var homeStep: some View {
        VStack(spacing: 20) {
            Text("Your first home").font(.system(.title2, design: .serif).weight(.semibold)).padding(.top, 24)
            HStack(spacing: 14) {
                ForEach(AssetCatalog.shared.structures.map(\.assetId), id: \.self) { id in
                    Button { structure = id } label: {
                        VStack(spacing: 8) {
                            RoundedRectangle(cornerRadius: 14).fill(Color(uiColor: PlaceholderArt.roofColor(id)))
                                .frame(height: 90)
                                .overlay(Image(systemName: "house.fill").font(.largeTitle).foregroundStyle(.white.opacity(0.9)))
                            Text(Copy.itemName(id)).font(.caption)
                        }
                        .padding(8)
                        .background(structure == id ? Theme.moss.opacity(0.18) : .clear, in: RoundedRectangle(cornerRadius: 18))
                        .overlay(RoundedRectangle(cornerRadius: 18).strokeBorder(structure == id ? Theme.moss : .clear, lineWidth: 2))
                    }
                    .buttonStyle(.plain)
                }
            }
            .padding(.horizontal, 20)
            Spacer()
            primary(busy ? "Moving in…" : "Move in", enabled: !busy) { await claim() }
                .padding(.horizontal, 24)
            Button("Choose another place") { step = .place }.padding(.bottom, 12)
        }
    }

    private func primary(_ title: String, enabled: Bool = true, action: @escaping () async -> Void) -> some View {
        Button {
            Task { busy = true; await action(); busy = false }
        } label: {
            Text(title).font(.headline).frame(maxWidth: .infinity).padding(.vertical, 14)
        }
        .buttonStyle(.borderedProminent)
        .tint(Theme.moss)
        .disabled(!enabled || busy)
    }

    // MARK: Actions

    private func saveName() async {
        let n = name.trimmingCharacters(in: .whitespaces)
        guard !n.isEmpty else { return }
        if await app.attempt({ try await app.api.updateDisplayName(n) }) != nil { step = .mini }
    }

    private func loadPlots() async {
        guard let c = app.city else { return }
        await city.load(app: app)
        plots = await app.attempt({ try await app.api.onboardingPlots(cityId: c.id) }) ?? []
        city.scene.setPlots(plots)
        if let mine = plots.first(where: { $0.reservedByMe == true }) {
            selected = mine
            city.scene.selectedPlotId = mine.id
        }
        if let first = plots.first { city.scene.focus(on: first.center, animated: false) }
    }

    /// Tapping a plot reserves it for 10 minutes so nobody else can take it while you decide.
    private func choose(_ plotId: EntityID) async {
        guard let plot = plots.first(where: { $0.id == plotId }) else { return }
        selected = plot
        city.scene.selectedPlotId = plotId
        reservation = nil
        do {
            reservation = try await app.api.reservePlot(plotId, key: IdempotencyKey.make())
            claimKey = IdempotencyKey.make()
        } catch let e as APIError where e.code == "plot_unavailable" {
            app.banner = e.userMessage
            selected = nil
            city.scene.selectedPlotId = nil
            await loadPlots()
        } catch {
            app.banner = Copy.errorMessage(error)
        }
    }

    private func claim() async {
        guard let plot = selected, let r = reservation else { step = .place; return }
        do {
            _ = try await app.api.claimPlot(plot.id, ClaimRequest(reservationId: r.reservationId, structureAssetId: structure), key: claimKey)
            await app.refreshSession()
        } catch let e as APIError where e.code == "reservation_invalid" || e.code == "plot_unavailable" {
            app.banner = e.userMessage
            reservation = nil
            selected = nil
            step = .place
            await loadPlots()
        } catch {
            app.banner = Copy.errorMessage(error)
        }
    }
}
