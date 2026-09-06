#!/usr/bin/env node
// See scripts/build.mjs for why SKIP_ASTRO_BUILD exists. The prebuild
// Firestore fetches (gallery + products) need the same guard: without it,
// a combined `firebase deploy --only hosting,functions` would still hit
// Firestore twice for this data even after build.mjs skips the redundant
// astro build itself — and the two live reads aren't guaranteed to return
// the same snapshot a few seconds apart.
import { execSync } from 'node:child_process';

if (process.env.SKIP_ASTRO_BUILD === '1') {
  console.log(
    '[astro prebuild] SKIP_ASTRO_BUILD=1 — already fetched earlier in this deploy, skipping.'
  );
  process.exit(0);
}

execSync('node scripts/fetch-gallery.mjs', { stdio: 'inherit' });
execSync('node scripts/fetch-products.mjs', { stdio: 'inherit' });
