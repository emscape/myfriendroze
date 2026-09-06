#!/usr/bin/env node
// Wraps `astro build` so the CD deploy job (.github/workflows/ci.yml) can
// build once, explicitly, then have firebase.json's hosting.predeploy AND
// functions.predeploy hooks skip a redundant second build — each
// independently declares "npm --prefix astro run build" because each needs
// it when its own target is deployed alone (`firebase deploy --only
// hosting` or `--only functions`), but deploying both together in one
// `firebase deploy --only hosting,functions` command otherwise runs a full
// astro build twice: once per predeploy hook. Beyond wasted time, the two
// builds aren't guaranteed identical (the prebuild scripts read live
// Firestore data), so Hosting and the ssrAstro Function could end up
// shipped from two different snapshots of the same deploy.
//
// SKIP_ASTRO_BUILD is only ever set by that one CD workflow step, right
// after it has already run this same build once itself — local dev and
// every other CI step invoke `npm run build` with it unset, so this
// behaves exactly like a plain `astro build` everywhere else.
import { execSync } from 'node:child_process';

if (process.env.SKIP_ASTRO_BUILD === '1') {
  console.log(
    '[astro build] SKIP_ASTRO_BUILD=1 — already built earlier in this deploy, skipping.'
  );
  process.exit(0);
}

execSync('npx astro build', { stdio: 'inherit' });
