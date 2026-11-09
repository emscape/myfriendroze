// hook-config.test.cjs
// RED-phase behavioural tests for lib/hook-config.cjs (REQ-1..REQ-7).
// Written blind to the implementation: only the public contract is exercised.
// Run with: node --test claude/hooks/lib/hook-config.test.cjs

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const MODULE_PATH = path.join(__dirname, 'hook-config.cjs');

function load() {
  // Required lazily so a missing module fails each test with a clear 5-point
  // message instead of crashing the whole file at import time.
  try {
    return require(MODULE_PATH);
  } catch (err) {
    assert.fail(
      `WHAT: module load FAILED\n` +
        `WHY: REQ-1 violation - lib/hook-config.cjs must exist and be requirable\n` +
        `EXPECTED: require('${MODULE_PATH}') returns { loadHookConfig, resolveProjectDir }\n` +
        `ACTUAL: ${err && err.message}\n` +
        `GUIDANCE: Provide a CommonJS module at that path exporting both functions by name.`
    );
  }
}

function msg(what, why, expected, actual, guidance) {
  return (
    `WHAT: ${what} FAILED\n` +
    `WHY: ${why}\n` +
    `EXPECTED: ${expected}\n` +
    `ACTUAL: ${typeof actual === 'string' ? actual : JSON.stringify(actual)}\n` +
    `GUIDANCE: ${guidance}`
  );
}

// Run fn while capturing everything written to process.stderr.
function captureStderr(fn) {
  const original = process.stderr.write;
  let captured = '';
  process.stderr.write = (chunk, ...rest) => {
    captured += typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8');
    const cb = rest.find((r) => typeof r === 'function');
    if (cb) cb();
    return true;
  };
  let result;
  let error;
  try {
    result = fn();
  } catch (e) {
    error = e;
  } finally {
    process.stderr.write = original;
  }
  return { result, error, stderr: captured };
}

// Fixture: a hooks dir (with shared config) and a project dir (optional override).
function makeFixture(shared, override) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hookcfg-unit-'));
  const hooksDir = path.join(root, 'hooks');
  const projectDir = path.join(root, 'project');
  fs.mkdirSync(hooksDir, { recursive: true });
  fs.mkdirSync(path.join(projectDir, '.claude'), { recursive: true });
  if (shared !== undefined) {
    fs.writeFileSync(
      path.join(hooksDir, 'config.json'),
      typeof shared === 'string' ? shared : JSON.stringify(shared)
    );
  }
  if (override !== undefined) {
    fs.writeFileSync(
      path.join(projectDir, '.claude', 'hooks.config.json'),
      typeof override === 'string' ? override : JSON.stringify(override)
    );
  }
  return {
    root,
    hooksDir,
    projectDir,
    cleanup: () => fs.rmSync(root, { recursive: true, force: true }),
  };
}

function withFixture(shared, override, fn) {
  const fx = makeFixture(shared, override);
  try {
    return fn(fx);
  } finally {
    fx.cleanup();
  }
}

const EMPTY_ENV = {};

function loadWith(fx, extra = {}) {
  const { loadHookConfig } = load();
  return loadHookConfig({
    hooksDir: fx.hooksDir,
    projectDir: fx.projectDir,
    env: EMPTY_ENV,
    cwd: fx.root,
    ...extra,
  });
}

test('exports (REQ-1)', () => {
  const mod = load();
  assert.equal(
    typeof mod.loadHookConfig,
    'function',
    msg('exports loadHookConfig', 'REQ-1', 'loadHookConfig is a function', typeof mod.loadHookConfig, 'Export loadHookConfig by name.')
  );
  assert.equal(
    typeof mod.resolveProjectDir,
    'function',
    msg('exports resolveProjectDir', 'REQ-1', 'resolveProjectDir is a function', typeof mod.resolveProjectDir, 'Export resolveProjectDir by name.')
  );
});

