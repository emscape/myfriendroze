---
name: constitutional-refactor
description: |
  Transform legacy code without contracts into constitutionally compliant code through
  systematic discovery, bridging, and adversarial TDD.
  Use when: (1) Encountering code without CL12 contracts, (2) Refactoring legacy systems,
  (3) "This code has no tests" or tests exist but aren't contract-linked,
  (4) API changes break existing tests (symptom of missing contracts),
  (5) User says "make this compliant", "add contracts", "wire to contracts".
  Triggers: "refactor", "legacy code", "no contracts", "add contracts", "make compliant",
  "constitutional refactoring", "wire to contracts", "this code needs contracts".
  Orchestrates: req-elicit, adversarial-test-writer, adversarial-coder, constitutional-audit.
---

# constitutional-refactor

Transform legacy code into constitutionally compliant code through systematic discovery and adversarial TDD.

## Philosophy

Legacy code is not broken — it's undocumented. Our job is to discover what it does, decide what it should do, and build the bridge between them with constitutional rigor.

**Core Principle**: We don't trust existing tests until they're linked to contracts. Tests without contracts are evidence of intent, not proof of correctness.

## Prerequisites

Before starting:
1. **BRANCH** — Never work on live code. Create feature branch.
2. **Skills available** — req-elicit, adversarial-test-writer, adversarial-coder, constitutional-audit
3. **User available** — Discovery requires human input for EXPECTED behavior

## The Six Phases

```
Phase 1: Discovery     → DISCONNECT MATRIX
Phase 2: Bridging      → Working transformation (learning tool)
Phase 3: Contracts     → CL12-compliant contracts (RALPH LOOP)
Phase 4: RED           → Genuine failing tests (RALPH LOOP)
Phase 5: GREEN         → Passing implementation (RALPH LOOP)
Phase 6: Final Audit   → ZERO VIOLATIONS (RALPH LOOP)
```

---

## Phase 1: Discovery

**Goal**: Build the DISCONNECT MATRIX — the map of EXPECTED vs OBSERVED behavior.

### Step 1.1: Elicit EXPECTED Behavior

Invoke `/req-elicit` with the user (including Phase 2.5 — Integration Specification):

```
"Let's understand what this code SHOULD do.
I'll treat the existing code as 'source prose' —
evidence of intent, not specification.

What is the purpose of [component]?
What should it do when working correctly?
Which components depend on which? Who calls whom, and when?"
```

Document EXPECTED behaviors AND integration wiring from this dialogue.
Phase 2.5 output: dependency graph, sequencing specs (SEQ), integration points checklist, lifecycle paths.

### Step 1.2: Observe ACTUAL Behavior

**CRITICAL**: Observation means EXECUTION, not code reading.

Code reading tells you what someone INTENDED to implement.
Execution tells you what ACTUALLY happens.

See `references/observation-techniques.md` for system-type-specific patterns.

**Quick Reference by System Type**:

| System Type | Observation Technique |
|-------------|----------------------|
| CLI Tool | Execute with all parameter combinations → capture stdout/stderr/exit codes |
| Web App | Playwright automation → capture UI states, network calls, DOM mutations |
| REST API | HTTP client to all endpoints → capture responses, status codes, timing |
| Library/Module | Throwaway test harness → capture returns, exceptions, state mutations |
| Database | Query before/after execution → capture row changes, schema behavior |

**Process**:
1. Identify system type from codebase
2. Build observation harness (script, Playwright test, HTTP client, etc.)
3. Execute systematically across all public interfaces
4. Capture ACTUAL outputs, side effects, state changes
5. Document in OBSERVED column (not what code says, what execution shows)

**Do NOT trust existing tests or code comments.** They tell you what someone thought the code should do, which may differ from what it ACTUALLY does.

### Step 1.3: Build DISCONNECT MATRIX

See `references/disconnect-matrix-template.md` for full template.

```markdown
| ID | Behavior | EXPECTED | OBSERVED | DELTA | Location |
|----|----------|----------|----------|-------|----------|
| B1 | Auth check | Validates token | Returns true always | OVERRIDE | auth.py:45 |
| B2 | Rate limit | 100 req/min | *nothing* | NEW | N/A |
| B3 | Legacy flag | *nothing* | Checks env var | REMOVE | config.py:12 |
```

**Classification**:
- **OVERRIDE**: OBSERVED exists but wrong — must change
- **NEW**: No OBSERVED — must create
- **REMOVE**: OBSERVED exists but unwanted — must eliminate

### Step 1.4: Halfstepping

