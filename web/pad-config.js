/**
 * Per-TOD pad geometry for compose seating + liftoff FX.
 * Architect/CoE: drop v3 values here (or replace emptyPad path) with no other code changes.
 *
 * Schema (native 1280×720 plate coords unless noted):
 * {
 *   cx: number,              // stack center X
 *   sitY: number,            // content-bbox feet / stack bottom seat line
 *   deckY: number,           // pad deck line for smoke spread + glow (may differ from sitY)
 *   targetH: number,         // seated stack content height
 *   nozzleOffsetY: number,   // added to sitY for flame/plume origin (usually 0)
 *   smokeOriginY: number,    // native Y for sideways smoke / linger (usually deckY)
 *   emptyPad: string,        // relative path under web/ for empty pad plate
 * }
 *
 * Keyed by TOD id: "02" | "03" | "04" | "05"
 */
(function (global) {
  "use strict";

  const DEFAULT_SIT = 548;
  const DEFAULT_TARGET_H = 500;

  /** @type {Record<string, {
   *   cx:number, sitY:number, deckY:number, targetH:number,
   *   nozzleOffsetY:number, smokeOriginY:number, emptyPad:string
   * }>} */
  const PAD_CONFIG = {
    "02": {
      cx: 556,
      sitY: DEFAULT_SIT,
      deckY: DEFAULT_SIT,
      targetH: DEFAULT_TARGET_H,
      nozzleOffsetY: 0,
      smokeOriginY: DEFAULT_SIT,
      emptyPad: "plates/empty/02-empty-pad-v2.png",
    },
    "03": {
      cx: 685,
      sitY: DEFAULT_SIT,
      deckY: DEFAULT_SIT,
      targetH: DEFAULT_TARGET_H,
      nozzleOffsetY: 0,
      smokeOriginY: DEFAULT_SIT,
      emptyPad: "plates/empty/03-empty-pad-v2.png",
    },
    "04": {
      cx: 717,
      sitY: DEFAULT_SIT,
      deckY: DEFAULT_SIT,
      targetH: DEFAULT_TARGET_H,
      nozzleOffsetY: 0,
      smokeOriginY: DEFAULT_SIT,
      emptyPad: "plates/empty/04-empty-pad-v2.png",
    },
    "05": {
      cx: 634,
      sitY: DEFAULT_SIT,
      deckY: DEFAULT_SIT, // v3: measure real deck (~590+); leave = sitY until then
      targetH: DEFAULT_TARGET_H,
      nozzleOffsetY: 0,
      smokeOriginY: DEFAULT_SIT,
      emptyPad: "plates/empty/05-empty-pad-v2.png",
    },
  };

  function padFor(todId) {
    return PAD_CONFIG[todId] || PAD_CONFIG["05"];
  }

  global.RocketBayPadConfig = {
    PAD_CONFIG: PAD_CONFIG,
    padFor: padFor,
    NATIVE_W: 1280,
    NATIVE_H: 720,
  };
})(typeof window !== "undefined" ? window : globalThis);