test('resolveProjectDir (REQ-2)', async (t) => {
  await t.test('explicit projectDir beats env and cwd', () => {
    const { resolveProjectDir } = load();
    const actual = resolveProjectDir({ projectDir: 'P', env: { CLAUDE_PROJECT_DIR: 'E' }, cwd: 'C' });
    assert.equal(actual, 'P', msg('explicit projectDir precedence', 'REQ-2 precedence', "'P'", actual, 'An explicit argument must win over every other source.'));
  });

  await t.test('env.CLAUDE_PROJECT_DIR beats cwd when no projectDir', () => {
    const { resolveProjectDir } = load();
    const actual = resolveProjectDir({ env: { CLAUDE_PROJECT_DIR: 'E' }, cwd: 'C' });
    assert.equal(actual, 'E', msg('env precedence', 'REQ-2 precedence', "'E'", actual, 'With no explicit dir, the environment variable decides.'));
  });

  await t.test('falls back to cwd when neither is given', () => {
    const { resolveProjectDir } = load();
    const actual = resolveProjectDir({ env: {}, cwd: 'C' });
    assert.equal(actual, 'C', msg('cwd fallback', 'REQ-2 precedence', "'C'", actual, 'cwd is the last resort.'));
  });

  await t.test('empty-string CLAUDE_PROJECT_DIR counts as unset', () => {
    const { resolveProjectDir } = load();
    const actual = resolveProjectDir({ env: { CLAUDE_PROJECT_DIR: '' }, cwd: 'C' });
    assert.equal(actual, 'C', msg('empty env value', 'REQ-2 empty string is unset', "'C'", actual, 'An empty variable must not be returned as the project dir.'));
  });

  await t.test('defaults: env=process.env, cwd=process.cwd()', () => {
    const { resolveProjectDir } = load();
    const saved = process.env.CLAUDE_PROJECT_DIR;
    try {
      process.env.CLAUDE_PROJECT_DIR = 'FROM_PROCESS_ENV';
      const viaEnv = resolveProjectDir({});
      assert.equal(viaEnv, 'FROM_PROCESS_ENV', msg('default env', 'REQ-2 defaults', "'FROM_PROCESS_ENV'", viaEnv, 'When env is omitted the real process environment is consulted.'));
      delete process.env.CLAUDE_PROJECT_DIR;
      const viaCwd = resolveProjectDir({});
      assert.equal(viaCwd, process.cwd(), msg('default cwd', 'REQ-2 defaults', process.cwd(), viaCwd, 'When cwd is omitted the real process.cwd() is used.'));
    } finally {
      if (saved === undefined) delete process.env.CLAUDE_PROJECT_DIR;
      else process.env.CLAUDE_PROJECT_DIR = saved;
    }
  });
});

test('loadHookConfig: shared config (REQ-3)', async (t) => {
  await t.test('missing shared config throws', () => {
    const fx = makeFixture(undefined, undefined);
    try {
      const { loadHookConfig } = load();
      assert.throws(
        () => loadHookConfig({ hooksDir: fx.hooksDir, projectDir: fx.projectDir, env: EMPTY_ENV, cwd: fx.root }),
        undefined,
        msg('missing shared config', 'REQ-3 must throw', 'throws when <hooksDir>/config.json is absent', 'did not throw', 'Propagate the read failure so callers can apply their own fail-open/closed policy.')
      );
    } finally {
      fx.cleanup();
    }
  });

  await t.test('invalid JSON shared config throws', () => {
    withFixture('{ not json', undefined, (fx) => {
      const { loadHookConfig } = load();
      assert.throws(
        () => loadHookConfig({ hooksDir: fx.hooksDir, projectDir: fx.projectDir, env: EMPTY_ENV, cwd: fx.root }),
        undefined,
        msg('invalid shared JSON', 'REQ-3 must throw', 'throws on unparsable config.json', 'did not throw', 'Do not swallow parse errors of the shared config.')
      );
    });
  });

  await t.test('shared config is read from <hooksDir>/config.json', () => {
    withFixture({ project_name: 'Shared', n: 1 }, undefined, (fx) => {
      const actual = loadWith(fx);
      assert.deepStrictEqual(actual, { project_name: 'Shared', n: 1 }, msg('read shared', 'REQ-3/REQ-4 no override => shared', '{"project_name":"Shared","n":1}', actual, 'Return exactly the shared config when no override exists.'));
    });
  });
});

