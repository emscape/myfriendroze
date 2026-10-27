#!/usr/bin/env node
// check-ci-status-after-push.js
// PostToolUse hook — Bash
//
// After a real `git push`, blocks until the corresponding GitHub Actions
// run finishes (or a timeout is hit) and reports the real pass/fail result.
//
// Why this exists: a Claude session pushed several times, reported "CI
// added, tests passing" based only on local runs, and never actually
// checked the GitHub Actions result — which had in fact been failing on
// every single push (a gitignore pattern had silently excluded essential
// source files from the very first commit). Local passes are not proof of
// a green remote run — different environment: fresh clone, no leftover
// local dev servers masking a missing dependency, etc. This hook makes
// that verification structural rather than something an agent has to
// remember to do.
//
// Exit codes (per this project's convention — see hooks.json's
// _exit_codes): 0 = pass/skip, 1 = inform Claude of failure (PostToolUse
// can't block a push that already happened, but should make failure
// impossible to silently miss).

'use strict';

const { execFileSync } = require('child_process');
const { loadHookConfig } = require('./lib/hook-config.cjs');
const { firstPushSegment, isGitPush, pushArgs, pushTargetDir, splitRefspec } = require('./lib/git-command.cjs');

function readConfig() {
  try {
    return loadHookConfig({ hooksDir: __dirname }).ci_status_check || {};
  } catch {
    return {};
  }
}

// Arguments go to the program as an argv array, never through a shell: a
// branch name may legally contain `;` or `$(...)`, and interpolating it
// into a command string would run it.
function run(file, args, cwd) {
  try {
    return execFileSync(file, args, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], cwd });
  } catch (e) {
    return e.stdout || '';
  }
}

function tryRun(file, args, cwd) {
  try {
    return { ok: true, out: execFileSync(file, args, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], cwd }) };
  } catch (e) {
    return { ok: false, out: e.stdout || '', err: e.stderr || String(e) };
  }
}

// Synchronous sleep with no external dependency — works cross-platform
// (Windows included) without relying on a shell `sleep` command.
function sleepSync(ms) {
  const sab = new SharedArrayBuffer(4);
  const view = new Int32Array(sab);
  Atomics.wait(view, 0, 0, ms);
}

// Whether a Bash command actually ran a `git push` — including
// `/usr/bin/git push`, `git -C "<dir>" push`, and wrapped/prefixed forms,
// but not a command that merely mentions "push" (a filename, a commit
// message). Uses the same parser as the merge/branch-delete guards.
function shouldVerify(cmd) {
  return isGitPush(cmd);
}

