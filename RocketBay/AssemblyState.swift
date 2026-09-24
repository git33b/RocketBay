import Foundation
import Combine

/// Current mix-and-match stack selection. Always allows any combo (MVP-1).
final class AssemblyState: ObservableObject {
    @Published var selectedS1: RocketPart?
    @Published var selectedS2: RocketPart?
    @Published var selectedPayload: RocketPart?
    @Published var selectedSideBooster: RocketPart?
    @Published var sideBoostersEnabled: Bool = false
    @Published var catalogRole: PartRole = .s1
    /// false = warehouse bay; true = pad revealed after wall drop.
    @Published var isOnPad: Bool = false
    @Published var isTransitioning: Bool = false

    var canLaunch: Bool {
        selectedS1 != nil && selectedS2 != nil && selectedPayload != nil && !isOnPad && !isTransitioning
    }

    var trayParts: [RocketPart] {
        PartCatalog.parts(role: catalogRole)
    }

    func select(_ part: RocketPart) {
        guard !isOnPad, !isTransitioning else { return }
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
        guard !isOnPad, !isTransitioning else { return }
        sideBoostersEnabled.toggle()
        if sideBoostersEnabled && selectedSideBooster == nil {
            selectedSideBooster = PartCatalog.parts(role: .sideBooster).first
        }
    }

    func resetToBay() {
        isOnPad = false
        isTransitioning = false
    }

    func clearStack() {
        guard !isTransitioning else { return }
        selectedS1 = nil
        selectedS2 = nil
        selectedPayload = nil
        selectedSideBooster = nil
        sideBoostersEnabled = false
        isOnPad = false
        isTransitioning = false
    }
}
