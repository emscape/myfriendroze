// Copies the built Astro SSR output (server + client) into
// firebase/functions/astro-dist/ so ssrAstro.js can import it and Firebase
// packages it into the deployed function bundle. Run via `npm run build`
// here and via the functions predeploy hook in firebase.json — never
// commit astro-dist/ itself (see .gitignore), it's regenerated every time.
//
// Plain Node fs, not a shell `cp -r`, so this runs the same way on Emily's
// Windows machine as anywhere else (per CLAUDE.md's Windows/Git Bash rule,
// but this specifically avoids relying on Git Bash being the one running
// it — predeploy hooks execute via the platform's default shell).
//
// IMPORTANT — why package.json pins @oslojs/encoding, clsx, cookie,
// devalue, html-escaper, kleur, mrmime, send, server-destroy, unstorage,
// zod as DIRECT dependencies (exact versions, not ^ranges), in addition to
// astro itself: astro-dist/server/**/*.mjs imports these by bare specifier
// (Astro's Node adapter leaves them external rather than bundling them —
// confirmed by grepping the built output for non-relative imports). Firebase
// never uploads local node_modules for a Functions deploy — Cloud Build
// always runs a fresh `npm install` server-side from package.json — so
// these packages have to be resolvable there too, not just locally.
// They're pinned as *direct* deps (not left as transitive-only, e.g. via
// prompts's kleur@3) because npm's hoisting only guarantees a transitive
// dependency lands at the top-level node_modules/ (where these
// files-copied-outside-node_modules/astro/ actually look) if nothing else
// wants a conflicting version — which is exactly what happened with kleur
// (prompts's kleur@3 won the top-level slot over astro's own kleur@4 until
// this file's copy-astro-dist smoke test caught it). A direct dependency
// always wins that slot, deterministically. If a future `astro build`
// starts requiring a new external package that isn't in this list, the
// smoke test (see ssrAstro.js's exports.getApp) will fail with
// ERR_MODULE_NOT_FOUND naming exactly which one — add it here with the
// version from astro/node_modules/<pkg>/package.json.

const fs = require('node:fs');
const path = require('node:path');

const astroDistDir = path.join(__dirname, '..', '..', '..', 'astro', 'dist');
const destDir = path.join(__dirname, '..', 'astro-dist');

for (const part of ['server', 'client']) {
  const src = path.join(astroDistDir, part);
  if (!fs.existsSync(src)) {
    console.error(
      `copy-astro-dist: ${src} does not exist. Run "npm run build" in astro/ first.`
    );
    process.exit(1);
  }
}

fs.rmSync(destDir, { recursive: true, force: true });
fs.mkdirSync(destDir, { recursive: true });
fs.cpSync(path.join(astroDistDir, 'server'), path.join(destDir, 'server'), { recursive: true });
fs.cpSync(path.join(astroDistDir, 'client'), path.join(destDir, 'client'), { recursive: true });

console.log(`copy-astro-dist: copied astro/dist/{server,client} -> ${destDir}`);
