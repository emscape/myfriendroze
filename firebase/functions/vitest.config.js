const { defineConfig } = require('vitest/config');

// Coverage threshold makes CLAUDE.md's QS1 (>85% coverage on Firebase
// Functions) mechanically enforced for new code going forward, rather than
// just an aspirational rule — see project_backlog memory for the fact that
// this repo had zero Functions test coverage before the Stripe payment work.
// Scoped to lib/ on purpose, not the whole functions/ tree — the rest of
// this codebase (index.js, orderConfirmation.js, etc.) predates this test
// infrastructure and has zero coverage today. Retrofitting that is a
// separate, much larger task (see project_backlog memory). This threshold
// only holds new pure-logic modules (built specifically to be unit-tested,
// same pattern as astro/scripts/fetch-gallery.mjs) to the QS1 bar, rather
// than either failing immediately on pre-existing gaps or being toothless.
module.exports = defineConfig({
  test: {
    coverage: {
      provider: 'v8',
      include: ['lib/**'],
      thresholds: {
        lines: 85,
        functions: 85,
        branches: 85,
        statements: 85,
      },
    },
  },
});
