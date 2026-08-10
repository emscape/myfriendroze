---
name: theater-test-detection
description: Detect and prevent theater tests in adversarial TDD. Use when reviewing test-writer output or auditing test quality for deterministic problems.
---

# Theater Test Detection

**Purpose**: Identify tests that create illusion of validation without verifying correctness

---

## DEFINITION

**Theater Test**: Test that passes when implementation is INCORRECT

**Core Question**: "Can implementation be wrong and test still pass?"
- **YES** → Theater test → REJECT
- **NO** → Genuine test → APPROVE

---

## CHARACTERISTICS (What to Look For)

### 1. Range Checks for Deterministic Values

**Theater**:
```rust
assert!(result > 0);  // Passes for ANY positive value
```

**Genuine**:
```rust
assert_eq!(result, 669171001);  // Passes ONLY for correct value
```

**Example from Euler #28**:
```fsharp
// THEATER (REJECTED)
Expect.isGreaterThan result 0  // 1001×1001 diagonal sum

// GENUINE (APPROVED)
Expect.equal result 669171001
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
```typescript
expect(typeof result).toBe('number');  // Any number passes
```

**Genuine**:
```typescript
expect(result).toBe(42);  // Only correct number passes
```

### 4. Trivial Assertions

**Theater**:
```java
assertTrue(1 + 1 > 0);  // Always true, validates nothing
```

**Genuine**:
```java
assertEquals(2, 1 + 1);  // Validates computation
```

### 5. Integration Bypass (Post-Construction Dependency Replacement)

**Theater**:
```python
pool = GlobalLanguageServerPool()
pool.timeout_manager = mock_timeout_manager  # Replaces AFTER construction — bypasses __init__ wiring
assert pool.timeout_manager.is_monitoring()  # Tests mock, not __init__ call
```

**Genuine**:
```python
pool = GlobalLanguageServerPool(timeout_manager=mock_timeout_manager)
assert pool.timeout_manager.is_monitoring()  # Verifies __init__ actually calls start_monitoring()
```

**Detection heuristic**: `object.dependency = mock` AFTER construction → suspect theater.

### 6. Component Isolation Masquerading as Integration

**Theater**:
```python
# Tests component directly — works fine, but doesn't test WIRING
timeout_manager = LSPTimeoutManager()
timeout_manager.start_monitoring()  # Direct call
assert timeout_manager._monitor_thread.is_alive()  # Component works!
# But does Pool.__init__ actually CALL start_monitoring()? Unknown.
```

**Genuine**:
```python
# Tests through parent lifecycle — verifies wiring
pool = GlobalLanguageServerPool()
assert pool.timeout_manager._monitor_thread.is_alive()  # Verifies __init__ → start_monitoring()
```

**Detection heuristic**: Test creates component standalone + calls method directly, instead of through parent lifecycle path → suspect theater for SEQ clauses.

---

## DETECTION METHODOLOGY

### Step 1: Identify Deterministic Problems

**Deterministic**: Same input → same output (always)
- Mathematical calculations
- Algorithm outputs
- Fixed transformations
- Example: Project Euler problems, sorting algorithms, cryptographic functions

**Non-Deterministic**: Output varies (acceptable for ranges)
- Random number generation
- Current timestamps
- External API responses

### Step 2: Apply Core Question

For each test in deterministic problem:

1. Read assertion
2. Ask: "Could implementation return WRONG value and test still pass?"
3. If YES → Theater test
4. If NO → Genuine test

### Step 3: Check for Exact Values

**Red Flags** (deterministic problems only):
- `>`, `<`, `>=`, `<=` comparisons (unless validating bounds)
- `isGreaterThan`, `isLessThan` expectations
- Range checks: `result > 0 && result < 1000`
- Approximations when exact value known

**Green Flags**:
- `==`, `===`, `assertEquals`, `Expect.equal`
- Exact value validation
- Precise comparisons

---

## REAL-WORLD EXAMPLES

### Example 1: Euler #28 (11×11 Grid)

**Context**: Mathematical formula for spiral diagonal sum

**Theater Test** (INITIAL - REJECTED):
```fsharp
test "1001x1001 grid computes Project Euler answer" {
    let result = calculateDiagonalSum 1001
    Expect.isGreaterThan result 0  // ❌ THEATER
    // Implementation could return 1, 100, 999999999 - all pass!
}
```

**Genuine Test** (CORRECTED - APPROVED):
```fsharp
test "1001x1001 grid must return exact Project Euler #28 answer" {
    let result = calculateDiagonalSum 1001
    Expect.equal result 669171001  // ✅ GENUINE
    // ONLY correct implementation passes
}
```

**Learning**: For deterministic math, exact value validation is non-negotiable.

### Example 2: Implementation Hints in Guidance

**Theater Pattern** (REJECTED):
```
Guidance: "Optimize algorithm. Diagonal pattern: Layer n has corners at positions..."
```
❌ Prescribes HOW (algorithm optimization, formula hints)

**Behavioral Pattern** (APPROVED):
```
Guidance: "For 11×11 grid, diagonal values must sum to exactly 961. Verify algorithm identifies correct positions."
```
✅ Describes WHAT (expected sum, behavioral validation)

---

## INTEGRATION WITH ADVERSARIAL TDD

### test-writer Responsibilities

Before submitting tests, self-audit:
1. For each deterministic problem: Validate exact values
2. Apply core question: "Can impl be wrong and test pass?"
3. If YES → Revise to genuine validation
4. Error message Point #5 (Guidance) = BEHAVIOR only

### Orchestrator Audit (Pre-Approval)

**Mandatory checklist**:
- [ ] All deterministic tests use exact values
- [ ] No range checks for fixed outputs
- [ ] Core question answered: "Can impl be wrong?" = NO for all tests
- [ ] Test guidance describes WHAT, not HOW
- [ ] No integration bypass (#5): Dependencies not replaced after construction
- [ ] No component isolation (#6): SEQ tests use lifecycle paths, not direct calls
- [ ] System-level: "Can a causal chain link be unwired and tests pass?" = NO

**Rejection Criteria**:
- ANY theater test for deterministic problem
- ANY implementation hints in guidance
- ANY integration bypass or component isolation theater

---

## FREQUENCY OF USE

**When to invoke this skill**:
- Reviewing test-writer output (M4.2 RED phase)
- Auditing test quality before approval
- Investigating test failures (is test or impl wrong?)
- Training new coordinators on test quality

**When NOT needed**:
- Non-deterministic problems (timestamps, randomness)
- Integration tests with external dependencies
- Property-based tests (ranges intentional)

---

## SUCCESS METRICS

**Evidence of Improvement**:
- **Before**: Euler #28 - 1 theater test, 3 implementation-aware guidances
- **After**: Target 0 theater tests escape to implementation

**Measurement**:
- Track test-writer revision rate
- Count theater tests caught in audit
- Monitor implementation-aware guidance occurrences

---

## CONSTITUTIONAL REFERENCE

**QS1 TDD/BDD**: "Theater Test Detection: Test must fail if implementation incorrect."

**Enforcement Level**: CONSTITUTIONAL VIOLATION if theater tests approved for deterministic problems

**Rationale**: Theater tests undermine TDD's forcing function - implementation could be wrong and tests green.

**Cross-Reference**: For comprehensive theater detection (spec-level, mock, contract, integration), see unified `~/.claude/skills/theater-detection/SKILL.md`.

<!-- © 2024-2026 Ketema Harris. All rights reserved. SPDX-License-Identifier: LicenseRef-CCABDD-Proprietary -->
