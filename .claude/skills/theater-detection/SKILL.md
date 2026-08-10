---
name: theater-detection
description: |
  Unified detection of theater tests, theater mocks, theater contracts,
  and spec-level theater (incomplete requirements). Use when auditing test quality,
  reviewing contracts, validating mock derivation, or evaluating requirements
  for integration completeness.
  Triggers: "theater detection", "theater test", "theater mock", "theater contract",
  "can mocks satisfy this requirement", "integration theater", "spec-level theater"
---

# Theater Detection

**Purpose**: Identify artifacts that create an illusion of correctness without providing genuine validation

---

## UNIFIED FRAMEWORK

"Theater" = artifact that passes when implementation is INCORRECT

| Artifact Type | Core Question | Theater If |
|--------------|---------------|------------|
| **Requirement** | "Can we satisfy this requirement with ALL components mocked?" | YES |
| **Test** | "Can implementation be wrong and test pass?" | YES |
| **Mock** | "Can mock behave differently from real provider and test pass?" | YES |
| **Contract** | "Can implementation return wrong data and contract be satisfied?" | YES |

**Universal Detection Pattern**:
1. Identify artifact type (requirement, test, mock, contract)
2. Apply corresponding core question
3. If answer is YES → **THEATER** → REJECT
4. If answer is NO → **GENUINE** → APPROVE

**Detection Ordering** (earliest catches prevent downstream theater):
```
PART 0: Spec-Level (requirements) → catches before contracts exist
PART 1: Test-Level → catches before implementation exists
PART 2: Mock-Level → catches mock derivation issues
PART 3: Contract-Level → catches vague specifications
```

---

# PART 0: SPEC-LEVEL THEATER DETECTION (Requirements)

## Definition

**Spec-Level Theater**: Requirement that can be satisfied with ALL components mocked —
meaning it captures the end-state but not the integration path that achieves it.

**Core Question**: "Can we satisfy this requirement with ALL components mocked?"

If YES → The requirement only captures the end-state, not the path. It is **incomplete**.
Mocks can fake end-states. Mocks cannot fake call sequences.

---

## Why This Is the PRIMARY Detection Layer

Traditional theater detection operates at test level (PART 1) or mock level (PART 2).
By then, the damage is done — contracts derived from incomplete requirements will also
be incomplete, and tests derived from those contracts will also miss the integration path.

**Spec-level theater catches incompleteness at the source — before contracts or tests exist.**

**Philosophical basis**: For integration, the HOW IS the WHAT. Meyer's "WHAT, not HOW"
applies to component contracts. Integration contracts specify the calling path because
the path IS the behavior. "Pool.__init__ calls start_monitoring()" is not an implementation
detail — it is an architectural obligation.

---

## Detection Methodology

### Step 1: Apply the Mock Test to Every Requirement

For each end-state requirement in the manifest:

```
"Can we satisfy '[requirement]' with ALL components mocked?"

If YES → Requirement captures end-state only, not integration path
         → ADD sequencing specs (SEQ clauses) from /req-elicit Phase 2.5
         → Requirement is INCOMPLETE until integration path is specified

If NO  → Requirement includes enough integration specificity
         → APPROVE
```

### Step 2: Evaluate Using the Mockability Matrix

| Requirement | Mockable? | Diagnosis | Fix |
|-------------|-----------|-----------|-----|
| "LSPs reclaimed after idle timeout" | YES — mock timer to say "reclaimed" | End-state only, no path | Add SEQ: who starts timer, who triggers reclaim |
| "Pool.__init__ MUST call start_monitoring()" | NO — either __init__ calls it or doesn't | Integration path specified | Sufficient |
| "Disconnect triggers pool.release() for all refs" | NO — either the call chain exists or doesn't | Integration path specified | Sufficient |
| "Session cleanup completes successfully" | YES — mock cleanup to return success | End-state only | Add SEQ: who triggers cleanup, what methods called |

