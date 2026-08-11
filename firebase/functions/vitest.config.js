const { defineConfig } = require('vitest/config');

// Coverage threshold makes CLAUDE.md's QS1 (>85% coverage on Firebase
// Functions) mechanically enforced for new code going forward, rather than
// just an aspirational rule — see project_backlog memory for the fact that
// this repo had zero Functions test coverage before the Stripe payment work.
// Scoped to an explicit allowlist, not the whole functions/ tree — the
// rest of this codebase (index.js, orderConfirmation.js, etc.) predates
// this test infrastructure and has zero coverage today. Retrofitting that
// is a separate, much larger task (see project_backlog memory). This
// threshold only holds files actually built with real tests as part of the
// Stripe payment work to the QS1 bar — add new files here as they gain
// real test coverage, same pattern as lib/**'s pure logic modules.
module.exports = defineConfig({
  test: {
    coverage: {
      provider: 'v8',
      include: ['lib/**', 'createCheckoutSession.js'],
      thresholds: {
        lines: 85,
        functions: 85,
        branches: 85,
        statements: 85,
      },
    },
  },
});
