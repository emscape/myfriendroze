// check-script-exists.test.js
// Lifecycle tests for check-script-exists.js — run with
// `node --test *.test.js *.test.cjs lib/*.test.cjs` from the hooks directory.
//
// The hook runs on stdin JSON as Claude Code invokes it, from a working
// directory outside the project, with CLAUDE_PROJECT_DIR naming the project.

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

test('hook lifecycle', async (t) => {
  const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'script-guard-proj-'));
  const elsewhere = fs.mkdtempSync(path.join(os.tmpdir(), 'script-guard-cwd-'));
  fs.mkdirSync(path.join(projectDir, '.claude'));
  fs.writeFileSync(path.join(projectDir, 'package.json'), JSON.stringify({ scripts: { build: 'echo build' } }));

  const run = (command, scriptGuard = {}) => {
    fs.writeFileSync(
      path.join(projectDir, '.claude', 'hooks.config.json'),
      JSON.stringify({ script_guard: { enabled: true, ...scriptGuard } })
    );
    const r = spawnSync(process.execPath, [path.join(__dirname, 'check-script-exists.js')], {
      input: JSON.stringify({ tool_name: 'Bash', tool_input: { command } }),
      cwd: elsewhere,
      env: { ...process.env, CLAUDE_PROJECT_DIR: projectDir },
      encoding: 'utf8',
      timeout: 30000,
    });
    return { status: r.status, stderr: r.stderr || '' };
  };

  try {
    await t.test('package_json_paths resolve against the project dir, not the working directory', () => {
      const r = run('npm run nope');
      assert.equal(r.status, 0);
      assert.match(r.stderr, /Script "nope" not found/);
      assert.match(r.stderr, /Available: build/);
    });

    await t.test('a script that exists in the project passes silently', () => {
      const r = run('npm run build');
      assert.equal(r.status, 0);
      assert.doesNotMatch(r.stderr, /not found/);
    });

    await t.test('on_missing "block" blocks the command (exit 2)', () => {
      const r = run('npm run nope', { on_missing: 'block' });
      assert.equal(r.status, 2);
      assert.match(r.stderr, /Script "nope" not found/);
    });
  } finally {
    fs.rmSync(projectDir, { recursive: true, force: true });
    fs.rmSync(elsewhere, { recursive: true, force: true });
  }
});