test('loadHookConfig: override presence (REQ-4)', async (t) => {
  await t.test('absent override deep-equals shared (nested content preserved)', () => {
    const shared = { a: { b: [1, 2, { c: null }] }, s: 'x' };
    withFixture(shared, undefined, (fx) => {
      const actual = loadWith(fx);
      assert.deepStrictEqual(actual, shared, msg('absent override', 'REQ-4', JSON.stringify(shared), actual, 'No override file means no change at all.'));
    });
  });

  await t.test('empty override object deep-equals shared', () => {
    const shared = { a: { b: 1 }, merge_guard: { enabled: true } };
    withFixture(shared, {}, (fx) => {
      const { result, stderr } = captureStderr(() => loadWith(fx));
      assert.deepStrictEqual(result, shared, msg('empty override', 'REQ-4/REQ-5', JSON.stringify(shared), result, 'An empty object overrides nothing.'));
      assert.equal(stderr, '', msg('empty override stderr', 'REQ-4 empty override is valid', 'no stderr output', stderr, 'A valid empty override must not warn.'));
    });
  });

  await t.test('override is read from <projectDir>/.claude/hooks.config.json, not cwd', () => {
    withFixture({ v: 'shared' }, { v: 'override' }, (fx) => {
      const other = fs.mkdtempSync(path.join(os.tmpdir(), 'hookcfg-other-'));
      try {
        const actual = loadWith(fx, { cwd: other });
        assert.deepStrictEqual(actual, { v: 'override' }, msg('override location', 'REQ-4', '{"v":"override"}', actual, 'Locate the override under the resolved project dir.'));
      } finally {
        fs.rmSync(other, { recursive: true, force: true });
      }
    });
  });

  await t.test('projectDir falls back to env.CLAUDE_PROJECT_DIR then cwd', () => {
    withFixture({ v: 'shared' }, { v: 'override' }, (fx) => {
      const { loadHookConfig } = load();
      const viaEnv = loadHookConfig({ hooksDir: fx.hooksDir, env: { CLAUDE_PROJECT_DIR: fx.projectDir }, cwd: os.tmpdir() });
      assert.deepStrictEqual(viaEnv, { v: 'override' }, msg('env-resolved project', 'REQ-2+REQ-4', '{"v":"override"}', viaEnv, 'loadHookConfig must resolve the project dir via the same precedence as resolveProjectDir.'));
      const viaCwd = loadHookConfig({ hooksDir: fx.hooksDir, env: {}, cwd: fx.projectDir });
      assert.deepStrictEqual(viaCwd, { v: 'override' }, msg('cwd-resolved project', 'REQ-2+REQ-4', '{"v":"override"}', viaCwd, 'cwd is used when no projectDir/env is given.'));
    });
  });

  await t.test('explicit projectDir beats env.CLAUDE_PROJECT_DIR', () => {
    withFixture({ v: 'shared' }, { v: 'override' }, (fx) => {
      const decoy = fs.mkdtempSync(path.join(os.tmpdir(), 'hookcfg-decoy-'));
      try {
        fs.mkdirSync(path.join(decoy, '.claude'));
        fs.writeFileSync(path.join(decoy, '.claude', 'hooks.config.json'), '{"v":"decoy"}');
        const { loadHookConfig } = load();
        const actual = loadHookConfig({ hooksDir: fx.hooksDir, projectDir: fx.projectDir, env: { CLAUDE_PROJECT_DIR: decoy }, cwd: decoy });
        assert.deepStrictEqual(actual, { v: 'override' }, msg('explicit beats env', 'REQ-2+REQ-4', '{"v":"override"}', actual, 'The explicit projectDir decides which override is read.'));
      } finally {
        fs.rmSync(decoy, { recursive: true, force: true });
      }
    });
  });
});

test('loadHookConfig: merge semantics (REQ-5)', async (t) => {
  await t.test('nested objects merge two levels deep; shared-only and override-only keys survive', () => {
    const shared = { a: { b: { c: 1, d: 2 }, e: 3 }, only_shared: 'S' };
    const override = { a: { b: { c: 9, z: 7 } }, only_override: 'O' };
    withFixture(shared, override, (fx) => {
      const actual = loadWith(fx);
      const expected = { a: { b: { c: 9, d: 2, z: 7 }, e: 3 }, only_shared: 'S', only_override: 'O' };
      assert.deepStrictEqual(actual, expected, msg('deep merge', 'REQ-5 recursive merge', JSON.stringify(expected), actual, 'Merge plain objects key by key at every depth.'));
    });
  });

  await t.test('arrays in override replace wholesale (not concatenated, not index-merged)', () => {
    withFixture({ list: [1, 2, 3], o: { l: ['a', 'b'] } }, { list: [9], o: { l: [] } }, (fx) => {
      const actual = loadWith(fx);
      assert.deepStrictEqual(actual, { list: [9], o: { l: [] } }, msg('array replace', 'REQ-5 arrays replace', '{"list":[9],"o":{"l":[]}}', actual, 'An override array becomes the value as-is, even when empty.'));
    });
  });

  await t.test('scalars replace; null replaces with null', () => {
    withFixture({ s: 'x', n: 1, b: true, z: { k: 1 } }, { s: 'y', n: 0, b: false, z: null }, (fx) => {
      const actual = loadWith(fx);
      assert.deepStrictEqual(actual, { s: 'y', n: 0, b: false, z: null }, msg('scalar/null replace', 'REQ-5 scalars+null replace', '{"s":"y","n":0,"b":false,"z":null}', actual, 'Falsy overrides (0, false, null) are real values and must win.'));
    });
  });

  await t.test('type changes replace: object over scalar and scalar over object', () => {
    withFixture({ x: 5, y: { k: 1 } }, { x: { k: 2 }, y: 'flat' }, (fx) => {
      const actual = loadWith(fx);
      assert.deepStrictEqual(actual, { x: { k: 2 }, y: 'flat' }, msg('type change', 'REQ-5', '{"x":{"k":2},"y":"flat"}', actual, 'Only object-over-object merges; any other pairing replaces.'));
    });
  });

  await t.test('inputs are not mutated or aliased across calls', () => {
    const shared = { a: { b: 1 }, arr: [1] };
    const override = { a: { c: 2 }, arr: [2] };
    withFixture(shared, override, (fx) => {
      const first = loadWith(fx);
      first.a.b = 'MUTATED';
      first.a.c = 'MUTATED';
      first.arr.push('MUTATED');
      const second = loadWith(fx);
      assert.deepStrictEqual(second, { a: { b: 1, c: 2 }, arr: [2] }, msg('no aliasing', 'REQ-5 inputs not mutated', '{"a":{"b":1,"c":2},"arr":[2]}', second, 'Each call must return a fresh object; mutating a result must not leak into later calls.'));
      const sharedOnDisk = JSON.parse(fs.readFileSync(path.join(fx.hooksDir, 'config.json'), 'utf8'));
      assert.deepStrictEqual(sharedOnDisk, shared, msg('shared file untouched', 'REQ-5', JSON.stringify(shared), sharedOnDisk, 'Never write back to config files.'));
    });
  });
});

