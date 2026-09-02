// check-branch-delete-guard.test.js
// Behavioral tests for the pure extraction logic in
// check-branch-delete-guard.js — run with `node --test .claude/hooks/`.
//
// The hook file itself is a script, not a module (no module.exports;
// it drives its own stdin/stdout/exit-code lifecycle at the bottom), so
// extractDeletedBranches() is pulled out of it via a small text
// transform rather than require()'d directly — requiring the file as-is
// would immediately start consuming process.stdin and never return.

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function loadExtractDeletedBranches() {
  const filePath = path.join(__dirname, 'check-branch-delete-guard.js');
  const src = fs.readFileSync(filePath, 'utf8').replace(/^#!.*\r?\n/, '');
  // Stop before the stdin-reading lifecycle at the bottom of the file, and
  // export the one function under test instead of letting the script run.
  const wrapped = src.replace(
    'const chunks = [];',
    'module.exports = { extractDeletedBranches }; return; const chunks = [];'
  );
  const mod = { exports: {} };
  // eslint-disable-next-line no-new-func
  const fn = new Function('module', 'require', '__dirname', wrapped);
  fn(mod, require, __dirname);
  return mod.exports.extractDeletedBranches;
}

const extractDeletedBranches = loadExtractDeletedBranches();

function branches(cmd) {
  return extractDeletedBranches(cmd).sort();
}

test('extractDeletedBranches', async (t) => {
  await t.test('flag after the remote: git push origin --delete branch', () => {
    assert.deepEqual(branches('git push origin --delete branch1'), ['branch1']);
  });

  await t.test('flag before the remote: git push --delete origin branch', () => {
    assert.deepEqual(branches('git push --delete origin branch2'), ['branch2']);
  });

  await t.test('-d short flag', () => {
    assert.deepEqual(branches('git push origin -d branch3'), ['branch3']);
  });

  await t.test(':branch colon shorthand', () => {
    assert.deepEqual(branches('git push origin :branch4'), ['branch4']);
  });

  await t.test('fully-qualified :refs/heads/branch shorthand is normalized to the bare name', () => {
    assert.deepEqual(branches('git push origin :refs/heads/branch5'), ['branch5']);
  });

  await t.test('a non-delete push is not flagged', () => {
    assert.deepEqual(branches('git push origin main'), []);
  });

  await t.test('multiple chained delete pushes are all caught', () => {
    assert.deepEqual(
      branches('git push origin --delete branch6 && git push origin --delete branch7'),
      ['branch6', 'branch7']
    );
  });

  await t.test('a quoted mention of "git push" earlier in the command does not mask a real delete later', () => {
    assert.deepEqual(
      branches('echo "git push" && git push origin --delete branch8'),
      ['branch8']
    );
  });

  await t.test('a single env var prefix is stripped', () => {
    assert.deepEqual(branches('GIT_TRACE=1 git push origin --delete branch9'), ['branch9']);
  });

  await t.test('the `env` command prefix is stripped', () => {
    assert.deepEqual(branches('env GIT_TRACE=1 git push origin --delete branch10'), ['branch10']);
  });

  await t.test('multiple env var assignments are all stripped', () => {
    assert.deepEqual(
      branches('FOO=bar BAZ=qux git push --delete origin branch11'),
      ['branch11']
    );
  });

  await t.test('a quoted env value containing spaces is stripped as one token', () => {
    assert.deepEqual(
      branches('GIT_SSH_COMMAND="ssh -vv" git push origin --delete branch12'),
      ['branch12']
    );
  });

  await t.test('a single-quoted env value containing spaces is stripped as one token', () => {
    assert.deepEqual(
      branches("GIT_SSH_COMMAND='ssh -vv' git push origin --delete branch13"),
      ['branch13']
    );
  });

  await t.test('an env-prefixed command that is not a push is not flagged', () => {
    assert.deepEqual(branches('env node -e "console.log(1)"'), []);
  });

  await t.test('an unrelated command is not flagged', () => {
    assert.deepEqual(branches('git status'), []);
  });
});
