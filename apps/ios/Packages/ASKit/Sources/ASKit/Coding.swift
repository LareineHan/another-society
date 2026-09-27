import Foundation

/// Shared JSON coders. Models declare explicit snake_case CodingKeys, so no key strategies are used
/// (key strategies would also rewrite dictionary keys such as Mini slots).
public enum ASJSON {
    public static func decoder() -> JSONDecoder {
        let d = JSONDecoder()
        d.dateDecodingStrategy = .custom { decoder in
            let c = try decoder.singleValueContainer()
            let s = try c.decode(String.self)
            if let date = parseISO8601(s) { return date }
            throw DecodingError.dataCorruptedError(in: c, debugDescription: "Unrecognized date: \(s)")
        }
        return d
    }

    public static func encoder() -> JSONEncoder {
        let e = JSONEncoder()
        e.dateEncodingStrategy = .iso8601
        return e
    }

    /// Server timestamps are ISO-8601 with milliseconds ("2026-09-27T20:49:57.441Z").
    public static func parseISO8601(_ s: String) -> Date? {
        if let d = try? Date.ISO8601FormatStyle(includingFractionalSeconds: true).parse(s) { return d }
        return try? Date.ISO8601FormatStyle().parse(s)
    }
}
