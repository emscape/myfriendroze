#!/usr/bin/env node
// check-branch-delete-guard.js
// PreToolUse hook — Bash
//
// Blocks `git push <remote> --delete <branch>` (and the `:branch` shorthand)
// when an open GitHub PR still has that branch as its base — deleting it out
// from under a still-open, stacked PR causes GitHub to auto-close that PR
// (not merge it, since its commits aren't in the new target yet), and
// GitHub then refuses to let you retarget a closed PR's base. The only
// recovery is opening a brand-new PR from the same branch/commits — see
// myfriendroze project_backlog memory, 2026-09-02, for the incident this
// hook exists to prevent a repeat of.
//
// Algorithm:
//   1. Only fires on an actual `git push ... --delete <branch>` (or the
//      `:branch` colon shorthand) — local `git branch -D` is left alone,
//      since that alone can't break a GitHub PR's base.
//   2. Extract every branch name being deleted.
//   3. `gh pr list --state open` for each branch name as a base.
//   4. Any match → BLOCK, naming the PR(s) and what to do instead.
//   5. `gh` unavailable/unauthenticated → warn and allow (can't verify,
//      but a stale check must never make otherwise-normal work impossible).
//
// Exit codes:
//   0  — PASS, not a matching command, or gh unavailable (fail open)
//   2  — BLOCK: an open PR still bases off a branch this command would delete

'use strict';

const { execSync } = require('child_process');

function run(cmd) {
  try {
    return execSync(cmd, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
  } catch (e) {
    return e.stdout || '';
  }
}

function tryRun(cmd) {
  try {
    return { ok: true, out: execSync(cmd, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }) };
  } catch (e) {
    return { ok: false, out: e.stdout || '', err: e.stderr || String(e) };
  }
}

// Pulls every branch name a `git push` invocation would delete — handles
// both `--delete branch1 branch2` (possibly repeated/mixed with other
// flags) and the older `:branch` refspec shorthand, since either can
// appear in real usage.
function extractDeletedBranches(cmd) {
  const branches = [];

  const deleteFlagMatch = cmd.match(/git\s+push\s+\S+\s+--delete\s+(.+)$/);
  if (deleteFlagMatch) {
    // Stop at the next flag (starts with -) or shell operator, so trailing
    // `&& something-else` doesn't get swallowed as a branch name.
    const rest = deleteFlagMatch[1].split(/\s+(?=-)|[;&|]/)[0];
    branches.push(...rest.trim().split(/\s+/).filter(Boolean));
  }

  // `git push origin :branch-name` — a leading bare colon means "delete".
  const colonMatches = cmd.matchAll(/(?:^|\s):([A-Za-z0-9_./-]+)(?=\s|$)/g);
  for (const m of colonMatches) branches.push(m[1]);

  return [...new Set(branches)];
}

const chunks = [];
process.stdin.on('data', (d) => chunks.push(d));
process.stdin.on('end', () => {
  let input;
  try {
    input = JSON.parse(Buffer.concat(chunks).toString());
  } catch {
    process.exit(0);
  }

  const cmd = (input?.tool_input?.command || '').trim();
  if (!/\bgit\s+push\b/.test(cmd) || (!/--delete\b/.test(cmd) && !/(?:^|\s):[A-Za-z0-9_./-]+/.test(cmd))) {
    process.exit(0); // not a branch-delete push — allow
  }

  const branches = extractDeletedBranches(cmd);
  if (branches.length === 0) process.exit(0);

  const ghCheck = tryRun('gh auth status');
  if (!ghCheck.ok) {
    console.error('[branch-delete-guard] gh CLI not available/authenticated — cannot check for stacked PRs depending on this branch. Allowing, but verify manually with `gh pr list --state open` first.');
    process.exit(0);
  }

  let openPrs;
  try {
    openPrs = JSON.parse(run('gh pr list --state open --json number,baseRefName,headRefName,title --limit 200') || '[]');
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
