// check-git-push-audit.test.js
// Behavioral tests for the secret detection in check-git-push-audit.js —
// run with `node --test *.test.js *.test.cjs lib/*.test.cjs` from the hooks directory.
//
// The hook only runs its stdin-driven lifecycle when executed directly
// (`require.main === module`), so requiring it here is safe.

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const { findSecrets, secretFix } = require('./check-git-push-audit.js');

function namesIn(file, content) {
  return findSecrets([{ file, lineNum: 1, content }]).map((f) => f.name);
}

function names(content) {
  return namesIn('src/app.js', content);
}

test('findSecrets', async (t) => {
  await t.test('an 8-character generic credential is flagged', () => {
    assert.deepEqual(names("api_key = 'a1b2c3d4'"), ['hardcoded credential']); // nosecret
  });

  await t.test('a 16-character access token is flagged', () => {
    // Fixture split so external secret scanners don't flag the literal.
    assert.deepEqual(names('access' + 'Token: "Zx9Qw3Er' + '7Ty1Ui5O"'), ['hardcoded credential']); // nosecret
  });

  await t.test('a 7-character generic credential value is not flagged', () => {
    assert.deepEqual(names("api_key = 'a1b2c3d'"), []);
  });

  await t.test('a 4-character password is flagged', () => {
    // Fixture split so external secret scanners don't flag the literal.
    assert.deepEqual(names('pass' + "word: 'pa55'"), ['hardcoded password']); // nosecret
  });

  await t.test('a 3-character password is not flagged', () => {
    assert.deepEqual(names("password: 'abc'"), []);
  });

  await t.test('a trailing // nosecret marker suppresses a short fixture in a test file', () => {
    assert.deepEqual(namesIn('src/app.test.js', "apiKey: 'test-api-key' // nosecret"), []); // nosecret
  });

  await t.test('a trailing # nosecret marker suppresses a short fixture in a test file', () => {
    assert.deepEqual(namesIn('tests/test_app.py', "password = 'hunter22' # nosecret"), []); // nosecret
  });

  await t.test('a nosecret marker suppresses a docs example', () => {
    assert.deepEqual(namesIn('docs/setup.md', "apiKey: 'test-api-key' // nosecret"), []); // nosecret
    assert.deepEqual(namesIn('README.md', "apiKey: 'test-api-key' // nosecret"), []); // nosecret
  });

  await t.test('a nosecret marker is ignored in production source', () => {
    assert.deepEqual(names("apiKey: 'test-api-key' // nosecret"), ['hardcoded credential']); // nosecret
    assert.deepEqual(namesIn('config/settings.py', "password = 'hunter22' # nosecret"), ['hardcoded password']); // nosecret
  });

  await t.test('each finding reports its file and line', () => {
    const [finding] = findSecrets([{ file: 'cfg.js', lineNum: 7, content: "client_secret='s3cr3tvalue'" }]); // nosecret
    assert.equal(finding.file, 'cfg.js');
    assert.equal(finding.lineNum, 7);
  });
});

test('secretFix', async (t) => {
  await t.test('offers the nosecret marker only where it is honored', () => {
    assert.match(secretFix('src/app.test.js'), /nosecret/);
    assert.match(secretFix('docs/setup.md'), /nosecret/);
    assert.doesNotMatch(secretFix('src/app.js'), /nosecret/);
    assert.match(secretFix('src/app.js'), /ask the user/);
  });
});

