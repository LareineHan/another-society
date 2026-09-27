import SwiftUI
import UIKit
import ASKit

/// App-wide session and world state. Every canonical fact comes from the server; this is a cache.
@MainActor
@Observable
final class AppModel {
    enum Phase: Equatable { case launching, signedOut, onboarding, inWorld }

    private(set) var phase: Phase = .launching
    private(set) var api: APIClient
    private(set) var me: MeResponse?
    private(set) var bootstrap: WorldBootstrap?
    private(set) var wallet: Wallet?
    private(set) var pendingGiftCount = 0
    var banner: String?

    private let tokenStore: TokenStore

    /// Tests inject an in-memory store so several residents can be signed in side by side.
    init(tokenStore: TokenStore = KeychainTokenStore(), baseURL: URL = AppConfig.apiBaseURL) {
        self.tokenStore = tokenStore
        api = APIClient(baseURL: baseURL, tokenStore: tokenStore)
    }

    var resident: Resident? { me?.resident }
    var city: CitySummary? {
        if let home = resident?.primaryHome, let c = bootstrap?.cities.first(where: { $0.id == home.cityId }) { return c }
        return bootstrap?.cities.first
    }
    var homePropertyId: EntityID? { resident?.primaryHome?.propertyId }
    var activeStay: ActiveStay? { me?.activeStay }

    // MARK: Lifecycle

    func launch() async {
        await wireSignOut()
        guard api.hasSession else { phase = .signedOut; return }
        await refreshSession()
    }

    /// Point the client at a different server (Debug settings). Signs out, since tokens are per-server.
    func switchServer(to url: String?) async {
        await api.signOut()
        AppConfig.setOverride(url)
        api = APIClient(baseURL: AppConfig.apiBaseURL, tokenStore: tokenStore)
        await wireSignOut()
        reset()
    }

    private func wireSignOut() async {
        await api.onSignedOut { [weak self] in
            Task { @MainActor in self?.reset() }
        }
    }

    private func reset() {
        me = nil
        wallet = nil
        pendingGiftCount = 0
        phase = .signedOut
    }

    func refreshSession() async {
        do {
            let m = try await api.me()
            let b = try await api.bootstrap()
            me = m
            bootstrap = b
            route()
            if phase == .inWorld { await refreshSidebars() }
        } catch APIError.unauthorized {
            reset()
        } catch {
            banner = Copy.errorMessage(error)
            if me == nil { phase = api.hasSession ? .launching : .signedOut }
        }
    }

    private func route() {
        guard let resident = me?.resident else { phase = .signedOut; return }
        phase = resident.primaryHome == nil ? .onboarding : .inWorld
    }

    func refreshMe() async {
        if let m = try? await api.me() {
            me = m
            route()
        }
    }

    func refreshSidebars() async {
        if let w = try? await api.wallet() { wallet = w }
        if let g = try? await api.giftInbox() { pendingGiftCount = g.count }
    }

    func setWallet(_ w: Wallet) { wallet = w }

    // MARK: Auth

    func signInWithApple(identityToken: String, authorizationCode: String, rawNonce: String) async {
        do {
            _ = try await api.signInWithApple(identityToken: identityToken, authorizationCode: authorizationCode, rawNonce: rawNonce, deviceLabel: UIDevice.current.name)
            await refreshSession()
        } catch {
            banner = Copy.errorMessage(error)
        }
    }

    /// Debug only: the local server (DEV_AUTH=true) accepts `dev:<name>` identity tokens.
    func devSignIn(name: String) async {
        guard AppConfig.allowsDevSignIn else { return }
        let subject = name.trimmingCharacters(in: .whitespaces).replacingOccurrences(of: " ", with: "-")
        await signInWithApple(identityToken: "dev:\(subject.isEmpty ? "tester" : subject)", authorizationCode: "dev", rawNonce: "dev-nonce-000")
    }

    func signOut() async {
        await api.signOut()
        reset()
    }

    func deleteAccount() async -> Bool {
        do {
            try await api.deleteAccount(key: IdempotencyKey.make())
            reset()
            return true
        } catch {
            banner = Copy.errorMessage(error)
            return false
        }
    }

    // MARK: Helpers

    /// Run a server action, surfacing errors as a quiet banner. Returns nil on failure.
    @discardableResult
    func attempt<T>(_ work: () async throws -> T) async -> T? {
        do { return try await work() }
        catch { banner = Copy.errorMessage(error); return nil }
    }
}