The DELTA column + Location tells you WHERE to start:
- OVERRIDE → Method override or modification at Location
- NEW → New code path (find appropriate insertion point)
- REMOVE → Mark for deletion after bridges work

---

## Phase 2: Bridging

**Goal**: Build working bridges that make EXPECTED behavior function alongside OBSERVED behavior.

Bridges are **learning tools**, not final code. They help you understand the transformation well enough to write contracts.

### Step 2.1: Build Bridges

For each OVERRIDE/NEW in the matrix:

```python
# Bridge pattern for OVERRIDE:
def method(self, args):
    if USE_NEW_BEHAVIOR:  # Feature flag or condition
        return new_expected_behavior(args)
    else:
        return old_observed_behavior(args)

# Bridge pattern for NEW:
def new_method(self, args):
    # Implement EXPECTED behavior
    # Old code doesn't call this yet
    pass
```

### Step 2.2: Validate Bridges

- Run existing tests — they should still pass (old behavior preserved)
- Manually test new behavior paths
- Use AI Panel `critique_code` for feedback

**Bridges are disposable.** Their purpose is learning, not permanence.

---

## Phase 3: Contract Generation (RALPH LOOP)

**Goal**: Generate CL12-compliant contracts from the DISCONNECT MATRIX.

### Step 3.1: Transform Matrix to Contracts

For each behavior in the matrix:

```python
# EXPECTED column → POST conditions
# "Auth check validates token" → POST: Returns True iff token valid

# REMOVE rows → INV conditions
# "Legacy flag check" → INV: Environment variables not accessed

# DELTA descriptions → PRE conditions
# "Requires valid session" → PRE: session_id is non-empty string

# Integration wiring (from Phase 2.5) → SEQ conditions
# "Pool init starts monitor" → SEQ: __init__ MUST call timeout_manager.start_monitoring()
#                                Source: REQ-ID, CHAIN-ID, IP-ID
```

### Step 3.2: Write Contract File

```python
"""
[Component] Contract

PRE-[ID]-01: [Precondition]
POST-[ID]-01: [Postcondition]
INV-[ID]-01: [Invariant]
ERRORS-[ID]-01: [Error condition]
"""
```

### Step 3.3: Ralph Loop — Contract Compliance

```
<promise>ALL behaviors in DISCONNECT matrix have CL12-compliant contracts</promise>
```

Loop:
1. Generate/update contracts
2. Run `/constitutional-audit` on contracts
3. If violations found → fix and repeat
4. Exit when: ZERO CL12 VIOLATIONS

---

## Phase 4: Demolition / RED (RALPH LOOP)

**Goal**: Remove bridges and write genuine failing tests.

### Step 4.1: Remove Old Code Paths

Delete the bridge conditionals and old behavior:

```python
# Before (bridge):
def method(self, args):
    if USE_NEW_BEHAVIOR:
        return new_expected_behavior(args)
    else:
        return old_observed_behavior(args)

# After (demolition):
def method(self, args):
    # Old path GONE — tests will fail
    raise NotImplementedError("Awaiting GREEN phase")
```

### Step 4.2: Pre-Test Gate (Integration Completeness)

**BEFORE invoking test-writer**, verify:
- Every Integration Point from Phase 1.1 has a SEQ clause in the contract
- Every SEQ clause specifies exact caller and callee
- No step says "the system" or "something triggers"

If ANY integration point lacks a SEQ clause → BLOCK → return to Phase 3.

### Step 4.3: Write Tests from Contracts

Invoke `/adversarial-test-writer` (fork-isolated):

```
Context:
- Contracts: [path to contract file] (including SEQ clauses)
- DISCONNECT MATRIX: [the matrix]
- Tests must be BLIND to implementation
- 5-point error messages required
- SEQ tests MUST use actual lifecycle paths (not direct method calls)
- Apply theater #5/#6 detection for integration tests
```

### Step 4.4: Ralph Loop — Genuine Tests

```
<promise>ALL contracts have failing tests with 5-point error messages</promise>
```

Loop:
1. Write tests via adversarial-test-writer
2. Run `/theater-detection`
3. If theater tests found → fix and repeat
4. Exit when: Tests genuine, failing appropriately

---

## Phase 5: Construction / GREEN (RALPH LOOP)

**Goal**: Implement against contracts to make tests pass.

### Step 5.1: Implement from Error Messages

Invoke `/adversarial-coder` (fork-isolated):

```
Context:
- Error messages from RED phase
- Contracts for reference
- Implementation must be BLIND to test source
- Minimal implementation (YAGNI)
```

### Step 5.2: Ralph Loop — All Tests Pass

```
<promise>ALL tests pass</promise>
```

