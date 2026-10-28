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
//   1. Skip entirely if branch_delete_guard.enabled is false in the SHARED config.json
//      (a project-local hooks.config.json cannot disable it; config.json missing/invalid → treated as enabled, same fail-open
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

const { execSync, execFileSync } = require('child_process');
const { loadHookConfig } = require('./lib/hook-config.cjs');
const { commandSegments, pushTargetDir, stripLeadingEnvPrefix, stripSurroundingQuotes } = require('./lib/git-command.cjs');

function isEnabled() {
  try {
    const config = loadHookConfig({ hooksDir: __dirname });
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

// `cmd` is a shell string, or a [file, ...args] array run without a shell —
// for arguments such as branch names, which git lets contain `$`, `;`, `&`.
function tryRun(cmd, cwd) {
  const opts = { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], cwd };
  try {
    return { ok: true, out: Array.isArray(cmd) ? execFileSync(cmd[0], cmd.slice(1), opts) : execSync(cmd, opts) };
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
// Segment splitting and normalization (env/sudo prefixes, `bash -c`
// wrappers, a path-qualified git binary, `git -C <dir>` and other global
// options) come from lib/git-command.cjs, shared with check-merge-guard.js
// so the two guards recognize the same set of push forms.
//
// Known limitation:
//   - If a remote is omitted entirely (relying on push.default / an
//     upstream tracking branch), the first branch name would be mistaken
//     for the remote and skipped. Rare enough in practice (this
//     codebase's own workflow always names the remote explicitly) not to
//     be worth the added complexity of distinguishing a remote name from
//     a branch name with no ground truth to check against.

// `git push origin :refs/heads/some-branch` is equivalent to
// `git push origin :some-branch` — git accepts the fully-qualified ref on
// either side of a refspec. Strips a quoted token down to its bare value
// first (see stripSurroundingQuotes), then the refs/heads/ prefix, so a
// quoted and/or fully-qualified delete still matches `pr.baseRefName`,
// which GitHub always reports as the bare, unquoted branch name.
function normalizeBranchName(name) {
  return stripSurroundingQuotes(name).replace(/^refs\/heads\//, '');
}

function extractDeletedBranches(fullCmd) {
  const branches = new Set();

  for (const { normalized: segment } of commandSegments(fullCmd)) {
    // Anchored at the start of the segment — "contains git push" isn't
    // enough, since that also matches inside an unrelated quoted string
    // that merely mentions it.
    if (!/^git\s+push\b/.test(segment)) continue;

    const tokens = segment.split(/\s+/); // tokens[0] === 'git', tokens[1] === 'push'
    // Unquoted first: the shell strips the quotes from `"--delete"` before
    // git sees it, so it's the same flag.
    const rest = tokens.slice(2).map(stripSurroundingQuotes);
    const hasDeleteFlag = rest.some((t) => t === '--delete' || t === '-d');
    if (hasDeleteFlag) {
      const nonFlags = rest.filter((t) => !t.startsWith('-'));
      for (const b of nonFlags.slice(1)) branches.add(normalizeBranchName(b)); // [0] is the remote
    }

    // `git push origin :branch-name` — a leading bare colon means
    // "delete", scoped to this same segment. Captures any run of
    // non-whitespace after the colon rather than an allow-listed character
    // class — git ref names permit a wide range of characters (`@`, `+`,
    // etc.; see git-check-ref-format), and a narrower class here would
    // silently fail to extract a real, valid branch name, defeating the
    // guard for exactly the kind of ref it should be catching. The colon
    // may also be immediately preceded by an opening quote (a quoted
    // refspec token, e.g. `":branch"`) rather than only whitespace/start
    // of segment — without allowing for that, the colon itself is never
    // found and the whole delete goes undetected, not just misparsed.
    for (const m of segment.matchAll(/(?:^|\s)["']?:(\S+?)["']?(?=\s|$)/g)) {
      branches.add(normalizeBranchName(m[1]));
    }
  }

  return [...branches];
}

// The open PRs basing off each branch: `{ affected, warnings }`, where
// `affected` lists only branches with dependents (`{ branch, dependents }`)
// and `warnings` names each branch whose lookup can't be trusted. Every
// branch is looked up, so one failed query can't hide a dependent found
// for another: the caller blocks on any `affected` entry and allows (with
// the warnings) only when there are none. One query per branch, filtered by base on GitHub's side, so a dependent PR can't
// fall past the first page of every open PR in a busy repo. Any result
// blocks, so the limit only caps the report. `run` defaults to tryRun;
// tests inject a fake, since a stub `gh.cmd` on PATH isn't found by a
// shell-less spawn on Windows.
function findDependents(branches, repoDir, run = tryRun) {
  const affected = [];
  const warnings = [];
  for (const branch of branches) {
    const prList = run(['gh', 'pr', 'list', '--state', 'open', '--base', branch, '--json', 'number,headRefName,title', '--limit', '100'], repoDir);
    if (!prList.ok || !prList.out.trim()) {
      warnings.push(`[branch-delete-guard] \`gh pr list\` ${prList.ok ? 'returned no output' : 'failed'} — cannot check for stacked PRs depending on "${branch}". Verify manually with \`gh pr list --state open --base ${branch}\` before deleting it.${prList.err ? `\n${prList.err}` : ''}`);
      continue;
    }

    let dependents;
    try {
      dependents = JSON.parse(prList.out);
    } catch {
      dependents = null;
    }
    if (!Array.isArray(dependents)) {
      warnings.push(`[branch-delete-guard] Could not parse \`gh pr list\` output for "${branch}" — verify manually before deleting it.`);
      continue;
    }
    if (dependents.length > 0) affected.push({ branch, dependents });
  }
  return { affected, warnings };
}

module.exports = { extractDeletedBranches, stripLeadingEnvPrefix, normalizeBranchName, isEnabled, tryRun, findDependents };

// Only run the stdin-driven hook lifecycle when this file is executed
// directly (`node check-branch-delete-guard.js`, which is how Claude Code
// invokes it) — not when it's require()'d, e.g. from
// check-branch-delete-guard.test.js. Without this guard, requiring the
// file for its pure functions would also attach stdin listeners and hang
// the process waiting for input that's never coming.
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
    const branches = extractDeletedBranches(cmd);
    if (branches.length === 0) process.exit(0); // not a delete push — allow

    // Open PRs of the repo being pushed to (after any `cd`/`git -C`), not
    // this hook's own working directory, whose PRs say nothing about it.
    const repoDir = pushTargetDir(cmd);
    if (!repoDir) {
      console.error('[branch-delete-guard] Could not determine which repository this delete targets (e.g. `cd "$VAR"`) — cannot check for stacked PRs depending on this branch. Allowing, but verify manually with `gh pr list --state open` in that repo first.');
      process.exit(0);
    }

    const ghAuth = tryRun('gh auth status', repoDir);
    if (!ghAuth.ok) {
      console.error('[branch-delete-guard] gh CLI not available/authenticated — cannot check for stacked PRs depending on this branch. Allowing, but verify manually with `gh pr list --state open` first.');
      process.exit(0);
    }

    const { affected, warnings } = findDependents(branches, repoDir);
    if (affected.length === 0) {
      for (const warning of warnings) console.error(warning);
      process.exit(0);
    }

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
      ...(warnings.length > 0 ? ['', 'Also unchecked:', ...warnings] : []),
    ].join('\n');

    console.error(report);
    process.stdout.write(JSON.stringify({ continue: false, stopReason: report }));
    process.exit(2);
  });
}
