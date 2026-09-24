#!/usr/bin/env node
// Print RocketBay friend-trial feedback (newest first) using the Firebase CLI's own login.
// Requires: firebase-tools installed (npm i -g firebase-tools) and `firebase login` done once
// with an account that has access to the rocketbay-game project.
// Usage: scripts/read-feedback.sh [limit] [--json]
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
  const q = { from: [{ collectionId: "feedback" }], orderBy: [{ field: { fieldPath: "createdAt" }, direction: "DESCENDING" }], limit };
  const res = await firestore.queryCollection(PROJECT, q);
  const rows = res.documents.map((d) => {
    const o = { id: d.name.split("/").pop() };
    for (const [k, v] of Object.entries(d.fields || {})) o[k] = val(v);
    return o;
  });
  if (asJson) { console.log(JSON.stringify(rows, null, 1)); return; }
  if (!rows.length) { console.log("(no feedback yet)"); return; }
  for (const r of rows) {
    const when = r.createdAt ? new Date(r.createdAt).toLocaleString("en-US", { timeZone: "America/Los_Angeles" }) + " PT" : "?";
    console.log(`— ${when}  ${r.name || "(anonymous)"}  [${r.build} · TOD ${r.tod || "?"} · ${r.stack || "-"}]`);
    console.log(`  ${String(r.text).replace(/\n/g, "\n  ")}`);
    console.log(`  device: ${r.device || "-"} | ua: ${(r.ua || "-").slice(0, 90)} | id: ${r.id}\n`);
  }
  console.log(`${rows.length} entr${rows.length === 1 ? "y" : "ies"} (limit ${limit})`);
})().catch((e) => { console.error("read-feedback failed:", e && (e.message || e)); process.exit(1); });
