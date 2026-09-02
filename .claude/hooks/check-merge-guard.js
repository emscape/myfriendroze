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
// only real bypass is `merge_guard.enabled: false` in config.json — a
// separate, deliberate file edit, not something a merge command's own
// invocation can satisfy inline.
//
// Config used:
//   .claude/hooks/config.json → merge_guard.enabled
//
// Exit codes:
//   0  — PASS: not a merge-shaped command, or guard disabled
//   2  — BLOCK: always, for any matching command

'use strict';

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const CONFIG_PATH = path.resolve(__dirname, 'config.json');
const PROTECTED_BRANCHES = ['master', 'main'];

function isEnabled() {
  try {
    const config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
    // Same fail-toward-safety default as the other guards in this file set:
    // only an explicit `false` opts out, missing/invalid config.json means
    // the check still runs.
    return config.merge_guard?.enabled !== false;
  } catch {
    return true;
  }
}

function currentBranch() {
  try {
    return execSync('git rev-parse --abbrev-ref HEAD', { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
  } catch {
    return null; // not a git repo / no commits yet — nothing to protect
  }
}

// Splits on shell chain operators so each command in a chain is checked on
// its own terms, same rationale as check-branch-delete-guard.js: a match
// inside one segment of a chained command must not be missed just because
// an earlier or later segment looks different.
function segmentsOf(fullCmd) {
  return fullCmd.split(/&&|\|\||[;&|]/).map((s) => s.trim()).filter(Boolean);
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

  for (const token of nonFlags) {
    const colonIdx = token.indexOf(':');
    if (colonIdx !== -1) {
      let src = token.slice(0, colonIdx);
      // An empty dest (`git push origin branch:`) means "push to a remote
      // ref with the same name as src" — git's own default-dest behavior
      // for a trailing-colon refspec.
      let dest = token.slice(colonIdx + 1) || src;
      src = src.replace(/^refs\/heads\//, '');
      dest = dest.replace(/^refs\/heads\//, '');
      if (PROTECTED_BRANCHES.includes(dest) && src !== dest) {
        return { src, dest };
      }
      continue;
    }

    // A bare protected-branch-name token only counts once at least a
    // remote/repository has also been given (`git push origin master`) —
    // a single lone token (`git push master`) is what git itself treats
    // as the repository argument, not a branch, so there's no push of
    // anything named master/main to react to yet.
    if (nonFlags.length >= 2 && PROTECTED_BRANCHES.includes(token)) {
      return { src: token, dest: token };
    }
  }
  return null;
}

function findMergeReason(fullCmd) {
  const segments = segmentsOf(fullCmd);

  for (const segment of segments) {
    if (/^gh\s+pr\s+merge\b/.test(segment)) {
      return `\`gh pr merge\` — matched: ${segment}`;
    }
    // The merge REST endpoint only actually merges on PUT — a GET to the
    // same path (checking merge state/method, used by ordinary read-only
    // status tooling) doesn't merge anything and shouldn't be blocked.
    if (
      /^gh\s+api\b/.test(segment) &&
      /\/pulls\/[^\s/]+\/merge\b/.test(segment) &&
      /(?:^|\s)(?:-X|--method)(?:\s+|=)PUT\b/i.test(segment)
    ) {
      return `\`gh api\` PUT call to a PR's /merge REST endpoint — matched: ${segment}`;
    }
    // Push (refspec or plain branch name) that lands commits directly on
    // master/main, bypassing PR + merge entirely — e.g.
    // `git push origin some-branch:master` or a plain `git push origin master`.
    const refspec = protectedRefspecPush(segment);
    if (refspec) {
      const detail = refspec.src === refspec.dest
        ? `pushes directly to protected branch "${refspec.dest}"`
        : `push refspec targets protected branch "${refspec.dest}" directly from "${refspec.src}"`;
      return `${detail} — matched: ${segment}`;
    }
  }

  // Local `git merge` while sitting on (or about to check out to) a
  // protected branch. Command-chain checkout is checked textually, since
  // the actual HEAD hasn't moved yet when this hook runs (the checkout in
  // the same chain hasn't executed).
  const hasMerge = segments.some((s) => /^git\s+merge\b/.test(s));
  if (hasMerge) {
    const checkedOutTo = PROTECTED_BRANCHES.find((b) =>
      segments.some((s) => new RegExp(`^git\\s+checkout\\s+${b}\\b`).test(s) || new RegExp(`^git\\s+switch\\s+${b}\\b`).test(s))
    );
    const branch = checkedOutTo || currentBranch();
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
