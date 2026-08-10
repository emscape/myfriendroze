---
name: constitutional-fix
description: |
  Fix constitutional violations via Ralph loop until ZERO VIOLATIONS.
  Use when: audit found violations, need to iterate until compliant,
  post-audit remediation required.
  Triggers: "fix violations", "constitutional fix", "remediate audit",
  "fix until zero violations"
allowed-tools:
  - Read
  - Write
  - Edit
  - Bash
  - TodoWrite
  - mcp__serena__*
  - mcp__ai-panel__*
---

# Constitutional Fix

Iterate until all constitutional violations are resolved.

## When to Use

After `/constitutional-audit` returns violations:
```
VERDICT: 3 VIOLATIONS FOUND
```

Invoke `/constitutional-fix` to enter remediation loop.

## How It Works

1. Creates Ralph loop state with promise: "ZERO CONSTITUTIONAL VIOLATIONS"
2. For each iteration:
   - Analyze remaining violations
   - Fix one or more violations
   - Run `/constitutional-audit`
   - If violations remain → loop continues
   - If zero violations → output promise → loop ends

## Workflow

```
/constitutional-fix
        ↓
┌─────────────────────────────────────┐
│  Create .claude/ralph-loop.local.md │
│  promise: ZERO CONSTITUTIONAL...    │
└─────────────────────────────────────┘
        ↓
┌─────────────────────────────────────┐
│  Iteration N:                       │
│  1. Read audit findings             │
│  2. Prioritize (CRITICAL first)     │
│  3. Fix violation(s)                │
│  4. Commit fix                      │
│  5. Run /constitutional-audit       │
│  6. If violations: continue loop    │
│  7. If zero: output promise         │
└─────────────────────────────────────┘
        ↓
┌─────────────────────────────────────┐
│  <promise>ZERO CONSTITUTIONAL       │
│  VIOLATIONS</promise>               │
│                                     │
│  Ralph loop detects → exits         │
└─────────────────────────────────────┘
```

## Setup State File

When invoked, create:

```markdown
---
iteration: 1
max_iterations: 10
completion_promise: "ZERO CONSTITUTIONAL VIOLATIONS"
---

## Constitutional Fix Loop

Fix all violations found by /constitutional-audit.

### Process per iteration:
1. Read current audit findings
2. Fix highest severity violation first
3. Commit with WHY/EXPECTED format
4. Re-run /constitutional-audit
5. If ZERO VIOLATIONS, output: <promise>ZERO CONSTITUTIONAL VIOLATIONS</promise>

### Violation Priority:
1. CRITICAL (CL violations)
2. HIGH (quality gate failures)
3. MEDIUM (style/pattern issues)

### Current Findings:
[Paste from last audit]
```

## Fix Patterns by Violation Type

**Reference**: See `/design-by-contract` skill → Contract Granularity Framework for tier definitions.

### CL12 Missing Contract
```python
# Add PRE/POST/INV/SEQ to docstring
def method():
    """
    PRE: [preconditions]
    POST: [postconditions]
    INV: [invariants]
    SEQ: [who must call whom, when — integration wiring]
         Source: [REQ-ID, CHAIN-ID, IP-ID]
    """
```

### CL12-E Missing Traceability

**Choose pattern based on tier** (see Contract Granularity Framework):

**Tier 1/2 - Direct Enforcement** (test directly validates a contract clause):
```python
def test_something():
    """Enforces: POST-1"""
    assert condition, "POST-1 violation: ..."
```

**Tier 3 - Implementation Test** (test enables a behavioral contract, doesn't enforce directly):
```swift
/// Tests for [Component] robustness
/// CONTRACT TRACEABILITY: POST-1 (enables [behavioral description])
///
/// These tests verify implementation-level details that ENABLE POST-1,
/// not a separate behavioral requirement.
func testImplementationDetail() {
    // POST-1 TRACEABILITY: If this fails, [consequence to behavioral contract]
    XCTAssertEqual(actual, expected)
}
```

**Decision Heuristic**:
- Client can observe difference → Tier 1/2 (direct enforcement)
- Only implementation observes → Tier 3 (CONTRACT TRACEABILITY)

### Theater Test
```python
# Replace vague assertion with specific
# BAD: assert result > 0
# GOOD: assert result == 42
```

### Integration Theater (#5 — Integration Bypass)
```python
# BAD: Replace dependency after construction
pool = Pool()
pool.timeout_manager = mock_tm  # Bypasses __init__ wiring

# GOOD: Inject via constructor
pool = Pool(timeout_manager=mock_tm)  # Tests __init__ path
```

### Integration Theater (#6 — Component Isolation)
```python
# BAD: Test component directly (misses wiring)
tm = TimeoutManager()
tm.start_monitoring()  # Direct — works fine but __init__ never calls this

# GOOD: Test through parent lifecycle
pool = Pool()
assert pool.timeout_manager._monitor_thread.is_alive()  # Via parent __init__
```

### Missing SEQ Clause
```python
# Add SEQ clause for each integration wiring obligation
"""
SEQ-1: __init__ MUST call timeout_manager.start_monitoring()
       Source: REQ-2026-005, CHAIN-1, IP-1
"""
# Then add corresponding test that uses lifecycle path
```

### CL10 Unverified Mock
```python
# Create contract file
# contracts/dependency.contract.py

# Derive mock from contract
# tests/mocks/dependency_mock.py
```

## Infinite Loop Prevention

**Commit before re-audit rule**:
- Each fix MUST be committed before re-running audit
- Prevents "fix in memory, audit old code" loop
- Commit hash proves fix was applied

```bash
# Fix violation
# ... edit files ...

# Commit (required before audit)
git add -A
git commit -m "WHY: Fix CL12 violation in auth module
EXPECTED: Contract now specifies POST conditions"

# Now audit will see the fix
/constitutional-audit HEAD
```

## Completion

When audit returns:
```
VERDICT: ZERO CONSTITUTIONAL VIOLATIONS
```

Output the promise:
```
<promise>ZERO CONSTITUTIONAL VIOLATIONS</promise>
```

Ralph loop Stop hook detects this and ends the loop.

## Integration

```
/constitutional-audit → VIOLATIONS FOUND
        ↓
/constitutional-fix → Ralph loop
        ↓
[iterations until zero]
        ↓
VERDICT: ZERO CONSTITUTIONAL VIOLATIONS
        ↓
<promise>ZERO CONSTITUTIONAL VIOLATIONS</promise>
        ↓
Loop ends
```

<!-- © 2024-2026 Ketema Harris. All rights reserved. SPDX-License-Identifier: LicenseRef-CCABDD-Proprietary -->