### Step 3: Trace Causal Chains

For each mockable requirement, use **Reverse Chain Walking** (from /req-elicit Phase 2.5):

```
Walk backward from end-state to external trigger:
1. [End state] — What DIRECTLY causes this?
2. [That cause] — What DIRECTLY triggers it?
3. Continue until reaching the EXTERNAL TRIGGER

Every link is a potential wiring failure point.
Every link needs a SEQ clause in the contract.
```

---

## System-Level Theater Detection Question

After all individual requirements pass the mock test, ask the system-level question:

> **"Can a link in any causal chain be UNWIRED and all tests still pass?"**

If YES → There exists an integration gap that no current test covers.
The chain has a link that, if missing, would not be detected.

This is the **ultimate theater detection question** — it tests the entire system's
integration coverage, not just individual requirements.

### Evidence from Real Failures

**Bug 1**: `GlobalLanguageServerPool.__init__` never called `start_monitoring()`.
- All component tests passed (start_monitoring works when called directly)
- Integration was unwired — __init__ simply never made the call
- System-level question would catch: "Can __init__ skip start_monitoring() and tests pass?" → YES → THEATER

**Bug 2**: `on_transport_session_closed()` never called `pool.release()`.
- Session unbind test passed (unbind_session works correctly)
- Integration was unwired — close callback only did unbind, not release
- System-level question would catch: "Can close skip pool.release() and tests pass?" → YES → THEATER

---

## When to Apply

**MANDATORY** (earliest possible — before any other theater detection):
- /req-elicit Phase 5 (before generating REQUIREMENT_MANIFEST.md)
- Before /design-by-contract (requirements must be integration-complete)
- When reviewing existing requirements for completeness

**Integration with CCABDD Pipeline**:
```
/req-elicit → Phase 5: Spec-Level Theater Detection (THIS)
    ↓ Only integration-complete requirements proceed
/design-by-contract → SEQ clauses for every Integration Point
    ↓ Pre-test gate: every IP has a SEQ clause
/adversarial-test-writer → Tests enforce SEQ clauses via actual lifecycle paths
    ↓
PART 1-3 theater detection (test, mock, contract level)
```

---

# PART 1: THEATER TEST DETECTION

## Definition

**Theater Test**: Test that passes when implementation is INCORRECT

**Core Question**: "Can implementation be wrong and test still pass?"

---

## Characteristics

### 1. Range Checks for Deterministic Values

**Theater**:
```python
assert result > 0  # Passes for ANY positive value
```

**Genuine**:
```python
assert result == 669171001  # Passes ONLY for correct value
```

### 2. Existence Checks

**Theater**:
```python
assert result is not None  # Checks existence, not correctness
```

**Genuine**:
```python
assert result == expected_value  # Checks correctness
```

### 3. Type Checks

**Theater**:
```python
assert isinstance(result, dict)  # Any dict passes
```

**Genuine**:
```python
assert result == {"sessions": [], "total_count": 0}  # Correct structure
```

### 4. Mock Wiring Only

**Theater**:
```python
assert mock.called  # Verifies wiring, not behavior
```

**Genuine**:
```python
mock.assert_called_with(expected_arg)
assert result == expected_side_effect
```

### 5. Integration Bypass (Mock Injection After Construction)

**Theater**:
```python
# Creates object, then REPLACES dependency after construction
pool = GlobalLanguageServerPool()
pool.timeout_manager = mock_timeout_manager  # Bypasses __init__ wiring
# Test passes, but __init__ never called start_monitoring() on real dependency
```

**Genuine**:
```python
# Tests through actual construction path
pool = GlobalLanguageServerPool(timeout_manager=mock_timeout_manager)
assert pool.timeout_manager.is_monitoring()  # Verifies __init__ wiring
```

**Why this is theater**: Replacing a dependency after construction bypasses any
wiring that `__init__` is supposed to perform. The test verifies component behavior
in an impossible runtime state — the object was never properly initialized with
the test's mock.

