import SwiftUI
import ASKit

/// Gifts waiting for you. A gift is the one place a name is intentionally shown (Blueprint §11.4).
struct GiftInboxView: View {
    @Environment(AppModel.self) private var app
    @State private var gifts: [Gift]?

    var body: some View {
        NavigationStack {
            Group {
                if let gifts {
                    if gifts.isEmpty {
                        ContentUnavailableView("No gifts waiting", systemImage: "gift", description: Text("When someone leaves you something, it waits in your room until you decide."))
                    } else {
                        List(gifts) { g in
                            VStack(alignment: .leading, spacing: 10) {
                                ItemRow(assetId: g.assetId, name: Copy.itemName(g.definitionKey))
                                Text("From \(g.giver?.displayName ?? "someone") · \(g.createdAt.formatted(.relative(presentation: .named)))")
                                    .font(.caption).foregroundStyle(.secondary)
                                HStack {
                                    act("Keep here", g, .keepHere, prominent: true)
                                    act("Put away", g, .putAway)
                                    act("Decline", g, .decline)
                                }
                            }
                            .padding(.vertical, 6)
                        }
                    }
                } else {
                    ProgressView()
                }
            }
            .navigationTitle("Gifts")
            .navigationBarTitleDisplayMode(.inline)
        }
        .task { await load() }
    }

    private func act(_ title: String, _ g: Gift, _ a: GiftAction, prominent: Bool = false) -> some View {
        Button(title) {
            Task {
                if await app.attempt({ try await app.api.resolveGift(g.id, a, key: IdempotencyKey.make()) }) != nil { await load() }
            }
        }
        .buttonStyle(prominent ? AnyPrimitiveButtonStyle(.borderedProminent) : AnyPrimitiveButtonStyle(.bordered))
        .tint(prominent ? Theme.moss : nil)
        .font(.footnote)
    }

    private func load() async {
        gifts = await app.attempt { try await app.api.giftInbox() } ?? []
        await app.refreshSidebars()
    }
}
