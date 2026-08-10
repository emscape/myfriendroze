---
name: cl12-examples
description: |
  Design by Contract (CL12) examples and templates for PRE/POST/INV patterns.
  Use when: (1) Writing new contracts for public methods, (2) Reviewing contracts for compliance,
  (3) Auditing test-contract traceability, (4) Implementing runtime verification,
  (5) Distinguishing type hints from behavioral contracts.
  Triggers: "write contract", "CL12 example", "PRE/POST/INV", "type vs contract",
  "strict constructionism", "contract violation", "test traceability".
---

# CL12 Design by Contract Examples

Quick reference for PRE/POST/INV patterns. Extended patterns in `references/` directory.

## Canonical Contract Format

```python
def method_name(self, param: Type) -> ReturnType:
    """
    One-line description.

    PRE: param conditions (inputs must satisfy)
    POST: return/state conditions (outputs guaranteed)
    INV: invariants maintained (unchanged throughout)
    SEQ: who must call whom, when (integration wiring obligations)
         Source: REQ-ID, CHAIN-ID, IP-ID
    ERRORS: exceptions raised and when (MANDATORY)
    """
```

## Type vs Contract (CRITICAL)

| Aspect | Type Hint | Behavioral Contract |
|--------|-----------|---------------------|
| Example | `-> Session \| None` | `POST: Returns Session if exists, None otherwise` |
| Specifies | STRUCTURE | BEHAVIOR |
| Sufficient? | NO | YES |

**VIOLATION**: Treating type hints as contracts. `-> dict` is structure; `POST: Returns dict with exactly keys "a", "b"` is behavior.

## INV Checklist (5-Point - MANDATORY)

Before claiming contract complete, verify ALL five INV dimensions:

1. **State Invariance**: What state MUST NOT change?
   - "INV: Registry state unchanged"
   - "INV: _active_project unchanged"

2. **Side Effect Prohibition**: What external mutations are forbidden?
   - "INV: No logging, no metrics, no I/O unless declared"
   - "INV: No database writes"

3. **Ordering Constraints**: What sequence rules must hold?
   - "INV: Lock held during operation"
   - "INV: Cannot be called before init()"

4. **Resource Invariants**: What resources must remain properly managed?
   - "INV: No unclosed handles"
   - "INV: Memory allocation unchanged"

5. **Exception Safety**: Do invariants hold on error paths?
   - "INV: On error, state rolled back to pre-call"
   - "INV: Exception does not leak resources"

## Observable Enforcement (CL12-A - MANDATORY)

"Caller MUST X" without enforcement = VIOLATION. Use enforcement mechanisms:

| Mechanism | When to Use | Detection Method |
|-----------|-------------|------------------|
| **Decorator** | Wrap all entry points | Registration rejects undecorated |
| **Gate** | Block invalid registration | Startup validation fails |
| **Threshold** | Detect bypass after-the-fact | `(now - last_X) > THRESHOLD` |
| **Audit Hook** | Log violations for analysis | Log level ERROR on detect |

**Test**: "Can caller bypass contract silently?" If YES → Add enforcement mechanism.

See `references/anti-patterns.md` Anti-Pattern 10 for examples.

## Contract Completeness Verification (MANDATORY)

Before claiming CL12 compliance, verify ALL items:

- [ ] Every public method/function has PRE/POST/INV/ERRORS (NO EXCEPTIONS)
- [ ] All helper functions are contracted if public, regardless of side effects
- [ ] Contract covers ALL observable behaviors
- [ ] No implementation behavior outside contract
- [ ] All INV dimensions addressed (5-point checklist)
- [ ] SEQ clauses exist for every integration point (wiring obligations)
- [ ] Theater contract check: "Can impl violate contract and tests pass?" = NO
- [ ] System-level theater: "Can a causal chain link be unwired and tests pass?" = NO
- [ ] Every test traces to specific contract clause including SEQ-N (CL12-E)
- [ ] "Caller MUST" has enforcement mechanism (CL12-A)
- [ ] "Never raises" backed by try/except (CL12-D)
- [ ] No PRE/INV/ERRORS contradictions (CL12-B)
- [ ] Single authoritative source per domain (CL12-C)

## Strict Constructionism

Implementation SHALL perform ONLY declared behaviors:

```python
# Contract says:
"""
POST: Creates Session bound to workspace
POST: Session registered in _sessions dict
"""

# Implementation audit:
self._sessions[id] = session  # ✓ Declared in POST
logger.info(f"Created {id}")  # ✗ NOT in contract → VIOLATION
metrics.increment("sessions") # ✗ NOT in contract → VIOLATION
```

**Fix**: Add to POST or remove from implementation.

## Test-Contract Traceability

Every test assertion traces to PRE/POST/INV:

