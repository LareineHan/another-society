import Foundation
import CoreGraphics

/// Canonical integer world coordinate (Blueprint §4.6). Floats are for rendering only.
public struct WorldPoint: Hashable, Codable, Sendable {
    public var x: Int
    public var y: Int
    public init(x: Int, y: Int) { self.x = x; self.y = y }

    public static let zero = WorldPoint(x: 0, y: 0)

    public func distance(to o: WorldPoint) -> Double {
        let dx = Double(o.x - x), dy = Double(o.y - y)
        return (dx * dx + dy * dy).squareRoot()
    }

    /// Snap to a grid (default quarter tile) so persisted layouts stay tidy integers.
    public func snapped(to step: Int = 250) -> WorldPoint {
        func s(_ v: Int) -> Int { Int((Double(v) / Double(step)).rounded()) * step }
        return WorldPoint(x: s(x), y: s(y))
    }
}

public enum WorldUnits {
    public static let perTile = 1000
    public static let chunkSize = 32_000
    public static let maxChunkWindow = 100

    /// Floor division so negative coordinates map to negative chunks (-1 -> chunk -1).
    public static func chunkIndex(_ u: Int) -> Int {
        u >= 0 ? u / chunkSize : -((-u + chunkSize - 1) / chunkSize)
    }
}

public struct ChunkRect: Hashable, Sendable {
    public var minX: Int, minY: Int, maxX: Int, maxY: Int
    public init(minX: Int, minY: Int, maxX: Int, maxY: Int) { self.minX = minX; self.minY = minY; self.maxX = maxX; self.maxY = maxY }
    public var count: Int { (maxX - minX + 1) * (maxY - minY + 1) }

    /// A window around a point that never exceeds the API's 100-chunk limit.
    public static func around(_ p: WorldPoint, radius: Int) -> ChunkRect {
        let r = max(0, min(radius, 4)) // 9 x 9 = 81 chunks max
        let cx = WorldUnits.chunkIndex(p.x), cy = WorldUnits.chunkIndex(p.y)
        return ChunkRect(minX: cx - r, minY: cy - r, maxX: cx + r, maxY: cy + r)
    }
}

/// Fixed 3/4 camera projection (Blueprint §4.3). World logic stays 2D; this only decides where
/// things are drawn and in what order. Swap the projection, keep the world.
public struct Projection: Sendable {
    public var pointsPerUnit: CGFloat
    public var verticalSquash: CGFloat

    public init(pointsPerUnit: CGFloat = 0.02, verticalSquash: CGFloat = 0.72) {
        self.pointsPerUnit = pointsPerUnit
        self.verticalSquash = verticalSquash
    }

    public func scenePoint(_ p: WorldPoint) -> CGPoint {
        CGPoint(x: CGFloat(p.x) * pointsPerUnit, y: CGFloat(p.y) * pointsPerUnit * verticalSquash)
    }

    public func worldPoint(_ s: CGPoint) -> WorldPoint {
        WorldPoint(x: Int((s.x / pointsPerUnit).rounded()), y: Int((s.y / (pointsPerUnit * verticalSquash)).rounded()))
    }

    public func size(_ wU: Int, _ dU: Int) -> CGSize {
        CGSize(width: CGFloat(wU) * pointsPerUnit, height: CGFloat(dU) * pointsPerUnit * verticalSquash)
    }

    /// Painter's order: things nearer the viewer (smaller y) draw on top.
    public func zPosition(_ p: WorldPoint, layer: Int = 0) -> CGFloat {
        CGFloat(layer) * 1000 - CGFloat(p.y) / 100
    }
}
