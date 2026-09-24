import SpriteKit
import UIKit

/// Warehouse bay → pad reveal using approved mvp1 stills + procedural interactive stack.
final class GameScene: SKScene {

    // MARK: - Layers
    private let padBackdrop = SKSpriteNode()
    private let warehouseNode = SKNode()
    private let leftWall = SKSpriteNode()
    private let rightWall = SKSpriteNode()
    private let stackNode = SKNode()
    private let steamNode = SKNode()

    private weak var assembly: AssemblyState?

    private var lastSkyPeriod: SkyPeriod?
    private var lastPadAssetName: String?
    private var wallDropCompleted = false

    // Logical design size (portrait tall) — matches ART-DIRECTION canvas
    private let designW: CGFloat = 390
    private let designH: CGFloat = 844

    // Stack base Y above scene bottom (stand/pad area ~center, tall)
    private var stackBaseY: CGFloat { 130 }

    // MARK: - Setup

    func configure(assembly: AssemblyState) {
        self.assembly = assembly
        rebuildStack()
    }

    override func didMove(to view: SKView) {
        backgroundColor = .black
        scaleMode = .aspectFill
        anchorPoint = CGPoint(x: 0.5, y: 0.5)
        size = CGSize(width: designW, height: designH)

        view.ignoresSiblingOrder = true

        buildPadBackdrop()
        buildWarehousePanels()
        addChild(steamNode)
        steamNode.zPosition = 40

        addChild(stackNode)
        stackNode.zPosition = 50
        stackNode.position = CGPoint(x: 0, y: stackBaseY - designH / 2)

        refreshSky()
        rebuildStack()
        applyPreLaunchState()
    }

    // MARK: - Textures (nearest-neighbor / PSP-sharp)

    private func nearestTexture(named name: String) -> SKTexture {
        let tex = SKTexture(imageNamed: name)
        tex.filteringMode = .nearest
        return tex
    }

    private func fitBackdrop(_ sprite: SKSpriteNode, texture: SKTexture) {
        sprite.texture = texture
        // Cover design canvas (aspect-fill)
        let texSize = texture.size()
        guard texSize.width > 0, texSize.height > 0 else {
            sprite.size = CGSize(width: designW, height: designH)
            return
        }
        let scale = max(designW / texSize.width, designH / texSize.height)
        sprite.size = CGSize(width: texSize.width * scale, height: texSize.height * scale)
        sprite.position = .zero
    }

    // MARK: - Pad still (SkyClock-driven)

    private func buildPadBackdrop() {
        padBackdrop.name = "padBackdrop"
        padBackdrop.zPosition = -100
        padBackdrop.alpha = 0
        addChild(padBackdrop)
        applyPadStill(for: SkyClock.palette().period, animated: false)
    }

    /// Map sky period (+ hour for golden) → approved pad still name.
    private func padAssetName(for period: SkyPeriod) -> String {
        let hour = SkyClock.currentHour()
        switch period {
        case .day:
            return "PadSunrise"
        case .goldenHour:
            // Morning golden → sunrise; evening golden → sunset
            return hour < 12 ? "PadSunrise" : "PadSunset"
        case .blueHour, .night:
            return "PadNight"
        }
    }

    private func applyPadStill(for period: SkyPeriod, animated: Bool) {
        let name = padAssetName(for: period)
        guard name != lastPadAssetName else { return }
        lastPadAssetName = name
        let tex = nearestTexture(named: name)
        if animated, padBackdrop.texture != nil, wallDropCompleted {
            let next = SKSpriteNode()
            fitBackdrop(next, texture: tex)
            next.zPosition = padBackdrop.zPosition + 1
            next.alpha = 0
            addChild(next)
            next.run(SKAction.sequence([
                SKAction.fadeIn(withDuration: 0.45),
                SKAction.run { [weak self] in
                    guard let self else { return }
                    self.fitBackdrop(self.padBackdrop, texture: tex)
                    next.removeFromParent()
                }
            ]))
        } else {
            fitBackdrop(padBackdrop, texture: tex)
        }
    }

    func refreshSky() {
        let palette = SkyClock.palette()
        lastSkyPeriod = palette.period
        // Always re-evaluate still (golden morning vs evening share period but differ by hour)
        applyPadStill(for: palette.period, animated: wallDropCompleted)
    }

    // MARK: - Warehouse still as left/right slide panels

