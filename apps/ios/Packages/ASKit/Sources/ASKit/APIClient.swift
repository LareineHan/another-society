import Foundation

public struct Tokens: Codable, Sendable, Equatable {
    public var accessToken: String
    public var refreshToken: String
    public init(accessToken: String, refreshToken: String) { self.accessToken = accessToken; self.refreshToken = refreshToken }
}

/// Where session tokens live. The app implements this with the Keychain; tests use memory.
public protocol TokenStore: AnyObject, Sendable {
    func load() -> Tokens?
    func save(_ tokens: Tokens?)
}

public final class InMemoryTokenStore: TokenStore, @unchecked Sendable {
    private let lock = NSLock()
    private var tokens: Tokens?
    public init(_ tokens: Tokens? = nil) { self.tokens = tokens }
    public func load() -> Tokens? { lock.lock(); defer { lock.unlock() }; return tokens }
    public func save(_ tokens: Tokens?) { lock.lock(); self.tokens = tokens; lock.unlock() }
}

public enum APIError: Error, Sendable, Equatable {
    /// Stable machine code from the server envelope (see OpenAPI info.description).
    case server(status: Int, code: String, message: String, details: [String: JSONValue]?)
    case unauthorized
    case transport(String)
    case decoding(String)

    public var code: String? { if case .server(_, let code, _, _) = self { return code }; return nil }
    public var status: Int? { if case .server(let s, _, _, _) = self { return s }; return nil }

    /// Human-safe message suitable for UI.
    public var userMessage: String {
        switch self {
        case .server(_, _, let message, _): return message
        case .unauthorized: return "Please sign in again."
        case .transport: return "The world is out of reach right now. Check your connection."
        case .decoding: return "Something unexpected came back from the world."
        }
    }

    public var currentRevision: Int? {
        if case .server(_, "revision_conflict", _, let details) = self { return details?["current_revision"]?.intValue }
        return nil
    }
}

/// Idempotency keys identify ONE user intent. Create a key when the user acts, reuse it for retries.
public enum IdempotencyKey {
    public static func make() -> String { UUID().uuidString.lowercased() }
}

public struct Endpoint: Sendable {
    public var method: String
    public var path: String
    public var query: [URLQueryItem] = []
    public var body: Data?
    public var idempotencyKey: String?
    public var requiresAuth = true
    public var headers: [String: String] = [:]

    public init(_ method: String, _ path: String, query: [URLQueryItem] = [], body: Data? = nil, idempotencyKey: String? = nil, requiresAuth: Bool = true) {
        self.method = method; self.path = path; self.query = query; self.body = body
        self.idempotencyKey = idempotencyKey; self.requiresAuth = requiresAuth
    }

    public static func json<B: Encodable>(_ method: String, _ path: String, _ body: B, idempotencyKey: String? = nil, requiresAuth: Bool = true) throws -> Endpoint {
        Endpoint(method, path, body: try ASJSON.encoder().encode(body), idempotencyKey: idempotencyKey, requiresAuth: requiresAuth)
    }
}

public struct Empty: Decodable, Sendable { public init() {} }

public struct RawResponse: Sendable {
    public let status: Int
    public let data: Data
    public let headers: [String: String]
}

