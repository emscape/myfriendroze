# Skill: project-mode-switch

## Purpose
Switch the active operational mode to reduce prompt overhead and align Claude Code's behavior with what the current work requires. Instead of re-stating constraints on every prompt, declare the mode once and let it govern the session.

## When to Use
- At the start of a focused work session
- When switching between different types of work (building vs debugging vs integrating)
- To reset constraints after a mode has drifted

## Inputs Required
- `mode`: one of `scaffold` | `feature` | `debug` | `integration`

## Example Invocation
```
/project-mode-switch mode=scaffold
/project-mode-switch mode=debug
/project-mode-switch mode=integration
```

---

## Modes

---

### scaffold mode

**Use when**: Creating the initial structure of a new module, package, or feature before any logic exists.

#### Active Constraints
- Files are stubs only — no real logic, only type signatures and empty function bodies
- No file may exceed 100 LOC at scaffold time
- Every scaffold must include a test skeleton (even if the test body is empty — the describe block must exist)
- `packages/domain` types must be defined before `apps/desktop` stubs
- No external dependencies may be added without explicit approval

#### Preferred Skills
- `/repo-bootstrap-audit` — run first on any unfamiliar area
- `/feature-boundary-check` — plan which packages the feature crosses before writing
- `/minimal-implementation-enforcer` — verify stubs aren't sneaking in real logic

#### Preferred Agents
- `architect` — approve the structure before stubbing
- `domain-engineer` — define domain types first (always before ui-builder)

#### Prohibited Behaviors
- Writing implementation logic (scaffold = structure, not behavior)
- Adding `apps/desktop` UI before `packages/domain` types exist
- Hardcoding story content values in any layer
- Skipping the test skeleton

---

### feature mode

**Use when**: Implementing real behavior in a feature that has already been scaffolded.

#### Active Constraints
- Follow TDD: write a failing test before implementing (RED → GREEN → REFACTOR)
- No function may exceed 50 LOC
- No file may exceed 500 LOC — split if needed (QS4)
- Every new behavior must have a corresponding test
- No cross-package imports introduced without running `/feature-boundary-check` first
- Story content must remain in `packages/content` — no hardcoded strings in logic or UI

#### Preferred Skills
- `/feature-boundary-check` — before any cross-package work
- `/integration-guard` — before connecting domain → store or store → component
- `/state-consistency-check` — after modifying `CaseState`, `PuzzleState`, or Zustand store shape
- `/minimal-implementation-enforcer` — before committing

#### Preferred Agents
- `domain-engineer` — implement domain logic with TDD
- `ui-builder` — implement UI (only after domain types exist)
- `qa-reviewer` — verify test coverage before merge

#### Prohibited Behaviors
- Writing `apps/desktop` UI before `packages/domain` logic exists
- Skipping tests for "simple" domain rules
- Introducing a new abstraction for a single use case
- Adding error handling for impossible states inside domain logic

---

### debug mode

**Use when**: Investigating and fixing a specific failure. The goal is the minimum change that fixes the problem.

#### Active Constraints
- Read before writing — understand the bug before touching any file
- Identify root cause before proposing fix (do not patch symptoms)
- Fix must be the minimum change — no opportunistic refactoring
- Every fix must have a test in `packages/domain/src/tests/` that would have caught the original bug
- If the fix touches more than 3 files, stop and escalate — it may be architectural

#### Preferred Skills
- `/state-consistency-check` — for CaseState / PuzzleState drift bugs
- `/integration-guard` — for domain→store or store→component wiring failures
- `/playability-validator` — for case progression or unlock flow bugs

#### Preferred Agents
- `failure-mode-analyzer` — map all failure modes before fixing one
- `qa-reviewer` — verify the fix before closing the bug

#### Prohibited Behaviors
- Refactoring code while fixing a bug (separate concerns)
- "Just try this" — fixes must be grounded in root cause analysis
- Marking a bug as fixed without a regression test
- Expanding scope ("while I'm here I'll also...")

---

### integration mode

**Use when**: Connecting two independently-developed modules, wiring a feature end-to-end, or preparing for a merge.

#### Active Constraints
- Run `/integration-guard` before writing any wiring code
- Type contracts at every boundary must be explicit TypeScript types or Zod schemas
- Every integration must have a Vitest test (domain→store) or Playwright test (store→UI) that proves the wire works
- Failure paths must be handled on both sides of every integration
- No integration that creates a reverse dependency (e.g., domain importing from desktop)

#### Preferred Skills
- `/integration-guard` — primary pre-work skill
- `/state-consistency-check` — verify `CaseState` / `PuzzleState` shapes match across domain and store
- `/playability-validator` — verify the integrated case flow is completable end-to-end
- `/refactor-boundary-check` — confirm no boundary violations after wiring

#### Preferred Agents
- `integration-architect` — plan the wiring contract (domain→store, Tauri→store, store→UI)
- `qa-reviewer` — write and verify integration tests
- `failure-mode-analyzer` — audit error paths at the integration boundary

#### Prohibited Behaviors
- Wiring domain to desktop without an explicit TypeScript type contract
- Integrating without a test that exercises the real implementation (not a mock)
- Accepting "it works in the mock" as sufficient
- Creating a dependency from `packages/domain` to `apps/desktop`

---

## Mode Summary Table

| Mode | Primary Question | Default Agent | Key Skill |
|---|---|---|---|
| scaffold | What structure does this need? | architect | feature-boundary-check |
| feature | How does this behavior work? | domain-engineer | integration-guard |
| debug | What is broken and why? | failure-mode-analyzer | state-consistency-check |
| integration | Can these two pieces work together? | integration-architect | integration-guard |

## Switching Modes
Modes are advisory — they do not change tool availability, only the operating constraints and recommended workflow. You can switch modes at any time. When in doubt, use `debug mode` (it has the most conservative constraints).