Loop:
1. Implement via adversarial-coder
2. Run tests
3. If failures → iterate (refactor-coder if needed)
4. Exit when: 0 test failures

### Step 5.3: EXECUTION GATE (⛔ MANDATORY)

**Before proceeding to Phase 6, you MUST execute the actual system.**

Mocked tests passing is NOT evidence of GREEN. You must:

1. **Identify system type** (CLI, Web, API, Library, MCP Server, etc.)
2. **Execute the actual system** (not tests):
   - CLI: Run the binary/script with real arguments
   - API: Make real HTTP requests to running server
   - MCP Server: Start server, invoke tools via MCP protocol
   - Library: Import and call from REPL or throwaway script
3. **Capture execution evidence**:
   - Actual stdout/stderr from invocation
   - Real responses (not mocked)
   - Observable side effects

**EXECUTION EVIDENCE TEMPLATE**:
```markdown
## Phase 5 Execution Evidence

System type: [CLI | API | MCP | Library | ...]
Invocation command: `<exact command>`
Output:
```
<actual stdout/stderr>
```
Observable effect: [what changed in the real world]
```

⛔ **CONSTITUTIONAL VIOLATION**: Declaring GREEN or proceeding to Phase 6 without execution evidence.

**Anti-Pattern Detection**:
| Pattern | Why It's Wrong |
|---------|----------------|
| "Tests pass → GREEN" | Tests may use mocks, be skipped, or be theater |
| "Code exists → Done" | Code may not be invokable |
| "Audit passes → Ship" | Audit checks contracts, not actual functionality |
| "Import works → Runs" | Import ≠ execution |

---

## Phase 6: Final Audit (RALPH LOOP)

**Goal**: Verify constitutional compliance of the complete refactoring.

### Step 6.1: Comprehensive Audit

Invoke `/constitutional-audit` on:
- Contract files
- Test files
- Implementation files

### Step 6.2: Ralph Loop — Zero Violations

```
<promise>ZERO CONSTITUTIONAL VIOLATIONS</promise>
```

Loop:
1. Run constitutional-audit
2. If violations → run `/constitutional-fix`
3. Repeat until clean
4. Exit when: ZERO VIOLATIONS

---

## Integration Map

```
┌─────────────────────────────────────────────────────────┐
│              constitutional-refactor                     │
│                   (ORCHESTRATOR)                         │
└─────────────────────────────────────────────────────────┘
                         │
    ┌────────────────────┼────────────────────┐
    ↓                    ↓                    ↓
┌─────────┐      ┌──────────────┐      ┌─────────────┐
│req-elicit│      │ AI Panel     │      │constitutional│
│(Phase 1) │      │ (Phase 2)    │      │   -audit     │
│NO FORK   │      │ NO FORK      │      │ FORK         │
└─────────┘      └──────────────┘      └─────────────┘
                                              │
                         ┌────────────────────┤
                         ↓                    ↓
                 ┌──────────────┐      ┌─────────────┐
                 │ adversarial- │      │constitutional│
                 │ test-writer  │      │    -fix      │
                 │ FORK         │      │ RALPH LOOP   │
                 │ (Phase 4)    │      └─────────────┘
                 └──────────────┘
                         │
                         ↓
                 ┌──────────────┐
                 │ adversarial- │
                 │ coder        │
                 │ FORK         │
                 │ (Phase 5)    │
                 └──────────────┘
```

**Fork Isolation**:
- req-elicit: NO FORK (needs full user dialogue context)
- AI Panel: NO FORK (needs code context for critique)
- adversarial-test-writer: FORK (blind to implementation)
- adversarial-coder: FORK (blind to test source)
- constitutional-audit: FORK (external auditor identity)

---

## When to Use This Skill

| Situation | Use This Skill? |
|-----------|-----------------|
| Code has no contracts | YES |
| Tests exist but not contract-linked | YES |
| API change broke existing tests | YES — symptom of missing contracts |
| New feature in green field | NO — use req-elicit → TDD directly |
| Bug fix in contracted code | NO — use existing TDD workflow |
| "Make this code compliant" | YES |

---

## References

- `references/observation-techniques.md` — HOW to observe by system type (CLI, Web, API, etc.)
- `references/disconnect-matrix-template.md` — Full matrix template with examples
- `references/bridge-patterns.md` — Common bridge patterns (Feature Flag, Adapter, Strangler Fig, etc.)
- `references/ralph-promises.md` — Ralph loop exit conditions per phase

<!-- © 2024-2026 Ketema Harris. All rights reserved. SPDX-License-Identifier: LicenseRef-CCABDD-Proprietary -->
