#!/usr/bin/env node
// List RocketBay leaderboard docs (or throttleLb) using the Firebase CLI's own login (owner tool).
// Requires: firebase-tools installed (npm i -g firebase-tools) and `firebase login` done once
// with an account that has access to the rocketbay-game project.
// Usage: node scripts/read-leaderboard.js [limit] [--json] [--throttle]
// Delete a test doc: firebase firestore:delete leaderboard/<id> --project rocketbay-game -f
const path = require("path");
const { execSync } = require("child_process");
function fbTools() {
  const tries = [process.env.FIREBASE_TOOLS_DIR,
    (() => { try { return path.join(execSync("npm root -g", { encoding: "utf8" }).trim(), "firebase-tools"); } catch (_) { return null; } })(),
    "/tmp/fbtools-latest/node_modules/firebase-tools"].filter(Boolean);
  for (const t of tries) { try { require.resolve(path.join(t, "lib/requireAuth.js")); return t; } catch (_) {} }
  console.error("firebase-tools not found. Install it: npm i -g firebase-tools (or set FIREBASE_TOOLS_DIR)"); process.exit(1);
}
const T = fbTools();
const { requireAuth } = require(path.join(T, "lib/requireAuth.js"));
const auth = require(path.join(T, "lib/auth.js"));
const firestore = require(path.join(T, "lib/gcp/firestore.js"));
const PROJECT = process.env.RB_PROJECT || "rocketbay-game";
const args = process.argv.slice(2), asJson = args.includes("--json");
const limit = parseInt(args.find((a) => /^\d+$/.test(a)) || "50", 10);
const val = (v) => v == null ? null : ("stringValue" in v ? v.stringValue : "integerValue" in v ? Number(v.integerValue)
  : "timestampValue" in v ? v.timestampValue : "booleanValue" in v ? v.booleanValue : JSON.stringify(v));
(async () => {
  // same account setup the firebase CLI performs before every command (uses `firebase login`)
  const options = { project: PROJECT };
  const acct = auth.selectAccount(process.env.RB_ACCOUNT, process.cwd());
  if (acct) auth.setActiveAccount(options, acct);
  await requireAuth(options);
  const coll = args.includes("--throttle") ? "throttleLb" : "leaderboard";
  const q = { from: [{ collectionId: coll }], limit };
  const res = await firestore.queryCollection(PROJECT, q);
  const rows = res.documents.map((d) => {
    const o = { id: d.name.split("/").pop() };
    for (const [k, v] of Object.entries(d.fields || {})) o[k] = val(v);
    return o;
  });
  if (asJson) { console.log(JSON.stringify(rows, null, 1)); return; }
  if (!rows.length) { console.log(`(${coll} collection empty)`); return; }
  for (const r of rows) {
    const when = (r.createdAt || r.last) ? new Date(r.createdAt || r.last).toLocaleString("en-US", { timeZone: "America/Los_Angeles" }) + " PT" : "?";
    console.log(coll === "leaderboard" ? `${r.id}  ${when}  ${r.name}  score ${r.score}  ${r.result}  ${r.distanceKm} km  bonus ${r.bonus}@${r.deployKm}  coins ${r.coins}  [${r.build} · ${r.tod} · ${r.stack}]` : `${r.id}  last ${when}`);
  }
  console.log(`${rows.length} doc(s) in ${coll} (limit ${limit})`);
})().catch((e) => { console.error("read-leaderboard failed:", e && (e.message || e)); process.exit(1); });