// Runs the hook as Claude Code does, from a directory that is not the repo
// being pushed. The fake credential is assembled at runtime so this file
// itself never contains it.
test('hook lifecycle', async (t) => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'push-audit-repo-'));
  const elsewhere = fs.mkdtempSync(path.join(os.tmpdir(), 'push-audit-cwd-'));
  const remote = fs.mkdtempSync(path.join(os.tmpdir(), 'push-audit-remote-'));
  const git = (...args) => execFileSync('git', args, { cwd: repo, stdio: 'pipe' });
  try {
    execFileSync('git', ['init', '-q', '--bare'], { cwd: remote, stdio: 'pipe' });
    git('init', '-q', '-b', 'main');
    git('config', 'user.email', 'test@example.com');
    git('config', 'user.name', 'Test');
    fs.writeFileSync(path.join(repo, 'a.txt'), 'first\n');
    git('add', '.');
    git('commit', '-q', '-m', 'first');
    fs.writeFileSync(path.join(repo, 'app.js'), `const apiKey = '${'Zx9Qw3Er' + '7Ty1Ui5O'}';\n`);
    git('add', '.');
    git('commit', '-q', '-m', 'second');

    const run = (command) => spawnSync(process.execPath, [path.join(__dirname, 'check-git-push-audit.js')], {
      input: JSON.stringify({ tool_name: 'Bash', tool_input: { command } }),
      cwd: elsewhere,
      encoding: 'utf8',
      timeout: 30000,
    });

    await t.test('git -C <repo> push audits that repo, not the hook cwd', () => {
      const r = run(`git -C "${repo}" push origin main`);
      assert.equal(r.status, 2);
      assert.match(r.stderr, /hardcoded credential/);
      assert.ok(r.stderr.includes(`in ${repo}`), r.stderr);
    });

    await t.test('cd <repo> && git push audits that repo, not the hook cwd', () => {
      const r = run(`cd "${repo}" && git push origin main`);
      assert.equal(r.status, 2);
      assert.match(r.stderr, /hardcoded credential/);
    });

    await t.test('a push whose target repo cannot be determined is blocked, not audited against the hook cwd', () => {
      const r = run('cd "$REPO" && git push origin main');
      assert.equal(r.status, 2);
      assert.match(r.stderr, /Could not determine which repository/);
    });

    // Last: it adds an upstream and a staged file to the shared repo.
    await t.test('a staged file does not stop the outgoing commits from being audited', () => {
      git('remote', 'add', 'origin', remote);
      git('push', '-q', 'origin', 'HEAD~1:refs/heads/main');
      git('branch', '--set-upstream-to=origin/main');
      fs.writeFileSync(path.join(repo, 'notes.txt'), 'benign\n');
      git('add', 'notes.txt');
      const r = run(`git -C "${repo}" push`);
      assert.equal(r.status, 2);
      assert.match(r.stderr, /hardcoded credential/);
      assert.match(r.stderr, /staged \+ unpushed commits/);
    });
  } finally {
    fs.rmSync(remote, { recursive: true, force: true });
    fs.rmSync(repo, { recursive: true, force: true });
    fs.rmSync(elsewhere, { recursive: true, force: true });
  }
});

