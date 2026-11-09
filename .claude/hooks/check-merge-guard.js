#!/usr/bin/env node
// check-merge-guard.js
// PreToolUse hook — Bash
//
// Unconditionally blocks any command that would merge a PR or land commits
// on master/main from this session — `gh pr merge`, a PUT to the
// equivalent `gh api .../pulls/{n}/merge` REST endpoint, a local `git
// merge` performed while on (or checking out to) master/main, and a push
// (refspec or plain branch name) that lands commits directly on
// master/main.
//
// This exists because "CI is green and there are no open review comments"
// was treated as implicit permission to merge two PRs that a fresh Copilot
// review pass had explicitly been requested for first — see myfriendroze
// project_backlog memory, 2026-09-02. That was a judgment failure, not a
// missing fact the hook could have surfaced; a hook can't read the
// conversation to know whether permission was actually given. So this
// hook does not try to — it blocks every single time, unconditionally,
// and the fix for that judgment failure is procedural: ask first, wait
// for an explicit yes in the conversation, and have the merge itself
// happen somewhere this hook can't intercept — the GitHub PR page.
//
// Deliberately not configurable with a "confirmed" bypass flag/env var on
// the command itself: anything checkable from inside a Bash tool call is
// something this session could set on its own, which would make the check
// meaningless against the exact failure mode it exists to prevent. The
// only real bypass is a human setting `merge_guard.enabled: false` in the SHARED config.json — a
// separate, deliberate file edit (a project-local hooks.config.json cannot
// disable this guard), not something a merge command's own
// invocation can satisfy inline.
//
// Config used:
//   .claude/hooks/config.json (+ project override, enabled:true only) → merge_guard.enabled
//
// Exit codes:
//   0  — PASS: not a merge-shaped command, or guard disabled
//   2  — BLOCK: always, for any matching command

'use strict';

const { execSync } = require('child_process');
const { loadHookConfig } = require('./lib/hook-config.cjs');
const { commandSegments, pushArgs, splitRefspec, stripSurroundingQuotes } = require('./lib/git-command.cjs');

const PROTECTED_BRANCHES = ['master', 'main'];

function isEnabled() {
  try {
    const config = loadHookConfig({ hooksDir: __dirname });
    // Same fail-toward-safety default as the other guards in this file set:
    // only an explicit `false` opts out, missing/invalid config.json means
    // the check still runs.
    return config.merge_guard?.enabled !== false;
  } catch {
    return true;
  }
}

// The branch checked out in `cwd` — the repo the command actually targets
// (after any `cd`/`git -C`), not this hook's own working directory.
// findMergeReason() never asks about an unknown (null) target: it blocks
// instead, since the hook's own branch says nothing about the target's.
function currentBranch(cwd) {
  try {
    return execSync('git rev-parse --abbrev-ref HEAD', { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], cwd: cwd || undefined }).trim();
  } catch {
    return null; // not a git repo / no commits yet — nothing to protect
  }
}

// Extracts the branch a `git checkout`/`git switch` invocation moves HEAD
// to, if any. A plain `git checkout master` or `git switch main` takes the
// branch name as an ordinary positional argument, but `-b`/`-B`
// (checkout) and `-c`/`-C` (switch) create-and-switch flags take the new
// branch name as *their own* argument instead — `git checkout -B main`
// force-resets and switches to main with no separate "main" positional to
// find. Missing that form meant effectiveBranch() could fall back to the
// pre-checkout branch and miss an implicit push/merge onto master/main
// immediately after — silently contradicting this hook's "unconditional"
// premise for exactly the case (force-creating/resetting the protected
// branch itself) that matters most.
function checkoutTarget(segment) {
  const m = segment.match(/^git\s+(?:checkout|switch)\s+(.*)$/);
  if (!m) return null;

  const tokens = m[1].split(/\s+/).filter(Boolean);
  const createFlagIdx = tokens.findIndex((t) => t === '-b' || t === '-B' || t === '-c' || t === '-C');
  if (createFlagIdx !== -1) {
    const raw = tokens[createFlagIdx + 1];
    // This hook sees the raw command string, quotes and all — a quoted
    // branch name (`git switch "main"`) otherwise yields a checkout
    // target of `"main"`, which never matches PROTECTED_BRANCHES and
    // bypasses the implicit-push/local-merge checks for the rest of the
    // chain.
    return raw ? stripSurroundingQuotes(raw) : null;
  }
  // `git checkout [<branch>] -- <paths>` and `git checkout .` restore files
  // and leave HEAD where it was, so they aren't a move to another branch.
  if (tokens.includes('--')) return null;
  const raw = tokens.find((t) => !t.startsWith('-'));
  const target = raw ? stripSurroundingQuotes(raw) : null;
  return target === '.' ? null : target;
}

