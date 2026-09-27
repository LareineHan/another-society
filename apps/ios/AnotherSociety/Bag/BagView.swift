import SwiftUI
import ASKit

/// Inventory + the system store. Prices and balances come from the server only (Blueprint §18).
struct BagView: View {
    @Environment(AppModel.self) private var app
    @State private var tab = 0
    @State private var items: [ItemInstance] = []
    @State private var listings: [StoreListing] = []
    @State private var buying: EntityID?

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                Picker("", selection: $tab) {
                    Text("Your things").tag(0)
                    Text("General store").tag(1)
                }
                .pickerStyle(.segmented)
                .padding()
                if tab == 0 { inventory } else { store }
            }
            .navigationTitle("Bag")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    if let w = app.wallet {
                        Label("\(w.balance)", systemImage: "circle.hexagongrid.fill")
                            .labelStyle(.titleAndIcon)
                            .monospacedDigit()
                            .accessibilityLabel("\(w.balance) \(Copy.currencyName)")
                    }
                }
            }
        }
        .task { await reload() }
    }

    private var inventory: some View {
        List {
            if items.isEmpty { Text("Nothing yet.").foregroundStyle(.secondary) }
            ForEach(items) { item in
                ItemRow(assetId: item.assetId, name: Copy.itemName(item.definitionKey), trailing: stateLabel(item.state))
            }
        }
        .listStyle(.plain)
    }

    private var store: some View {
        List {
            Section {
                ForEach(listings) { l in
                    HStack {
                        ItemRow(assetId: l.assetId, name: Copy.itemName(l.definitionKey))
                        if l.giftEligible == true { Image(systemName: "gift").foregroundStyle(.secondary).accessibilityLabel("Gift-safe") }
                        Button {
                            Task { await buy(l) }
                        } label: {
                            if buying == l.id { ProgressView() } else { Text("\(l.unitPrice)").monospacedDigit() }
                        }
                        .buttonStyle(.bordered)
                        .disabled(buying != nil || (app.wallet?.balance ?? 0) < l.unitPrice)
                    }
                }
            } footer: {
                Text("Prices are set by the city. Coins can't be bought with real money.")
            }
        }
        .listStyle(.insetGrouped)
    }

    private func stateLabel(_ s: String) -> String? {
        switch s {
        case "placed": return "at home"
        case "pending_placement": return "gift waiting"
        default: return nil
        }
    }

    private func reload() async {
        items = await app.attempt { try await app.api.inventory() } ?? []
        let cityId = app.city?.id
        listings = await app.attempt { try await app.api.catalog(cityId: cityId) } ?? []
        await app.refreshSidebars()
    }

    /// One key per tap: a retried request can never buy twice (Blueprint §73.2).
    private func buy(_ l: StoreListing) async {
        buying = l.id
        defer { buying = nil }
        if let r = await app.attempt({ try await app.api.purchase(listingId: l.id, quantity: 1, key: IdempotencyKey.make()) }) {
            app.setWallet(r.wallet)
            items = await app.attempt { try await app.api.inventory() } ?? items
        }
    }
}