test('loadHookConfig: broken override is ignored (REQ-6)', async (t) => {
  const shared = { project_name: 'Shared', dep_guard: { enabled: true } };
  const cases = [
    ['invalid JSON', '{ nope'],
    ['JSON array', '[1,2,3]'],
    ['JSON string', '"just a string"'],
    ['JSON null', 'null'],
    ['JSON number', '42'],
  ];
  for (const [label, content] of cases) {
    await t.test(`${label}: ignored, no throw, one-line stderr warning`, () => {
      withFixture(shared, content, (fx) => {
        const { result, error, stderr } = captureStderr(() => loadWith(fx));
        assert.equal(error, undefined, msg(`${label} no throw`, 'REQ-6 must not throw', 'no exception', String(error && error.message), 'A broken override must never break the hook.'));
        assert.deepStrictEqual(result, shared, msg(`${label} ignored`, 'REQ-6 ignored', JSON.stringify(shared), result, 'Return the shared config unchanged.'));
        assert.ok(stderr.includes('hooks.config.json'), msg(`${label} warning text`, 'REQ-6 warn', "stderr mentions 'hooks.config.json'", stderr, 'Tell the user which file was ignored.'));
        const lines = stderr.split(/\r?\n/).filter((l) => l.trim() !== '');
        assert.equal(lines.length, 1, msg(`${label} one line`, 'REQ-6 one-line warning', '1 non-empty stderr line', lines, 'Emit a single concise line.'));
      });
    });
  }
});

test('loadHookConfig: protected guards (REQ-7)', async (t) => {
  for (const section of ['merge_guard', 'env_guard', 'branch_delete_guard']) {
    await t.test(`${section}: enabled=false ignored, other keys honoured, warning names section`, () => {
      const shared = { [section]: { enabled: true, keep: 'shared', tune: 1 }, other: 1 };
      const override = { [section]: { enabled: false, tune: 2, added: 'yes' } };
      withFixture(shared, override, (fx) => {
        const { result, stderr } = captureStderr(() => loadWith(fx));
        const expected = { [section]: { enabled: true, keep: 'shared', tune: 2, added: 'yes' }, other: 1 };
        assert.deepStrictEqual(result, expected, msg(`${section} protected`, 'REQ-7 only enabled=false dropped', JSON.stringify(expected), result, 'Ignore just the disabling value; merge every other key normally.'));
        assert.ok(stderr.includes(section), msg(`${section} warning`, 'REQ-7 warn naming section', `stderr contains '${section}'`, stderr, 'Report the blocked attempt, naming the section.'));
      });
    });

    await t.test(`${section}: enabled=true from override is honoured (even over shared false), no warning`, () => {
      withFixture({ [section]: { enabled: false } }, { [section]: { enabled: true } }, (fx) => {
        const { result, stderr } = captureStderr(() => loadWith(fx));
        assert.deepStrictEqual(result, { [section]: { enabled: true } }, msg(`${section} enable`, 'REQ-7 enabled:true honoured', '{enabled:true}', result, 'Projects may tighten but not loosen.'));
        assert.equal(stderr, '', msg(`${section} enable stderr`, 'REQ-7', 'no stderr', stderr, 'Do not warn when nothing was blocked.'));
      });
    });
  }

  await t.test('only the offending section is named when several are overridden', () => {
    const shared = { merge_guard: { enabled: true }, env_guard: { enabled: true } };
    withFixture(shared, { merge_guard: { enabled: false }, env_guard: { enabled: true } }, (fx) => {
      const { result, stderr } = captureStderr(() => loadWith(fx));
      assert.deepStrictEqual(result, shared, msg('mixed protected', 'REQ-7', JSON.stringify(shared), result, 'Both guards remain enabled.'));
      assert.ok(stderr.includes('merge_guard'), msg('names merge_guard', 'REQ-7', 'mentions merge_guard', stderr, 'Name the blocked section.'));
      assert.ok(!stderr.includes('env_guard'), msg('does not name env_guard', 'REQ-7', 'no mention of env_guard', stderr, 'Only warn about sections actually blocked.'));
    });
  });

  await t.test('non-protected sections CAN be disabled by override, silently', () => {
    const shared = { dep_guard: { enabled: true, warn_patterns: ['npm install'] }, search_guard: { enabled: true, on_violation: 'warn' } };
    withFixture(shared, { dep_guard: { enabled: false }, search_guard: { enabled: false } }, (fx) => {
      const { result, stderr } = captureStderr(() => loadWith(fx));
      const expected = { dep_guard: { enabled: false, warn_patterns: ['npm install'] }, search_guard: { enabled: false, on_violation: 'warn' } };
      assert.deepStrictEqual(result, expected, msg('non-protected disable', 'REQ-7 only three sections protected', JSON.stringify(expected), result, 'dep_guard and search_guard are project-tunable.'));
      assert.equal(stderr, '', msg('non-protected stderr', 'REQ-7', 'no stderr', stderr, 'Legitimate overrides must not warn.'));
    });
  });
});

