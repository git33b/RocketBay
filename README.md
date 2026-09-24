# Rocket Bay (MVP-1)

Mix-and-match rocket stacker: assemble Stage 1 / Stage 2 / Payload (+ optional side boosters) in a warehouse bay, then **Go for Launch** to drop the bay walls and reveal the pad. Sky gradient follows device local time.

**Bundle display name:** Rocket Bay  
**Bundle ID:** `com.ateeb.RocketBay`  
**Target:** iOS 17+, Swift 5, portrait, SwiftUI + SpriteKit  
**Out of scope (do not expect):** systems check, fuel, countdown, flight, separation, splashdown, IAP, career.

**Art (MVP-1b):** Backdrop stills matched to approved `/workspace/rocket-designs/mvp1/` frames (warehouse + pad sunrise/sunset/night). Pending Mac/Simulator visual verify.

Trademark policy: UI and metadata use **generic display names only** (e.g. Moon Giant S1, Pencil Core, Gridfin Booster Pair, Escape Cone, Orange Tank). Research IDs like `S1-01` exist only as code/JSON keys.

---

## Open & run on a Mac

1. Copy `/workspace/RocketBay` to your Mac (or open it if this folder is already synced).
2. Double-open **`RocketBay.xcodeproj`** in Xcode 15+.
3. Select an iPhone simulator (e.g. iPhone 16) or a connected device.
4. Set your **Team** under Signing & Capabilities if deploying to a device (Simulator works with automatic signing empty team in many setups).
5. Press **Run** (⌘R).

### Success checklist (MVP-1)

| # | Criterion | How to verify |
|---|-----------|---------------|
| 1 | SwiftUI root + SpriteView + SKScene, portrait, full screen | App launches edge-to-edge portrait |
| 2 | Full ~36-part catalog; UI shows generic labels only | Tray tabs S1 / S2 / Payload / Boosters; names like Pencil Core — no Falcon/NASA/etc. |
| 3 | Warehouse bay still → pad stills by sky period | Pre-launch: WarehouseAssemble; after wall-drop: PadSunrise/Sunset/Night |
| 4 | Pick S1 + S2 + Payload; optional side boosters; snap/scale by H/D | Select three parts + toggle Side Boosters; stack rebuilds with size classes |
| 5 | Go for Launch → walls drop (~1.2s) → pad reveal | Button enabled when S1/S2/Payload set; walls slide away; pad + tower appear. **No flight.** |
| 6 | Sky from local time (day / golden / blue / night) | Label under title; tap label to cycle mock hours |
| 7 | PSP-sharp stills + procedural stack | Nearest-neighbor textures; hard-outlined stack parts |
| 8 | Display name “Rocket Bay” | Home screen / SpringBoard name |

---

## Project layout

```
RocketBay/
├── RocketBay.xcodeproj/          # Open this
│   └── project.pbxproj
│   └── xcshareddata/xcschemes/RocketBay.xcscheme
├── RocketBay/
│   ├── RocketBayApp.swift        # @main entry
│   ├── ContentView.swift         # SwiftUI chrome + SpriteView
│   ├── GameScene.swift           # Bay, stack, wall-drop, pad, sky
│   ├── PartCatalog.swift         # 36 parts + generic displayName
│   ├── SkyClock.swift            # Local-hour → sky period/palette
│   ├── AssemblyState.swift       # Selection + launch gate
│   ├── Info.plist                # Portrait, display name
│   ├── Assets.xcassets/          # mvp1 stills + AppIcon
│   └── Resources/PartCatalog.json
└── README.md
```

---

## Brief residual (Linux box)

This project was authored on Linux **without** Xcode, Swift toolchain, or iOS Simulator. The following could **not** be verified here:

- `xcodebuild` compile / link
- Simulator boot and touch input
- Signing / Team provisioning
- Actual SpriteKit frame rate on device
- Asset catalog AppIcon (placeholder empty 1024 slot — add an icon before App Store)

On Mac, if the project fails to open, confirm Xcode ≥ 15 and that `project.pbxproj` was copied intact.

---

## Dev notes

- **Mock sky:** tap the sky period label (DAY / GOLDEN HOUR / …) to cycle hours 12 → 18 → 20 → 23. Or set `SkyClock.mockHour` in code.
- **Reset:** CLEAR empties the stack; after pad reveal, BACK TO BAY restores bay walls.
- **Art:** matched to approved mvp1 stills (`WarehouseAssemble`, `PadSunrise`, `PadSunset`, `PadNight`) in `Assets.xcassets` with `.filteringMode = .nearest`. Interactive stack stays procedural on top. **Pending Mac verify.**
