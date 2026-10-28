// check-branch-delete-guard.test.js
// Behavioral tests for the pure extraction logic in
// check-branch-delete-guard.js — run with `node --test *.test.js *.test.cjs lib/*.test.cjs` from the hooks directory.
//
// check-branch-delete-guard.js only runs its stdin-driven hook lifecycle
// when executed directly (`require.main === module`), so it's safe to
// require() here for its exported pure functions without triggering that
// lifecycle or hanging the test process waiting on stdin.

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { extractDeletedBranches, tryRun, findDependents } = require('./check-branch-delete-guard.js');

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

  await t.test('a sudo-wrapped delete is detected', () => {
    assert.deepEqual(branches('sudo git push origin --delete branch22'), ['branch22']);
  });

  await t.test('a path-qualified git binary is detected', () => {
    assert.deepEqual(branches('/usr/bin/git push origin --delete branch23'), ['branch23']);
    assert.deepEqual(branches('"C:\\Program Files\\Git\\bin\\git.exe" push origin :branch24'), ['branch24']);
  });

  await t.test('git global options before push are skipped, including a quoted -C path with spaces', () => {
    assert.deepEqual(branches('git -C repo push origin --delete branch25'), ['branch25']);
    assert.deepEqual(branches('git -C "C:\\Work Tree" push origin --delete branch26'), ['branch26']);
  });

  await t.test('a delete inside a bash -c wrapper, behind env, is detected', () => {
    assert.deepEqual(branches("env bash -c 'git push origin --delete branch27'"), ['branch27']);
  });

  await t.test('a chain operator inside a quoted commit message does not create a fake delete', () => {
    assert.deepEqual(branches('git commit -m "x && git push origin --delete branch28"'), []);
  });

  await t.test('a delete inside a command substitution is detected', () => {
    assert.deepEqual(branches('echo $(git push origin --delete branch29)'), ['branch29']);
    assert.deepEqual(branches('echo `git push origin :branch30`'), ['branch30']);
  });

  await t.test('a quoted --delete / -d flag is still a delete', () => {
    assert.deepEqual(branches('git push origin "--delete" topic'), ['topic']);
    assert.deepEqual(branches("git push origin '-d' topic"), ['topic']);
  });

  await t.test('a delete inside a subshell is detected without the closing paren', () => {
    assert.deepEqual(branches('(cd repo && git push origin --delete branch31)'), ['branch31']);
  });
});

// Runs the hook as Claude Code does (stdin JSON) with gh off PATH. A delete
// that reaches the PR check warns that gh is unavailable; one dropped
// earlier exits silently. Catches a raw-text prefilter in the lifecycle
// that the extractor-only tests above can't see.
function runHookWithoutGh(command) {
  const r = spawnSync(process.execPath, [path.join(__dirname, 'check-branch-delete-guard.js')], {
    input: JSON.stringify({ tool_name: 'Bash', tool_input: { command } }),
    env: { ...process.env, PATH: path.dirname(process.execPath) },
    encoding: 'utf8',
    timeout: 30000,
  });
  return { status: r.status, stderr: r.stderr || '' };
}

test('hook lifecycle', async (t) => {
  await t.test('a delete behind git -C with a quoted path reaches the PR check', () => {
    const workTree = fs.mkdtempSync(path.join(os.tmpdir(), 'work tree-'));
    try {
      const r = runHookWithoutGh(`git -C "${workTree}" push origin --delete topic`);
      assert.equal(r.status, 0);
      assert.match(r.stderr, /gh CLI not available/);
    } finally {
      fs.rmSync(workTree, { recursive: true, force: true });
    }
  });

  await t.test('a delete whose target repo cannot be determined warns instead of checking the hook cwd', () => {
    const r = runHookWithoutGh('cd "$REPO" && git push origin --delete topic');
    assert.equal(r.status, 0);
    assert.match(r.stderr, /Could not determine which repository/);
  });

  await t.test('a delete through a quoted Windows git.exe path reaches the PR check', () => {
    const r = runHookWithoutGh('"C:\\Program Files\\Git\\bin\\git.exe" push origin --delete topic');
    assert.equal(r.status, 0);
    assert.match(r.stderr, /gh CLI not available/);
  });

  await t.test('a non-delete push exits without reaching the PR check', () => {
    const r = runHookWithoutGh('git push origin topic');
    assert.equal(r.status, 0);
    assert.equal(r.stderr, '');
  });
});