**Detection heuristic**: If test creates an object, then assigns to an attribute
that was already set by `__init__`, the test is bypassing construction wiring.

### 6. Component Isolation Masquerading as Integration

**Theater**:
```python
# Tests component method directly, calling it standalone
timeout_manager = LSPTimeoutManager()
timeout_manager.start_monitoring()  # Direct call — works fine
assert timeout_manager._monitor_thread.is_alive()
# But does __init__ of the PARENT object actually call start_monitoring()?
```

**Genuine**:
```python
# Tests through integration path (parent __init__ → component method)
pool = GlobalLanguageServerPool()  # __init__ should call start_monitoring()
assert pool.timeout_manager._monitor_thread.is_alive()  # Verify via parent
```

**Why this is theater**: The test proves the component works when called directly.
It does NOT prove the component is called at all in the integration path.
Every component in a theater system works perfectly — they're just not wired together.

**Detection heuristic**: If a test calls a method directly that should be called
by a parent/owner during lifecycle events (init, cleanup, error recovery), the
test is verifying the component, not the integration.

---

## Detection Methodology

### Step 1: Identify Deterministic Problems

**Deterministic**: Same input → same output (always)
- Mathematical calculations
- Algorithm outputs
- Fixed transformations

**Non-Deterministic**: Output varies (ranges acceptable)
- Random generation
- Timestamps
- External API responses

### Step 2: Apply Core Question

For each assertion in deterministic test:
1. Read assertion
2. Ask: "Could implementation return WRONG value and test still pass?"
3. If YES → Theater test → REJECT
4. If NO → Genuine test → APPROVE

### Step 3: Check for Exact Values

**Red Flags** (deterministic problems):
- `>`, `<`, `>=`, `<=` comparisons
- `isGreaterThan`, `isLessThan`
- Range checks: `0 < result < 1000`
- `is not None` (existence only)

**Green Flags**:
- `==`, `===`, `assertEquals`
- `assert_called_with(exact_args)`
- Exact structure validation

---

# PART 2: MOCK THEATER DETECTION

## Definition

**Mock Theater**: Mock behaves differently from real provider; tests pass, production fails

**Core Question**: "Can this mock behave differently from real provider and tests still pass?"

---

## The orphaned_at Lesson

Tests mocked `psycopg2.connect` and assumed `orphaned_at` column existed.
Migration documented but never created.
**Tests passed. Production failed.**

Root cause: Mock invented database schema instead of deriving from verified contract.

---

## Anti-Patterns (REJECT if found)

- [ ] Hand-written mock that invents return values without contract
- [ ] Mock that assumes database column exists (MUST verify via contract)
- [ ] Mock that assumes API response format (MUST verify via contract)
- [ ] Copying mock from another test without verifying contract applicability
- [ ] Mock that doesn't enforce preconditions
- [ ] Mock return values not derived from contract postconditions
- [ ] Mock that ignores error conditions

## Valid Patterns (ACCEPT)

- [ ] Mock derived from verified contract file
- [ ] Contract verification test passes in CI
- [ ] Mock enforces same preconditions as real provider
- [ ] Test docstring references contract file
- [ ] Mock raises same exceptions for invalid input

---

## Mock Derivation Requirements

```python
# tests/mocks/database_mock.py
"""
Mock derived from: contracts/database.contract.py
Contract verified: 2025-01-12, CI run #1234

DO NOT hand-write return values. Derive from contract.
"""
from contracts.database import SCHEMA, EXPECTED_ERRORS

def create_mock():
    # Enforce preconditions FROM CONTRACT
    # Simulate postconditions FROM CONTRACT
    # Raise errors FROM CONTRACT
    pass
```

---

# PART 3: THEATER CONTRACT DETECTION (CL12)

## Definition

**Theater Contract**: Contract that specifies only types, not behavior

**Core Question**: "Can implementation return wrong data and contract still be satisfied?"

