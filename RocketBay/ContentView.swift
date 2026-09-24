import SwiftUI
import SpriteKit

struct ContentView: View {
    @StateObject private var assembly = AssemblyState()
    @State private var scene = GameScene(size: CGSize(width: 390, height: 844))
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
                if !assembly.isOnPad {
                    catalogTray
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
                    // Dev mock clock: cycle period representative hours
                    let hours = [12, 7, 18, 20, 23] // day, sunrise golden, sunset golden, blue, night
                    let cur = SkyClock.mockHour ?? SkyClock.currentHour()
                    let idx = hours.firstIndex(of: cur).map { ($0 + 1) % hours.count } ?? 0
                    SkyClock.mockHour = hours[idx]
                    skyTick += 1
                    scene.refreshSky()
                } label: {
                    Text(SkyClock.palette().period.label.uppercased() + "  ·  tap to cycle")
                        .font(.system(size: 10, weight: .medium, design: .monospaced))
                        .foregroundStyle(.white.opacity(0.7))
                        .id(skyTick)
                }
            }
            Spacer()
            if assembly.isOnPad {
                Button("BACK TO BAY") {
                    assembly.resetToBay()
                    scene.resetBayVisuals()
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

    private var catalogTray: some View {
        VStack(spacing: 8) {
            // Role tabs
            HStack(spacing: 6) {
                ForEach([PartRole.s1, .s2, .payload, .sideBooster], id: \.self) { role in
                    Button(role.trayLabel.uppercased()) {
                        assembly.catalogRole = role
                    }
                    .font(.system(size: 10, weight: .bold, design: .monospaced))
                    .padding(.horizontal, 8)
                    .padding(.vertical, 6)
                    .background(assembly.catalogRole == role ? Color.orange.opacity(0.85) : Color.white.opacity(0.12))
                    .clipShape(RoundedRectangle(cornerRadius: 4))
                    .foregroundStyle(.white)
                }
            }

            // Part chips
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 8) {
                    ForEach(assembly.trayParts) { part in
                        Button {
                            assembly.select(part)
                        } label: {
                            VStack(alignment: .leading, spacing: 2) {
                                Text(part.displayName)
                                    .font(.system(size: 11, weight: .semibold, design: .monospaced))
                                    .lineLimit(2)
                                    .multilineTextAlignment(.leading)
                                Text("\(part.heightClass.rawValue)/\(part.diameterClass.rawValue)")
                                    .font(.system(size: 9, design: .monospaced))
                                    .opacity(0.7)
                            }
                            .foregroundStyle(.white)
                            .frame(width: 108, alignment: .leading)
                            .padding(8)
                            .background(isSelected(part) ? Color.cyan.opacity(0.35) : Color.white.opacity(0.12))
                            .overlay(
                                RoundedRectangle(cornerRadius: 4)
                                    .stroke(isSelected(part) ? Color.cyan : Color.clear, lineWidth: 2)
                            )
                            .clipShape(RoundedRectangle(cornerRadius: 4))
                        }
                    }
                }
            }

            // Side booster toggle
            Toggle(isOn: Binding(
                get: { assembly.sideBoostersEnabled },
                set: { newVal in
                    if newVal != assembly.sideBoostersEnabled {
                        assembly.toggleSideBoosters()
                    }
                }
            )) {
                Text("SIDE BOOSTERS")
                    .font(.system(size: 11, weight: .bold, design: .monospaced))
                    .foregroundStyle(.white)
            }
            .toggleStyle(SwitchToggleStyle(tint: .orange))
            .padding(.horizontal, 4)
        }
        .padding(10)
        .background(Color.black.opacity(0.55))
        .clipShape(RoundedRectangle(cornerRadius: 8))
    }

    private func isSelected(_ part: RocketPart) -> Bool {
        switch part.role {
        case .s1: return assembly.selectedS1?.id == part.id
        case .s2: return assembly.selectedS2?.id == part.id
        case .payload: return assembly.selectedPayload?.id == part.id
        case .sideBooster: return assembly.selectedSideBooster?.id == part.id
        }
    }

    private var bottomBar: some View {
        HStack {
            VStack(alignment: .leading, spacing: 2) {
                stackSummary
            }
            Spacer()
            Button {
                goForLaunch()
            } label: {
                Text(assembly.isOnPad ? "ON PAD" : "GO FOR LAUNCH")
                    .font(.system(size: 13, weight: .black, design: .monospaced))
                    .padding(.horizontal, 16)
                    .padding(.vertical, 12)
                    .background(assembly.canLaunch ? Color.orange : Color.gray.opacity(0.5))
                    .clipShape(RoundedRectangle(cornerRadius: 6))
                    .foregroundStyle(.white)
            }
            .disabled(!assembly.canLaunch)
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
            assembly.isOnPad = true
        }
    }
}

#Preview {
    ContentView()
}
