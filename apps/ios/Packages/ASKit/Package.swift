// swift-tools-version: 5.9
import PackageDescription

// ASKit: the platform-neutral core of the iOS client (models, API client, fixed-point geometry,
// road routing, asset manifest). No SwiftUI/SpriteKit here, so it builds and tests with `swift test`.
let package = Package(
    name: "ASKit",
    platforms: [.iOS(.v17), .macOS(.v14)],
    products: [.library(name: "ASKit", targets: ["ASKit"])],
    targets: [
        .target(name: "ASKit", resources: [.process("Resources")]),
        .testTarget(name: "ASKitTests", dependencies: ["ASKit"], resources: [.copy("Fixtures")]),
    ]
)