// The push's arguments come from the shared pushArgs() (lib/git-command.cjs):
// flags in any position and the values of flags such as `-o` are skipped,
// quotes are removed, and a `#` comment or a redirection (`>/dev/null`,
// `2>&1`) is not an argument. Every refspec is checked, not just one in a
// fixed position. splitRefspec() drops a leading `+` (a per-refspec force)
// and gives an empty dest (`branch:`) the src's name, as git does. A bare
// branch name (`git push origin master`) pushes to the remote branch of the
// same name, and `refs/heads/main` is the same branch as `main`. No
// `src !== dest` requirement: `main:main` lands on main like any other.
//
// A lone colon refspec in the remote position (`git push feature:main`)
// is checked too, erring toward blocking rather than replicating git's
// own remote-vs-refspec resolution. A lone bare name (`git push master`)
// is the repository argument, not a branch, so it isn't.
function protectedRefspecPush(segment) {
  if (!/^git\s+push\b/.test(segment)) return null;

  const { remote, refspecs } = pushArgs(segment);
  const candidates = remote && remote.includes(':') ? [remote, ...refspecs] : refspecs;
  for (const token of candidates) {
    const { src, dest } = splitRefspec(token);
    const target = dest.replace(/^refs\/heads\//, '');
    if (PROTECTED_BRANCHES.includes(target)) {
      return { src: src.replace(/^refs\/heads\//, ''), dest: target };
    }
  }
  return null;
}

// `getCurrentBranch(dir)` defaults to the real `currentBranch()` (a live `git
// rev-parse` call in `dir`) but is overridable — tests inject a fixed value instead
// of depending on whatever branch happens to be checked out in the real
// repo when they run, which would otherwise make any test exercising the
// "no explicit branch/refspec given" fallback path non-deterministic.
function findMergeReason(fullCmd, getCurrentBranch = currentBranch) {
  // Every anchored check below runs against the normalized form (see
  // lib/git-command.cjs) — the original, raw segment is kept only for the
  // human-readable "matched:" text in a block report, so the reason shown
  // still looks like what was actually typed.
  const parsed = commandSegments(fullCmd);
  const segments = parsed.map((s) => s.raw);
  const normalized = parsed.map((s) => s.normalized);

  // Reused by both the push and merge checks below: the branch this command
  // chain last checked out in a given directory before segment i
  // (textually — the actual HEAD hasn't moved yet when this hook runs),
  // falling back to whatever branch is actually checked out there. Keyed
  // by directory, so `git -C a checkout main && git -C b push` judges b by
  // its own branch, and in order, so `checkout main && checkout feature &&
  // push` pushes feature. A protected checkout in a directory that can't
  // be known (null) might be any repository, so it counts for every
  // directory from then on.
  const lastCheckout = new Map();
  let unknownProtected = null;
  const checkoutsBefore = parsed.map((s, i) => {
    const before = { byDir: new Map(lastCheckout), unknownProtected };
    const target = checkoutTarget(normalized[i]);
    if (target && s.cwd !== null) lastCheckout.set(s.cwd, target);
    if (target && s.cwd === null && PROTECTED_BRANCHES.includes(target)) unknownProtected = target;
    return before;
  });
  function checkedOutTo(i, dir) {
    const { byDir, unknownProtected: unknown } = checkoutsBefore[i];
    const own = dir === null ? undefined : byDir.get(dir);
    return own && PROTECTED_BRANCHES.includes(own) ? own : unknown ?? own;
  }
  // Lazy and cached per directory: a real `git rev-parse` call is only
  // worth paying for when nothing in the command already answers the
  // question textually, and `git -C a push && git -C b merge x` asks two repos.
  const branchByDir = new Map();
  function effectiveBranch(i, dir) {
    const target = checkedOutTo(i, dir);
    if (target) return target;
    if (!branchByDir.has(dir)) branchByDir.set(dir, getCurrentBranch(dir));
    return branchByDir.get(dir);
  }

  for (let i = 0; i < segments.length; i++) {
    const segment = normalized[i];

    if (/^gh\s+pr\s+merge\b/.test(segment)) {
      return `\`gh pr merge\` — matched: ${segments[i]}`;
    }
    // The merge REST endpoint only actually merges on PUT — a GET to the
    // same path (checking merge state/method, used by ordinary read-only
    // status tooling) doesn't merge anything and shouldn't be blocked.
    // -X's value can be space-separated (`-X PUT`) or concatenated
    // curl-style (`-XPUT`, no space at all) — `\s*` covers both in one
    // alternative rather than requiring a separator that may not be there.
    if (
      /^gh\s+api\b/.test(segment) &&
      /\/pulls\/[^\s/]+\/merge\b/.test(segment) &&
      /(?:^|\s)(?:-X\s*PUT|--method(?:\s+|=)PUT)\b/i.test(segment)
    ) {
      return `\`gh api\` PUT call to a PR's /merge REST endpoint — matched: ${segments[i]}`;
    }
    // Push (refspec or plain branch name) that lands commits directly on
    // master/main, bypassing PR + merge entirely — e.g.
    // `git push origin some-branch:master` or a plain `git push origin master`.
    const refspec = protectedRefspecPush(segment);
    if (refspec) {
      const detail = refspec.src === refspec.dest
        ? `pushes directly to protected branch "${refspec.dest}"`
        : `push refspec targets protected branch "${refspec.dest}" directly from "${refspec.src}"`;
      return `${detail} — matched: ${segments[i]}`;
    }
    // A `git push` with no explicit branch/refspec argument (at most a
    // remote) pushes the *current* branch via git's own defaults — e.g.
    // `git switch main && git push origin`. protectedRefspecPush() only
    // catches an explicit mention of a protected branch, so this implicit
    // form landed commits on master/main completely undetected. Only
    // applies when nothing explicit was given (no refspecs):
    // an explicit branch/refspec naming a *different* branch (e.g.
    // `git push origin some-other-branch` while sitting on master) is a
    // deliberate, legitimate push of something else and shouldn't be
    // swept in just because HEAD happens to be on a protected branch.
    if (/^git\s+push\b/.test(segment)) {
      const { refspecs, sets } = pushArgs(segment);
      // --all/--branches/--mirror push every local branch (or the whole
      // repo, including local master/main if either exists) to the remote,
      // regardless of which branch is currently checked out — unlike an
      // ordinary implicit push, this isn't gated on the current branch
      // being protected at all, since it can land commits on master/main
      // even when run from an unrelated feature branch. Blocked
      // unconditionally whenever any of them is present, matching this
      // hook's stated "err toward blocking" direction.
      if (sets.some((flag) => flag !== '--tags')) {
        return `push includes ${sets.filter((flag) => flag !== '--tags').join('/')}, which can update protected branches regardless of the current branch — matched: ${segments[i]}`;
      }
      // `--tags` with no refspec pushes only tags, not the current branch.
      if (refspecs.length === 0 && sets.length === 0) {
        if (parsed[i].cwd === null && !checkedOutTo(i, null)) {
          return `implicit push (no explicit branch/refspec given) in a repository this guard can't determine (e.g. \`cd "$VAR"\`), so its current branch can't be checked — name the branch or use a literal path — matched: ${segments[i]}`;
        }
        const branch = effectiveBranch(i, parsed[i].cwd);
        if (branch && PROTECTED_BRANCHES.includes(branch)) {
          return `implicit push (no explicit branch/refspec given) while on protected branch "${branch}" — matched: ${segments[i]}`;
        }
      }
    }
  }

  // Local `git merge` while sitting on (or about to check out to) a
  // protected branch.
  for (let i = 0; i < normalized.length; i++) {
    if (!/^git\s+merge\b/.test(normalized[i])) continue;
    if (parsed[i].cwd === null && !checkedOutTo(i, null)) {
      return `local \`git merge\` in a repository this guard can't determine (e.g. \`cd "$VAR"\`), so its current branch can't be checked — use a literal path`;
    }
    const branch = effectiveBranch(i, parsed[i].cwd);
    if (branch && PROTECTED_BRANCHES.includes(branch)) {
      return `local \`git merge\` on protected branch "${branch}"`;
    }
  }

  return null;
}

module.exports = { findMergeReason, protectedRefspecPush, isEnabled, currentBranch };

// Only run the stdin-driven hook lifecycle when this file is executed
// directly (`node check-merge-guard.js`, which is how Claude Code invokes
// it) — not when it's require()'d, e.g. from check-merge-guard.test.js.
if (require.main === module) {
  runHook();
}

function runHook() {
  const chunks = [];
  process.stdin.on('data', (d) => chunks.push(d));
  process.stdin.on('end', () => {
    if (!isEnabled()) process.exit(0);

    let input;
    try {
      input = JSON.parse(Buffer.concat(chunks).toString());
    } catch {
      process.exit(0);
    }

    const cmd = (input?.tool_input?.command || '').trim();
    if (!cmd) process.exit(0);

    const reason = findMergeReason(cmd);
    if (!reason) process.exit(0);

    const report = [
      'MERGE GUARD — BLOCK (always, by design)',
      '',
      `This command would merge a PR or land commits on a protected branch: ${reason}`,
      '',
      'This hook does not check whether permission was already given in the',
      'conversation — it can\'t read the chat, and any bypass this session',
      'could set on the command itself would defeat the point. It blocks every',
      'matching command, unconditionally.',
      '',
      'Fix: get explicit confirmation in this conversation that this specific',
      'PR should be merged now, then have the merge happen via the GitHub PR',
      'page (or a terminal outside this session) — not from this session.',
    ].join('\n');

    console.error(report);
    process.stdout.write(JSON.stringify({ continue: false, stopReason: report }));
    process.exit(2);
  });
}
