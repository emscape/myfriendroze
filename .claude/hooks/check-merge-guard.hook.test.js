// check-merge-guard.hook.test.js
// Runtime tests: run check-merge-guard.js as Claude Code does (JSON on stdin)
// and assert on the exit code, so a wrapper form the parser fails to see
// through shows up as a hook that lets the command run. Exit 2 blocks.
//
// Run with `node --test *.test.js *.test.cjs lib/*.test.cjs` from the hooks directory.

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const HOOK = path.join(__dirname, 'check-merge-guard.js');

function runHook(command) {
  const cwd = os.tmpdir();
  const result = spawnSync(process.execPath, [HOOK], {
    input: JSON.stringify({ tool_name: 'Bash', tool_input: { command }, cwd }),
    cwd,
    encoding: 'utf8',
    timeout: 15000,
  });
  return result.status;
}

function assertBlocked(command, why) {
  assert.equal(
    runHook(command),
    2,
    `the hook should exit 2 (block) for ${JSON.stringify(command)}. ${why} ` +
      'Any other exit code lets the command run unguarded.'
  );
}

function assertAllowed(command, why) {
  assert.equal(
    runHook(command),
    0,
    `the hook should exit 0 (allow) for ${JSON.stringify(command)}. ${why}`
  );
}

test('check-merge-guard hook, eval and xargs wrappers', async (t) => {
  await t.test('xargs -- (end of options) before a guarded command', () => {
    assertBlocked('xargs -- gh pr merge 27', 'after -- the next word is the command.');
    assertBlocked('xargs -r -- gh pr merge 27', 'options before -- must not hide the command.');
    assertBlocked('xargs -- git push origin main', 'a push to main must be blocked through xargs --.');
    assertBlocked('echo 27 | xargs -- gh pr merge', 'the piped form must be blocked too.');
  });

  await t.test('xargs with option clusters and placeholders', () => {
    assertBlocked('echo 27 | xargs -rt gh pr merge', 'a clustered -rt must not hide the command.');
    assertBlocked('echo 27 | xargs -I{} gh pr merge {}', 'an attached -I{} must not hide the command.');
    assertBlocked('echo 27 | xargs -rn1 gh pr merge', 'a -rn1 cluster must not hide the command.');
    assertBlocked('xargs -rt git push origin main', 'a clustered -rt must not hide a push to main.');
  });

  await t.test('eval around a guarded command', () => {
    assertBlocked('eval "gh pr merge 27"', 'eval runs its argument as a command line.');
    assertBlocked('eval -- "gh pr merge 27"', 'eval accepts -- before its argument.');
    assertBlocked('eval gh pr merge 27', 'unquoted eval arguments are joined and run.');
    assertBlocked('eval "git push origin main"', 'a push to main must be blocked through eval.');
  });

  await t.test('wrappers nested in other wrappers', () => {
    assertBlocked('bash -c "echo 27 | xargs -- gh pr merge"', 'bash -c around xargs.');
    assertBlocked('eval "echo 27 | xargs -rt gh pr merge"', 'eval around xargs.');
  });

  await t.test('a very long eval chain still blocks instead of crashing', () => {
    assertBlocked(`${'eval '.repeat(20000)}gh pr merge 27`,
      'a stack overflow in the parser would exit 1 and fail open.');
  });

  await t.test('wrappers around harmless commands are allowed', () => {
    assertAllowed('xargs -- echo gh pr merge 27', 'the inner command is echo.');
    assertAllowed('eval "echo gh pr merge 27"', 'the inner command is echo.');
    assertAllowed('echo 27 | xargs -rt echo done', 'nothing guarded runs.');
  });
});
