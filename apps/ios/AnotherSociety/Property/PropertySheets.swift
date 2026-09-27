import SwiftUI
import ASKit

struct ItemPickerView: View {
    @Environment(AppModel.self) private var app
    @Environment(\.dismiss) private var dismiss
    let title: String
    let filter: (ItemInstance) -> Bool
    var emptyText = "Nothing here yet. The general store has a few things."
    let pick: (ItemInstance) -> Void
    @State private var items: [ItemInstance]?

    var body: some View {
        NavigationStack {
            Group {
                if let items {
                    let shown = items.filter(filter)
                    if shown.isEmpty {
                        ContentUnavailableView(emptyText, systemImage: "bag")
                    } else {
                        List(shown) { item in
                            Button { pick(item) } label: { ItemRow(assetId: item.assetId, name: Copy.itemName(item.definitionKey)) }
                                .foregroundStyle(Theme.ink)
                        }
                    }
                } else {
                    ProgressView()
                }
            }
            .navigationTitle(title)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Close") { dismiss() } } }
        }
        .task { items = await app.attempt { try await app.api.inventory() } ?? [] }
    }
}

struct ItemRow: View {
    let assetId: String?
    let name: String
    var trailing: String? = nil
    var body: some View {
        HStack(spacing: 12) {
            RoundedRectangle(cornerRadius: 8)
                .fill(Color(uiColor: PlaceholderArt.color(for: assetId)))
                .frame(width: 36, height: 36)
                .overlay(RoundedRectangle(cornerRadius: 8).strokeBorder(.black.opacity(0.08)))
            Text(name)
            Spacer()
            if let trailing { Text(trailing).foregroundStyle(.secondary).monospacedDigit() }
        }
    }
}

/// Owner access controls (Blueprint §11.3): normal access, away access, stays, and capacity.
struct AccessSettingsView: View {
    let property: Property
    let apply: (AccessUpdate) -> Void
    @State private var open: Bool
    @State private var openWhileAway: Bool
    @State private var allowStays: Bool
    @State private var capacity: Int

    init(property: Property, apply: @escaping (AccessUpdate) -> Void) {
        self.property = property
        self.apply = apply
        _open = State(initialValue: property.accessMode == .open)
        _openWhileAway = State(initialValue: property.awayAccessMode == .open)
        _allowStays = State(initialValue: property.allowStays)
        _capacity = State(initialValue: property.stayCapacity)
    }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    Toggle("Door open", isOn: $open)
                    Toggle("Open while I'm staying elsewhere", isOn: $openWhileAway).disabled(!open)
                } footer: {
                    Text("Visitors are never named to you. Only gifts carry a name.")
                }
                Section {
                    Toggle("Allow stays", isOn: $allowStays)
                    Stepper("Room for \(capacity)", value: $capacity, in: 0...20).disabled(!allowStays)
                } footer: {
                    Text("You can send any guest home at any time. No message is sent.")
                }
            }
            .navigationTitle("Door")
            .navigationBarTitleDisplayMode(.inline)
            .onChange(of: open) { _, v in apply(AccessUpdate(accessMode: v ? .open : .closed)) }
            .onChange(of: openWhileAway) { _, v in apply(AccessUpdate(awayAccessMode: v ? .open : .closed)) }
            .onChange(of: allowStays) { _, v in apply(AccessUpdate(allowStays: v)) }
            .onChange(of: capacity) { _, v in apply(AccessUpdate(stayCapacity: v)) }
        }
    }
}

struct GuestsView: View {
    let stayers: [Stayer]
    let sendHome: (EntityID) -> Void
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            List {
                if stayers.isEmpty { Text("Nobody is staying right now.").foregroundStyle(.secondary) }
                ForEach(stayers) { s in
                    HStack(spacing: 12) {
                        MiniFigure(definition: s.miniDefinition).frame(width: 40, height: 40)
                        VStack(alignment: .leading) {
                            Text(s.displayName)
                            Text(s.startedAt, style: .relative).font(.caption).foregroundStyle(.secondary)
                        }
                        Spacer()
                        Button("Send home") { sendHome(s.residentId); dismiss() }
                            .buttonStyle(.bordered)
                    }
                }
            }
            .navigationTitle("Guests")
            .navigationBarTitleDisplayMode(.inline)
        }
    }
}

struct ReportSheet: View {
    let targetName: String
    let submit: (String, String?) -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var reason = "inappropriate_content"
    @State private var details = ""

    private struct Reason: Identifiable { let id: String; let title: String }
    private let reasons = [
        Reason(id: "inappropriate_content", title: "Inappropriate content"),
        Reason(id: "offensive_name", title: "Offensive name"),
        Reason(id: "harassment", title: "Harassment"),
        Reason(id: "spam", title: "Spam or scam"),
        Reason(id: "other", title: "Something else"),
    ]

    var body: some View {
        NavigationStack {
            Form {
                Picker("Reason", selection: $reason) {
                    ForEach(reasons) { Text($0.title).tag($0.id) }
                }
                Section("Anything a reviewer should know (optional)") {
                    TextField("Details", text: $details, axis: .vertical).lineLimit(3...6)
                }
                Section {
                    Text("Reports go to a person on the IMPLEMON team. Contact: \(AppConfig.supportEmail)")
                        .font(.footnote).foregroundStyle(.secondary)
                }
            }
            .navigationTitle("Report \(targetName)")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Send") { submit(reason, details.isEmpty ? nil : String(details.prefix(2000))); dismiss() }
                }
            }
        }
    }
}

/// Owner decides where a gift goes; nobody else can place things in this home (Blueprint §11.4).
struct GiftResolveSheet: View {
    @Environment(AppModel.self) private var app
    @Environment(\.dismiss) private var dismiss
    let giftId: EntityID
    let done: () -> Void
    @State private var gift: Gift?

    var body: some View {
        VStack(spacing: 16) {
            if let gift {
                ItemRow(assetId: gift.assetId, name: Copy.itemName(gift.definitionKey))
                Text("Left for you by \(gift.giver?.displayName ?? "someone")").font(.footnote).foregroundStyle(.secondary)
            } else {
                ProgressView()
            }
            HStack(spacing: 10) {
                action("Keep here", .keepHere, prominent: true)
                action("Put away", .putAway)
                action("Decline", .decline)
            }
        }
        .padding(20)
        .task {
            let inbox = await app.attempt { try await app.api.giftInbox() } ?? []
            gift = inbox.first { $0.id == giftId }
        }
    }

    private func action(_ title: String, _ a: GiftAction, prominent: Bool = false) -> some View {
        Button(title) {
            Task {
                if await app.attempt({ try await app.api.resolveGift(giftId, a, key: IdempotencyKey.make()) }) != nil {
                    done()
                    dismiss()
                }
            }
        }
        .buttonStyle(prominent ? AnyPrimitiveButtonStyle(.borderedProminent) : AnyPrimitiveButtonStyle(.bordered))
        .tint(prominent ? Theme.moss : nil)
    }
}

/// Type-erased primitive button style so a single call site can switch styles.
struct AnyPrimitiveButtonStyle: PrimitiveButtonStyle {
    private let make: (Configuration) -> AnyView
    init<S: PrimitiveButtonStyle>(_ style: S) { make = { AnyView(style.makeBody(configuration: $0)) } }
    func makeBody(configuration: Configuration) -> some View { make(configuration) }
}
