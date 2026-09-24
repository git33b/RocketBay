# FRIEND-TRIAL (build label `trial1`, branch `friend-trial`)

Staged on the Firebase Hosting **preview channel** `friend-trial` (7-day expiry). The live site
(https://rocketbay-game.web.app, modular2) is untouched. Deploy the preview with:

    cd /workspace/rocketbay-hosting/preview-trial   # staged copy of web/ (dev/ + *.md excluded)
    firebase hosting:channel:deploy friend-trial --expires 7d --project rocketbay-game

## What's in trial1
- First-screen hint ("Build your rocket from the parts below, then tap GO FOR LAUNCH."), GOT IT dismisses;
  shown once (`localStorage.rb_hint_seen`, also set when the player launches).
- Feedback button (top-right; builder + mission/outcome screens, hidden during flight) -> dialog with
  text (<=1000) + optional name (<=40). Sends text, build label, TOD, stack, device, UA, client time and a
  server timestamp to Firestore `feedback/`. Client cooldown 30 s + rules-enforced 30 s throttle.
- Favicon (`favicon.ico`, `icons/favicon-32.png`), title `RocketBay`, web manifest (`manifest.webmanifest`,
  standalone, theme `#0b1026`), apple-touch-icon; icons derived from `stills/final/10-liftoff.png`.
- Canvas2D readback warning fixed (stack canvas context created with `willReadFrequently`).

## Firestore
- Project `rocketbay-game`, database `(default)`, native mode, location `nam5` (created 2026-09-24).
- Rules: `firestore.rules` (repo root), deployed with `firebase deploy --only firestore:rules --project rocketbay-game`
  from the repo root (repo `firebase.json` has only a `firestore` block; it can never deploy hosting).
- Web app: "RocketBay Web" `1:860087634148:web:38b6231ff8931e948244f1`; config lives in `web/firebase-init.js`
  (public by design; rules are the security boundary).

### Reading feedback (Ateeb)
- Console: https://console.firebase.google.com/project/rocketbay-game/firestore/databases/-default-/data/~2Ffeedback
- CLI: one-time `npm i -g firebase-tools && firebase login`, then `scripts/read-feedback.sh [limit] [--json]`
  (newest first, times in PT). Uses the Firebase CLI's signed-in account; clients can never read.

## Adding a leaderboard later (not built)
1. Client: reuse the shared module, no new init:
   `const M = await import("./firebase-init.js"); const { db, fs } = await M.getDb();`
   write with a batch: `M.stampThrottle(fs, db, batch, M.clientId()); batch.set(fs.doc(fs.collection(db,"leaderboard")), {...createdAt: fs.serverTimestamp()})`.
2. Rules: uncomment the `leaderboard` block in `firestore.rules`. It already uses the shared helpers
   (`onlyFields`, `isStr`, `optStr`, `serverStamped`, `throttled`). Decide read policy (public reads of the
   collection vs. a server-maintained summary doc), add a composite index if ordering by score + time.
3. Scores are client-reported: without App Check/Auth they can be spoofed within the rules' caps. For a
   friends board that's acceptable; for anything public add App Check or a Cloud Function that validates.
