// Lazy Firestore Admin SDK singleton for server-rendered Astro pages
// (shop.astro, products/[handle].astro) that need a live read on every
// request — these run inside the ssrAstro Cloud Function (see
// firebase/functions/ssrAstro.js), which gets Application Default
// Credentials automatically once deployed. Locally there is no such
// ambient credential (confirmed: a bare admin.initializeApp() fails with
// "Unable to detect a Project Id" outside a real GCP/Cloud Functions
// environment), so local runs need the same service-account file
// scripts/fetch-products.mjs already uses.
//
// Finding that file by a *fixed* number of '..' segments from this
// module's own location — the original approach here — is not safe: this
// file's compiled location varies by execution context. Unbundled under
// `astro dev` it's the real astro/src/lib/ source; after `npm run build`
// it's a Vite-chunked file under astro/dist/server/chunks/; before a real
// deploy/emulator run it's relocated again to
// firebase/functions/astro-dist/server/chunks/ by copy-astro-dist.js. A
// single guessed '..' count is only correct for one of those three at a
// time (confirmed broken for the other two — Copilot review on #20 caught
// this, and reproduced it here against the real copy-astro-dist.js
// output). Walking up from wherever this code actually runs to a stable
// repo-root marker (firebase.json, always present at the repo root) finds
// the right file regardless of how deep bundling nests this module, and
// keeps working through future bundler changes without more guessing.
import admin from 'firebase-admin';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * @param {string} startDir
 * @returns {string | null}
 */
function findRepoRoot(startDir) {
  let dir = startDir;
  for (let i = 0; i < 10; i++) {
    if (fs.existsSync(path.join(dir, 'firebase.json'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return null; // reached the filesystem root
    dir = parent;
  }
  return null;
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = findRepoRoot(__dirname);
// null when no firebase.json was found within 10 levels up — deliberately
// not resolved to a guessed path in that case, so the fs.existsSync check
// below cleanly falls through to applicationDefault() instead of throwing
// on a non-string/nonsense path.
const serviceAccountPath = repoRoot
  ? path.join(repoRoot, 'firebase', 'functions', 'secrets', 'serviceAccountKey.json')
  : null;

let dbInstance = null;

/* v8 ignore start -- see file-level comment */
export function getFirestoreDb() {
  if (!dbInstance) {
    if (!admin.apps.length) {
      const config = {};
      if (serviceAccountPath && fs.existsSync(serviceAccountPath)) {
        config.credential = admin.credential.cert(
          JSON.parse(fs.readFileSync(serviceAccountPath, 'utf8'))
        );
      } else {
        config.credential = admin.credential.applicationDefault();
      }
      admin.initializeApp(config);
    }
    dbInstance = admin.firestore();
  }
  return dbInstance;
}
/* v8 ignore stop */
