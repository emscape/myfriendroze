# Ralph Loop Promises

Deterministic exit conditions for each iterative phase of Constitutional Refactoring.

## What is a Ralph Loop?

A Ralph-Wiggum loop is an iterative refinement cycle with a **deterministic exit condition** (the Promise). The loop continues until the Promise is satisfied—no shortcuts, no "good enough."

```
┌─────────────────────────────────────────┐
│            RALPH LOOP                    │
│                                          │
│   ┌──────────┐                          │
│   │ Execute  │◄─────────────┐           │
│   └────┬─────┘              │           │
│        │                    │           │
│        ▼                    │           │
│   ┌──────────┐         ┌────┴────┐      │
│   │ Check    │──NO────►│  Fix    │      │
│   │ Promise  │         │         │      │
│   └────┬─────┘         └─────────┘      │
│        │                                 │
│       YES                                │
│        │                                 │
│        ▼                                 │
│   ┌──────────┐                          │
│   │  EXIT    │                          │
│   └──────────┘                          │
│                                          │
└─────────────────────────────────────────┘
```

---

## Phase 3: Contract Generation

**Promise**:
```
<promise>ALL behaviors in DISCONNECT MATRIX have CL12-compliant contracts</promise>
```

**Verification**:
```bash
# Run constitutional-audit on contract files
/constitutional-audit contracts/[component]_contract.py

# Expected output for exit:
VERDICT: ZERO CONSTITUTIONAL VIOLATIONS
```

**Loop Actions**:

| Check Result | Action |
|--------------|--------|
| Missing PRE for behavior | Add PRE-[ID]-NN clause |
| Missing POST for behavior | Add POST-[ID]-NN clause |
| Missing INV for REMOVE row | Add INV-[ID]-NN clause |
| Type-as-contract violation | Rewrite with behavioral spec |
| Theater contract detected | Add measurable criteria |

**Exit Criteria**:
- [ ] Every DISCONNECT MATRIX row has corresponding contract clause
- [ ] All contracts have PRE/POST/INV (not just types)
- [ ] constitutional-audit returns ZERO VIOLATIONS
- [ ] No theater contracts (vague or type-only specs)

---

## Phase 4: RED (Genuine Failing Tests)

**Promise**:
```
<promise>ALL contracts have failing tests with 5-point error messages</promise>
```

**Verification**:
```bash
# Run tests and verify they fail appropriately
pytest tests/test_[component]_contract.py -v

# Expected: All tests FAIL (RED phase)
# Each failure has 5-point error message

# Theater detection
/theater-detection tests/test_[component]_contract.py

# Expected: ZERO theater tests
```

**Loop Actions**:

| Check Result | Action |
|--------------|--------|
| Test passes (should fail) | Test is theater → rewrite |
| Missing contract coverage | Add test for uncovered clause |
| Theater test detected | Rewrite with exact values |
| Error message incomplete | Add missing 5-point components |
| Test reads implementation | Invoke adversarial-test-writer (fork) |

**5-Point Error Message Standard**:
```python
assert result == expected, (
    f"test_name FAILED | "              # 1. What failed
    f"POST-B01-01 violated | "          # 2. Why (contract clause)
    f"Expected: {expected} | "          # 3. Expected
    f"Actual: {result} | "              # 4. Actual
    f"Guidance: [behavioral hint]"      # 5. WHAT not HOW
)
```

**Exit Criteria**:
- [ ] Every contract clause has at least one test
- [ ] All tests currently FAIL (implementation demolished)
- [ ] Error messages have all 5 points
- [ ] theater-detection returns ZERO theater tests
- [ ] Tests written BLIND to implementation (fork-isolated)

---

## Phase 5: GREEN (Passing Implementation)

**Promise**:
```
<promise>ALL tests pass</promise>
```

**Verification**:
```bash
# Run full test suite
pytest tests/test_[component]_contract.py -v

# Expected: ALL tests PASS
# 0 failures, 0 errors
```

**Loop Actions**:

| Check Result | Action |
|--------------|--------|
| Test fails with clear message | Implement per error guidance |
| Test fails with unclear message | Return to Phase 4, fix test |
| Implementation reads test source | Invoke adversarial-coder (fork) |
| Multiple failures | Focus on one at a time |
| Flaky test | Fix test, not implementation |

**Exit Criteria**:
- [ ] ALL tests pass (0 failures)
- [ ] Implementation written BLIND to test source (fork-isolated)
- [ ] No YAGNI violations (minimal implementation)
- [ ] DRY compliance (uses existing utilities)

---

## Phase 6: Final Audit

**Promise**:
```
<promise>ZERO CONSTITUTIONAL VIOLATIONS</promise>
```

**Verification**:
```bash
# Full audit on all artifacts
/constitutional-audit \
  contracts/[component]_contract.py \
  tests/test_[component]_contract.py \
  src/[component].py

# Expected:
VERDICT: ZERO CONSTITUTIONAL VIOLATIONS
```

**Loop Actions**:

| Check Result | Action |
|--------------|--------|
| CL12 violation (missing contract) | Add PRE/POST/INV to method |
| CL12-E violation (untraceable test) | Add contract clause reference |
| Theater test found | Rewrite with exact assertions |
| Mock theater found | Verify mock against contract |
| Implementation drift | Realign with contract |

**Audit Checklist**:
- [ ] All public methods have PRE/POST/INV in docstrings
- [ ] All tests trace to specific contract clauses
- [ ] No theater tests (can fail if impl wrong)
- [ ] No theater mocks (verified against real provider)
- [ ] No undeclared side effects
- [ ] Error handling matches ERRORS clauses

**Exit Criteria**:
- [ ] constitutional-audit returns ZERO VIOLATIONS
- [ ] All checklist items verified
- [ ] Ready for merge to main branch

---

## Promise Hierarchy

Phases must complete in order. Each promise depends on the previous:

```
Phase 3 Promise (Contracts exist)
    │
    └──► Phase 4 Promise (Tests exist, fail appropriately)
            │
            └──► Phase 5 Promise (Implementation passes tests)
                    │
                    └──► Phase 6 Promise (Everything compliant)
```

**Cannot Skip**: Each phase's promise is a prerequisite for the next.

---

## Escalation

If a loop exceeds 5 iterations without satisfying the Promise:

1. **STOP** - Something is fundamentally wrong
2. **Analyze** - Why isn't the Promise achievable?
3. **Escalate to User** - Present findings, ask for guidance:
   - Is the contract incorrect?
   - Is the test invalid?
   - Is the requirement impossible?
4. **Revise** - Update earlier phase artifacts if needed
5. **Resume** - Continue loop with corrections

**Common Escalation Causes**:

| Symptom | Likely Cause | Resolution |
|---------|--------------|------------|
| Contract can't be satisfied | EXPECTED was wrong | Return to req-elicit |
| Tests can't fail appropriately | Theater test design | Rewrite tests from scratch |
| Implementation can't pass | Conflicting requirements | Clarify with user |
| Audit keeps finding issues | Fundamental misunderstanding | Return to Phase 1 |
