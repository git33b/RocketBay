# Rocket Bay (MVP-1b)

Mix-and-match rocket stacker on locked uniform-pack pad stills (assemble → grounded → mission). Sky / TOD picks the plate pack; rocket and tower are **baked into** the plates (no procedural stack overlay). Liftoff stills are **HOLD** (not wired).

**Bundle display name:** Rocket Bay  
**Bundle ID:** `com.ateeb.RocketBay`  
**Target:** iOS 17+, Swift 5, **landscape 16:9**, SwiftUI + SpriteKit  
**Out of scope:** liftoff FX, pad ops / flight, config overlays, IAP, career.

**Art (MVP-1b):** 12 locked plates from `/workspace/rocket-designs/mvp1/scenes/` (4 TOD × assemble/grounded/mission), 1280×720 PNG. Asset names: `Pad02AssembleSunrise`, `Pad03GroundedSunset`, `Pad04MissionNight`, `Pad05AssembleDay`, …

Trademark policy: UI uses **generic display names only**. Lock-tray labels (exact): Moon Giant, Pencil Core, Gridfin Booster, Steel Booster, Orange Tank, Euro Core. Research IDs like `S1-01` are code/JSON keys only.

---

## TOD → plate mapping

| SkyClock period | Hour hint | TOD pack | Code |
|-----------------|-----------|----------|------|
| Day | 9–17 | day | 05 |
| Golden hour | morning (&lt;12) | sunrise | 02 |
| Golden hour | evening | sunset | 03 |
| Blue hour | morning (&lt;12) | sunrise | 02 |
| Blue hour | evening | night | 04 |
| Night | 21–5 | night | 04 |

Phase asset: `Pad{02\|03\|04\|05}{Assemble\|Grounded\|Mission}{Sunrise\|Sunset\|Night\|Day}`.

Flow: **assemble** → Go for Launch → **grounded** (same TOD) → Enter Mission → **mission** (Deploy payload \| Explore the universe). Back To Bay → assemble. No warehouse wall-drop; no liftoff.

---

## Open & run on a Mac

1. Copy `/workspace/RocketBay` to your Mac (or open if synced).
2. Open **`RocketBay.xcodeproj`** in Xcode 15+.
3. Select an iPhone / iPad simulator (landscape).
4. Set **Team** under Signing if needed.
5. Press **Run** (⌘R).

### Success checklist (MVP-1b)

| # | Criterion | How to verify |
|---|-----------|---------------|
| 1 | Landscape SpriteView + 1280×720 scene | App launches edge-to-edge landscape |
| 2 | Correct plate per TOD + phase | Cycle sky label; Go for Launch / Enter Mission |
| 3 | Lock-tray exact six labels | Moon Giant, Pencil Core, Gridfin Booster, Steel Booster, Orange Tank, Euro Core |
| 4 | No procedural stack on plates | Rocket/tower only from still |
| 5 | Mission two-choice | “Deploy payload” \| “Explore the universe” |
| 6 | No liftoff / no warehouse wall-drop | Go for Launch swaps assemble→grounded plate |
| 7 | Back resets to assemble | BACK TO BAY |

---

## Project layout

```
RocketBay/
├── RocketBay.xcodeproj/
├── RocketBay/
│   ├── RocketBayApp.swift
│   ├── ContentView.swift         # SwiftUI chrome + mission choices
│   ├── GameScene.swift           # Plate stills by TOD + phase
│   ├── PartCatalog.swift         # Catalog + lock-tray six
│   ├── SkyClock.swift            # Local-hour → sky period
│   ├── AssemblyState.swift       # Selection + padPhase
│   ├── Info.plist                # Landscape
│   ├── Assets.xcassets/          # 12 Pad* imagesets
│   └── Resources/PartCatalog.json
└── README.md
```

---

## Brief residual (Linux box)

Authored on Linux **without** Xcode / Simulator. Not verified here: `xcodebuild`, Simulator, signing, device FPS. Asset `Contents.json` + PNG path smoke passed on box. **Mac-verify pending.**

---

## Dev notes

- **Mock sky:** tap period label to cycle hours 12 → 7 → 18 → 20 → 23 (day / sunrise / sunset / night / night).
- **CLEAR** empties selection on assemble; **BACK TO BAY** returns to assemble plate.
- Stills use `.filteringMode = .nearest`.