// What a normalized `git push` segment pushes, from its one refspec:
// `{ src, dest }` (refs/heads/ stripped; a `dest` of `HEAD` means the
// current branch), null when no refspec is given (git pushes the current
// branch), or `{ skip }` when no branch commit is pushed (a delete, or a
// tag or other non-branch destination). `git push origin feature` from
// another branch, or `feature:main`, pushes something other than HEAD, so
// HEAD and the current branch aren't the commit and branch to wait for.
// Multi-ref and tag-only pushes (`--all`, `--branches`, `--mirror`,
// `--tags`, or several refspecs) have no single branch whose CI run
// stands for them.
//
// With no refspec, git may still push several branches: the remote's
// configured push refspecs, or every matching branch under
// push.default=matching. `gitConfig(key)` reads a config value (empty when
// unset); it defaults to none set.
function pushedRef(segment, gitConfig = () => '') {
  const { remote, refspecs, sets, deletes } = pushArgs(segment);
  if (deletes) return { skip: 'the push deletes a remote branch' };
  if (sets.length > 0) return { skip: `\`${sets[0]}\` pushes more than one branch's commit, so check CI for each pushed branch manually` };
  if (refspecs.length === 0) {
    if (gitConfig(`remote.${remote || 'origin'}.push`)) return { skip: "the push uses the remote's configured push refspecs, so check CI for each pushed branch manually" };
    if (gitConfig('push.default') === 'matching') return { skip: 'push.default=matching pushes every matching branch, so check CI for each pushed branch manually' };
    return null;
  }
  if (refspecs.length > 1) return { skip: `the push sends ${refspecs.length} refspecs, so check CI for each pushed branch manually` };

  const { src, dest } = splitRefspec(refspecs[0]);
  if (!src) return { skip: 'the push deletes a remote branch' };
  if (/^refs\/(?!heads\/)/.test(dest)) return { skip: `the push updates ${dest}, not a branch` };
  return { src, dest: dest.replace(/^refs\/heads\//, '') };
}

module.exports = { shouldVerify, pushedRef };

// Only run the stdin-driven hook lifecycle when executed directly (how
// Claude Code invokes it) — not when require()'d from the test file.
if (require.main === module) {
  runHook();
}

function runHook() {
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

    if (!shouldVerify(cmd)) {
      process.exit(0);
    }

    const config = readConfig();
    if (config.enabled === false) {
      process.exit(0);
    }

    // The branch, SHA, and runs all come from the repo that was pushed, not
    // this hook's own working directory.
    const repoDir = pushTargetDir(cmd);
    if (!repoDir) {
      console.error('[ci-status-check] Could not determine which repository this push targeted (e.g. `cd "$VAR"`) — skipping CI verification. Check manually with `gh run list` in that repo.');
      process.exit(0);
    }

    // The commit and remote branch named by the push's refspec, falling
    // back to HEAD and the current branch when none is given.
    const ref = pushedRef(firstPushSegment(cmd).normalized, (key) => tryRun('git', ['config', '--get-all', key], repoDir).out.trim());
    if (ref?.skip) {
      console.error(`[ci-status-check] Skipping CI verification: ${ref.skip}.`);
      process.exit(0);
    }

    const ghCheck = tryRun('gh', ['auth', 'status'], repoDir);
    if (!ghCheck.ok) {
      console.error('[ci-status-check] gh CLI not available/authenticated — skipping CI verification. Check manually with `gh run list`.');
      process.exit(0);
    }

    const src = ref?.src || 'HEAD';
    const branch = ref && ref.dest !== 'HEAD'
      ? ref.dest
      : run('git', ['branch', '--show-current'], repoDir).trim();
    const sha = run('git', ['rev-parse', '--verify', '--quiet', `${src}^{commit}`], repoDir).trim();
    if (!branch || !sha) {
      if (ref) {
        console.error(`[ci-status-check] Could not resolve the pushed ref "${src}" to a commit — skipping CI verification. Check manually with \`gh run list\` in that repo.`);
      }
      process.exit(0); // not in a git repo, or detached HEAD — nothing to verify
    }

    const newRunTimeoutMs = (config.new_run_timeout_seconds ?? 60) * 1000;
    const pollIntervalMs = (config.poll_interval_seconds ?? 5) * 1000;
    // completion_timeout_seconds (config.json) is intentionally unenforced —
    // see the comment above the gh run watch call below for why.

    console.error(`[ci-status-check] Waiting for GitHub Actions run on ${branch}@${sha.slice(0, 7)}...`);

    // Phase 1: wait for a run matching this exact commit to appear at all.
    let matchedRun = null;
    const phase1Deadline = Date.now() + newRunTimeoutMs;
    while (Date.now() < phase1Deadline && !matchedRun) {
      const listResult = tryRun(
        'gh',
        ['run', 'list', '--branch', branch, '--limit', '5', '--json', 'databaseId,status,conclusion,headSha'],
        repoDir
      );
      if (listResult.ok) {
        try {
          const runs = JSON.parse(listResult.out);
          matchedRun = runs.find((r) => r.headSha === sha) || null;
        } catch {
          // malformed JSON — treat as not-found-yet, keep polling
        }
      }
      if (!matchedRun) sleepSync(pollIntervalMs);
    }

    if (!matchedRun) {
      console.error(
        `[ci-status-check] No GitHub Actions run found for ${sha.slice(0, 7)} within ${newRunTimeoutMs / 1000}s. This may mean the repo has no workflow watching this branch, or GitHub is slow to register it. You must manually verify with \`gh run list --branch ${branch}\` before reporting success to the user.`
      );
      process.exit(1);
    }

    // Phase 2: `gh run watch` does its own polling internally and exits
    // non-zero on a failed conclusion with --exit-status — no need to
    // hand-roll a second poll loop. It blocks until the run actually
    // completes with no timeout flag of its own; execSync can't interrupt a
    // blocking child process on a wall-clock deadline without spawning it
    // separately and killing it, which isn't worth the complexity here —
    // GitHub Actions jobs already have their own multi-hour cap, so this
    // will always return eventually. completion_timeout_seconds (config.json)
    // is currently unused anywhere in this file as a result — documented
    // there for a future implementer, not silently deleted.
    const watchResult = tryRun('gh', ['run', 'watch', String(matchedRun.databaseId), '--exit-status'], repoDir);

    if (watchResult.ok) {
      console.error(`[ci-status-check] ✅ CI PASSED for ${sha.slice(0, 7)} (run ${matchedRun.databaseId}).`);
      process.exit(0);
    }

    console.error(
      `[ci-status-check] ❌ CI FAILED for ${sha.slice(0, 7)} (run ${matchedRun.databaseId}). Run \`gh run view ${matchedRun.databaseId} --log-failed\` to see why before telling the user this succeeded.`
    );
    process.exit(1);
  });
}
