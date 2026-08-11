import { describe, it, expect } from 'vitest';

// Not testing real business logic — this file exists solely to prove the
// test runner itself is wired up correctly (npm test, CI's functions job)
// before any real Functions code depends on it. See vitest.config.js for
// why coverage enforcement is scoped to lib/ rather than this file.
//
// .mjs + import here, not require() — vitest is ESM-only, but this
// codebase's actual Functions source stays CommonJS (matching index.js and
// everything it requires). Node's ESM loader can import a CJS module fine,
// so lib/*.js under test can stay CommonJS too — only the test files
// themselves need to be .mjs, same convention as astro/scripts/*.test.mjs.
describe('vitest smoke test', () => {
  it('runs', () => {
    expect(1 + 1).toBe(2);
  });
});
