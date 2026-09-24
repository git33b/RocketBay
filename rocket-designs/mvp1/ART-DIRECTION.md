# MVP-1 Scene Art Direction — for Ateeb review

**Logical canvas:** 390×844 portrait (matches GameScene design size)  
**Style lock:** PSP-sharp, slightly pixelated, hard outlines, limited palette, nearest-neighbor feel  
**IP:** Generic stack only — no agency logos, no trademarked rocket names in UI/art

## 01 — Warehouse assemble
- Vertical Starship-vibe bay: corrugated walls, gantry/crane rails, amber work lights
- Floor: dark plate + yellow safety dashes leading to center stand
- Stack fills ~70–80% height; low camera looking up axis
- Bay walls CLOSED (pre “Go for Launch”)
- Bottom tray: 3 generic slot glyphs (S1 / S2 / Payload) — no brand text
- Palette: charcoal / steel / white stack / amber accents

## 02–04 — Pad after wall-drop
- Same stack + simple lattice tower + clamp arms; thin steam at base
- Walls gone; sky is the hero; astronomy-friendly color
- **Sunrise:** peach–gold low sun, soft shadows, pale blue upper
- **Sunset:** orange/magenta horizon, purple-blue upper, warm rim light
- **Night:** indigo-black, dense sharp stars, subtle Milky Way, cool blue clamp lights (stars stay readable — no washed moon)

## Builder handoff notes (once approved)
- Sprite layers: sky bands → pad/tower → stack → steam → UI tray
- Sky = clock-driven gradient bands + stars (already sketched in GameScene)
- Wall-drop is left/right bay panels sliding out to reveal sky+pad

## Portrait lock (2026-09-23 Ateeb)
- App is **portrait only**. Canonical stills are 720×1280 (9:16).
- Landscape 1280×720 comps archived under `landscape-backup/`.
- GameScene design size remains 390×844 portrait.

## Orientation flip (2026-09-23 Ateeb)
- **Landscape locked** (mission-control HUD needs horizontal room for status/checks/thrust).
- Portrait 9:16 crops archived under `portrait/` + `portrait-jpg/` — not canonical.
- Canonical stills: root `01`–`04` at 1280×720.

## Stack rules (designing now)
- Side boosters: show 0 / 2 / 4 (max 4).
- Second stages: up to 2 stacked on S1 before payload.

## Silhouette lock (2026-09-23 Ateeb)
Parts **look like** historical + current vehicles (Falcon 9, Starship-class, Saturn V, R-7/Soyuz, SLS/Artemis, Ariane, Proton, CZ-5, etc.).
Player-facing: **generic labels only** — no agency logos, no trademarked names in art/UI/metadata.
Internal map: research catalog IDs in brief + rocket-score-model.md.