```python
def test_overview_structure():
    """
    Contract: Registry.get_overview()
    Enforces: POST: Returns dict with exactly "sessions", "total_count"
    """
    result = registry.get_overview()

    # POST: exactly two keys
    assert set(result.keys()) == {"sessions", "total_count"}, \
        "POST violation: unexpected keys (Strict Constructionism)"

    # POST: total_count == len(sessions)
    assert result["total_count"] == len(result["sessions"]), \
        "POST violation: total_count != len(sessions)"
```

## Empty-Set Clause References (CL12-E Addendum)

When a contract section is intentionally empty, use these canonical patterns:

| Section | Empty Pattern | TEST_CASES Reference | Meaning |
|---------|---------------|---------------------|---------|
| PRE | `PRE: None` | `"contract": "PRE: None"` | No preconditions |
| POST | (never empty) | N/A | Must have ≥1 postcondition |
| INV | (never empty) | N/A | Must have 5-point checklist |
| ERRORS | `ERRORS: None` | `"contract": "ERRORS: None"` | Never raises |

**Traceability Rule**: `ERRORS: None` is a valid clause reference for tests asserting
"no exception raised." Do NOT fabricate `ERRORS-1: None` - there is no first error.

**INV Checklist Item References (CL12-E Addendum)**:
Method-level 5-point INV checklist items are valid canonical identifiers using format:
- `INV (State Invariance)` - references checklist item #1
- `INV (Side Effect Prohibition)` - references checklist item #2
- `INV (Ordering Constraints)` - references checklist item #3
- `INV (Resource Invariants)` - references checklist item #4
- `INV (Exception Safety)` - references checklist item #5

**Test Pattern for INV Checklist Items**:
```python
def test_exception_safety_unbinds():
    """
    Contract: activate_session_project()
    Enforces: INV (Exception Safety): On error, unbind session and clear ContextVar
    """
    # Verify cleanup on error path
```

**Test Pattern for ERRORS: None**:
```python
def test_errors_none_never_raises():
    """
    Contract: deactivate_session()
    Enforces: ERRORS: None (never raises, idempotent)
    """
    # No exception expected - test passes if no raise
    registry.deactivate_session("nonexistent-id")  # Should not raise
```

## Modular Contract Structure

One contract per domain, independently testable:

```
contracts/
├── session_context_contract.py      # SessionContext PRE/POST/INV
├── session_cleanup_contract.py      # Cleanup behavior specs
├── session_creation_trigger_contract.py  # When sessions created
├── path_validation_contract.py      # Path boundary enforcement
├── backward_compat_contract.py      # Legacy API guarantees
├── mcp_factory_activation_contract.py    # MCP factory behavior
└── contract_index.py               # SINGLE authoritative import + audit
```

Each contract file has `test_<contract>_verification.py`.

**Authority Rule (MANDATORY)**:
- Exactly ONE authoritative source for a domain.
- If a contract index exists, it is the sole authoritative entrypoint.
- Any monolithic contract file must be explicitly deprecated or removed.

## Theater Contract Detection

Ask: "Can implementation violate contract and tests still pass?"

**Theater Contract** (REJECT):
```python
"""POST: Returns dict"""  # Too vague - any dict satisfies
```

**Genuine Contract** (ACCEPT):
```python
"""POST: Returns dict with exactly keys "sessions", "total_count"
         where sessions is list of SessionContext, total_count is int"""
```

## Contract Granularity Framework

**Reference**: See `/design-by-contract` skill → Contract Granularity Framework for full tier definitions.

**Summary**: Not everything needs a contract:

| Tier | Scope | Test Pattern |
|------|-------|--------------|
| **1. Behavioral** | Module boundary state changes | `"""Enforces: POST-1"""` |
| **1.5 Integration** | Wiring obligations between components (SEQ) | `"""Enforces: SEQ-1"""` — MUST use lifecycle paths |
| **2. Structural** | External API data formats | `"""Enforces: POST-1"""` |
| **3. Implementation** | Internal parsing, field optionality | `"""CONTRACT TRACEABILITY: POST-1 (enables ...)"""` |

**Key Insight**: Creating contracts for every implementation detail leads to brittle specs. Tier 3 tests trace to behavioral contracts without requiring their own PRE/POST/INV.

**Tier 1.5 Insight**: For integration contracts, the HOW IS the WHAT. SEQ clauses specify the calling path because the path IS the behavior. Tests for SEQ clauses MUST construct objects through actual lifecycle paths, not call methods directly.

## References

- **Contract Granularity Framework**: See `/design-by-contract` skill for full tier definitions
- **Anti-Patterns (MANDATORY)**: See `references/anti-patterns.md` - Anti-Patterns 1-12 define VIOLATIONS. Must review before claiming compliance.
- **Runtime Verification**: See `references/runtime-verification.md` for icontract, Rust contracts, TypeScript patterns
- **Complete Examples**: See `references/complete-examples.md` for full contract file templates

<!-- © 2024-2026 Ketema Harris. All rights reserved. SPDX-License-Identifier: LicenseRef-CCABDD-Proprietary -->