// The PR lookup passes the branch name as an argument array: git allows
// `$`, `;` and `&` in branch names, and a shell would act on them.
test('tryRun', async (t) => {
  await t.test('an argument array runs without a shell, so metacharacters stay literal', () => {
    const r = tryRun([process.execPath, '-e', 'process.stdout.write(process.argv[1])', 'feat$x;echo&hi']);
    assert.equal(r.ok, true, r.err);
    assert.equal(r.out, 'feat$x;echo&hi');
  });
});

// A fake `gh pr list` runner: `results` maps a --base branch to what the
// call returns. Records every argument array it's given.
function fakeRun(results) {
  const calls = [];
  const run = (args, cwd) => {
    calls.push({ args, cwd });
    const base = args[args.indexOf('--base') + 1];
    return results[base] ?? { ok: true, out: '[]' };
  };
  return { run, calls };
}

test('findDependents', async (t) => {
  const pr = (number, headRefName) => ({ number, headRefName, title: `PR ${number}` });

  await t.test('queries each deleted branch separately, by base, in the target repo', () => {
    const { run, calls } = fakeRun({});
    const r = findDependents(['feature-a', 'feature-b'], '/repo', run);
    assert.deepEqual(r, { affected: [], warnings: [] });
    assert.deepEqual(calls.map((c) => c.args[c.args.indexOf('--base') + 1]), ['feature-a', 'feature-b']);
    assert.ok(calls.every((c) => c.cwd === '/repo' && c.args[0] === 'gh' && c.args.includes('open')));
  });

  await t.test('a dependent PR on any one of several branches is reported for that branch only', () => {
    const { run } = fakeRun({ 'feature-b': { ok: true, out: JSON.stringify([pr(12, 'stacked')]) } });
    const r = findDependents(['feature-a', 'feature-b'], '/repo', run);
    assert.deepEqual(r, { affected: [{ branch: 'feature-b', dependents: [pr(12, 'stacked')] }], warnings: [] });
  });

  await t.test('a branch name with shell metacharacters is passed through as one literal argument', () => {
    const name = 'feat$x;echo&hi';
    const { run, calls } = fakeRun({ [name]: { ok: true, out: JSON.stringify([pr(3, 'child')]) } });
    const r = findDependents([name], '/repo', run);
    assert.equal(calls[0].args[calls[0].args.indexOf('--base') + 1], name);
    assert.equal(r.affected[0].branch, name);
  });

  const badResults = [
    { ok: false, out: '', err: 'HTTP 502' },
    { ok: true, out: '' },
    { ok: true, out: 'not json' },
    { ok: true, out: '{"message":"error"}' },
  ];

  await t.test('a failed, empty or unparsable lookup warns for that branch instead of reporting no dependents', () => {
    for (const result of badResults) {
      const { run } = fakeRun({ 'feature-b': result });
      const r = findDependents(['feature-a', 'feature-b'], '/repo', run);
      assert.deepEqual(r.affected, [], JSON.stringify(result));
      assert.equal(r.warnings.length, 1, JSON.stringify(result));
      assert.match(r.warnings[0], /"feature-b"/);
    }
  });

  await t.test('a failed lookup for one branch keeps the dependents found for another, before or after it', () => {
    const blocked = { ok: true, out: JSON.stringify([pr(7, 'child')]) };
    for (const result of badResults) {
      for (const order of [['has-pr', 'fails'], ['fails', 'has-pr']]) {
        const { run, calls } = fakeRun({ 'has-pr': blocked, fails: result });
        const r = findDependents(order, '/repo', run);
        assert.equal(calls.length, 2, 'every branch is looked up');
        assert.deepEqual(r.affected, [{ branch: 'has-pr', dependents: [pr(7, 'child')] }], JSON.stringify({ result, order }));
        assert.equal(r.warnings.length, 1);
      }
    }
  });
});
