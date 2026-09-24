import SpriteKit
import UIKit

/// Pad phase for still selection (liftoff HOLD — not wired).
enum PadPhase: String, CaseIterable {
    case assemble
    case grounded
    case mission
}

/// Time-of-day bucket matching locked plate packs 02–05.
enum PadTOD: String, CaseIterable {
    case sunrise // 02
    case sunset  // 03
    case night   // 04
    case day     // 05

    var packCode: String {
        switch self {
        case .sunrise: return "02"
        case .sunset: return "03"
        case .night: return "04"
        case .day: return "05"
        }
    }

    var titleCase: String {
        switch self {
        case .sunrise: return "Sunrise"
        case .sunset: return "Sunset"
        case .night: return "Night"
        case .day: return "Day"
        }
    }
}

/// Locked uniform pack plates (1280×720). Rocket/tower baked in — no procedural stack overlay.
final class GameScene: SKScene {

    private let plateNode = SKSpriteNode()
    private weak var assembly: AssemblyState?

    private var lastPlateName: String?
    private var currentPhase: PadPhase = .assemble

    /// Matches locked plate pixel size (16:9 landscape).
    private let designW: CGFloat = 1280
    private let designH: CGFloat = 720

    // MARK: - Setup

    func configure(assembly: AssemblyState) {
        self.assembly = assembly
        currentPhase = assembly.padPhase
        refreshPlate(animated: false)
    }

    override func didMove(to view: SKView) {
        backgroundColor = .black
        scaleMode = .aspectFill
        anchorPoint = CGPoint(x: 0.5, y: 0.5)
        size = CGSize(width: designW, height: designH)

        view.ignoresSiblingOrder = true

        plateNode.name = "plate"
        plateNode.zPosition = 0
        addChild(plateNode)

        refreshPlate(animated: false)
    }

    // MARK: - Textures

    private func nearestTexture(named name: String) -> SKTexture {
        let tex = SKTexture(imageNamed: name)
        tex.filteringMode = .nearest
        return tex
    }

    private func fitPlate(_ sprite: SKSpriteNode, texture: SKTexture) {
        sprite.texture = texture
        let texSize = texture.size()
        guard texSize.width > 0, texSize.height > 0 else {
            sprite.size = CGSize(width: designW, height: designH)
            return
        }
        let scale = max(designW / texSize.width, designH / texSize.height)
        sprite.size = CGSize(width: texSize.width * scale, height: texSize.height * scale)
        sprite.position = .zero
    }

    // MARK: - TOD → plate mapping

    /// SkyClock period (+ hour) → locked TOD pack.
    /// sunrise(02) · sunset(03) · night(04) · day(05)
    /// Morning golden → sunrise; evening golden → sunset;
    /// morning blue → sunrise; evening blue → night; night → night; day → day.
    static func padTOD(period: SkyPeriod, hour: Int) -> PadTOD {
        switch period {
        case .day:
            return .day
        case .goldenHour:
            return hour < 12 ? .sunrise : .sunset
        case .blueHour:
            return hour < 12 ? .sunrise : .night
        case .night:
            return .night
        }
    }

    /// Asset name: Pad{02|03|04|05}{Assemble|Grounded|Mission}{Sunrise|Sunset|Night|Day}
    static func plateAssetName(tod: PadTOD, phase: PadPhase) -> String {
        let phaseTitle: String
        switch phase {
        case .assemble: phaseTitle = "Assemble"
        case .grounded: phaseTitle = "Grounded"
        case .mission: phaseTitle = "Mission"
        }
        return "Pad\(tod.packCode)\(phaseTitle)\(tod.titleCase)"
    }

    private func currentTOD() -> PadTOD {
        let hour = SkyClock.currentHour()
        return Self.padTOD(period: SkyClock.period(forHour: hour), hour: hour)
    }

    // MARK: - Plate apply

    func refreshSky() {
        refreshPlate(animated: true)
    }

    func setPhase(_ phase: PadPhase, animated: Bool = true) {
        currentPhase = phase
        refreshPlate(animated: animated)
    }

    func refreshPlate(animated: Bool) {
        if let assembly {
            currentPhase = assembly.padPhase
        }
        let tod = currentTOD()
        let name = Self.plateAssetName(tod: tod, phase: currentPhase)
        applyPlate(named: name, animated: animated)
    }

    private func applyPlate(named name: String, animated: Bool) {
        guard name != lastPlateName else { return }
        let tex = nearestTexture(named: name)
        if animated, lastPlateName != nil, plateNode.texture != nil {
            let next = SKSpriteNode()
            fitPlate(next, texture: tex)
            next.zPosition = plateNode.zPosition + 1
            next.alpha = 0
            addChild(next)
            let newName = name
            next.run(SKAction.sequence([
                SKAction.fadeIn(withDuration: 0.35),
                SKAction.run { [weak self] in
                    guard let self else { return }
                    self.fitPlate(self.plateNode, texture: tex)
                    self.lastPlateName = newName
                    next.removeFromParent()
                }
            ]))
        } else {
            fitPlate(plateNode, texture: tex)
            lastPlateName = name
        }
    }

    // MARK: - Phase transitions (no warehouse wall-drop; no liftoff)

    /// Go for Launch: assemble → grounded (same TOD).
    func goForLaunch(completion: @escaping () -> Void) {
        setPhase(.grounded, animated: true)
        run(SKAction.sequence([
            SKAction.wait(forDuration: 0.4),
            SKAction.run(completion)
        ]))
    }

    /// Grounded → mission (same TOD).
    func enterMission(completion: @escaping () -> Void = {}) {
        setPhase(.mission, animated: true)
        run(SKAction.sequence([
            SKAction.wait(forDuration: 0.35),
            SKAction.run(completion)
        ]))
    }

    /// Back reset → assemble plate.
    func resetToAssemble() {
        lastPlateName = nil
        setPhase(.assemble, animated: false)
    }

    /// Kept for API compat; procedural stack is retired while locked plates are shown.
    func rebuildStack() {
        // no-op: rocket/tower are baked into assemble/grounded/mission plates
    }
}
