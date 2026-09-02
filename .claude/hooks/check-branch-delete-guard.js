#!/usr/bin/env node
// check-branch-delete-guard.js
// PreToolUse hook — Bash
//
// Blocks `git push <remote> --delete <branch>` (any flag/argument order,
// including `-d` and the `:branch` shorthand) when an open GitHub PR still
// has that branch as its base — deleting it out from under a still-open,
// stacked PR causes GitHub to auto-close that PR (not merge it, since its
// commits aren't in the new target yet), and GitHub then refuses to let
// you retarget a closed PR's base. The only recovery is opening a
// brand-new PR from the same branch/commits — see myfriendroze
// project_backlog memory, 2026-09-02, for the incident this hook exists
// to prevent a repeat of.
//
// Config used:
//   .claude/hooks/config.json → branch_delete_guard.enabled
//
// Algorithm:
//   1. Skip entirely if branch_delete_guard.enabled is false in config.json
//      (config.json missing/invalid → treated as enabled, same fail-open
//      spirit as the gh-unavailable case below — a missing config must
//      never silently disable a safety check).
//   2. Only fires on an actual `git push ... --delete <branch>...` (any
//      flag order) or the `:branch` colon shorthand — local `git branch -D`
//      is left alone, since that alone can't break a GitHub PR's base.
//   3. Extract every branch name being deleted.
//   4. `gh pr list --state open` for each branch name as a base.
//   5. Any match → BLOCK, naming the PR(s) and what to do instead.
//   6. `gh` unavailable/unauthenticated, or `gh pr list` fails/returns
//      unparseable output → warn loudly and allow (can't verify, but a
//      stale check must never make otherwise-normal work impossible).
//
// Exit codes:
//   0  — PASS, not a matching command, guard disabled, or gh unavailable
//        (fail open)
//   2  — BLOCK: an open PR still bases off a branch this command would delete

'use strict';

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const CONFIG_PATH = path.resolve(__dirname, 'config.json');

function isEnabled() {
  try {
    const config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
    // Absent key defaults to enabled — only an explicit `false` opts out,
    // matching the "fail open on missing config, not on missing setting"
    // distinction: a config file that exists but never mentions this guard
    // shouldn't be read as "someone deliberately turned it off".
    return config.branch_delete_guard?.enabled !== false;
  } catch {
    // config.json missing/invalid — err toward the safety check running,
    // not toward silently skipping it.
    return true;
  }
}

function tryRun(cmd) {
  try {
    return { ok: true, out: execSync(cmd, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }) };
  } catch (e) {
    return { ok: false, out: e.stdout || '', err: e.stderr || String(e) };
  }
}

