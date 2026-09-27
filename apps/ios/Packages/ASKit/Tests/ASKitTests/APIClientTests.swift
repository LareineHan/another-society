import XCTest
@testable import ASKit

/// URLProtocol stub so the client's auth/refresh/idempotency behavior is tested without a server.
final class StubProtocol: URLProtocol {
    nonisolated(unsafe) static var handler: ((URLRequest) -> (Int, Data, [String: String]))?
    nonisolated(unsafe) static var requests: [URLRequest] = []
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        var req = request
        if req.httpBody == nil, let stream = req.httpBodyStream {
            stream.open(); defer { stream.close() }
            var data = Data(); var buf = [UInt8](repeating: 0, count: 4096)
            while stream.hasBytesAvailable { let n = stream.read(&buf, maxLength: buf.count); if n <= 0 { break }; data.append(buf, count: n) }
            req.httpBody = data
        }
        StubProtocol.requests.append(req)
        let (status, body, headers) = StubProtocol.handler!(req)
        let resp = HTTPURLResponse(url: req.url!, statusCode: status, httpVersion: nil, headerFields: headers)!
        client?.urlProtocol(self, didReceive: resp, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: body)
        client?.urlProtocolDidFinishLoading(self)
    }
    override func stopLoading() {}
}

final class APIClientTests: XCTestCase {
    func client(tokens: Tokens?) -> (APIClient, InMemoryTokenStore) {
        let config = URLSessionConfiguration.ephemeral
        config.protocolClasses = [StubProtocol.self]
        let store = InMemoryTokenStore(tokens)
        return (APIClient(baseURL: URL(string: "https://api.test")!, tokenStore: store, session: URLSession(configuration: config)), store)
    }

    override func setUp() { StubProtocol.requests = [] }

    func testRefreshesOnceOn401ThenRetries() async throws {
        StubProtocol.handler = { req in
            if req.url!.path == "/v1/auth/refresh" {
                return (200, Data(#"{"access_token":"new","refresh_token":"r2","expires_in":900,"user_id":"u","is_new_account":false}"#.utf8), [:])
            }
            let auth = req.value(forHTTPHeaderField: "Authorization")
            if auth == "Bearer old" { return (401, Data(#"{"request_id":"req_x","code":"unauthorized","message":"no"}"#.utf8), [:]) }
            return (200, Data(#"{"currency_code":"WORLD","balance":42}"#.utf8), [:])
        }
        let (api, store) = client(tokens: Tokens(accessToken: "old", refreshToken: "r1"))
        let wallet = try await api.wallet()
        XCTAssertEqual(wallet.balance, 42)
        XCTAssertEqual(store.load(), Tokens(accessToken: "new", refreshToken: "r2"))
        XCTAssertEqual(StubProtocol.requests.map { $0.url!.path }, ["/v1/wallet", "/v1/auth/refresh", "/v1/wallet"])
    }

    func testFailedRefreshSignsOut() async {
        StubProtocol.handler = { _ in (401, Data(#"{"request_id":"r","code":"unauthorized","message":"no"}"#.utf8), [:]) }
        let (api, store) = client(tokens: Tokens(accessToken: "old", refreshToken: "r1"))
        let signedOut = expectation(description: "signed out")
        await api.onSignedOut { signedOut.fulfill() }
        do { _ = try await api.wallet(); XCTFail("expected unauthorized") } catch { XCTAssertEqual(error as? APIError, .unauthorized) }
        await fulfillment(of: [signedOut], timeout: 1)
        XCTAssertNil(store.load())
    }

    func testMutationsCarryTheCallersIdempotencyKeyAndServerErrorsAreTyped() async throws {
        StubProtocol.handler = { _ in
            (409, Data(#"{"request_id":"req_1","code":"revision_conflict","message":"changed","details":{"current_revision":7}}"#.utf8), [:])
        }
        let (api, _) = client(tokens: Tokens(accessToken: "t", refreshToken: "r"))
        let key = IdempotencyKey.make()
        do {
            _ = try await api.saveLayout(spaceId: "s", expectedRevision: 3, placements: [Placement(itemInstanceId: "i", xU: 1000, yU: 2000, rotationQ: 1)], key: key)
            XCTFail("expected conflict")
        } catch let e as APIError {
            XCTAssertEqual(e.code, "revision_conflict")
            XCTAssertEqual(e.currentRevision, 7)
        }
        let sent = try XCTUnwrap(StubProtocol.requests.last)
        XCTAssertEqual(sent.value(forHTTPHeaderField: "Idempotency-Key"), key)
        let body = try JSONSerialization.jsonObject(with: try XCTUnwrap(sent.httpBody)) as? [String: Any]
        XCTAssertEqual(body?["expected_revision"] as? Int, 3)
        let placement = (body?["placements"] as? [[String: Any]])?.first
        XCTAssertEqual(placement?["item_instance_id"] as? String, "i")
        XCTAssertEqual(placement?["rotation_q"] as? Int, 1)
        XCTAssertEqual(placement?["scale_milli"] as? Int, 1000)
    }

    func testRoadsUseETagCache() async throws {
        let url = try XCTUnwrap(Bundle.module.url(forResource: "roads", withExtension: "json", subdirectory: "Fixtures"))
        let payload = try Data(contentsOf: url)
        StubProtocol.handler = { req in
            req.value(forHTTPHeaderField: "If-None-Match") == "\"roads-2\"" ? (304, Data(), [:]) : (200, payload, ["ETag": "\"roads-2\""])
        }
        let (api, _) = client(tokens: Tokens(accessToken: "t", refreshToken: "r"))
        let a = try await api.roads(cityId: "c")
        let b = try await api.roads(cityId: "c")
        XCTAssertEqual(a.nodes.count, b.nodes.count)
        XCTAssertEqual(StubProtocol.requests.last?.value(forHTTPHeaderField: "If-None-Match"), "\"roads-2\"")
    }
}
