import SwiftUI
import SpriteKit

struct ContentView: View {
    @StateObject private var assembly = AssemblyState()
    @State private var scene = GameScene(size: CGSize(width: 1280, height: 720))
    @State private var skyTick: Int = 0
    @Environment(\.scenePhase) private var scenePhase

    var body: some View {
        ZStack {
            SpriteView(scene: scene, options: [.ignoresSiblingOrder])
                .ignoresSafeArea()
                .onAppear {
                    configureScene()
                    scene.refreshSky()
                }
                .onChange(of: scenePhase) { _, phase in
                    if phase == .active {
                        scene.refreshSky()
                    }
                }

            VStack(spacing: 0) {
                topBar
                Spacer()
                if assembly.padPhase == .assemble {
                    // Minimal pad-native chips (plates already include tray art; no Fun B chrome)
                    lockTrayChips
                }
                if assembly.padPhase == .mission {
                    missionChoiceOverlay
                }
                bottomBar
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 8)
        }
        .preferredColorScheme(.dark)
        .statusBarHidden(true)
        .onChange(of: assembly.selectedS1?.id) { _, _ in scene.rebuildStack() }
        .onChange(of: assembly.selectedS2?.id) { _, _ in scene.rebuildStack() }
        .onChange(of: assembly.selectedPayload?.id) { _, _ in scene.rebuildStack() }
        .onChange(of: assembly.selectedSideBooster?.id) { _, _ in scene.rebuildStack() }
        .onChange(of: assembly.sideBoostersEnabled) { _, _ in scene.rebuildStack() }
    }

    private func configureScene() {
        scene.scaleMode = .aspectFill
        scene.configure(assembly: assembly)
    }

    // MARK: - Chrome

    private var topBar: some View {
        HStack {
            VStack(alignment: .leading, spacing: 2) {
                Text("ROCKET BAY")
                    .font(.system(size: 14, weight: .bold, design: .monospaced))
                    .foregroundStyle(.white)
                Button {
                    // Dev mock clock: day, morning golden, evening golden, evening blue, night
                    let hours = [12, 7, 18, 20, 23]
                    let cur = SkyClock.mockHour ?? SkyClock.currentHour()
                    let idx = hours.firstIndex(of: cur).map { ($0 + 1) % hours.count } ?? 0
                    SkyClock.mockHour = hours[idx]
                    skyTick += 1
                    scene.refreshSky()
                } label: {
                    let hour = SkyClock.currentHour()
                    let period = SkyClock.period(forHour: hour)
                    let tod = GameScene.padTOD(period: period, hour: hour)
                    Text("\(period.label.uppercased()) → \(tod.rawValue.uppercased())  ·  tap to cycle")
                        .font(.system(size: 10, weight: .medium, design: .monospaced))
                        .foregroundStyle(.white.opacity(0.7))
                        .id(skyTick)
                }
            }
            Spacer()
            if assembly.padPhase != .assemble {
                Button("BACK TO BAY") {
                    assembly.resetToBay()
                    scene.resetToAssemble()
                }
                .font(.system(size: 11, weight: .bold, design: .monospaced))
                .padding(.horizontal, 10)
                .padding(.vertical, 6)
                .background(Color.white.opacity(0.15))
                .clipShape(RoundedRectangle(cornerRadius: 4))
                .foregroundStyle(.white)
            } else {
                Button("CLEAR") {
                    assembly.clearStack()
                    scene.rebuildStack()
                }
                .font(.system(size: 11, weight: .bold, design: .monospaced))
                .padding(.horizontal, 10)
                .padding(.vertical, 6)
                .background(Color.white.opacity(0.15))
                .clipShape(RoundedRectangle(cornerRadius: 4))
                .foregroundStyle(.white)
            }
        }
        .padding(10)
        .background(Color.black.opacity(0.45))
        .clipShape(RoundedRectangle(cornerRadius: 8))
    }

