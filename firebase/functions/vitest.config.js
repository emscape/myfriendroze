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
  // Forced to a single fork: v8's coverage data gets collected per test
  // worker, and when the same source file is loaded across multiple worker
  // processes (e.g. stripeWebhook.js requiring lib/orderFromSession at
  // module scope, while orderFromSession.test.mjs also imports it
  // directly), the default multi-process pool's coverage merge under-
  // reports — a file that's ~92% covered when its own test runs alone
  // showed as ~28% in the full multi-worker suite. Single-fork execution
  // sidesteps the merge entirely. This suite is small (well under a
  // second), so the lost parallelism doesn't matter here.
  pool: 'forks',
  poolOptions: { forks: { singleFork: true } },
  test: {
    coverage: {
      provider: 'v8',
      include: ['lib/**', 'createCheckoutSession.js', 'stripeWebhook.js', 'orderConfirmation.js'],
      thresholds: {
        lines: 85,
        functions: 85,
        branches: 85,
        statements: 85,
      },
    },
  },
});