// Pulls every branch name a `git push` invocation would delete.
//
// Splits the whole command into shell-chained segments *first*, then
// inspects each segment independently for one that actually starts with
// `git push` — rather than searching the raw string for the first "git
// push" substring and taking everything up to the next operator. The
// search-then-slice approach broke on something like
// `echo "git push" && git push origin --delete some-branch`: the regex
// matched inside the quoted echo argument, the segment split then handed
// back `git push"` as the "push segment" (no --delete flag on it), and
// the hook concluded there was nothing to check — silently allowing the
// real delete later in the same command to slip through unexamined.
//
// Handles `--delete`/`-d` in any position relative to the remote (e.g.
// both `git push origin --delete branch` and `git push --delete origin
// branch` are valid git syntax and equally common) by tokenizing each
// push segment and treating every non-flag token after the remote as a
// branch to delete — rather than assuming a fixed "remote, then
// --delete, then branches" shape, which silently matched zero branches
// (and so silently allowed the delete) for the flag-before-remote form.
// Also handles the older `:branch` refspec shorthand independently, since
// that doesn't need a --delete/-d flag at all.
//
// Known limitations:
//   - Segment splitting is not quote-aware, so a chain operator sitting
//     inside a quoted string (rare, and not the scenario above — that one
//     only involved "git push" itself inside quotes) can still split
//     mid-string. Any resulting false-positive segment errs toward
//     blocking, not toward silently allowing a real delete, which is the
//     safe direction for a security check.
//   - If a remote is omitted entirely (relying on push.default / an
//     upstream tracking branch), the first branch name would be mistaken
//     for the remote and skipped. Rare enough in practice (this
//     codebase's own workflow always names the remote explicitly) not to
//     be worth the added complexity of distinguishing a remote name from
//     a branch name with no ground truth to check against.
function extractDeletedBranches(fullCmd) {
  const branches = new Set();

  const segments = fullCmd.split(/&&|\|\||[;&|]/);
  for (const rawSegment of segments) {
    const segment = rawSegment.trim();
    // Anchored at the start of the segment — "contains git push" isn't
    // enough, since that also matches inside an unrelated quoted string
    // that merely mentions it.
    if (!/^git\s+push\b/.test(segment)) continue;

    const tokens = segment.split(/\s+/); // tokens[0] === 'git', tokens[1] === 'push'
    const rest = tokens.slice(2);
    const hasDeleteFlag = rest.some((t) => t === '--delete' || t === '-d');
    if (hasDeleteFlag) {
      const nonFlags = rest.filter((t) => !t.startsWith('-'));
      for (const b of nonFlags.slice(1)) branches.add(b); // [0] is the remote
    }

    // `git push origin :branch-name` — a leading bare colon means
    // "delete", scoped to this same segment.
    for (const m of segment.matchAll(/(?:^|\s):([A-Za-z0-9_./-]+)(?=\s|$)/g)) {
      branches.add(m[1]);
    }
  }

  return [...branches];
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
  if (!/\bgit\s+push\b/.test(cmd)) process.exit(0); // not a push — allow

  const branches = extractDeletedBranches(cmd);
  if (branches.length === 0) process.exit(0); // push, but not a delete — allow

  const ghAuth = tryRun('gh auth status');
  if (!ghAuth.ok) {
    console.error('[branch-delete-guard] gh CLI not available/authenticated — cannot check for stacked PRs depending on this branch. Allowing, but verify manually with `gh pr list --state open` first.');
    process.exit(0);
  }

  const prList = tryRun('gh pr list --state open --json number,baseRefName,headRefName,title --limit 200');
  if (!prList.ok || !prList.out.trim()) {
    console.error(`[branch-delete-guard] \`gh pr list\` ${prList.ok ? 'returned no output' : 'failed'} — cannot check for stacked PRs depending on this branch. Allowing, but verify manually with \`gh pr list --state open\` before deleting.${prList.err ? `\n${prList.err}` : ''}`);
    process.exit(0);
  }

  let openPrs;
  try {
    openPrs = JSON.parse(prList.out);
  } catch {
    console.error('[branch-delete-guard] Could not parse `gh pr list` output — allowing, but verify manually before deleting.');
    process.exit(0);
  }

  const affected = branches
    .map((branch) => ({
      branch,
      dependents: openPrs.filter((pr) => pr.baseRefName === branch),
    }))
    .filter((entry) => entry.dependents.length > 0);

  if (affected.length === 0) process.exit(0);

  const rows = affected
    .flatMap(({ branch, dependents }) =>
      dependents.map((pr) => `  #${pr.number} "${pr.title}" (${pr.headRefName}) still bases off "${branch}"`)
    )
    .join('\n');

  const report = [
    'BRANCH DELETE GUARD — BLOCK',
    '',
    'Deleting this branch would pull the base out from under a still-open PR:',
    rows,
    '',
    'Deleting a PR\'s base branch does not merge it — GitHub auto-closes it instead',
    '(since its commits usually are not in the new target yet), and a closed PR\'s',
    'base cannot be retargeted. The only recovery is opening a brand-new PR from',
    'the same branch/commits.',
    '',
    'Fix: retarget the dependent PR(s) above to their real final base first',
    '(`gh pr edit <number> --base <new-base>`), confirm it shows a clean/correct',
    'diff, then delete this branch.',
  ].join('\n');

  console.error(report);
  process.stdout.write(JSON.stringify({ continue: false, stopReason: report }));
  process.exit(2);
});
