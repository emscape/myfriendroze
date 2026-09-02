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

function blocked(cmd, getCurrentBranch) {
  return findMergeReason(cmd, getCurrentBranch) !== null;
}

// A command with no explicit branch/refspec (e.g. `git push origin`) falls
// back to whatever branch is actually checked out, via a real `git
// rev-parse` call by default — fine for the hook itself, but a real
// ambient value would make any test exercising that fallback path
// non-deterministic (its result would depend on whichever branch happens
// to be checked out when the test suite runs). These fixed stand-ins are
// injected as the second argument instead.
const onFeatureBranch = () => 'fix/unrelated-feature';
const onMaster = () => 'master';

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

  await t.test('refspec push where src and dest are both the same protected branch', () => {
    assert.equal(blocked('git push origin main:main'), true);
  });

  await t.test('refspec push with a trailing colon (empty dest defaults to src) targeting a protected branch', () => {
    assert.equal(blocked('git push origin main:'), true);
  });

  await t.test('gh pr merge behind an env-var prefix', () => {
    assert.equal(blocked('GH_TOKEN=abc123 gh pr merge 27'), true);
  });

  await t.test('gh pr merge invoked via an absolute path', () => {
    assert.equal(blocked('/usr/bin/gh pr merge 27'), true);
  });

  await t.test('git merge on a protected branch behind an env-var prefix', () => {
    assert.equal(blocked('git checkout master && GIT_TRACE=1 git merge fix/some-branch'), true);
  });

  await t.test('git merge on a protected branch invoked via an absolute path', () => {
    assert.equal(blocked('git checkout master && /usr/bin/git merge fix/some-branch'), true);
  });

  await t.test('a protected-branch push behind an env-var prefix', () => {
    assert.equal(blocked('GIT_TRACE=1 git push origin master'), true);
  });

  await t.test('gh pr merge behind the -R global repo flag', () => {
    assert.equal(blocked('gh -R emscape/myfriendroze pr merge 27'), true);
  });

  await t.test('gh pr merge behind the --repo global flag, separate-argument form', () => {
    assert.equal(blocked('gh --repo emscape/myfriendroze pr merge 27'), true);
  });

  await t.test('gh pr merge behind the --repo global flag, combined-argument form', () => {
    assert.equal(blocked('gh --repo=emscape/myfriendroze pr merge 27'), true);
  });

  await t.test('a protected-branch push behind the git -C global flag', () => {
    assert.equal(blocked('git -C /some/dir push origin master'), true);
  });

  await t.test('git merge on a protected branch behind the git -c global config-override flag', () => {
    assert.equal(blocked('git checkout master && git -c user.name=bot merge fix/some-branch'), true);
  });

  await t.test('a protected-branch push behind a global flag stacked with an env-var prefix', () => {
    assert.equal(blocked('GIT_TRACE=1 git -C /some/dir push origin master'), true);
  });

  await t.test('gh -R with a non-merge subcommand is not flagged', () => {
    assert.equal(blocked('gh -R emscape/myfriendroze pr view 27'), false);
  });

  await t.test('a quoted Windows absolute path (with spaces) to git.exe is normalized', () => {
    assert.equal(blocked('"C:\\Program Files\\Git\\bin\\git.exe" push origin master'), true);
  });

  await t.test('a quoted Windows absolute path (with spaces) to gh.exe is normalized', () => {
    assert.equal(blocked('"C:\\Program Files\\GitHub CLI\\gh.exe" pr merge 27'), true);
  });

  await t.test('an unquoted path to git.exe (no spaces) is still normalized', () => {
    assert.equal(blocked('C:\\Git\\bin\\git.exe push origin master'), true);
  });

  await t.test('a quoted refspec targeting a protected branch is unquoted before matching', () => {
    assert.equal(blocked('git push origin "feature:main"'), true);
  });

  await t.test('a quoted bare branch name matching a protected branch is unquoted before matching', () => {
    assert.equal(blocked('git push origin "main"'), true);
  });

  await t.test('git push --all is blocked regardless of the current branch', () => {
    assert.equal(blocked('git push --all', onFeatureBranch), true);
  });

  await t.test('git push --mirror is blocked regardless of the current branch', () => {
    assert.equal(blocked('git push origin --mirror', onFeatureBranch), true);
  });

  await t.test('gh pr merge behind a sudo prefix', () => {
    assert.equal(blocked('sudo gh pr merge 27'), true);
  });

  await t.test('a protected-branch push behind a sudo prefix with a flag', () => {
    assert.equal(blocked('sudo -n git push origin master'), true);
  });

  await t.test('a protected-branch push behind a command prefix', () => {
    assert.equal(blocked('command git push origin master'), true);
  });

  await t.test('gh pr merge behind an exec prefix', () => {
    assert.equal(blocked('exec gh pr merge 27'), true);
  });

  await t.test('sudo and an env-var prefix stacked together, in either order', () => {
    assert.equal(blocked('sudo GIT_TRACE=1 git push origin master'), true);
    assert.equal(blocked('GIT_TRACE=1 sudo git push origin master'), true);
  });

  await t.test('sudo behind an env-var prefix that is not a merge is not flagged', () => {
    assert.equal(blocked('sudo gh pr view 27'), false);
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

  await t.test('git push origin alone (no branch argument) is not a merge, when not on a protected branch', () => {
    assert.equal(blocked('git push origin', onFeatureBranch), false);
  });

  await t.test('a single bare token is treated as the remote, not a branch push, when not on a protected branch', () => {
    assert.equal(blocked('git push some-remote', onFeatureBranch), false);
  });

  await t.test('git switch main && git push origin — implicit push while on a protected branch', () => {
    // Deterministic via the textual checkout in the command chain itself;
    // no branch injection needed since checkedOutTo resolves this before
    // any real current-branch lookup would even happen.
    assert.equal(blocked('git switch main && git push origin'), true);
  });

  await t.test('git checkout master && git push — implicit push (no remote either) while on a protected branch', () => {
    assert.equal(blocked('git checkout master && git push'), true);
  });

  await t.test('git push origin — implicit push while on a protected branch, via injected current-branch fallback', () => {
    assert.equal(blocked('git push origin', onMaster), true);
  });

  await t.test('an explicit different-branch push is not swept in just because HEAD is on a protected branch', () => {
    assert.equal(blocked('git push origin some-other-branch', onMaster), false);
  });

  await t.test('git checkout -B main (force-create/reset + switch) then an implicit push is blocked', () => {
    assert.equal(blocked('git checkout -B main && git push origin'), true);
  });

  await t.test('git switch -c main (create + switch) then an implicit push is blocked', () => {
    assert.equal(blocked('git switch -c main && git push origin'), true);
  });

  await t.test('git switch -C master (force-create + switch) then a local merge is blocked', () => {
    assert.equal(blocked('git switch -C master && git merge fix/some-branch'), true);
  });

  await t.test('git checkout -b (create, non-forcing) a non-protected branch is not flagged', () => {
    // Injected fallback keeps this deterministic — the checkout target
    // here is a non-protected branch, so effectiveBranch() falls through
    // to the (otherwise real) current-branch lookup, same as any other
    // implicit-push case with no protected checkout in the chain.
    assert.equal(blocked('git checkout -b fix/some-feature && git push origin', onFeatureBranch), false);
  });

  await t.test('git switch "main" (quoted) then an implicit push is still blocked', () => {
    assert.equal(blocked('git switch "main" && git push origin'), true);
  });

  await t.test('git checkout -B "master" (quoted, force-create) then a local merge is still blocked', () => {
    assert.equal(blocked('git checkout -B "master" && git merge fix/some-branch'), true);
  });

  await t.test('gh pr merge hidden inside a bash -c wrapper', () => {
    assert.equal(blocked('bash -c "gh pr merge 27"'), true);
  });

  await t.test('gh pr merge hidden inside a bash -lc wrapper (combined login+command flags)', () => {
    assert.equal(blocked('bash -lc "gh pr merge 27"'), true);
  });

  await t.test('a protected-branch push hidden inside an sh -c wrapper', () => {
    assert.equal(blocked('sh -c "git push feature:main"'), true);
  });

  await t.test('a wrapped command chained after an unrelated segment', () => {
    assert.equal(blocked('echo hi && bash -c "gh pr merge 27"'), true);
  });

  await t.test('a doubly-nested shell wrapper (bash -c wrapping an sh -c)', () => {
    assert.equal(blocked('bash -c "sh -c \\"gh pr merge 27\\""'), true);
  });

  await t.test('an implicit push hidden inside a wrapper, via a checkout inside the same wrapped string', () => {
    assert.equal(blocked('bash -c "git switch main && git push origin"'), true);
  });

  await t.test('a bash -c wrapper running a non-merge command is not flagged', () => {
    assert.equal(blocked('bash -c "gh pr view 27"'), false);
  });

  await t.test('a multi-line command with the merge on the second line', () => {
    assert.equal(blocked('echo hi\ngh pr merge 27'), true);
  });

  await t.test('a multi-line command with an implicit push reached via a checkout on an earlier line', () => {
    assert.equal(blocked('git switch main\ngit push origin'), true);
  });

  await t.test('a newline inside a quoted -m argument is still protected from splitting', () => {
    // Regression guard for the fix's own known interaction: newline
    // handling must only apply when quote === null, same as every other
    // separator character, or this would reopen the original
    // commit-message false-positive for any multi-line message.
    const cmd = 'git commit -m "line one\nline two: e.g. gh pr merge 27 is just an example"';
    assert.equal(blocked(cmd), false);
  });

  await t.test('a multi-line command where only the first line is a merge is not missed', () => {
    assert.equal(blocked('gh pr merge 27\necho done'), true);
  });

  await t.test('an env-prefixed command that is not a merge is not flagged', () => {
    assert.equal(blocked('GH_TOKEN=abc123 gh pr view 27'), false);
  });

  await t.test('a refspec pushing an unrelated branch to itself is not flagged', () => {
    assert.equal(blocked('git push origin feature:feature'), false);
  });

  await t.test('a commit message that merely discusses push/merge commands in prose is not flagged', () => {
    // Found in practice, not just in theory: this is (a close paraphrase
    // of) an actual commit message body that got mis-split on the "&&"
    // inside its own quoted -m argument, producing a fragment that
    // started with "git push origin" and also contained the bare word
    // "main" later in the same sentence — blocking a plain git commit.
    const cmd = 'git commit -m "Explain the fix\n\nWHY:\n- e.g. git switch main && git push origin — pushes the current branch, landing commits on main directly, went undetected"';
    assert.equal(blocked(cmd), false);
  });

  await t.test('a commit message with an escaped quote does not prematurely end the quoted region', () => {
    // Reproduces the review-reported case: an escaped `\"` inside a
    // double-quoted -m argument must not be treated as the real closing
    // quote, or the "&&"/"main" after it get re-exposed to splitting —
    // the exact bug the quote-tracking in segmentsOf() exists to prevent.
    const cmd = 'git commit -m "He said \\"hi\\" && then explained: e.g. git push origin main directly"';
    assert.equal(blocked(cmd), false);
  });

  await t.test('an unrelated command is not flagged', () => {
    assert.equal(blocked('git status'), false);
  });

  await t.test('npm test is not flagged', () => {
    assert.equal(blocked('npm test'), false);
  });
});