    private func buildWarehousePanels() {
        warehouseNode.name = "warehouse"
        warehouseNode.zPosition = 20
        addChild(warehouseNode)

        let full = nearestTexture(named: "WarehouseAssemble")
        // SKTexture rect: origin bottom-left, normalized
        let leftTex = SKTexture(rect: CGRect(x: 0, y: 0, width: 0.5, height: 1), in: full)
        leftTex.filteringMode = .nearest
        let rightTex = SKTexture(rect: CGRect(x: 0.5, y: 0, width: 0.5, height: 1), in: full)
        rightTex.filteringMode = .nearest

        let texSize = full.size()
        let scale = max(designW / max(texSize.width, 1), designH / max(texSize.height, 1))
        let fullW = texSize.width * scale
        let fullH = texSize.height * scale
        let halfW = fullW / 2

        leftWall.name = "leftWall"
        leftWall.texture = leftTex
        leftWall.size = CGSize(width: halfW, height: fullH)
        leftWall.position = CGPoint(x: -halfW / 2, y: 0)
        leftWall.zPosition = 1

        rightWall.name = "rightWall"
        rightWall.texture = rightTex
        rightWall.size = CGSize(width: halfW, height: fullH)
        rightWall.position = CGPoint(x: halfW / 2, y: 0)
        rightWall.zPosition = 1

        warehouseNode.addChild(leftWall)
        warehouseNode.addChild(rightWall)
    }

    private func applyPreLaunchState() {
        padBackdrop.alpha = 0
        warehouseNode.alpha = 1
        leftWall.alpha = 1
        rightWall.alpha = 1
        leftWall.position.x = -leftWall.size.width / 2
        rightWall.position.x = rightWall.size.width / 2
        // Recenter halves relative to scene
        let halfW = leftWall.size.width
        leftWall.position = CGPoint(x: -halfW / 2, y: 0)
        rightWall.position = CGPoint(x: halfW / 2, y: 0)
        steamNode.removeAllChildren()
    }

    // MARK: - Stack assembly (procedural parts on top of stills)

    func rebuildStack() {
        stackNode.removeAllChildren()
        guard let assembly else { return }

        var yCursor: CGFloat = 0
        let coreWidthBase: CGFloat = 36

        if assembly.sideBoostersEnabled, let booster = assembly.selectedSideBooster, let s1 = assembly.selectedS1 {
            let bH = partHeight(booster) * 0.95
            let bW = coreWidthBase * booster.diameterClass.diameterFactor * 0.7
            let gap = coreWidthBase * s1.diameterClass.diameterFactor * 0.55 + bW * 0.55 + 4
            for sign in [-1.0, 1.0] as [CGFloat] {
                let node = makePartSprite(booster, width: bW, height: bH)
                node.position = CGPoint(x: sign * gap, y: bH / 2)
                node.zPosition = 1
                stackNode.addChild(node)
            }
        }

        if let s1 = assembly.selectedS1 {
            let h = partHeight(s1)
            let w = coreWidthBase * s1.diameterClass.diameterFactor
            let node = makePartSprite(s1, width: w, height: h)
            node.position = CGPoint(x: 0, y: yCursor + h / 2)
            node.zPosition = 10
            stackNode.addChild(node)
            yCursor += h
        }

        if let s2 = assembly.selectedS2 {
            let h = partHeight(s2)
            let w = coreWidthBase * s2.diameterClass.diameterFactor
            let node = makePartSprite(s2, width: w, height: h)
            node.position = CGPoint(x: 0, y: yCursor + h / 2)
            node.zPosition = 11
            stackNode.addChild(node)
            yCursor += h
        }

        if let pl = assembly.selectedPayload {
            let h = partHeight(pl)
            let w = coreWidthBase * pl.diameterClass.diameterFactor
            let node = makePartSprite(pl, width: w, height: h)
            node.position = CGPoint(x: 0, y: yCursor + h / 2)
            node.zPosition = 12
            stackNode.addChild(node)
        }
    }

    private func partHeight(_ part: RocketPart) -> CGFloat {
        70 * part.heightClass.heightFactor
    }

