import SwiftUI
import SpriteKit
import ASKit

struct PropertyView: View {
    @Environment(AppModel.self) private var app
    @Environment(\.dismiss) private var dismiss
    @State private var model: PropertyModel
    @State private var sheet: Sheet?
    @State private var confirmBlock = false
    let onLeft: () -> Void

    enum Sheet: Identifiable {
        case addItem, chooseGift, access, guests, report, resolveGift(EntityID)
        var id: String {
            switch self {
            case .addItem: return "add"
            case .chooseGift: return "gift"
            case .access: return "access"
            case .guests: return "guests"
            case .report: return "report"
            case .resolveGift(let g): return "resolve-\(g)"
            }
        }
    }

    init(propertyId: EntityID, onLeft: @escaping () -> Void) {
        _model = State(initialValue: PropertyModel(propertyId: propertyId))
        self.onLeft = onLeft
    }

    var body: some View {
        ZStack(alignment: .bottom) {
            GeometryReader { geo in
                SpriteView(scene: model.scene, preferredFramesPerSecond: 30, options: [.ignoresSiblingOrder])
                    .onAppear { model.scene.size = geo.size }
                    .onChange(of: geo.size) { _, s in model.scene.size = s }
            }
            .ignoresSafeArea()

            VStack {
                header
                Spacer()
                controls
            }
            .padding(16)

            if model.loading { ProgressView().padding().background(.thinMaterial, in: Circle()).frame(maxHeight: .infinity) }
            if let failed = model.failed {
                ContentUnavailableView(failed, systemImage: "door.left.hand.closed")
                    .background(Theme.paper)
            }
        }
        .navigationBarBackButtonHidden(model.mode == .edit)
        .navigationTitle(title)
        .navigationBarTitleDisplayMode(.inline)
        .task {
            model.scene.onTapGift = { id in sheet = .resolveGift(id) }
            model.scene.onTapStayer = { _ in if model.isOwner { sheet = .guests } }
            await model.load(app: app)
            if !model.isOwner && model.failed == nil {
                try? await Task.sleep(nanoseconds: UInt64(AppConfig.visitQualifyDelay * 1_000_000_000))
                await model.qualifyVisit(app: app)
            }
        }
        .onDisappear(perform: onLeft)
        .sheet(item: $sheet) { s in sheetContent(s) }
        .confirmationDialog("Block \(model.property?.owner?.displayName ?? "this resident")?", isPresented: $confirmBlock, titleVisibility: .visible) {
            Button("Block", role: .destructive) { Task { await block() } }
        } message: {
            Text("You won't see each other's homes, stays or gifts. They are not told.")
        }
    }

    private var title: String {
        if model.isOwner { return "Home" }
        return model.property?.owner?.displayName ?? ""
    }

    @ViewBuilder private var header: some View {
        if model.isOwner, model.mode == .look, let s = model.summary, !s.copy.isEmpty {
            Text(s.copy)
                .font(.footnote)
                .padding(.horizontal, 12).padding(.vertical, 8)
                .background(.thinMaterial, in: Capsule())
                .foregroundStyle(Theme.ink)
        }
        if case .giving = model.mode {
            Text(model.dropSpot == nil ? "Tap a spot to leave your gift" : "Leave it here?")
                .font(.footnote.weight(.medium))
                .padding(.horizontal, 12).padding(.vertical, 8)
                .background(.thinMaterial, in: Capsule())
        }
    }

    @ViewBuilder private var controls: some View {
        if model.failed != nil || model.property == nil {
            EmptyView()
        } else {
            switch model.mode {
            case .edit: editBar
            case .giving: givingBar
            case .look: model.isOwner ? AnyView(ownerBar) : AnyView(visitorBar)
            }
        }
    }

    private var ownerBar: some View {
        HStack(spacing: 10) {
            pill("Arrange", "square.on.square.dashed") { model.mode = .edit }
            pill("Door", "door.left.hand.open") { sheet = .access }
            pill(guestsTitle, "person.2") { sheet = .guests }
        }
    }

    private var guestsTitle: String {
        let n = model.space?.stayers?.count ?? 0
        return n == 0 ? "Guests" : "Guests \(n)"
    }

