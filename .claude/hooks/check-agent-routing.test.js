// check-agent-routing.test.js
// Lifecycle tests for check-agent-routing.js — run with
// `node --test *.test.js *.test.cjs lib/*.test.cjs` from the hooks directory.
//
// A UserPromptSubmit hook's stdout on exit 0 is what Claude Code adds to
// the conversation; stderr or a non-zero exit only reaches the terminal.

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

function runHook(prompt) {
  const r = spawnSync(process.execPath, [path.join(__dirname, 'check-agent-routing.js')], {
    input: JSON.stringify({ hook_event_name: 'UserPromptSubmit', prompt }),
    encoding: 'utf8',
    timeout: 30000,
  });
  return { status: r.status, stdout: r.stdout || '' };
}

test('hook lifecycle', async (t) => {
  await t.test('a matching prompt adds its reminder as context (stdout, exit 0)', () => {
    const r = runHook('Please implement the new checkout page');
    assert.equal(r.status, 0);
    assert.match(r.stdout, /IMPLEMENTATION WORK DETECTED/);
  });

  await t.test('an unmatched prompt adds nothing', () => {
    const r = runHook('hello');
    assert.equal(r.status, 0);
    assert.equal(r.stdout, '');
  });
});
