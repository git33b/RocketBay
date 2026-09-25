// RocketBay shared Firebase init (ES module, lazy). Used by feedback + the flight-v1 leaderboard:  const { db, fs } = await (await import("./firebase-init.js")).getDb();
// The web config is public by design (security is enforced by firestore.rules).
const SDK = "https://www.gstatic.com/firebasejs/10.14.1/";
export const FIREBASE_CONFIG = {
  apiKey: "AIzaSyANnasNw-3Ke8b7oRi4MItii5Rlnjhehqg",
  authDomain: "rocketbay-game.firebaseapp.com",
  projectId: "rocketbay-game",
  storageBucket: "rocketbay-game.firebasestorage.app",
  messagingSenderId: "860087634148",
  appId: "1:860087634148:web:38b6231ff8931e948244f1",
};
let _p = null;
/** @returns {Promise<{app:any, db:any, fs:any}>} fs = the firestore module (doc, collection, writeBatch, serverTimestamp, ...) */
export function getDb() {
  if (!_p) {
    _p = Promise.all([import(SDK + "firebase-app.js"), import(SDK + "firebase-firestore.js")]).then(([appMod, fs]) => {
      const app = appMod.getApps().find((a) => a.name === "rocketbay") || appMod.initializeApp(FIREBASE_CONFIG, "rocketbay");
      return { app, db: fs.getFirestore(app), fs };
    });
    _p.catch(() => { _p = null; }); // allow retry after offline failure
  }
  return _p;
}
/** Random per-browser id (localStorage) used for rules-enforced write throttling. */
export function clientId() {
  let id = null;
  try { id = localStorage.getItem("rb_cid"); } catch (_) {}
  if (!id) {
    id = (crypto.randomUUID ? crypto.randomUUID() : String(Math.random()).slice(2) + Date.now()).replace(/-/g, "").slice(0, 32);
    try { localStorage.setItem("rb_cid", id); } catch (_) {}
  }
  return id;
}
/** Adds the throttle stamp for this client to a batch (required by rules for throttled collections).
 *  coll: "throttle" (feedback, 30 s) or "throttleLb" (leaderboard, 20 s). */
export function stampThrottle(fs, db, batch, cid, coll) {
  batch.set(fs.doc(db, coll || "throttle", cid), { last: fs.serverTimestamp() });
}
