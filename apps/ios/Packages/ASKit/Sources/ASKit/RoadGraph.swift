import Foundation

/// Client-side routing over the downloaded active road graph (Blueprint §6.3). The server never
/// streams walking steps; the client animates a Mini along this path locally.
public struct RoadGraph: Sendable {
    public let nodes: [EntityID: RoadNode]
    public let edges: [EntityID: RoadEdge]
    public let civicAnchors: [CivicAnchor]
    public let activationRevision: Int
    private let adjacency: [EntityID: [(to: EntityID, weight: Int, edge: EntityID)]]

    public init(_ payload: RoadGraphPayload) {
        var n: [EntityID: RoadNode] = [:]
        for node in payload.nodes { n[node.id] = node }
        var e: [EntityID: RoadEdge] = [:]
        var adj: [EntityID: [(to: EntityID, weight: Int, edge: EntityID)]] = [:]
        for edge in payload.edges where n[edge.fromNodeId] != nil && n[edge.toNodeId] != nil {
            e[edge.id] = edge
            adj[edge.fromNodeId, default: []].append((edge.toNodeId, edge.weightMilli, edge.id))
            adj[edge.toNodeId, default: []].append((edge.fromNodeId, edge.weightMilli, edge.id))
        }
        nodes = n
        edges = e
        adjacency = adj
        civicAnchors = payload.civicAnchors
        activationRevision = payload.activationRevision
    }

    /// A* with a straight-line heuristic (admissible: authored weights are never shorter than the chord).
    public func shortestPath(from start: EntityID, to goal: EntityID) -> [EntityID]? {
        guard let goalNode = nodes[goal], nodes[start] != nil else { return nil }
        if start == goal { return [start] }
        var open = MinHeap<EntityID>()
        var cameFrom: [EntityID: EntityID] = [:]
        var g: [EntityID: Double] = [start: 0]
        open.push(start, priority: nodes[start]!.point.distance(to: goalNode.point))
        var closed = Set<EntityID>()
        while let current = open.pop() {
            if current == goal { return reconstruct(cameFrom, current) }
            if !closed.insert(current).inserted { continue }
            for (next, weight, _) in adjacency[current] ?? [] where !closed.contains(next) {
                let tentative = g[current]! + Double(weight)
                if tentative < g[next] ?? .infinity {
                    cameFrom[next] = current
                    g[next] = tentative
                    open.push(next, priority: tentative + nodes[next]!.point.distance(to: goalNode.point))
                }
            }
        }
        return nil
    }

    /// World-space points for a node path, following each edge's authored geometry.
    public func polyline(_ path: [EntityID]) -> [WorldPoint] {
        guard let first = path.first, let firstNode = nodes[first] else { return [] }
        var points = [firstNode.point]
        for (a, b) in zip(path, path.dropFirst()) {
            guard let hop = adjacency[a]?.first(where: { $0.to == b }), let edge = edges[hop.edge] else { continue }
            var geometry = (edge.geometryPoints ?? []).map(\.world)
            if edge.fromNodeId != a { geometry.reverse() }
            if geometry.count < 2, let nb = nodes[b] { geometry = [nodes[a]!.point, nb.point] }
            points.append(contentsOf: geometry.dropFirst())
        }
        return points
    }

    public func nearestNode(to p: WorldPoint) -> EntityID? {
        nodes.values.min(by: { $0.point.distance(to: p) < $1.point.distance(to: p) })?.id
    }

    /// Full route between two places: nearest graph nodes, A*, then the final hop to the exact point.
    public func route(from a: WorldPoint, fromNode: EntityID? = nil, to b: WorldPoint, toNode: EntityID? = nil) -> [WorldPoint] {
        guard let s = fromNode ?? nearestNode(to: a), let t = toNode ?? nearestNode(to: b),
              let path = shortestPath(from: s, to: t) else { return [a, b] }
        return [a] + polyline(path) + [b]
    }

    private func reconstruct(_ cameFrom: [EntityID: EntityID], _ end: EntityID) -> [EntityID] {
        var path = [end]
        var cur = end
        while let prev = cameFrom[cur] { path.append(prev); cur = prev }
        return path.reversed()
    }
}

/// Minimal binary heap for A*.
struct MinHeap<T> {
    private var items: [(value: T, priority: Double)] = []
    var isEmpty: Bool { items.isEmpty }

    mutating func push(_ value: T, priority: Double) {
        items.append((value, priority))
        var i = items.count - 1
        while i > 0 {
            let parent = (i - 1) / 2
            if items[parent].priority <= items[i].priority { break }
            items.swapAt(parent, i)
            i = parent
        }
    }

    mutating func pop() -> T? {
        guard !items.isEmpty else { return nil }
        items.swapAt(0, items.count - 1)
        let top = items.removeLast()
        var i = 0
        while true {
            let l = 2 * i + 1, r = l + 1
            var m = i
            if l < items.count && items[l].priority < items[m].priority { m = l }
            if r < items.count && items[r].priority < items[m].priority { m = r }
            if m == i { break }
            items.swapAt(i, m)
            i = m
        }
        return top.value
    }
}

/// Polyline helpers for route animation.
public enum PathMath {
    public static func length(_ pts: [WorldPoint]) -> Double {
        zip(pts, pts.dropFirst()).reduce(0) { $0 + $1.0.distance(to: $1.1) }
    }

    /// Travel time for a route: brisk but short, never a chore (tap-to-travel, Blueprint §4.3).
    public static func travelSeconds(_ pts: [WorldPoint]) -> Double {
        min(4.0, max(0.8, length(pts) / 18_000))
    }
}
