#!/usr/bin/env node
// check-merge-guard.js
// PreToolUse hook — Bash
//
// Unconditionally blocks any command that would merge a PR or land commits
// on master/main from this session — `gh pr merge`, the equivalent `gh
// api .../pulls/{n}/merge` REST call, a local `git merge` performed while
// on (or checking out to) master/main, and a push refspec that targets
// master/main directly from a different branch name.
//
// This exists because "CI is green and there are no open review comments"
// was treated as implicit permission to merge two PRs Emily had explicitly
// said she wanted a fresh Copilot review pass on first — see myfriendroze
// project_backlog memory, 2026-09-02. That was a judgment failure, not a
// missing fact the hook could have surfaced; a hook can't read the
// conversation to know whether she actually said yes. So this hook does
// not try to — it blocks every single time, unconditionally, and the fix
// for that judgment failure is procedural: ask her, wait for an explicit
// yes in the conversation, and have the merge itself happen somewhere
// this hook can't intercept — the GitHub PR page, run by her.
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

function findMergeReason(fullCmd) {
  const segments = segmentsOf(fullCmd);

  for (const segment of segments) {
    if (/^gh\s+pr\s+merge\b/.test(segment)) {
      return `\`gh pr merge\` — matched: ${segment}`;
    }
    if (/^gh\s+api\b/.test(segment) && /\/pulls\/[^\s/]+\/merge\b/.test(segment)) {
      return `\`gh api\` call to a PR's /merge REST endpoint — matched: ${segment}`;
    }
    // Push refspec that lands a different branch directly onto master/main,
    // bypassing PR + merge entirely (e.g. `git push origin some-branch:master`).
    const refspecPush = segment.match(/^git\s+push\s+\S+\s+([A-Za-z0-9_./-]+):([A-Za-z0-9_./-]+)\s*$/);
    if (refspecPush) {
      const [, src, dest] = refspecPush;
      if (PROTECTED_BRANCHES.includes(dest) && src !== dest) {
        return `push refspec targets protected branch "${dest}" directly from "${src}" — matched: ${segment}`;
      }
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
    'Fix: confirm with Emily in this conversation that this specific PR',
    'should be merged now, then have her merge it herself via the GitHub PR',
    'page (or her own terminal) — not from this session.',
  ].join('\n');

  console.error(report);
  process.stdout.write(JSON.stringify({ continue: false, stopReason: report }));
  process.exit(2);
});
