import SwiftUI
import UIKit

/// Paper-diorama palette (Blueprint §4.2): soft, warm, readable at phone scale. Placeholder until art lands.
enum Theme {
    static let paper = Color(hex: 0xF4EFE6)
    static let ground = Color(hex: 0xE6DECF)
    static let ink = Color(hex: 0x3B3A36)
    static let moss = Color(hex: 0x7C9A6B)
    static let forest = Color(hex: 0x8FAA7C)
    static let wall = Color(hex: 0xF7F1E6)
    static let roofWarm = Color(hex: 0xC9785B)
    static let accent = Color(hex: 0x7C9A6B)

    enum UI {
        static let paper = UIColor(hex: 0xF4EFE6)
        static let ground = UIColor(hex: 0xE6DECF)
        static let groundShade = UIColor(hex: 0xD9D0BE)
        static let ink = UIColor(hex: 0x3B3A36)
        static let road = UIColor(hex: 0xD2C6AE)
        static let roadEdge = UIColor(hex: 0xBBAE95)
        static let arterial = UIColor(hex: 0xC8BA9E)
        static let forest = UIColor(hex: 0x8FAA7C)
        static let forestDark = UIColor(hex: 0x76936A)
        static let plotVacant = UIColor(hex: 0x7C9A6B)
        static let plotSelected = UIColor(hex: 0xC9785B)
        static let wall = UIColor(hex: 0xF7F1E6)
        static let wallShade = UIColor(hex: 0xE9DFCF)
        static let floor = UIColor(hex: 0xE8D6BC)
        static let floorLine = UIColor(hex: 0xD8C3A5)
        static let shadow = UIColor(white: 0, alpha: 0.12)
        static let glow = UIColor(hex: 0xF2C572)
        static let civic = UIColor(hex: 0xB9A7C9)
    }
}

extension Color {
    init(hex: UInt32, opacity: Double = 1) {
        self.init(.sRGB, red: Double((hex >> 16) & 0xFF) / 255, green: Double((hex >> 8) & 0xFF) / 255, blue: Double(hex & 0xFF) / 255, opacity: opacity)
    }
}

extension UIColor {
    convenience init(hex: UInt32, alpha: CGFloat = 1) {
        self.init(red: CGFloat((hex >> 16) & 0xFF) / 255, green: CGFloat((hex >> 8) & 0xFF) / 255, blue: CGFloat(hex & 0xFF) / 255, alpha: alpha)
    }
}
