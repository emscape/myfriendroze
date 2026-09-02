// check-branch-delete-guard.test.js
// Behavioral tests for the pure extraction logic in
// check-branch-delete-guard.js — run with `node --test .claude/hooks/`.
//
// check-branch-delete-guard.js only runs its stdin-driven hook lifecycle
// when executed directly (`require.main === module`), so it's safe to
// require() here for its exported pure functions without triggering that
// lifecycle or hanging the test process waiting on stdin.

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { extractDeletedBranches } = require('./check-branch-delete-guard.js');

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

  await t.test(':branch shorthand captures ref characters outside the old allow-list (@, +)', () => {
    assert.deepEqual(branches('git push origin :feature/branch+with@chars'), ['feature/branch+with@chars']);
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

  await t.test('env -u NAME (separate-argument unset flag) is stripped', () => {
    assert.deepEqual(branches('env -u GIT_SSH_COMMAND git push origin --delete branch14'), ['branch14']);
  });

  await t.test('env --unset=NAME (combined long-flag form) is stripped', () => {
    assert.deepEqual(branches('env --unset=GIT_SSH_COMMAND git push origin --delete branch15'), ['branch15']);
  });

  await t.test('env -C DIR (change-directory flag) is stripped', () => {
    assert.deepEqual(branches('env -C /tmp git push origin --delete branch16'), ['branch16']);
  });

  await t.test('a mix of env flags and VAR=value assignments in one prefix is stripped', () => {
    assert.deepEqual(
      branches('env -i GIT_TRACE=1 -u GIT_SSH_COMMAND git push origin --delete branch17'),
      ['branch17']
    );
  });

  await t.test('a double-quoted --delete branch argument is unquoted before matching', () => {
    assert.deepEqual(branches('git push origin --delete "branch18"'), ['branch18']);
  });

  await t.test('a single-quoted --delete branch argument is unquoted before matching', () => {
    assert.deepEqual(branches("git push origin --delete 'branch19'"), ['branch19']);
  });

  await t.test('a fully double-quoted :branch refspec token is detected and unquoted', () => {
    assert.deepEqual(branches('git push origin ":branch20"'), ['branch20']);
  });

  await t.test('a fully single-quoted :branch refspec token is detected and unquoted', () => {
    assert.deepEqual(branches("git push origin ':branch21'"), ['branch21']);
  });

  await t.test('an unrelated command is not flagged', () => {
    assert.deepEqual(branches('git status'), []);
  });
});
