import Foundation
import Combine

/// Current mix-and-match stack selection + pad phase. Always allows any combo (MVP-1).
final class AssemblyState: ObservableObject {
    @Published var selectedS1: RocketPart?
    @Published var selectedS2: RocketPart?
    @Published var selectedPayload: RocketPart?
    @Published var selectedSideBooster: RocketPart?
    @Published var sideBoostersEnabled: Bool = false
    @Published var catalogRole: PartRole = .s1
    /// Pad still phase: assemble → grounded → mission (liftoff HOLD).
    @Published var padPhase: PadPhase = .assemble
    @Published var isTransitioning: Bool = false
    /// Mission choice after entering mission plate (nil until tapped).
    @Published var missionChoice: String? = nil

    /// true when pad has advanced past assemble (grounded or mission).
    var isOnPad: Bool { padPhase == .grounded || padPhase == .mission }

    var canLaunch: Bool {
        selectedS1 != nil && selectedS2 != nil && selectedPayload != nil
            && padPhase == .assemble && !isTransitioning
    }

    var canEnterMission: Bool {
        padPhase == .grounded && !isTransitioning
    }

    var trayParts: [RocketPart] {
        // Pad-native tray focus: six locked display names first when browsing all,
        // otherwise role-filtered catalog.
        PartCatalog.parts(role: catalogRole)
    }

    /// Curated six lock-name parts for pad-native tray chips.
    var lockTrayParts: [RocketPart] {
        PartCatalog.lockTray
    }

    func select(_ part: RocketPart) {
        guard padPhase == .assemble, !isTransitioning else { return }
        switch part.role {
        case .s1: selectedS1 = part
        case .s2: selectedS2 = part
        case .payload: selectedPayload = part
        case .sideBooster:
            selectedSideBooster = part
            sideBoostersEnabled = true
        }
    }

    func toggleSideBoosters() {
        guard padPhase == .assemble, !isTransitioning else { return }
        sideBoostersEnabled.toggle()
        if sideBoostersEnabled && selectedSideBooster == nil {
            selectedSideBooster = PartCatalog.parts(role: .sideBooster).first
        }
    }

    func advanceToGrounded() {
        padPhase = .grounded
        missionChoice = nil
    }

    func advanceToMission() {
        padPhase = .mission
        missionChoice = nil
    }

    func resetToBay() {
        padPhase = .assemble
        isTransitioning = false
        missionChoice = nil
    }

    func clearStack() {
        guard !isTransitioning else { return }
        selectedS1 = nil
        selectedS2 = nil
        selectedPayload = nil
        selectedSideBooster = nil
        sideBoostersEnabled = false
        padPhase = .assemble
        isTransitioning = false
        missionChoice = nil
    }
}