// ---- REQ-7b / REQ-2b additions (table-driven) ----

const PROTECTED = ['merge_guard', 'env_guard', 'branch_delete_guard'];

function warningLines(stderr) {
  return stderr.split(/\r?\n/).filter((l) => l.trim() !== '');
}

test('REQ-7b(a): non-plain-object override of a protected section is ignored', async (t) => {
  const values = [
    ['null', null],
    ['string', 'off'],
    ['number 0', 0],
    ['number 42', 42],
    ['boolean true', true],
    ['boolean false', false],
    ['empty array', []],
    ['array with object', [{ enabled: false }]],
  ];
  for (const section of PROTECTED) {
    for (const [label, value] of values) {
      await t.test(`${section} = ${label}: shared kept, one warning naming section`, () => {
        const shared = { [section]: { enabled: true, keep: 'k' }, other: 1 };
        withFixture(shared, { [section]: value }, (fx) => {
          const { result, error, stderr } = captureStderr(() => loadWith(fx));
          assert.equal(error, undefined, msg(`${section}=${label} no throw`, 'REQ-7b(a)', 'no exception', String(error && error.message), 'Never throw on a bad override.'));
          assert.deepStrictEqual(result, shared, msg(`${section}=${label} shared kept`, 'REQ-7b(a) non-object ignored entirely', JSON.stringify(shared), result, 'A protected section can only be tuned by an object; anything else is discarded.'));
          const lines = warningLines(stderr);
          assert.equal(lines.length, 1, msg(`${section}=${label} one warning`, 'REQ-7b(a)', '1 non-empty stderr line', lines, 'Emit exactly one warning.'));
          assert.ok(lines[0].includes(section), msg(`${section}=${label} warning names section`, 'REQ-7b(a)', `warning contains '${section}'`, lines[0], 'Name the section whose override was discarded.'));
        });
      });
    }
  }
});

test('REQ-7b(b): protected enabled honoured only when boolean true', async (t) => {
  const values = [
    ['false', false],
    ['0', 0],
    ['1', 1],
    ['"false"', 'false'],
    ['"true"', 'true'],
    ['null', null],
    ['""', ''],
    ['"0"', '0'],
    ['array', [true]],
    ['object', { v: true }],
  ];
  for (const section of PROTECTED) {
    for (const [label, value] of values) {
      await t.test(`${section}.enabled = ${label}: ignored, other keys merge, one warning`, () => {
        const shared = { [section]: { enabled: true, keep: 'k', tune: 1 } };
        withFixture(shared, { [section]: { enabled: value, tune: 2, added: 'a' } }, (fx) => {
          const { result, stderr } = captureStderr(() => loadWith(fx));
          const expected = { [section]: { enabled: true, keep: 'k', tune: 2, added: 'a' } };
          assert.deepStrictEqual(result, expected, msg(`${section}.enabled=${label}`, 'REQ-7b(b) only boolean true honoured', JSON.stringify(expected), result, 'Keep the shared enabled value; merge every other key.'));
          const lines = warningLines(stderr);
          assert.equal(lines.length, 1, msg(`${section}.enabled=${label} one warning`, 'REQ-7b(b)', '1 non-empty stderr line', lines, 'Emit exactly one warning.'));
          assert.ok(lines[0].includes(section), msg(`${section}.enabled=${label} warning names section`, 'REQ-7b(b)', `warning contains '${section}'`, lines[0], 'Name the section.'));
        });
      });
    }

    await t.test(`${section}.enabled = ignored value over shared false keeps false (shared wins)`, () => {
      withFixture({ [section]: { enabled: false } }, { [section]: { enabled: 'yes' } }, (fx) => {
        const { result } = captureStderr(() => loadWith(fx));
        assert.deepStrictEqual(result, { [section]: { enabled: false } }, msg(`${section} shared false kept`, 'REQ-7b(b)', '{enabled:false}', result, 'A non-boolean-true override never changes shared enabled, in either direction.'));
      });
    });

    await t.test(`${section}.enabled = true over shared false => true, no warning (REQ-7b(c))`, () => {
      withFixture({ [section]: { enabled: false, keep: 'k' } }, { [section]: { enabled: true } }, (fx) => {
        const { result, stderr } = captureStderr(() => loadWith(fx));
        assert.deepStrictEqual(result, { [section]: { enabled: true, keep: 'k' } }, msg(`${section} enable`, 'REQ-7b(c)', '{enabled:true,keep:"k"}', result, 'Boolean true is honoured.'));
        assert.equal(stderr, '', msg(`${section} enable stderr`, 'REQ-7b(c)', 'no stderr', stderr, 'No warning when nothing was blocked.'));
      });
    });
  }
});