---

## Characteristics

### 1. Type-Only Specification

**Theater**:
```python
"""
POST: Returns dict
"""
```

**Genuine**:
```python
"""
POST: Returns dict with exactly keys "sessions" (list) and "total_count" (int)
POST: total_count == len(sessions)
"""
```

### 2. Missing PRE/POST/INV

**Theater**:
```python
def get_session(self, id: str) -> Session | None:
    """Get a session."""  # NO CONTRACT
```

**Genuine**:
```python
def get_session(self, id: str) -> Session | None:
    """
    Retrieve session by identifier.

    PRE: id is non-empty string
    POST: Returns Session if id exists in registry, None otherwise
    INV: Registry state unchanged
    """
```

### 3. Vague Postconditions

**Theater**:
```python
"""
POST: Returns session information
"""
```

**Genuine**:
```python
"""
POST: Returns dict with keys: session_id (str), workspace_root (str),
      project_name (str), connected_at (ISO8601), activation_source (str)
"""
```

---

## Detection Methodology

### Step 1: Check Structure

- [ ] PRE: present (at least one, or explicit "none")
- [ ] POST: present (at least one)
- [ ] INV: present (or explicitly "none")

### Step 2: Apply Core Question

For each POST condition:
1. Read specification
2. Ask: "Could implementation return WRONG data and POST still be satisfied?"
3. If YES → Theater contract → REJECT
4. If NO → Genuine contract → APPROVE

### Step 3: Verify Specificity

**Red Flags**:
- "Returns dict" (no key specification)
- "Returns result" (no structure specification)
- "Modifies state" (no specific state named)
- Missing exact values for deterministic operations

**Green Flags**:
- "Returns dict with exactly keys A, B, C"
- "Returns list of length N where each element has..."
- "Increments counter X by 1"
- "Sets field Y to value Z"

---

## Strict Constructionism Audit

For each implementation, verify:
1. Every action is declared in PRE/POST/INV
2. No undeclared side-effects
3. No undeclared state mutations
4. No undeclared return variations

**Audit Template**:
```python
# Contract declares:
"""
POST: Creates Session
POST: Registers in _sessions dict
"""

# Implementation audit:
# ✅ self._sessions[id] = session  → Declared
# ❌ logger.info(...)              → NOT declared → VIOLATION
# ❌ metrics.increment(...)        → NOT declared → VIOLATION
```

---

# UNIFIED CHECKLIST

## Pre-Approval Audit

### Spec-Level Theater Check (PART 0 — Apply FIRST)
- [ ] Every end-state requirement tested with mock question: "Can mocks satisfy this?" = NO
- [ ] Every mockable requirement has corresponding SEQ clauses in contract
- [ ] Every causal chain enumerated with specific caller.method at each link
- [ ] System-level question: "Can any chain link be unwired and all tests pass?" = NO
- [ ] Integration Points Checklist complete (from /req-elicit Phase 2.5)

