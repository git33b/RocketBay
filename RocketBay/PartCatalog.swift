import Foundation
import CoreGraphics

/// Role of a rocket part in the vertical stack.
enum PartRole: String, Codable, CaseIterable, Identifiable {
    case s1 = "S1"
    case s2 = "S2"
    case payload = "Payload"
    case sideBooster = "SideBooster"

    var id: String { rawValue }

    var trayLabel: String {
        switch self {
        case .s1: return "S1"
        case .s2: return "S2"
        case .payload: return "Payload"
        case .sideBooster: return "Boosters"
        }
    }
}

enum SizeClass: String, Codable, CaseIterable {
    case s = "S"
    case m = "M"
    case l = "L"
    case xl = "XL"

    /// Relative height multiplier for procedural sprites (logical units).
    var heightFactor: CGFloat {
        switch self {
        case .s: return 0.55
        case .m: return 0.75
        case .l: return 1.0
        case .xl: return 1.35
        }
    }

    /// Relative diameter / width multiplier.
    var diameterFactor: CGFloat {
        switch self {
        case .s: return 0.55
        case .m: return 0.75
        case .l: return 1.0
        case .xl: return 1.3
        }
    }
}

/// Single catalog entry. `id` is research-only (e.g. S1-01); UI uses `displayName`.
struct RocketPart: Identifiable, Codable, Hashable {
    let id: String
    let displayName: String
    let role: PartRole
    let heightClass: SizeClass
    let diameterClass: SizeClass
    /// Simple palette key for procedural coloring (not a trademark).
    let palette: String
}

