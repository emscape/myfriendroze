// check-ci-status-after-push.test.js
// Behavioral tests for the push detection in check-ci-status-after-push.js
// — run with `node --test *.test.js *.test.cjs lib/*.test.cjs` from the hooks directory.
//
// The hook only runs its stdin-driven lifecycle when executed directly
// (`require.main === module`), so requiring it here is safe.

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { shouldVerify, pushedRef } = require('./check-ci-status-after-push.js');

test('shouldVerify', async (t) => {
  await t.test('plain git push', () => {
    assert.equal(shouldVerify('git push -u origin feature'), true);
  });

  await t.test('path-qualified git binary', () => {
    assert.equal(shouldVerify('/usr/bin/git push origin feature'), true);
  });

  await t.test('git -C with a quoted path containing spaces', () => {
    assert.equal(shouldVerify('git -C "/path with spaces" push'), true);
  });

  await t.test('push inside an env-prefixed shell wrapper', () => {
    assert.equal(shouldVerify('env bash -c "git push"'), true);
  });

  await t.test('push only mentioned in a quoted argument', () => {
    assert.equal(shouldVerify('git commit -m "remember to git push"'), false);
  });

  await t.test('a command whose text merely contains "push"', () => {
    assert.equal(shouldVerify('cat check-git-push-audit.js'), false);
  });
});

test('pushedRef', async (t) => {
  await t.test('no refspec means the current branch and HEAD', () => {
    assert.equal(pushedRef('git push'), null);
    assert.equal(pushedRef('git push -u origin'), null);
  });

  await t.test('a bare branch pushes that local branch to the same name', () => {
    assert.deepEqual(pushedRef('git push origin feature'), { src: 'feature', dest: 'feature' });
    assert.deepEqual(pushedRef('git push -u origin "feature"'), { src: 'feature', dest: 'feature' });
  });

  await t.test('a src:dest refspec waits for runs on the destination branch', () => {
    assert.deepEqual(pushedRef('git push origin feature:release'), { src: 'feature', dest: 'release' });
    assert.deepEqual(pushedRef('git push origin +HEAD:refs/heads/release'), { src: 'HEAD', dest: 'release' });
    assert.deepEqual(pushedRef('git push origin feature:'), { src: 'feature', dest: 'feature' });
  });

  await t.test('HEAD as the refspec keeps the current branch as the destination', () => {
    assert.deepEqual(pushedRef('git push origin HEAD'), { src: 'HEAD', dest: 'HEAD' });
  });

  await t.test('option values are not taken as the remote or refspec', () => {
    assert.deepEqual(pushedRef('git push -o ci.skip origin feature'), { src: 'feature', dest: 'feature' });
  });

  await t.test('deletes and non-branch destinations are skipped', () => {
    assert.ok(pushedRef('git push origin --delete feature').skip);
    assert.ok(pushedRef('git push origin :feature').skip);
    assert.ok(pushedRef('git push origin v1.0:refs/tags/v1.0').skip);
  });

  await t.test('multi-ref and tag-only pushes are skipped, not checked as the current branch', () => {
    assert.match(pushedRef('git push --all').skip, /--all/);
    assert.match(pushedRef('git push origin --mirror').skip, /--mirror/);
    assert.match(pushedRef('git push origin --tags').skip, /--tags/);
    assert.match(pushedRef('git push --branches origin').skip, /--branches/);
    assert.match(pushedRef('git push origin feature-a feature-b').skip, /2 refspecs/);
  });

  await t.test('a no-refspec push that git would expand to several branches is skipped', () => {
    const config = (values) => (key) => values[key] || '';
    assert.match(pushedRef('git push', config({ 'push.default': 'matching' })).skip, /matching/);
    assert.match(pushedRef('git push backup', config({ 'remote.backup.push': 'refs/heads/*' })).skip, /configured push refspecs/);
    assert.match(pushedRef('git push', config({ 'remote.origin.push': 'refs/heads/a' })).skip, /configured push refspecs/);
    assert.equal(pushedRef('git push', config({ 'push.default': 'simple' })), null);
    assert.deepEqual(pushedRef('git push origin feature', config({ 'push.default': 'matching' })), { src: 'feature', dest: 'feature' });
  });

  await t.test('a quoted remote containing a space is one argument', () => {
    assert.deepEqual(pushedRef('git push "/tmp/remote repo" feature'), { src: 'feature', dest: 'feature' });
  });
});

// Runs the hook as Claude Code does (stdin JSON), with a project override
// that enables the check — a project that disables ci_status_check in its
// own .claude/hooks.config.json would otherwise exit before the code under
// test.
function runHook(command) {
  const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ci-status-proj-'));
  try {
    fs.mkdirSync(path.join(projectDir, '.claude'));
    fs.writeFileSync(
      path.join(projectDir, '.claude', 'hooks.config.json'),
      JSON.stringify({ ci_status_check: { enabled: true } })
    );
    const r = spawnSync(process.execPath, [path.join(__dirname, 'check-ci-status-after-push.js')], {
      input: JSON.stringify({ tool_name: 'Bash', tool_input: { command } }),
      env: { ...process.env, CLAUDE_PROJECT_DIR: projectDir },
      encoding: 'utf8',
      timeout: 30000,
    });
    return { status: r.status, stderr: r.stderr || '' };
  } finally {
    fs.rmSync(projectDir, { recursive: true, force: true });
  }
}

test('hook lifecycle', async (t) => {
  await t.test('a push whose target repo cannot be determined is skipped, not checked against the hook cwd', () => {
    const r = runHook('cd "$REPO" && git push');
    assert.equal(r.status, 0);
    assert.match(r.stderr, /Could not determine which repository/);
  });

  await t.test('a delete push is skipped before any CI lookup', () => {
    const r = runHook(`git -C "${__dirname}" push origin --delete some-branch`);
    assert.equal(r.status, 0);
    assert.match(r.stderr, /Skipping CI verification: the push deletes a remote branch/);
  });
});
