# Rocket Score — UX fold-in (from research)

Source of truth: `/workspace/rocket-score-model.md` (36/36 IDs)

## Player-visible
- **Rocket Score** 0–100 + letter (A–F)
- Bars: **Reliability · Thrust · Stability · Mass** (+ derived MassFit under the hood)

## Rollup (show as “computed when stack complete”)
1. Weighted blend by roles (S1 0.40 / S2 0.25 / PL 0.15 / SB 0.20; no-SB reweight in file)
2. Adjacency Δ (A1–A12) — nation/era/diameter synergy, solids+cryo clash, orbiter hard clash, Heavy SB prefers matching core, dual-S2 rules
3. Deterministic jitter from stackKey (±3…±12)
4. MassFit = clamp(100 − max(0, Mass−Thrust)·1.2, 0, 100)
5. Score = 0.40·Rel + 0.20·Thrust + 0.25·Stability + 0.15·MassFit

## MVP-2 fail seeds (for pad ops later)
Rel<40 systems · Thr<30 static fire · Thr<45 & Mass>70 or MassFit<35 liftoff · Stab<35 tip/abort · A7 orbiter/wrong-S1 systems fail

## Art note
ux-03 score “74” was placeholder — live UI uses this model. Player-facing names stay generic; research IDs drive attributes.
