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

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

function readConfig() {
  try {
    const raw = fs.readFileSync(path.join(__dirname, 'config.json'), 'utf8');
    return JSON.parse(raw).ci_status_check || {};
  } catch {
    return {};
  }
}

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

// Synchronous sleep with no external dependency — works cross-platform
// (Windows included) without relying on a shell `sleep` command.
function sleepSync(ms) {
  const sab = new SharedArrayBuffer(4);
  const view = new Int32Array(sab);
  Atomics.wait(view, 0, 0, ms);
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

  // Tighter than a bare substring match on purpose — this repo's own
  // check-git-push-audit.js previously had a real bug where
  // `\bgit\b.*\bpush\b` matched any command whose text merely contained
  // "push" anywhere, including unrelated filenames. Require "git push" as
  // adjacent words.
  if (!/(^|[;&|]\s*|\s)git\s+push(\s|$)/.test(cmd)) {
    process.exit(0);
  }

  const config = readConfig();
  if (config.enabled === false) {
    process.exit(0);
  }

  const ghCheck = tryRun('gh auth status');
  if (!ghCheck.ok) {
    console.error('[ci-status-check] gh CLI not available/authenticated — skipping CI verification. Check manually with `gh run list`.');
    process.exit(0);
  }

  const branch = run('git branch --show-current').trim();
  const sha = run('git rev-parse HEAD').trim();
  if (!branch || !sha) {
    process.exit(0); // not in a git repo, or detached HEAD — nothing to verify
  }

  const newRunTimeoutMs = (config.new_run_timeout_seconds ?? 60) * 1000;
  const completionTimeoutMs = (config.completion_timeout_seconds ?? 180) * 1000;
  const pollIntervalMs = (config.poll_interval_seconds ?? 5) * 1000;

  console.error(`[ci-status-check] Waiting for GitHub Actions run on ${branch}@${sha.slice(0, 7)}...`);

  // Phase 1: wait for a run matching this exact commit to appear at all.
  let matchedRun = null;
  const phase1Deadline = Date.now() + newRunTimeoutMs;
  while (Date.now() < phase1Deadline && !matchedRun) {
    const listResult = tryRun(
      `gh run list --branch ${branch} --limit 5 --json databaseId,status,conclusion,headSha`
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

  // Phase 2: wait for that specific run to finish.
  let finalRun = matchedRun;
  const phase2Deadline = Date.now() + completionTimeoutMs;
  while (Date.now() < phase2Deadline && finalRun.status !== 'completed') {
    sleepSync(pollIntervalMs);
    const viewResult = tryRun(`gh run view ${finalRun.databaseId} --json status,conclusion`);
    if (viewResult.ok) {
      try {
        finalRun = { ...finalRun, ...JSON.parse(viewResult.out) };
      } catch {
        // keep previous finalRun, retry next loop
      }
    }
  }

  if (finalRun.status !== 'completed') {
    console.error(
      `[ci-status-check] GitHub Actions run ${finalRun.databaseId} for ${sha.slice(0, 7)} is still "${finalRun.status}" after ${completionTimeoutMs / 1000}s. You must check \`gh run view ${finalRun.databaseId}\` yourself before reporting success to the user.`
    );
    process.exit(1);
  }

  if (finalRun.conclusion === 'success') {
    console.error(`[ci-status-check] ✅ CI PASSED for ${sha.slice(0, 7)} (run ${finalRun.databaseId}).`);
    process.exit(0);
  }

  console.error(
    `[ci-status-check] ❌ CI FAILED for ${sha.slice(0, 7)} (run ${finalRun.databaseId}, conclusion: ${finalRun.conclusion}). Run \`gh run view ${finalRun.databaseId} --log-failed\` to see why before telling the user this succeeded.`
  );
  process.exit(1);
});