/// Thin, typed HTTP client for the Another Society API.
/// - Attaches the bearer token, refreshes once on 401 (single flight), and signs out if refresh fails.
/// - Retries transport failures ONLY for requests that carry an Idempotency-Key (same key each time),
///   so a flaky network can never duplicate a purchase, claim or gift.
public actor APIClient {
    public nonisolated let baseURL: URL
    private let session: URLSession
    private let tokenStore: TokenStore
    private var refreshTask: Task<Tokens, Error>?
    private var signedOutHandler: (@Sendable () -> Void)?
    var etags: [String: (etag: String, data: Data)] = [:]

    public init(baseURL: URL, tokenStore: TokenStore, session: URLSession = .shared) {
        self.baseURL = baseURL
        self.tokenStore = tokenStore
        self.session = session
    }

    public func onSignedOut(_ handler: @escaping @Sendable () -> Void) { signedOutHandler = handler }

    public nonisolated var hasSession: Bool { tokenStore.load() != nil }

    func store(_ auth: AuthResponse) { tokenStore.save(Tokens(accessToken: auth.accessToken, refreshToken: auth.refreshToken)) }
    func clearSession() { tokenStore.save(nil) }

    public func send<T: Decodable>(_ endpoint: Endpoint, as type: T.Type = T.self) async throws -> T {
        let raw = try await perform(endpoint)
        if T.self == Empty.self { return Empty() as! T }
        do {
            return try ASJSON.decoder().decode(T.self, from: raw.data)
        } catch {
            throw APIError.decoding("\(endpoint.method) \(endpoint.path): \(error)")
        }
    }

    public func perform(_ endpoint: Endpoint, allowRefresh: Bool = true) async throws -> RawResponse {
        var attempt = 0
        while true {
            do {
                let raw = try await transport(endpoint)
                if raw.status == 401 && endpoint.requiresAuth && allowRefresh {
                    _ = try await refreshTokens()
                    return try await perform(endpoint, allowRefresh: false)
                }
                if raw.status == 401 && endpoint.requiresAuth {
                    signOutLocally()
                    throw APIError.unauthorized
                }
                guard (200..<300).contains(raw.status) || raw.status == 304 else { throw Self.serverError(raw) }
                return raw
            } catch let error as URLError where endpoint.idempotencyKey != nil && attempt < 2 && Self.isRetryable(error) {
                attempt += 1
                try await Task.sleep(nanoseconds: UInt64(300_000_000 * attempt))
            } catch let error as URLError {
                throw APIError.transport(error.localizedDescription)
            }
        }
    }

    private func transport(_ endpoint: Endpoint) async throws -> RawResponse {
        var components = URLComponents(url: baseURL.appendingPathComponent(endpoint.path), resolvingAgainstBaseURL: false)!
        if !endpoint.query.isEmpty { components.queryItems = endpoint.query }
        var request = URLRequest(url: components.url!)
        request.httpMethod = endpoint.method
        request.timeoutInterval = 20
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        if let body = endpoint.body {
            request.httpBody = body
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        }
        if let key = endpoint.idempotencyKey { request.setValue(key, forHTTPHeaderField: "Idempotency-Key") }
        if endpoint.requiresAuth, let tokens = tokenStore.load() {
            request.setValue("Bearer \(tokens.accessToken)", forHTTPHeaderField: "Authorization")
        }
        for (k, v) in endpoint.headers { request.setValue(v, forHTTPHeaderField: k) }
        let (data, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse else { throw URLError(.badServerResponse) }
        var headers: [String: String] = [:]
        for (k, v) in http.allHeaderFields { if let k = k as? String, let v = v as? String { headers[k.lowercased()] = v } }
        return RawResponse(status: http.statusCode, data: data, headers: headers)
    }

    /// Single-flight refresh: concurrent 401s share one refresh call.
    private func refreshTokens() async throws -> Tokens {
        if let task = refreshTask { return try await task.value }
        guard let current = tokenStore.load() else { signOutLocally(); throw APIError.unauthorized }
        let task = Task<Tokens, Error> { [session, baseURL] in
            var request = URLRequest(url: baseURL.appendingPathComponent("/v1/auth/refresh"))
            request.httpMethod = "POST"
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.httpBody = try ASJSON.encoder().encode(RefreshRequest(refreshToken: current.refreshToken))
            let (data, response) = try await session.data(for: request)
            guard (response as? HTTPURLResponse)?.statusCode == 200 else { throw APIError.unauthorized }
            let auth = try ASJSON.decoder().decode(AuthResponse.self, from: data)
            return Tokens(accessToken: auth.accessToken, refreshToken: auth.refreshToken)
        }
        refreshTask = task
        defer { refreshTask = nil }
        do {
            let tokens = try await task.value
            tokenStore.save(tokens)
            return tokens
        } catch let error as URLError {
            // Offline is not "signed out": keep the session and surface a transport error.
            throw APIError.transport(error.localizedDescription)
        } catch {
            signOutLocally()
            throw APIError.unauthorized
        }
    }

    private func signOutLocally() {
        tokenStore.save(nil)
        signedOutHandler?()
    }

    private static func isRetryable(_ e: URLError) -> Bool {
        [.timedOut, .networkConnectionLost, .notConnectedToInternet, .cannotConnectToHost, .dnsLookupFailed].contains(e.code)
    }

    private static func serverError(_ raw: RawResponse) -> APIError {
        if let body = try? ASJSON.decoder().decode(APIErrorBody.self, from: raw.data) {
            return .server(status: raw.status, code: body.code, message: body.message, details: body.details)
        }
        return .server(status: raw.status, code: "http_\(raw.status)", message: "Something went wrong.", details: nil)
    }
}