// Which commits get audited: every one the push sends, not just the last.
// Each test builds its own repo and bare remote.
test('outgoing commit range', async (t) => {
  const secret = `const apiKey = '${'Zx9Qw3Er' + '7Ty1Ui5O'}';\n`;
  const dirs = [];
  const tmp = (prefix) => {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
    dirs.push(d);
    return d;
  };
  function setup() {
    const repo = tmp('push-audit-range-');
    const remote = tmp('push-audit-range-remote-');
    const git = (...args) => execFileSync('git', args, { cwd: repo, stdio: 'pipe' });
    execFileSync('git', ['init', '-q', '--bare'], { cwd: remote, stdio: 'pipe' });
    git('init', '-q', '-b', 'main');
    git('config', 'user.email', 'test@example.com');
    git('config', 'user.name', 'Test');
    git('remote', 'add', 'origin', remote);
    const commit = (file, content, msg) => {
      fs.writeFileSync(path.join(repo, file), content);
      git('add', '.');
      git('commit', '-q', '-m', msg);
    };
    return { repo, remote, git, commit };
  }
  const run = (repo, command) => spawnSync(process.execPath, [path.join(__dirname, 'check-git-push-audit.js')], {
    input: JSON.stringify({ tool_name: 'Bash', tool_input: { command } }),
    cwd: repo,
    encoding: 'utf8',
    timeout: 30000,
  });

  try {
    await t.test('a new branch with no upstream has all its commits audited, not just the last', () => {
      const { repo, git, commit } = setup();
      commit('a.txt', 'base\n', 'base');
      git('push', '-q', 'origin', 'main');
      git('checkout', '-q', '-b', 'feature');
      commit('app.js', secret, 'add key');
      commit('b.txt', 'benign\n', 'benign');
      const r = run(repo, 'git push -u origin feature');
      assert.equal(r.status, 2, r.stderr);
      assert.match(r.stderr, /hardcoded credential/);
      assert.match(r.stderr, /unpushed commits/);
    });

    await t.test('a secret added and then deleted in a later outgoing commit is still caught', () => {
      const { repo, git, commit } = setup();
      commit('a.txt', 'base\n', 'base');
      git('push', '-q', '-u', 'origin', 'main');
      commit('app.js', secret, 'add key');
      commit('app.js', 'const apiKey = process.env.API_KEY;\n', 'remove key');
      const r = run(repo, 'git push');
      assert.equal(r.status, 2, r.stderr);
      assert.match(r.stderr, /hardcoded credential/);
    });

    await t.test('a root commit is audited', () => {
      const { repo, commit } = setup();
      commit('app.js', secret, 'root');
      const r = run(repo, 'git push -u origin main');
      assert.equal(r.status, 2, r.stderr);
      assert.match(r.stderr, /hardcoded credential/);
    });

    await t.test('pushing an already-pushed commit to a new branch is not blocked as empty', () => {
      const { repo, git, commit } = setup();
      commit('a.txt', 'base\n', 'base');
      git('push', '-q', 'origin', 'main');
      git('checkout', '-q', '-b', 'feature');
      const r = run(repo, 'git push -u origin feature');
      assert.equal(r.status, 0, r.stderr);
      assert.match(r.stderr, /HEAD~1\.\.HEAD|root commit/);
    });

    // A benign current branch, and a `release` branch whose commit adds a
    // credential.
    function withRelease() {
      const s = setup();
      s.commit('a.txt', 'base\n', 'base');
      s.git('push', '-q', '-u', 'origin', 'main');
      s.git('checkout', '-q', '-b', 'release');
      s.commit('app.js', secret, 'add key');
      s.git('checkout', '-q', 'main');
      s.git('checkout', '-q', '-b', 'feature');
      s.commit('b.txt', 'benign\n', 'benign');
      return s;
    }

    await t.test('the pushed source ref is audited, not HEAD', () => {
      for (const command of ['git push origin release', 'git push origin release:main', 'git push origin +refs/heads/release:refs/heads/main']) {
        const { repo } = withRelease();
        const r = run(repo, command);
        assert.equal(r.status, 2, `${command}\n${r.stderr}`);
        assert.match(r.stderr, /hardcoded credential/, command);
      }
    });

    await t.test('--all and --mirror audit every branch, not just the current one', () => {
      for (const command of ['git push --all origin', 'git push origin --mirror', 'git push --branches origin']) {
        const { repo } = withRelease();
        const r = run(repo, command);
        assert.equal(r.status, 2, `${command}\n${r.stderr}`);
        assert.match(r.stderr, /hardcoded credential/, command);
      }
    });

    await t.test('a pushed ref that does not resolve blocks instead of auditing something else', () => {
      const { repo } = withRelease();
      const r = run(repo, 'git push origin "$BRANCH"');
      assert.equal(r.status, 2, r.stderr);
      assert.match(r.stderr, /Could not resolve `\$BRANCH`/);
    });

    await t.test('commits already on one remote are still audited when pushed to another', () => {
      const { repo, git, commit } = setup();
      commit('app.js', secret, 'add key');
      git('push', '-q', '-u', 'origin', 'main');
      const backup = tmp('push-audit-range-backup-');
      execFileSync('git', ['init', '-q', '--bare'], { cwd: backup, stdio: 'pipe' });
      git('remote', 'add', 'backup', backup);
      const r = run(repo, 'git push backup main');
      assert.equal(r.status, 2, r.stderr);
      assert.match(r.stderr, /hardcoded credential/);
      assert.match(r.stderr, /--remotes=backup/);
    });

    await t.test('a push to a URL or path audits the pushed ref in full, since it has no tracking refs', () => {
      const { repo, remote, git, commit } = setup();
      commit('app.js', secret, 'add key');
      commit('b.txt', 'benign\n', 'benign');
      git('push', '-q', '-u', 'origin', 'main');
      const r = run(repo, `git push "${remote}" main`);
      assert.equal(r.status, 2, r.stderr);
      assert.match(r.stderr, /hardcoded credential/);
    });

    await t.test('a quoted remote path containing a space is one argument, not a ref to resolve', () => {
      const { repo, git, commit } = setup();
      commit('a.txt', 'base\n', 'base');
      const spaced = path.join(tmp('push-audit-range-'), 'remote repo');
      fs.mkdirSync(spaced);
      execFileSync('git', ['init', '-q', '--bare'], { cwd: spaced, stdio: 'pipe' });
      git('push', '-q', '-u', 'origin', 'main');
      const r = run(repo, `git push "${spaced}" main`);
      assert.equal(r.status, 0, r.stderr);
      assert.doesNotMatch(r.stderr, /Could not resolve/);
    });

    await t.test('a git log that fails partway blocks instead of auditing partial output', () => {
      const { repo, git, commit } = setup();
      commit('a.txt', 'base\n', 'base');
      git('push', '-q', '-u', 'origin', 'main');
      commit('app.js', 'const x = 1;\n', 'add file');
      // Drop the new blob: the commit and tree still resolve, but `git log -p` can't read it.
      const blob = execFileSync('git', ['rev-parse', 'HEAD:app.js'], { cwd: repo, encoding: 'utf8' }).trim();
      fs.rmSync(path.join(repo, '.git', 'objects', blob.slice(0, 2), blob.slice(2)), { force: true });
      const r = run(repo, 'git push');
      assert.equal(r.status, 2, r.stderr);
      assert.match(r.stderr, /Could not read the commits this push sends/);
    });

    await t.test('a staged diff that cannot be read blocks instead of auditing partial output', () => {
      const { repo, git, commit } = setup();
      commit('a.txt', 'base\n', 'base');
      git('push', '-q', '-u', 'origin', 'main');
      fs.writeFileSync(path.join(repo, 'app.js'), 'const x = 1;\n');
      git('add', 'app.js');
      const blob = execFileSync('git', ['rev-parse', ':app.js'], { cwd: repo, encoding: 'utf8' }).trim();
      fs.rmSync(path.join(repo, '.git', 'objects', blob.slice(0, 2), blob.slice(2)), { force: true });
      const r = run(repo, 'git push');
      assert.equal(r.status, 2, r.stderr);
      assert.match(r.stderr, /Could not read the staged changes/);
    });

    await t.test('--mirror audits a commit reachable only from a tag', () => {
      const { repo, git, commit } = setup();
      commit('a.txt', 'base\n', 'base');
      git('push', '-q', '-u', 'origin', 'main');
      git('checkout', '-q', '-b', 'temp');
      commit('app.js', secret, 'add key');
      git('tag', 'v1');
      git('checkout', '-q', 'main');
      git('branch', '-q', '-D', 'temp');
      const r = run(repo, 'git push origin --mirror');
      assert.equal(r.status, 2, r.stderr);
      assert.match(r.stderr, /hardcoded credential/);
    });

    await t.test('with no refspec, push.default=matching audits every branch, not just HEAD', () => {
      const { repo, git } = withRelease();
      git('push', '-q', 'origin', 'release~1:refs/heads/release');
      git('config', 'push.default', 'matching');
      const r = run(repo, 'git push origin');
      assert.equal(r.status, 2, r.stderr);
      assert.match(r.stderr, /hardcoded credential/);
    });

    await t.test("with no refspec, the remote's configured push refspecs are audited", () => {
      const { repo, git } = withRelease();
      git('config', 'remote.origin.push', 'refs/heads/release:refs/heads/release');
      const r = run(repo, 'git push');
      assert.equal(r.status, 2, r.stderr);
      assert.match(r.stderr, /hardcoded credential/);
    });

    await t.test('an implicit push excludes only what its own remote already has', () => {
      const { repo, git, commit } = setup();
      commit('a.txt', 'base\n', 'base');
      git('push', '-q', '-u', 'origin', 'main');
      commit('app.js', secret, 'add key');
      const r = run(repo, 'git push');
      assert.equal(r.status, 2, r.stderr);
      assert.match(r.stderr, /HEAD --not --remotes=origin/);
    });
  } finally {
    for (const d of dirs) fs.rmSync(d, { recursive: true, force: true });
  }
});