test('REQ-2b: empty-string explicit projectDir is treated as unset', async (t) => {
  await t.test('falls through to env.CLAUDE_PROJECT_DIR', () => {
    const { resolveProjectDir } = load();
    const actual = resolveProjectDir({ projectDir: '', env: { CLAUDE_PROJECT_DIR: 'E' }, cwd: 'C' });
    assert.equal(actual, 'E', msg('empty projectDir -> env', 'REQ-2b', "'E'", actual, 'An empty explicit dir must not win.'));
  });
  await t.test('falls through to cwd when env also empty', () => {
    const { resolveProjectDir } = load();
    const actual = resolveProjectDir({ projectDir: '', env: { CLAUDE_PROJECT_DIR: '' }, cwd: 'C' });
    assert.equal(actual, 'C', msg('empty projectDir -> cwd', 'REQ-2b', "'C'", actual, 'Empty explicit and empty env both count as unset.'));
  });
  await t.test('loadHookConfig with projectDir "" reads the env-selected override', () => {
    withFixture({ v: 'shared' }, { v: 'override' }, (fx) => {
      const { loadHookConfig } = load();
      const actual = loadHookConfig({ hooksDir: fx.hooksDir, projectDir: '', env: { CLAUDE_PROJECT_DIR: fx.projectDir }, cwd: os.tmpdir() });
      assert.deepStrictEqual(actual, { v: 'override' }, msg('empty projectDir in load', 'REQ-2b', '{"v":"override"}', actual, 'loadHookConfig resolves the dir with the same empty-is-unset rule.'));
    });
  });
});

// ---- REQ-14: UTF-8 BOM tolerance ----

const BOM = Buffer.from([0xef, 0xbb, 0xbf]);
const withBom = (json) => Buffer.concat([BOM, Buffer.from(json)]);

function bomFixture({ shared, sharedBom = false, override, overrideBom = false }) {
  const fx = makeFixture(undefined, undefined);
  const sharedJson = JSON.stringify(shared);
  fs.writeFileSync(path.join(fx.hooksDir, 'config.json'), sharedBom ? withBom(sharedJson) : Buffer.from(sharedJson));
  if (override !== undefined) {
    const raw = typeof override === 'string' ? override : JSON.stringify(override);
    fs.writeFileSync(path.join(fx.projectDir, '.claude', 'hooks.config.json'), overrideBom ? withBom(raw) : Buffer.from(raw));
  }
  return fx;
}

function runBom(opts, fn) {
  const fx = bomFixture(opts);
  try {
    return fn(fx);
  } finally {
    fx.cleanup();
  }
}