    private var visitorBar: some View {
        HStack(spacing: 10) {
            if model.isStayingHere(app) {
                pill("Leave", "arrow.uturn.left") { Task { await model.leave(app: app) } }
            } else if model.property?.viewer?.canStay == true {
                pill("Stay here", "moon.zzz") { Task { await model.stay(app: app) } }
            }
            pill("Leave a gift", "gift") { sheet = .chooseGift }
            Menu {
                Button("Report this home", systemImage: "flag") { sheet = .report }
                Button("Block \(model.property?.owner?.displayName ?? "resident")", systemImage: "hand.raised", role: .destructive) { confirmBlock = true }
            } label: {
                Image(systemName: "ellipsis").frame(width: 44, height: 44).background(.regularMaterial, in: Circle())
            }
            .accessibilityLabel("More")
        }
        .disabled(model.busy)
    }

    private var editBar: some View {
        VStack(spacing: 10) {
            HStack(spacing: 10) {
                pill("Add", "plus") { sheet = .addItem }
                if let id = model.selectedItemId {
                    pill("Turn", "rotate.right") { model.rotate(id) }
                    pill("Put away", "tray.and.arrow.down") { model.removeSelected() }
                }
            }
            HStack(spacing: 10) {
                Button("Cancel") { model.discardDraft(app: app) }.buttonStyle(.bordered)
                Button(model.busy ? "Saving…" : "Save") { Task { await model.save(app: app) } }
                    .buttonStyle(.borderedProminent)
                    .tint(Theme.moss)
                    .disabled(!model.dirty || model.busy)
            }
        }
        .padding(12)
        .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 20, style: .continuous))
    }

    private var givingBar: some View {
        HStack(spacing: 10) {
            Button("Cancel") { model.mode = .look }.buttonStyle(.bordered)
            Button("Leave gift") {
                Task {
                    if await model.leaveGift(app: app) { app.banner = "You left a gift."; await app.refreshSidebars() }
                }
            }
            .buttonStyle(.borderedProminent)
            .tint(Theme.moss)
            .disabled(model.dropSpot == nil || model.busy)
        }
        .padding(12)
        .background(.regularMaterial, in: Capsule())
    }

    private func pill(_ title: String, _ icon: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Label(title, systemImage: icon)
                .font(.subheadline.weight(.medium))
                .padding(.horizontal, 14).padding(.vertical, 11)
                .background(.regularMaterial, in: Capsule())
        }
        .buttonStyle(.plain)
        .foregroundStyle(Theme.ink)
    }

    @ViewBuilder private func sheetContent(_ s: Sheet) -> some View {
        switch s {
        case .addItem:
            ItemPickerView(title: "Add to room", filter: { item in item.state == "inventory" && !model.draft.contains { $0.itemInstanceId == item.id } }) { item in
                model.add(item)
                sheet = nil
            }
            .presentationDetents([.medium, .large])
        case .chooseGift:
            ItemPickerView(title: "Choose a gift", filter: \.canGift, emptyText: "Gift-safe items from the store can be left as gifts.") { item in
                model.mode = .giving(item.id)
                sheet = nil
            }
            .presentationDetents([.medium, .large])
        case .access:
            if let p = model.property {
                AccessSettingsView(property: p) { update in Task { await model.updateAccess(update, app: app) } }
                    .presentationDetents([.medium])
            }
        case .guests:
            GuestsView(stayers: model.space?.stayers ?? []) { rid in Task { await model.sendHome(rid, app: app) } }
                .presentationDetents([.medium])
        case .report:
            ReportSheet(targetName: "this home") { reason, details in
                Task {
                    if await app.attempt({ try await app.api.report(.property, id: model.propertyId, reasonCode: reason, details: details) }) != nil {
                        app.banner = "Thanks. A person will review it."
                    }
                }
            }
        case .resolveGift(let giftId):
            GiftResolveSheet(giftId: giftId) {
                Task { await model.reloadSpace(app: app); await app.refreshSidebars() }
            }
            .presentationDetents([.height(260)])
        }
    }

    private func block() async {
        guard let owner = model.property?.ownerResidentId else { return }
        if await app.attempt({ try await app.api.block(owner) }) != nil {
            await app.refreshMe()
            dismiss()
        }
    }
}
