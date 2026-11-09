---
name: constitutional-orchestrator
description: |
  Master CCABDD (Constitutional Contract Adversarial BDD) workflow coordinator.
  Use when: implementing features with TDD, starting new development tasks,
  coordinating RED/GREEN/AUDIT cycle, ensuring constitutional compliance.
  Triggers: "implement feature", "start TDD", "constitutional workflow",
  "CCABDD", "new feature development"
allowed-tools:
  - Agent
  - TodoWrite
  - Read
  - Write
  - Edit
  - Bash
  - Glob
  - Grep
  - mcp__SequentialThinking__sequentialthinking
---

# Constitutional Orchestrator

Master coordinator for Constitutional Contract Adversarial Behavior-Driven Development.

## Workflow Overview

```
M1-M2: DISCOVERY
  ├── /req-elicit ON SELF → "What am I missing?"
  │   └── Phase 2.5: Dependency graph, sequencing specs, integration points
  ├── Grep/Glob/Read (Explore sub-agent for broad discovery) → Find relevant code
  └── Written checkpoint: "What am I missing?" answered with evidence

M3: PLAN
  ├── /design-by-contract → Generate CL12 contracts (PRE/POST/INV/SEQ/ERRORS)
  ├── Pre-test gate: every Integration Point has SEQ clause
  ├── TodoWrite plan with contract references
  ├── Independent review of the plan (fresh-context reviewer sub-agent)
  └── WAIT for user approval (CL5)

M4.2: RED PHASE
  ├── /prompt-engineering → Craft test-writer prompt
  ├── /adversarial-test-writer (FORK) → Tests from contracts
  └── /theater-detection → Validate not theater

M4.3: GREEN PHASE
  ├── /prompt-engineering → Craft coder prompt
  └── /adversarial-coder (FORK) → Implementation

M4.5: AUDIT
  └── /constitutional-audit (FORK) → Verify compliance

M4.6+: ITERATION (if violations)
  └── /constitutional-fix → /ralph-loop until ZERO VIOLATIONS

M5: FINAL
  ├── /constitutional-audit (final)
  ├── Claude Code project memory / repo docs → Document decisions
  └── Notify orchestrator if delegated task
```

## Sub-Skill Invocations

### RED Phase
```
Invoke: /adversarial-test-writer
Pass: Requirements, contracts (including SEQ clauses), TSR template
Expect: Tests with 5-point error messages, SEQ tests use lifecycle paths
Verify: /theater-detection passes (including #5/#6 integration theater)
```

### GREEN Phase
```
Invoke: /adversarial-coder
Pass: Error messages ONLY (not test source)
Expect: Implementation that passes tests
Verify: All tests pass
```

### Audit Phase
```
Invoke: /constitutional-audit <commit>
Expect: VERDICT: ZERO CONSTITUTIONAL VIOLATIONS
If violations: /constitutional-fix
```

## Decision Matrix (Iteration)

| Tests Pass? | test_sound? | impl_sound? | Action |
|-------------|-------------|-------------|--------|
| NO | True | False | Invoke /adversarial-coder again |
| NO | False | True | Refine tests (coordinator analysis) |
| NO | False | False | Escalate to user |
| YES | - | - | Proceed to M5 |

## Independent Review Integration

Each review spawns a fresh-context reviewer sub-agent (e.g. qa-reviewer, architect, failure-mode-analyzer, or the built-in /code-review skill).

- **M3**: Independent review of the plan
- **M4**: Independent review of plan adherence and the code diff
- **M5**: Independent review (final validation)
- **When stuck**: fresh-context second-opinion sub-agent given the failing output; after 3 failed attempts ask the user

Always pass actual code via git diff, never summaries.

## Evidence Format

```
F:path:lines (file reference)
T:module::test=STATUS (test result)
C:hash (commit)
COV:% (coverage)
O:snippet (output)
```

## Constitutional Laws (Key)

- **CL5**: Human approval REQUIRED before implementation
- **CL6**: TDD enforcement - RED → GREEN → COMMIT → REFACTOR
- **CL12**: Design by Contract - PRE/POST/INV/SEQ for all public methods
- **CL10**: Mock verification - contracts required for external deps

## Contract Granularity Framework

**Reference**: See `/design-by-contract` skill → Contract Granularity Framework.

Not all tests require their own contracts. Four tiers:
- **Tier 1**: Behavioral contracts (module boundaries)
- **Tier 1.5**: Integration contracts (SEQ — wiring obligations between components)
- **Tier 2**: Structural contracts (external APIs)
- **Tier 3**: Implementation tests (trace to Tier 1/2 via `CONTRACT TRACEABILITY`)

## Pre-Test Gate (Integration Completeness)

**BEFORE invoking /adversarial-test-writer**, verify:
- Every Integration Point from REQUIREMENT_MANIFEST has a SEQ clause in the contract
- Every SEQ clause specifies exact caller and callee
- No step says "the system" or "something triggers"

If ANY integration point lacks a SEQ clause → BLOCK → return to /design-by-contract.

## MCP Tools Available

- **Sequential Thinking**: For complex reasoning

<!-- © 2024-2026 Ketema Harris. All rights reserved. SPDX-License-Identifier: LicenseRef-CCABDD-Proprietary -->
<!-- Adapted with permission by Emily Anderson, 2026. -->