### Theater Test Check (PART 1)
- [ ] All deterministic tests use exact values
- [ ] No range checks for fixed outputs
- [ ] No mock injection after construction (Characteristic #5)
- [ ] No component isolation masquerading as integration (Characteristic #6)
- [ ] SEQ clause tests use actual lifecycle paths, not direct method calls
- [ ] Core question: "Can impl be wrong and test pass?" = NO for all

### Mock Theater Check (PART 2)
- [ ] All mocks derived from contract files
- [ ] Contract verification tests exist and pass
- [ ] No hand-written mock values

### Theater Contract Check (PART 3)
- [ ] All public methods have PRE/POST/INV
- [ ] All integration points have SEQ clauses
- [ ] POST conditions specify exact structure (keys, types, constraints)
- [ ] Core question: "Can impl return wrong data and contract satisfied?" = NO

---

## Evidence Recording

```
THEATER DETECTION AUDIT:

Spec-Level (PART 0):
- REQ:"LSPs reclaimed after timeout": THEATER → mockable end-state, no SEQ path
- REQ:"Pool.__init__ calls start_monitoring()": GENUINE → cannot be mocked
- SYSTEM: "Can chain link be unwired and tests pass?" = YES → 2 gaps found

Tests (PART 1):
- T:module::test_name: GENUINE (exact value assertion)
- T:module::test_range: THEATER → REJECTED (range check for deterministic)
- T:test_release_starts_idle_timer: THEATER → #5 integration bypass (mock injected after construction)
- T:test_start_monitoring_creates_daemon: THEATER → #6 component isolation (direct call, not via __init__)

Mocks (PART 2):
- M:database_mock: VERIFIED (contracts/database.contract.py, CI #1234)
- M:api_mock: THEATER → REJECTED (hand-written values)

Contracts (PART 3):
- C:SessionRegistry.get_session: GENUINE (POST specifies exact keys)
- C:Pool.get_stats: THEATER → REJECTED (POST says "returns dict" only)
- C:Pool.__init__: INCOMPLETE → missing SEQ clause for start_monitoring()
```

---

## Constitutional Reference

| Law | Theater Type | Violation Level |
|-----|-------------|-----------------|
| CL12/REQ | Spec-Level Theater (incomplete requirement) | CONSTITUTIONAL VIOLATION |
| QS1 | Theater Test | CONSTITUTIONAL VIOLATION |
| QS1 | Integration Bypass (#5) | CONSTITUTIONAL VIOLATION |
| QS1 | Component Isolation Masquerading (#6) | CONSTITUTIONAL VIOLATION |
| CL10 | Mock Theater | CONSTITUTIONAL VIOLATION |
| CL12 | Theater Contract | CONSTITUTIONAL VIOLATION |
| CL12 | Missing SEQ clause for integration point | CRITICAL VIOLATION |

**Enforcement**: Any theater artifact approved for deterministic problems = CONSTITUTIONAL VIOLATION

**Integration with CCABDD Pipeline**:
- Spec-level theater detection applies during /req-elicit Phase 5
- SEQ clause completeness verified during /design-by-contract pre-test gate
- Test-level theater detection applies during M4.2 RED phase review
- System-level question ("Can chain link be unwired?") applies during M4.4.5 audit

---

## Tier 3 Implementation Tests (NOT Theater)

**Reference**: See `/design-by-contract` skill → Contract Granularity Framework.

**Important Distinction**: Tier 3 implementation tests with CONTRACT TRACEABILITY headers are **NOT theater**. They:
- Verify implementation details that ENABLE behavioral contracts
- Use `CONTRACT TRACEABILITY: POST-1 (enables ...)` format
- Trace to the behavioral contract they support

**Example (Valid Tier 3)**:
```swift
/// CONTRACT TRACEABILITY: POST-1 (enables token storage)
/// Tests MCP JWT parsing compatibility
func testEmailVerifiedOptional() { ... }
```

**Detection**: Test is theater if it lacks BOTH direct enforcement (`Enforces: POST-1`) AND tier 3 traceability (`CONTRACT TRACEABILITY: POST-1`).

---

## When to Invoke This Skill

**MANDATORY**:
- /req-elicit Phase 5 (spec-level theater detection — PART 0)
- /design-by-contract pre-test gate (SEQ clause completeness)
- M4.2 RED phase (reviewing test-writer output — PARTS 1-3)
- M4.4.5 Constitutional audit (system-level theater question)
- Any mock introduction
- Any new public method contract
- Any new integration point between components

**OPTIONAL**:
- Debugging test failures (check for #5/#6 characteristics)
- Investigating production bugs (check for spec-level incompleteness)
- Training on test quality
- Reviewing existing requirements for integration gaps

<!-- © 2024-2026 Ketema Harris. All rights reserved. SPDX-License-Identifier: LicenseRef-CCABDD-Proprietary -->
