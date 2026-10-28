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
const { commandSegments, stripSurroundingQuotes } = require('./lib/git-command.cjs');

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
  const raw = tokens.find((t) => !t.startsWith('-'));
  return raw ? stripSurroundingQuotes(raw) : null;
}

// A refspec token is `<src>:<dest>` with no spaces, and a bare branch-name
// token (no colon) pushes a local branch of that name to a remote branch
// of the same name. Once flags are filtered out, every remaining non-flag
// token is checked as a candidate — not just tokens assumed to follow a
// remote — for two reasons found in review:
//   1. A rigid `git push <remote> <refspec>` shape (nothing else) missed
//      `git push --force origin feature:main` and `git push origin
//      --force feature:main` entirely, since a flag anywhere breaks a
//      fixed-position match. Tokenizing and filtering flags, the same
//      approach check-branch-delete-guard.js uses for --delete, closes
//      that gap regardless of flag position.
//   2. Requiring at least a remote + one more token missed both
//      `git push feature:main` (remote omitted — git still resolves this
//      via config in some setups) and, more importantly, a *plain*
//      `git push origin master` with no colon at all, which lands commits
//      on master just as directly as any refspec does. Checking every
//      non-flag token — including a lone one — for either a colon-refspec
//      or an exact match against a protected branch name closes both,
//      erring toward blocking rather than trying to perfectly replicate
//      git's own remote-vs-refspec argument resolution.
function protectedRefspecPush(segment) {
  if (!/^git\s+push\b/.test(segment)) return null;

  const tokens = segment.split(/\s+/); // tokens[0] === 'git', tokens[1] === 'push'
  const nonFlags = tokens.slice(2).filter((t) => !t.startsWith('-'));

  for (const rawToken of nonFlags) {
    // This hook sees the raw command string, quotes and all — the shell
    // hasn't stripped them yet the way it would before argv reaches git
    // itself. `git push origin "main"` or `git push origin "feature:main"`
    // would otherwise leave a trailing quote character on the token
    // (`main"`), which never matches PROTECTED_BRANCHES even though the
    // quoting changes nothing about what actually gets pushed.
    const token = stripSurroundingQuotes(rawToken);
    const colonIdx = token.indexOf(':');
    if (colonIdx !== -1) {
      let src = token.slice(0, colonIdx);
      // An empty dest (`git push origin branch:`) means "push to a remote
      // ref with the same name as src" — git's own default-dest behavior
      // for a trailing-colon refspec.
      let dest = token.slice(colonIdx + 1) || src;
      src = src.replace(/^refs\/heads\//, '');
      dest = dest.replace(/^refs\/heads\//, '');
      // No `src !== dest` requirement — `git push origin main:main` (or
      // the trailing-colon form `main:`) lands commits on main exactly as
      // directly as any other refspec targeting it, so there's no case
      // where src and dest being equal makes this any less a direct push
      // to a protected branch.
      if (PROTECTED_BRANCHES.includes(dest)) {
        return { src, dest };
      }
      continue;
    }

    // A bare protected-branch-name token only counts once at least a
    // remote/repository has also been given (`git push origin master`) —
    // a single lone token (`git push master`) is what git itself treats
    // as the repository argument, not a branch, so there's no push of
    // anything named master/main to react to yet. A fully-qualified
    // `refs/heads/main` is the same branch.
    const branch = token.replace(/^refs\/heads\//, '');
    if (nonFlags.length >= 2 && PROTECTED_BRANCHES.includes(branch)) {
      return { src: branch, dest: branch };
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

  // Resolved once per command and reused by both the push and merge
  // checks below: a branch this command chain explicitly checks out to
  // (textually — the actual HEAD hasn't moved yet when this hook runs),
  // falling back to whatever branch is actually currently checked out.
  // Lazy since a real `git rev-parse` call is only worth paying for when
  // nothing in the command already answers the question textually.
  const checkedOutTo = normalized
    .map(checkoutTarget)
    .find((target) => target && PROTECTED_BRANCHES.includes(target));
  // Cached per directory: `git -C a push && git -C b merge x` asks two repos.
  const branchByDir = new Map();
  function effectiveBranch(dir) {
    if (checkedOutTo) return checkedOutTo;
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
    // applies when nothing explicit was given (nonFlags.length <= 1):
    // an explicit branch/refspec naming a *different* branch (e.g.
    // `git push origin some-other-branch` while sitting on master) is a
    // deliberate, legitimate push of something else and shouldn't be
    // swept in just because HEAD happens to be on a protected branch.
    if (/^git\s+push\b/.test(segment)) {
      const tokens = segment.split(/\s+/);
      const rest = tokens.slice(2);
      // --all/--mirror push every local branch (or the whole repo,
      // including local master/main if either exists) to the remote,
      // regardless of which branch is currently checked out — unlike an
      // ordinary implicit push, this isn't gated on the current branch
      // being protected at all, since it can land commits on master/main
      // even when run from an unrelated feature branch. Blocked
      // unconditionally whenever either flag is present, matching this
      // hook's stated "err toward blocking" direction.
      if (rest.includes('--all') || rest.includes('--mirror')) {
        return `push includes --all/--mirror, which can update protected branches regardless of the current branch — matched: ${segments[i]}`;
      }
      const nonFlags = rest.filter((t) => !t.startsWith('-'));
      if (nonFlags.length <= 1) {
        if (parsed[i].cwd === null && !checkedOutTo) {
          return `implicit push (no explicit branch/refspec given) in a repository this guard can't determine (e.g. \`cd "$VAR"\`), so its current branch can't be checked — name the branch or use a literal path — matched: ${segments[i]}`;
        }
        const branch = effectiveBranch(parsed[i].cwd);
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
    if (parsed[i].cwd === null && !checkedOutTo) {
      return `local \`git merge\` in a repository this guard can't determine (e.g. \`cd "$VAR"\`), so its current branch can't be checked — use a literal path`;
    }
    const branch = effectiveBranch(parsed[i].cwd);
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
