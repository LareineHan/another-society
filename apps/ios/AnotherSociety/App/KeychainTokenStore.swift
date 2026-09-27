import Foundation
import Security
import ASKit

/// Refresh/access tokens live in the Keychain, this device only (Blueprint §14.4).
final class KeychainTokenStore: TokenStore, @unchecked Sendable {
    private let service = "com.implemon.anothersociety.session"
    private let account = "tokens"
    private let lock = NSLock()
    private var cache: Tokens??

    func load() -> Tokens? {
        lock.lock(); defer { lock.unlock() }
        if let cache { return cache }
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne,
        ]
        var out: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &out)
        let tokens = status == errSecSuccess ? (out as? Data).flatMap { try? JSONDecoder().decode(Tokens.self, from: $0) } : nil
        cache = .some(tokens)
        return tokens
    }

    func save(_ tokens: Tokens?) {
        lock.lock(); defer { lock.unlock() }
        cache = .some(tokens)
        let base: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
        ]
        SecItemDelete(base as CFDictionary)
        guard let tokens, let data = try? JSONEncoder().encode(tokens) else { return }
        var add = base
        add[kSecValueData as String] = data
        add[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        SecItemAdd(add as CFDictionary, nil)
    }
}
