import SwiftUI
import ASKit

struct RootView: View {
    @Environment(AppModel.self) private var app

    var body: some View {
        ZStack(alignment: .top) {
            switch app.phase {
            case .launching:
                LaunchView()
            case .signedOut:
                SignInView()
            case .onboarding:
                OnboardingView()
            case .inWorld:
                WorldView()
            }
            if let banner = app.banner {
                BannerView(text: banner) { app.banner = nil }
                    .padding(.horizontal, 16)
                    .padding(.top, 8)
                    .transition(.move(edge: .top).combined(with: .opacity))
            }
        }
        .animation(.easeInOut(duration: 0.25), value: app.phase)
        .animation(.easeInOut(duration: 0.2), value: app.banner)
    }
}

struct LaunchView: View {
    @Environment(AppModel.self) private var app
    var body: some View {
        ZStack {
            Theme.paper.ignoresSafeArea()
            VStack(spacing: 16) {
                ProgressView()
                if app.banner != nil {
                    Button("Try again") { Task { await app.refreshSession() } }
                        .buttonStyle(.bordered)
                }
            }
        }
    }
}

struct BannerView: View {
    let text: String
    let dismiss: () -> Void
    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            Text(text).font(.callout).foregroundStyle(Theme.ink).frame(maxWidth: .infinity, alignment: .leading)
            Button(action: dismiss) { Image(systemName: "xmark").font(.caption.weight(.semibold)) }
                .foregroundStyle(Theme.ink.opacity(0.6))
                .accessibilityLabel("Dismiss")
        }
        .padding(14)
        .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
        .task {
            try? await Task.sleep(nanoseconds: 5_000_000_000)
            dismiss()
        }
    }
}