    /// Six exact lock names — pad-native minimal chips (not Fun B tray chrome).
    private var lockTrayChips: some View {
        VStack(spacing: 6) {
            Text("TRAY")
                .font(.system(size: 9, weight: .bold, design: .monospaced))
                .foregroundStyle(.white.opacity(0.55))
                .frame(maxWidth: .infinity, alignment: .leading)
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 8) {
                    ForEach(assembly.lockTrayParts) { part in
                        Button {
                            assembly.select(part)
                        } label: {
                            Text(part.displayName)
                                .font(.system(size: 11, weight: .semibold, design: .monospaced))
                                .lineLimit(1)
                                .foregroundStyle(.white)
                                .padding(.horizontal, 10)
                                .padding(.vertical, 8)
                                .background(isSelected(part) ? Color.cyan.opacity(0.35) : Color.white.opacity(0.10))
                                .overlay(
                                    RoundedRectangle(cornerRadius: 4)
                                        .stroke(isSelected(part) ? Color.cyan : Color.white.opacity(0.2), lineWidth: 1)
                                )
                                .clipShape(RoundedRectangle(cornerRadius: 4))
                        }
                    }
                }
            }
            // Compact role tray for remaining catalog (S2 etc.) — minimal, not Fun B
            HStack(spacing: 6) {
                ForEach([PartRole.s1, .s2, .payload, .sideBooster], id: \.self) { role in
                    Button(role.trayLabel.uppercased()) {
                        assembly.catalogRole = role
                    }
                    .font(.system(size: 9, weight: .bold, design: .monospaced))
                    .padding(.horizontal, 6)
                    .padding(.vertical, 4)
                    .background(assembly.catalogRole == role ? Color.orange.opacity(0.7) : Color.white.opacity(0.08))
                    .clipShape(RoundedRectangle(cornerRadius: 3))
                    .foregroundStyle(.white)
                }
            }
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 6) {
                    ForEach(assembly.trayParts) { part in
                        Button {
                            assembly.select(part)
                        } label: {
                            Text(part.displayName)
                                .font(.system(size: 10, weight: .medium, design: .monospaced))
                                .lineLimit(1)
                                .foregroundStyle(.white.opacity(0.9))
                                .padding(.horizontal, 8)
                                .padding(.vertical, 6)
                                .background(isSelected(part) ? Color.cyan.opacity(0.3) : Color.white.opacity(0.08))
                                .clipShape(RoundedRectangle(cornerRadius: 3))
                        }
                    }
                }
            }
        }
        .padding(8)
        .background(Color.black.opacity(0.35))
        .clipShape(RoundedRectangle(cornerRadius: 6))
    }

    private func isSelected(_ part: RocketPart) -> Bool {
        switch part.role {
        case .s1: return assembly.selectedS1?.id == part.id
        case .s2: return assembly.selectedS2?.id == part.id
        case .payload: return assembly.selectedPayload?.id == part.id
        case .sideBooster: return assembly.selectedSideBooster?.id == part.id
        }
    }

    /// Mission plate: exact two-choice labels.
    private var missionChoiceOverlay: some View {
        HStack(spacing: 16) {
            Button {
                assembly.missionChoice = "Deploy payload"
            } label: {
                Text("Deploy payload")
                    .font(.system(size: 14, weight: .bold, design: .monospaced))
                    .padding(.horizontal, 18)
                    .padding(.vertical, 14)
                    .frame(maxWidth: .infinity)
                    .background(assembly.missionChoice == "Deploy payload" ? Color.cyan.opacity(0.45) : Color.white.opacity(0.14))
                    .overlay(
                        RoundedRectangle(cornerRadius: 6)
                            .stroke(Color.white.opacity(0.35), lineWidth: 1)
                    )
                    .clipShape(RoundedRectangle(cornerRadius: 6))
                    .foregroundStyle(.white)
            }
            Button {
                assembly.missionChoice = "Explore the universe"
            } label: {
                Text("Explore the universe")
                    .font(.system(size: 14, weight: .bold, design: .monospaced))
                    .padding(.horizontal, 18)
                    .padding(.vertical, 14)
                    .frame(maxWidth: .infinity)
                    .background(assembly.missionChoice == "Explore the universe" ? Color.cyan.opacity(0.45) : Color.white.opacity(0.14))
                    .overlay(
                        RoundedRectangle(cornerRadius: 6)
                            .stroke(Color.white.opacity(0.35), lineWidth: 1)
                    )
                    .clipShape(RoundedRectangle(cornerRadius: 6))
                    .foregroundStyle(.white)
            }
        }
        .padding(12)
        .background(Color.black.opacity(0.5))
        .clipShape(RoundedRectangle(cornerRadius: 8))
    }

    private var bottomBar: some View {
        HStack {
            VStack(alignment: .leading, spacing: 2) {
                stackSummary
            }
            Spacer()
            if assembly.padPhase == .assemble {
                Button {
                    goForLaunch()
                } label: {
                    Text("GO FOR LAUNCH")
                        .font(.system(size: 13, weight: .black, design: .monospaced))
                        .padding(.horizontal, 16)
                        .padding(.vertical, 12)
                        .background(assembly.canLaunch ? Color.orange : Color.gray.opacity(0.5))
                        .clipShape(RoundedRectangle(cornerRadius: 6))
                        .foregroundStyle(.white)
                }
                .disabled(!assembly.canLaunch)
            } else if assembly.padPhase == .grounded {
                Button {
                    enterMission()
                } label: {
                    Text("ENTER MISSION")
                        .font(.system(size: 13, weight: .black, design: .monospaced))
                        .padding(.horizontal, 16)
                        .padding(.vertical, 12)
                        .background(Color.orange)
                        .clipShape(RoundedRectangle(cornerRadius: 6))
                        .foregroundStyle(.white)
                }
            } else {
                Text(assembly.missionChoice ?? "ON MISSION")
                    .font(.system(size: 12, weight: .bold, design: .monospaced))
                    .foregroundStyle(.white.opacity(0.85))
                    .padding(.horizontal, 12)
                    .padding(.vertical, 10)
            }
        }
        .padding(10)
        .background(Color.black.opacity(0.45))
        .clipShape(RoundedRectangle(cornerRadius: 8))
    }

    private var stackSummary: some View {
        Group {
            Text(short(assembly.selectedS1) + " / " + short(assembly.selectedS2) + " / " + short(assembly.selectedPayload))
                .font(.system(size: 10, weight: .medium, design: .monospaced))
                .foregroundStyle(.white.opacity(0.85))
                .lineLimit(2)
            if assembly.sideBoostersEnabled {
                Text("+ \(assembly.selectedSideBooster?.displayName ?? "Boosters")")
                    .font(.system(size: 9, design: .monospaced))
                    .foregroundStyle(.orange.opacity(0.9))
            }
            Text("PHASE \(assembly.padPhase.rawValue.uppercased())")
                .font(.system(size: 9, weight: .bold, design: .monospaced))
                .foregroundStyle(.white.opacity(0.5))
        }
    }

    private func short(_ part: RocketPart?) -> String {
        part?.displayName ?? "—"
    }

    private func goForLaunch() {
        guard assembly.canLaunch else { return }
        assembly.isTransitioning = true
        scene.goForLaunch {
            assembly.isTransitioning = false
            assembly.advanceToGrounded()
            scene.setPhase(.grounded, animated: false)
        }
    }

    private func enterMission() {
        guard assembly.canEnterMission else { return }
        assembly.isTransitioning = true
        scene.enterMission {
            assembly.isTransitioning = false
            assembly.advanceToMission()
            scene.setPhase(.mission, animated: false)
        }
    }
}

#Preview {
    ContentView()
}