test('REQ-14: BOM handling', async (t) => {
  await t.test('BOM override merges exactly like the no-BOM override, with no warning', () => {
    const shared = { a: { b: 1, c: [1, 2] }, dep_guard: { enabled: true } };
    const override = { a: { b: 2 }, dep_guard: { enabled: false }, extra: 'x' };
    const plain = runBom({ shared, override }, (fx) => captureStderr(() => loadWith(fx)));
    const bom = runBom({ shared, override, overrideBom: true }, (fx) => captureStderr(() => loadWith(fx)));
    const expected = { a: { b: 2, c: [1, 2] }, dep_guard: { enabled: false }, extra: 'x' };
    assert.deepStrictEqual(plain.result, expected, msg('no-BOM control', 'REQ-14 control', JSON.stringify(expected), plain.result, 'Control case must merge normally.'));
    assert.deepStrictEqual(bom.result, expected, msg('BOM override merge', 'REQ-14 override BOM tolerated', JSON.stringify(expected), bom.result, 'A leading UTF-8 BOM must not make the override invalid.'));
    assert.equal(bom.stderr, '', msg('BOM override stderr', 'REQ-14', 'no stderr', bom.stderr, 'A BOM-prefixed valid override is not an error.'));
  });

  await t.test('BOM shared config loads without throwing and equals the no-BOM load (with and without override)', () => {
    const shared = { project_name: 'S', n: { k: [1] } };
    const override = { n: { z: 1 } };
    for (const withOverride of [false, true]) {
      const plain = runBom({ shared, override: withOverride ? override : undefined }, (fx) => loadWith(fx));
      const { result, error } = runBom({ shared, sharedBom: true, override: withOverride ? override : undefined }, (fx) => captureStderr(() => loadWith(fx)));
      assert.equal(error, undefined, msg(`BOM shared no throw (override=${withOverride})`, 'REQ-14 shared BOM', 'no exception', String(error && error.message), 'Strip a leading BOM from the shared config too.'));
      assert.deepStrictEqual(result, plain, msg(`BOM shared equality (override=${withOverride})`, 'REQ-14', JSON.stringify(plain), result, 'BOM and non-BOM shared configs load identically.'));
    }
  });

  await t.test('BOM override cannot bypass protected guards (REQ-7)', async (tt) => {
    for (const section of PROTECTED) {
      await tt.test(`${section}: enabled=false in BOM file still ignored, other key merged, warning names section`, () => {
        const shared = { [section]: { enabled: true, tune: 1 } };
        const override = { [section]: { enabled: false, tune: 2 } };
        runBom({ shared, override, overrideBom: true }, (fx) => {
          const { result, stderr } = captureStderr(() => loadWith(fx));
          const expected = { [section]: { enabled: true, tune: 2 } };
          assert.deepStrictEqual(result, expected, msg(`${section} BOM protected`, 'REQ-14+REQ-7', JSON.stringify(expected), result, 'The BOM file must be parsed (tune honoured) AND protection applied (enabled kept).'));
          assert.ok(stderr.includes(section), msg(`${section} BOM warning`, 'REQ-14+REQ-7', `stderr names '${section}'`, stderr, 'Warn about the blocked disable.'));
        });
      });
    }
  });

  await t.test('override containing ONLY a BOM is invalid: warning, shared unchanged', () => {
    const shared = { merge_guard: { enabled: true }, v: 1 };
    const fx = bomFixture({ shared });
    try {
      fs.writeFileSync(path.join(fx.projectDir, '.claude', 'hooks.config.json'), BOM);
      const { result, error, stderr } = captureStderr(() => loadWith(fx));
      assert.equal(error, undefined, msg('BOM-only no throw', 'REQ-14 / REQ-6', 'no exception', String(error && error.message), 'Never throw on a bad override.'));
      assert.deepStrictEqual(result, shared, msg('BOM-only ignored', 'REQ-14 / REQ-6', JSON.stringify(shared), result, 'Stripping the BOM leaves empty text, which is invalid JSON and must be ignored.'));
      assert.ok(stderr.includes('hooks.config.json'), msg('BOM-only warning', 'REQ-14 / REQ-6', "stderr mentions 'hooks.config.json'", stderr, 'Warn that the override was ignored.'));
      assert.equal(warningLines(stderr).length, 1, msg('BOM-only one line', 'REQ-6', '1 stderr line', warningLines(stderr), 'Emit a single line.'));
    } finally {
      fx.cleanup();
    }
  });
});

// ---- REQ-15: prototype-key safety ----

const HOSTILE_KEYS = ['__proto__', 'constructor', 'prototype'];

function assertPlainDeep(value, where, label) {
  if (value !== null && typeof value === 'object') {
    assert.equal(
      Object.getPrototypeOf(value),
      Array.isArray(value) ? Array.prototype : Object.prototype,
      msg(`${label} prototype at ${where}`, 'REQ-15 no prototype tampering', 'prototype is Object.prototype (Array.prototype for arrays)', String(Object.getPrototypeOf(value)), 'Hostile keys must never alter any merged object prototype.')
    );
    for (const k of Object.keys(value)) assertPlainDeep(value[k], `${where}.${k}`, label);
  }
}

function assertGlobalClean(label) {
  for (const k of ['enabled', 'merge_guard', 'polluted', 'legit']) {
    assert.equal(({})[k], undefined, msg(`${label} global pollution '${k}'`, 'REQ-15 Object.prototype untouched', `({}).${k} === undefined`, String(({})[k]), 'Never write onto shared prototypes.'));
  }
}

