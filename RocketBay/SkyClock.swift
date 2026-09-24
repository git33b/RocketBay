import Foundation
import SwiftUI

/// Coarse sky period from local device clock (MVP-1; no solar math package).
enum SkyPeriod: String, CaseIterable {
    case night
    case blueHour
    case goldenHour
    case day

    var label: String {
        switch self {
        case .night: return "Night"
        case .blueHour: return "Blue Hour"
        case .goldenHour: return "Golden Hour"
        case .day: return "Day"
        }
    }
}

/// Sky colors for SpriteKit / SwiftUI gradients. Limited PSP-like palette.
struct SkyPalette {
    let top: (r: CGFloat, g: CGFloat, b: CGFloat)
    let mid: (r: CGFloat, g: CGFloat, b: CGFloat)
    let bottom: (r: CGFloat, g: CGFloat, b: CGFloat)
    let period: SkyPeriod

    var topColor: Color {
        Color(red: top.r, green: top.g, blue: top.b)
    }
    var midColor: Color {
        Color(red: mid.r, green: mid.g, blue: mid.b)
    }
    var bottomColor: Color {
        Color(red: bottom.r, green: bottom.g, blue: bottom.b)
    }
}

enum SkyClock {
    /// Optional mock hour (0-23) for testing; nil = use device local time.
    static var mockHour: Int? = nil

    static func currentHour(now: Date = Date(), calendar: Calendar = .current) -> Int {
        if let mock = mockHour { return max(0, min(23, mock)) }
        return calendar.component(.hour, from: now)
    }

    /// Rough bands (local clock, no lat/lon):
    /// night 21-5 · blue 5-7 & 19-21 · golden 7-9 & 17-19 · day 9-17
    static func period(forHour hour: Int) -> SkyPeriod {
        switch hour {
        case 21...23, 0..<5: return .night
        case 5..<7, 19..<21: return .blueHour
        case 7..<9, 17..<19: return .goldenHour
        default: return .day
        }
    }

    static func palette(now: Date = Date()) -> SkyPalette {
        let hour = currentHour(now: now)
        switch period(forHour: hour) {
        case .night:
            return SkyPalette(
                top: (0.05, 0.05, 0.18),
                mid: (0.08, 0.10, 0.28),
                bottom: (0.12, 0.14, 0.32),
                period: .night
            )
        case .blueHour:
            return SkyPalette(
                top: (0.10, 0.15, 0.35),
                mid: (0.20, 0.30, 0.55),
                bottom: (0.35, 0.40, 0.60),
                period: .blueHour
            )
        case .goldenHour:
            return SkyPalette(
                top: (0.25, 0.35, 0.55),
                mid: (0.85, 0.55, 0.30),
                bottom: (0.95, 0.70, 0.40),
                period: .goldenHour
            )
        case .day:
            return SkyPalette(
                top: (0.25, 0.55, 0.95),
                mid: (0.45, 0.70, 0.98),
                bottom: (0.70, 0.85, 1.0),
                period: .day
            )
        }
    }
}
