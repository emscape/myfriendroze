// Lazy Firestore Admin SDK singleton for server-rendered Astro pages
// (shop.astro, products/[handle].astro) that need a live read on every
// request — these run inside the ssrAstro Cloud Function (see
// firebase/functions/ssrAstro.js), which gets Application Default
// Credentials automatically once deployed. Local dev/build falls back to
// the same service-account file scripts/fetch-products.mjs already uses,
// so `astro dev`/`npm run build` work without extra setup.
//
// Thin wiring, not unit tested directly — same category as
// createCheckoutSession.js's outer onRequest wrapper (constructs a real
// Firestore client from real credentials; mocking `firebase-admin` here
// would test the mock, not this). Verified via a real build +
// `firebase emulators:start` smoke test, and the functions that consume
// this (products-live.js) take `db` as an injected parameter so *their*
// logic is fully unit-testable without touching this file.

import admin from 'firebase-admin';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const serviceAccountPath = path.join(
  __dirname,
  '..',
  '..',
  '..',
  'firebase',
  'functions',
  'secrets',
  'serviceAccountKey.json'
);

let dbInstance = null;

/* v8 ignore start -- see file-level comment */
export function getFirestoreDb() {
  if (!dbInstance) {
    if (!admin.apps.length) {
      const config = {};
      if (fs.existsSync(serviceAccountPath)) {
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