    private func makePartSprite(_ part: RocketPart, width: CGFloat, height: CGFloat) -> SKNode {
        let root = SKNode()
        root.name = part.id

        let body: SKShapeNode
        switch part.role {
        case .payload:
            let path = UIBezierPath()
            path.move(to: CGPoint(x: -width / 2, y: -height / 2))
            path.addLine(to: CGPoint(x: width / 2, y: -height / 2))
            path.addLine(to: CGPoint(x: 0, y: height / 2))
            path.close()
            body = SKShapeNode(path: path.cgPath)
        default:
            body = SKShapeNode(rectOf: CGSize(width: width, height: height), cornerRadius: 2)
        }

        let colors = paletteColors(part.palette)
        body.fillColor = colors.fill
        body.strokeColor = colors.stroke
        body.lineWidth = 2
        root.addChild(body)

        if part.role != .payload {
            let band = SKShapeNode(rectOf: CGSize(width: width, height: max(4, height * 0.08)))
            band.fillColor = colors.accent
            band.strokeColor = .clear
            band.position = CGPoint(x: 0, y: height * 0.25)
            root.addChild(band)

            let band2 = SKShapeNode(rectOf: CGSize(width: width, height: max(3, height * 0.05)))
            band2.fillColor = colors.accent
            band2.strokeColor = .clear
            band2.position = CGPoint(x: 0, y: -height * 0.2)
            root.addChild(band2)
        }

        if part.role == .s1 || part.role == .sideBooster {
            let bellCount = part.diameterClass == .xl ? 5 : (part.diameterClass == .l ? 3 : 1)
            let bellW = width / CGFloat(bellCount + 1)
            for i in 0..<bellCount {
                let bell = SKShapeNode(rectOf: CGSize(width: bellW * 0.7, height: 10), cornerRadius: 1)
                bell.fillColor = SKColor(red: 0.45, green: 0.4, blue: 0.35, alpha: 1)
                bell.strokeColor = SKColor(white: 0.2, alpha: 1)
                bell.lineWidth = 1
                let spacing = width / CGFloat(bellCount + 1)
                bell.position = CGPoint(
                    x: -width / 2 + spacing * CGFloat(i + 1),
                    y: -height / 2 - 5
                )
                root.addChild(bell)
            }
        }

        if part.palette == "blackWhite", part.role == .s1 || part.role == .sideBooster {
            for sign in [-1.0, 1.0] as [CGFloat] {
                let fin = SKShapeNode(rectOf: CGSize(width: 8, height: 14))
                fin.fillColor = SKColor(white: 0.7, alpha: 1)
                fin.strokeColor = SKColor(white: 0.2, alpha: 1)
                fin.lineWidth = 1
                fin.position = CGPoint(x: sign * (width / 2 + 4), y: height * 0.35)
                root.addChild(fin)
            }
        }

        return root
    }

    private func paletteColors(_ key: String) -> (fill: SKColor, stroke: SKColor, accent: SKColor) {
        switch key {
        case "banded":
            return (SKColor(white: 0.92, alpha: 1), SKColor(white: 0.15, alpha: 1), SKColor(white: 0.12, alpha: 1))
        case "corrugated":
            return (SKColor(red: 0.75, green: 0.72, blue: 0.65, alpha: 1), SKColor(white: 0.2, alpha: 1), SKColor(red: 0.55, green: 0.5, blue: 0.4, alpha: 1))
        case "cyanOrange":
            return (SKColor(red: 0.3, green: 0.75, blue: 0.85, alpha: 1), SKColor(white: 0.15, alpha: 1), SKColor(red: 0.95, green: 0.45, blue: 0.15, alpha: 1))
        case "blackWhite":
            return (SKColor(white: 0.88, alpha: 1), SKColor(white: 0.1, alpha: 1), SKColor(white: 0.08, alpha: 1))
        case "silver":
            return (SKColor(red: 0.75, green: 0.78, blue: 0.82, alpha: 1), SKColor(white: 0.3, alpha: 1), SKColor(red: 0.5, green: 0.55, blue: 0.6, alpha: 1))
        case "green":
            return (SKColor(red: 0.45, green: 0.65, blue: 0.4, alpha: 1), SKColor(white: 0.2, alpha: 1), SKColor(red: 0.3, green: 0.45, blue: 0.28, alpha: 1))
        case "white":
            return (SKColor(white: 0.95, alpha: 1), SKColor(white: 0.25, alpha: 1), SKColor(red: 0.2, green: 0.4, blue: 0.7, alpha: 1))
        case "whiteOrange":
            return (SKColor(white: 0.93, alpha: 1), SKColor(white: 0.2, alpha: 1), SKColor(red: 0.95, green: 0.5, blue: 0.15, alpha: 1))
        case "outrigger":
            return (SKColor(red: 0.55, green: 0.55, blue: 0.58, alpha: 1), SKColor(white: 0.2, alpha: 1), SKColor(red: 0.7, green: 0.35, blue: 0.2, alpha: 1))
        case "yellow":
            return (SKColor(red: 0.92, green: 0.85, blue: 0.45, alpha: 1), SKColor(white: 0.25, alpha: 1), SKColor(white: 0.9, alpha: 1))
        case "orange":
            return (SKColor(red: 0.95, green: 0.55, blue: 0.2, alpha: 1), SKColor(white: 0.2, alpha: 1), SKColor(white: 0.85, alpha: 1))
        case "blueBlack":
            return (SKColor(red: 0.15, green: 0.25, blue: 0.45, alpha: 1), SKColor(white: 0.1, alpha: 1), SKColor(white: 0.08, alpha: 1))
        case "cone", "capsule", "fairing":
            return (SKColor(white: 0.9, alpha: 1), SKColor(white: 0.2, alpha: 1), SKColor(red: 0.8, green: 0.2, blue: 0.15, alpha: 1))
        case "orbiter":
            return (SKColor(white: 0.85, alpha: 1), SKColor(white: 0.2, alpha: 1), SKColor(red: 0.2, green: 0.35, blue: 0.6, alpha: 1))
        default:
            return (SKColor(white: 0.7, alpha: 1), SKColor(white: 0.2, alpha: 1), SKColor(white: 0.4, alpha: 1))
        }
    }

