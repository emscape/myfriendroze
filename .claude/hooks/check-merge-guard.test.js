// check-merge-guard.test.js
// Behavioral tests for the pure detection logic in check-merge-guard.js —
// run with `node --test .claude/hooks/`.
//
// check-merge-guard.js only runs its stdin-driven hook lifecycle when
// executed directly (`require.main === module`), so it's safe to
// require() here without triggering that lifecycle or hanging the test
// process waiting on stdin.

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { findMergeReason } = require('./check-merge-guard.js');

function blocked(cmd) {
  return findMergeReason(cmd) !== null;
}

test('findMergeReason', async (t) => {
  await t.test('gh pr merge, plain', () => {
    assert.equal(blocked('gh pr merge 27'), true);
  });

  await t.test('gh pr merge with flags in various positions', () => {
    assert.equal(blocked('gh pr merge 27 --squash --delete-branch'), true);
    assert.equal(blocked('gh pr merge --squash 27'), true);
  });

  await t.test('gh api PUT call to the PR /merge REST endpoint', () => {
    assert.equal(blocked('gh api repos/emscape/myfriendroze/pulls/27/merge -X PUT'), true);
  });

  await t.test('gh api call to the /merge endpoint using --method PUT', () => {
    assert.equal(blocked('gh api repos/emscape/myfriendroze/pulls/27/merge --method PUT'), true);
  });

  await t.test('a read-only GET to the /merge endpoint (no -X PUT) is not blocked', () => {
    assert.equal(blocked('gh api repos/emscape/myfriendroze/pulls/27/merge'), false);
  });

  await t.test('a chained command with an unrelated segment before the real merge', () => {
    assert.equal(blocked('echo hi && gh pr merge 5'), true);
  });

  await t.test('local git merge after checking out master', () => {
    assert.equal(blocked('git checkout master && git merge fix/some-branch'), true);
  });

  await t.test('local git merge after switching to main', () => {
    assert.equal(blocked('git switch main && git merge fix/some-branch'), true);
  });

  await t.test('push refspec landing a branch directly on master', () => {
    assert.equal(blocked('git push origin fix/some-branch:master'), true);
  });

  await t.test('push refspec with --force before the remote', () => {
    assert.equal(blocked('git push --force origin feature:main'), true);
  });

  await t.test('push refspec with --force after the remote', () => {
    assert.equal(blocked('git push origin --force feature:main'), true);
  });

  await t.test('push refspec with -f short flag', () => {
    assert.equal(blocked('git push origin -f feature:master'), true);
  });

  await t.test('push refspec using fully-qualified refs/heads/ on both sides', () => {
    assert.equal(blocked('git push origin refs/heads/feature:refs/heads/main'), true);
  });

  await t.test('push refspec with the remote omitted entirely', () => {
    assert.equal(blocked('git push feature:main'), true);
  });

  await t.test('a plain push of a branch literally named master to a remote', () => {
    assert.equal(blocked('git push origin master'), true);
  });

  await t.test('a plain push of a branch literally named main to a remote', () => {
    assert.equal(blocked('git push origin main'), true);
  });

  await t.test('gh pr view is not a merge', () => {
    assert.equal(blocked('gh pr view 27'), false);
  });

  await t.test('gh pr list is not a merge', () => {
    assert.equal(blocked('gh pr list --state open'), false);
  });

  await t.test('an ordinary feature-branch push is not a merge', () => {
    assert.equal(blocked('git push origin fix/some-feature'), false);
  });

  await t.test('git push origin alone (no branch argument) is not a merge', () => {
    assert.equal(blocked('git push origin'), false);
  });

  await t.test('a single bare token is treated as the remote, not a branch push', () => {
    assert.equal(blocked('git push some-remote'), false);
  });

  await t.test('an unrelated command is not flagged', () => {
    assert.equal(blocked('git status'), false);
  });

  await t.test('npm test is not flagged', () => {
    assert.equal(blocked('npm test'), false);
  });
});