enum PartCatalog {
    static let all: [RocketPart] = [
        // MARK: - Stage 1 (S1-01 … S1-12)
        RocketPart(id: "S1-01", displayName: "Moon Giant S1", role: .s1, heightClass: .xl, diameterClass: .xl, palette: "banded"),
        RocketPart(id: "S1-02", displayName: "Pencil Core", role: .s1, heightClass: .m, diameterClass: .m, palette: "corrugated"),
        RocketPart(id: "S1-03", displayName: "Cyan Giant Core", role: .s1, heightClass: .xl, diameterClass: .xl, palette: "cyanOrange"),
        RocketPart(id: "S1-04", displayName: "Gridfin Tower", role: .s1, heightClass: .l, diameterClass: .m, palette: "blackWhite"),
        RocketPart(id: "S1-05", displayName: "Smooth Core", role: .s1, heightClass: .l, diameterClass: .m, palette: "silver"),
        RocketPart(id: "S1-06", displayName: "Green Cryo Core", role: .s1, heightClass: .l, diameterClass: .m, palette: "green"),
        RocketPart(id: "S1-07", displayName: "White Nozzle Core", role: .s1, heightClass: .l, diameterClass: .m, palette: "white"),
        RocketPart(id: "S1-08", displayName: "Wide Cryo Core", role: .s1, heightClass: .l, diameterClass: .l, palette: "whiteOrange"),
        RocketPart(id: "S1-09", displayName: "Outrigger Hex", role: .s1, heightClass: .l, diameterClass: .l, palette: "outrigger"),
        RocketPart(id: "S1-10", displayName: "Yellow Clean Core", role: .s1, heightClass: .l, diameterClass: .m, palette: "yellow"),
        RocketPart(id: "S1-11", displayName: "Orange Foam Core", role: .s1, heightClass: .xl, diameterClass: .xl, palette: "orange"),
        RocketPart(id: "S1-12", displayName: "Blue Night Tower", role: .s1, heightClass: .xl, diameterClass: .l, palette: "blueBlack"),

        // MARK: - Stage 2 (S2-01 … S2-10)
        RocketPart(id: "S2-01", displayName: "Moon Giant S2", role: .s2, heightClass: .l, diameterClass: .xl, palette: "banded"),
        RocketPart(id: "S2-02", displayName: "Moon Transfer", role: .s2, heightClass: .m, diameterClass: .l, palette: "banded"),
        RocketPart(id: "S2-03", displayName: "Pencil Upper", role: .s2, heightClass: .s, diameterClass: .s, palette: "corrugated"),
        RocketPart(id: "S2-04", displayName: "Vacuum Upper", role: .s2, heightClass: .m, diameterClass: .m, palette: "blackWhite"),
        RocketPart(id: "S2-05", displayName: "Silver Skin Tank", role: .s2, heightClass: .m, diameterClass: .s, palette: "silver"),
        RocketPart(id: "S2-06", displayName: "Compact Cryo Upper", role: .s2, heightClass: .m, diameterClass: .m, palette: "white"),
        RocketPart(id: "S2-07", displayName: "Wide Cryo Upper", role: .s2, heightClass: .m, diameterClass: .l, palette: "whiteOrange"),
        RocketPart(id: "S2-08", displayName: "Toroid Upper", role: .s2, heightClass: .s, diameterClass: .m, palette: "outrigger"),
        RocketPart(id: "S2-09", displayName: "Sea Upper", role: .s2, heightClass: .m, diameterClass: .m, palette: "yellow"),
        RocketPart(id: "S2-10", displayName: "Wide Hydro Upper", role: .s2, heightClass: .l, diameterClass: .l, palette: "blueBlack"),

        // MARK: - Payload (PL-01 … PL-08)
        RocketPart(id: "PL-01", displayName: "Escape Cone", role: .payload, heightClass: .s, diameterClass: .m, palette: "cone"),
        RocketPart(id: "PL-02", displayName: "Ball Cone Capsule", role: .payload, heightClass: .s, diameterClass: .s, palette: "capsule"),
        RocketPart(id: "PL-03", displayName: "Orbiter Delta", role: .payload, heightClass: .m, diameterClass: .l, palette: "orbiter"),
        RocketPart(id: "PL-04", displayName: "Orange Tank", role: .payload, heightClass: .l, diameterClass: .l, palette: "orange"),
        RocketPart(id: "PL-05", displayName: "Trunc Capsule", role: .payload, heightClass: .s, diameterClass: .s, palette: "capsule"),
        RocketPart(id: "PL-06", displayName: "Dual Nest Fairing", role: .payload, heightClass: .m, diameterClass: .m, palette: "fairing"),
        RocketPart(id: "PL-07", displayName: "Round Fairing", role: .payload, heightClass: .m, diameterClass: .m, palette: "fairing"),
        RocketPart(id: "PL-08", displayName: "Sister Orbiter", role: .payload, heightClass: .m, diameterClass: .l, palette: "orbiter"),

        // MARK: - Side boosters (SB-01 … SB-06)
        RocketPart(id: "SB-01", displayName: "Gridfin Booster Pair", role: .sideBooster, heightClass: .l, diameterClass: .m, palette: "blackWhite"),
        RocketPart(id: "SB-02", displayName: "Segment Solid Pair", role: .sideBooster, heightClass: .l, diameterClass: .s, palette: "white"),
        RocketPart(id: "SB-03", displayName: "Tall Solid Pair", role: .sideBooster, heightClass: .l, diameterClass: .s, palette: "white"),
        RocketPart(id: "SB-04", displayName: "Liquid Strap Pair", role: .sideBooster, heightClass: .l, diameterClass: .m, palette: "cyanOrange"),
        RocketPart(id: "SB-05", displayName: "Slim Solid Pair", role: .sideBooster, heightClass: .m, diameterClass: .s, palette: "white"),
        RocketPart(id: "SB-06", displayName: "Quad Liquid Boosters", role: .sideBooster, heightClass: .l, diameterClass: .m, palette: "whiteOrange"),
    ]

    static func parts(role: PartRole) -> [RocketPart] {
        all.filter { $0.role == role }
    }

    static func part(id: String) -> RocketPart? {
        all.first { $0.id == id }
    }
}