    // MARK: - Go for Launch (wall panels slide out ~1.2s)

    func goForLaunch(completion: @escaping () -> Void) {
        guard !wallDropCompleted else {
            completion()
            return
        }
        wallDropCompleted = true

        // Ensure pad still matches current sky before reveal
        applyPadStill(for: SkyClock.palette().period, animated: false)

        let duration: TimeInterval = 1.2
        let slideX = designW * 0.55 + 20

        let leftSlide = SKAction.group([
            SKAction.moveBy(x: -slideX, y: -20, duration: duration),
            SKAction.fadeOut(withDuration: duration)
        ])
        leftSlide.timingMode = .easeIn

        let rightSlide = SKAction.group([
            SKAction.moveBy(x: slideX, y: -20, duration: duration),
            SKAction.fadeOut(withDuration: duration)
        ])
        rightSlide.timingMode = .easeIn

        leftWall.run(leftSlide)
        rightWall.run(rightSlide)

        // Reveal pad still under panels
        padBackdrop.run(SKAction.sequence([
            SKAction.wait(forDuration: duration * 0.25),
            SKAction.fadeIn(withDuration: duration * 0.55)
        ]))

        // Slight camera settle on stack
        let settle = SKAction.sequence([
            SKAction.wait(forDuration: duration * 0.5),
            SKAction.moveBy(x: 0, y: -16, duration: 0.5)
        ])
        settle.timingMode = .easeOut
        stackNode.run(settle)

        run(SKAction.sequence([
            SKAction.wait(forDuration: duration * 0.55),
            SKAction.run { [weak self] in self?.startSteamLoop() }
        ]))

        run(SKAction.sequence([
            SKAction.wait(forDuration: duration + 0.15),
            SKAction.run(completion)
        ]))
    }

    // MARK: - Steam (cool blue tint at night / blue hour)

    private func startSteamLoop() {
        steamNode.removeAllChildren()
        steamNode.removeAllActions()
        spawnSteamBurst()
        let loop = SKAction.repeatForever(SKAction.sequence([
            SKAction.wait(forDuration: 1.4),
            SKAction.run { [weak self] in self?.spawnSteamBurst() }
        ]))
        steamNode.run(loop, withKey: "steamLoop")
    }

    private func spawnSteamBurst() {
        let period = SkyClock.palette().period
        let coolNight = (period == .night || period == .blueHour)
        let fill: SKColor = coolNight
            ? SKColor(red: 0.65, green: 0.78, blue: 0.95, alpha: 0.45)
            : SKColor(white: 0.88, alpha: 0.45)

        for i in 0..<5 {
            let puff = SKShapeNode(circleOfRadius: CGFloat.random(in: 7...15))
            puff.fillColor = fill
            puff.strokeColor = .clear
            puff.position = CGPoint(
                x: CGFloat.random(in: -55...55),
                y: -designH / 2 + 100
            )
            puff.zPosition = 1
            steamNode.addChild(puff)
            let drift = SKAction.group([
                SKAction.moveBy(
                    x: CGFloat.random(in: -35...35),
                    y: CGFloat.random(in: 45...100),
                    duration: 1.35
                ),
                SKAction.fadeOut(withDuration: 1.35),
                SKAction.scale(to: 1.9, duration: 1.35)
            ])
            puff.run(SKAction.sequence([
                SKAction.wait(forDuration: Double(i) * 0.07),
                drift,
                SKAction.removeFromParent()
            ]))
        }
    }

    func resetBayVisuals() {
        wallDropCompleted = false
        leftWall.removeAllActions()
        rightWall.removeAllActions()
        padBackdrop.removeAllActions()
        stackNode.removeAllActions()
        steamNode.removeAllActions()
        steamNode.removeAllChildren()

        stackNode.position = CGPoint(x: 0, y: stackBaseY - designH / 2)

        // Rebuild warehouse panels cleanly
        warehouseNode.removeFromParent()
        warehouseNode.removeAllChildren()
        leftWall.removeAllChildren()
        rightWall.removeAllChildren()
        buildWarehousePanels()
        applyPreLaunchState()
        rebuildStack()
    }
}