test('REQ-15: hostile keys in override never influence the result', async (t) => {
  const shared = { dep_guard: { enabled: true }, merge_guard: {}, env_guard: {}, branch_delete_guard: {}, x: 1 };
  const locations = [
    ['top level', (K) => `{"${K}":{"enabled":false,"polluted":true},"legit":1}`, { ...shared, legit: 1 }],
    ['under dep_guard', (K) => `{"dep_guard":{"${K}":{"enabled":false,"polluted":true},"legit":2}}`, { ...shared, dep_guard: { enabled: true, legit: 2 } }],
    ['under merge_guard', (K) => `{"merge_guard":{"${K}":{"enabled":false,"polluted":true},"legit":3}}`, { ...shared, merge_guard: { legit: 3 } }],
    ['under env_guard', (K) => `{"env_guard":{"${K}":{"enabled":false,"polluted":true},"legit":3}}`, { ...shared, env_guard: { legit: 3 } }],
    ['under branch_delete_guard', (K) => `{"branch_delete_guard":{"${K}":{"enabled":false,"polluted":true},"legit":3}}`, { ...shared, branch_delete_guard: { legit: 3 } }],
  ];
  for (const K of HOSTILE_KEYS) {
    for (const [where, build, expected] of locations) {
      await t.test(`${K} ${where}: dropped, one warning naming key, rest merged`, () => {
        runBom({ shared, override: build(K) }, (fx) => {
          const { result, error, stderr } = captureStderr(() => loadWith(fx));
          const label = `${K} ${where}`;
          assert.equal(error, undefined, msg(`${label} no throw`, 'REQ-15', 'no exception', String(error && error.message), 'Hostile keys must not crash the loader.'));
          assert.deepStrictEqual(result, expected, msg(`${label} result`, 'REQ-15 dropped key, other keys merged', JSON.stringify(expected), result, 'Result equals merging the override without the hostile key.'));
          assert.deepStrictEqual(Object.keys(result).sort(), Object.keys(expected).sort(), msg(`${label} own keys`, 'REQ-15', JSON.stringify(Object.keys(expected)), Object.keys(result), 'No hostile key may appear as an own key.'));
          assert.notEqual(result.merge_guard && result.merge_guard.enabled, false, msg(`${label} merge_guard.enabled`, 'REQ-15+REQ-7', 'not false', String(result.merge_guard && result.merge_guard.enabled), 'A hostile key must not smuggle in a disable.'));
          assertPlainDeep(result, 'result', label);
          assertGlobalClean(label);
          const lines = warningLines(stderr);
          assert.equal(lines.length, 1, msg(`${label} one warning`, 'REQ-15', '1 non-empty stderr line', lines, 'Emit exactly one warning.'));
          assert.ok(lines[0].includes(K), msg(`${label} warning names key`, 'REQ-15', `warning contains '${K}'`, lines[0], 'Name the offending key.'));
        });
      });
    }
  }

  await t.test('__proto__ two levels deep under a non-protected section is dropped', () => {
    const sh = { dep_guard: { a: { b: 1 } } };
    runBom({ shared: sh, override: '{"dep_guard":{"a":{"__proto__":{"polluted":true},"c":2}}}' }, (fx) => {
      const { result, stderr } = captureStderr(() => loadWith(fx));
      assert.deepStrictEqual(result, { dep_guard: { a: { b: 1, c: 2 } } }, msg('deep __proto__', 'REQ-15', '{"dep_guard":{"a":{"b":1,"c":2}}}', result, 'Drop hostile keys at any depth.'));
      assert.equal(result.dep_guard.a.polluted, undefined, msg('deep __proto__ inherited', 'REQ-15', 'undefined', String(result.dep_guard.a.polluted), 'No inherited values from hostile keys.'));
      assertGlobalClean('deep');
      assert.ok(stderr.includes('__proto__'), msg('deep __proto__ warning', 'REQ-15', "stderr names '__proto__'", stderr, 'Warn naming the key.'));
    });
  });
});

test('REQ-15: hostile __proto__ in the SHARED config does not crash or change prototypes', () => {
  const fx = bomFixture({ shared: { x: 1 } });
  try {
    fs.writeFileSync(path.join(fx.hooksDir, 'config.json'), '{"__proto__":{"polluted":true},"x":1}');
    const { result, error } = captureStderr(() => loadWith(fx));
    assert.equal(error, undefined, msg('shared __proto__ no throw', 'REQ-15 shared', 'no exception', String(error && error.message), 'Hostile shared config must still load.'));
    assert.equal(Object.getPrototypeOf(result), Object.prototype, msg('shared __proto__ prototype', 'REQ-15 shared', 'Object.prototype', String(Object.getPrototypeOf(result)), 'Result prototype must stay Object.prototype.'));
    assertGlobalClean('shared');
  } finally {
    fx.cleanup();
  }
});

// ---- REQ-16: pathological depth ----

test('REQ-16: extremely deep override is ignored without throwing', async (t) => {
  const N = 5000;
  const shared = { x: 1, dep_guard: { enabled: true } };
  const cases = [
    ['deep object', '{"a":'.repeat(N) + '1' + '}'.repeat(N)],
    ['deep array inside object', '{"a":' + '['.repeat(N) + ']'.repeat(N) + '}'],
    ['top-level deep array', '['.repeat(N) + ']'.repeat(N)],
    ['deep object under dep_guard', '{"dep_guard":' + '{"a":'.repeat(N) + '1' + '}'.repeat(N) + '}'],
  ];
  for (const [label, text] of cases) {
    await t.test(`${label}: returns shared, one warning`, () => {
      runBom({ shared, override: text }, (fx) => {
        const { result, error, stderr } = captureStderr(() => loadWith(fx));
        assert.equal(error, undefined, msg(`${label} no throw`, 'REQ-16', 'no exception', String(error && error.message), 'Deep nesting must not crash a hook.'));
        assert.deepStrictEqual(result, shared, msg(`${label} ignored`, 'REQ-16', JSON.stringify(shared), result, 'Treat an unmanageable override as broken and return the shared config.'));
        const lines = warningLines(stderr);
        assert.equal(lines.length, 1, msg(`${label} one warning`, 'REQ-16', '1 non-empty stderr line', lines.map((l) => l.slice(0, 120)), 'Emit exactly one warning.'));
        assert.ok(lines[0].includes('hooks.config.json'), msg(`${label} warning text`, 'REQ-16', "mentions 'hooks.config.json'", lines[0].slice(0, 200), 'Name the ignored file.'));
      });
    });
  }
});
