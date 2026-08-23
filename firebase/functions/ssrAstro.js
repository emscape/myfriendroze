// Wraps the built Astro SSR server (Node adapter, middleware mode) as a
// Cloud Function, so Firebase Hosting's catch-all rewrite (see
// firebase.json) can hand it every request that isn't a static asset or one
// of the specific-path rewrites (stripeWebhook, createCheckoutSession).
// This is what makes astro/src/pages/api/*.js routes (checkout, shipping,
// products) actually reachable in production — previously nothing served
// them at all. See stripe-payment-integration / project_backlog memory.
//
// astro-dist/ (server + client) is a build artifact copied in by
// scripts/copy-astro-dist.js as part of `npm run build` here and the
// functions predeploy hook in firebase.json — not committed to git.
//
// dist/server/entry.mjs is ESM (Astro's Node adapter always emits ESM);
// this file stays CommonJS to match the rest of firebase/functions/, so the
// handler is loaded via a dynamic import() instead of require().
//
// express.static() here is a fallback for hitting this function directly
// (e.g. the Functions emulator on its own port, bypassing Hosting) — in
// real production traffic, Hosting serves static assets from
// astro/dist/client itself and only forwards non-static requests here.

const { onRequest } = require('firebase-functions/v2/https');
const express = require('express');
const path = require('node:path');

let appPromise = null;

function getApp() {
  if (!appPromise) {
    appPromise = import('./astro-dist/server/entry.mjs').then(({ handler: ssrHandler }) => {
      const app = express();
      app.use(express.static(path.join(__dirname, 'astro-dist/client')));
      app.use(ssrHandler);
      return app;
    });
  }
  return appPromise;
}

// Thin wiring, same category as stripeWebhook.js's outer onRequest wrapper
// (see its comment) — not unit tested, since a test would have to mock the
// dynamic import of the very build artifact this function exists to serve,
// which would verify nothing real. Verified instead via a real build +
// `firebase emulators:start` + curl smoke test before every deploy that
// touches this file.
//
// region pinned to us-west1 to match stripeWebhook/createCheckoutSession —
// left unset it would fall to Firebase's us-central1 default, putting this
// function in a different region than the two it's routed alongside for no
// reason (extra cross-region latency talking to Firestore, inconsistent
// deploy footprint).
exports.ssrAstro = onRequest({ region: 'us-west1' }, async (req, res) => {
  const app = await getApp();
  app(req, res);
});

// Exported for manual smoke-testing the real built app in-process (see
// deploy notes) — deliberately not wired into the committed vitest suite,
// since that would require astro-dist/ to exist at CI time, which needs an
// astro build step CI doesn't currently run.
exports.getApp = getApp;
