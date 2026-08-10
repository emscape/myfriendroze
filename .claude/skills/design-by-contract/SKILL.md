---
name: design-by-contract
description: |
  CL12 contract authoring - generate PRE/POST/INV/SEQ specifications.
  Use when: writing contracts for public methods, reviewing contracts,
  implementing runtime verification, distinguishing types from contracts,
  specifying integration wiring obligations between components.
  Triggers: "write contract", "CL12", "PRE/POST/INV", "design by contract",
  "behavioral contract", "contract for method", "integration contract", "SEQ"
allowed-tools:
  - Read
  - Write
  - Edit
  - mcp__serena__find_symbol
  - mcp__serena__get_symbols_overview
  - mcp__serena__replace_symbol_body
  - mcp__ai-panel__critique_code
---

# Design by Contract (CL12)

Generate behavioral contracts with PRE/POST/INV specifications.

## Core Principle

**Type signatures are NOT contracts.**

```python
# This is a TYPE HINT (structural):
def get_user(user_id: str) -> dict[str, Any]: ...

# This is a CONTRACT (behavioral):
def get_user(user_id: str) -> dict[str, Any]:
    """
    PRE: user_id is non-empty string matching UUID v4 format
    POST: Returns dict with keys ["id", "name", "email", "created_at"]
          where id == user_id, all values are non-None
    INV: Database connection remains open
    ERRORS: Raises UserNotFoundError if user_id not in database
    """
```

## Contract Clauses

### PRE (Preconditions)
What MUST be true BEFORE the method executes.

```
PRE: user_id is non-empty string
PRE: amount > 0
PRE: connection is open
PRE: caller has permission X
```

### POST (Postconditions)
What MUST be true AFTER the method executes.

```
POST: Returns list of exactly N items
POST: Database contains new record with id == returned_id
POST: File exists at path with content matching input
POST: Event was published to queue
```

### INV (Invariants)
What MUST remain true THROUGHOUT execution.

```
INV: Total balance unchanged (transfer)
INV: List remains sorted
INV: Connection pool size unchanged
INV: No side effects on input parameters
```

### ERRORS
What exceptions may be raised and when.

```
ERRORS: Raises ValueError if amount <= 0
ERRORS: Raises ConnectionError if database unreachable
ERRORS: Returns None (does not raise) if not found
```

### SEQ (Sequencing Obligations) — Integration Contracts

WHO must call WHOM, and WHEN. For integration, the HOW IS the WHAT.

Traditional DbC says "WHAT, not HOW" — correct for component contracts.
For integration contracts, the calling sequence IS the behavior.
"Pool.__init__ calls start_monitoring()" is not an implementation detail —
it is an architectural obligation that, if missing, breaks the system
regardless of how individual components are implemented.

```
SEQ-1: __init__ MUST call timeout_manager.start_monitoring()
       Source: REQ-2026-005, CHAIN-1, IP-1
SEQ-2: on_transport_session_closed() MUST call pool.release()
       for ALL session.lsp_references AFTER unbind_session()
       Source: REQ-2026-005, CHAIN-1, IP-2
SEQ-3: _monitor_loop() MUST call check_and_reclaim()
       every check_interval seconds WHILE is_monitoring() == True
       Source: REQ-2026-005, CHAIN-1, IP-3
```

**Format**: `[Caller] MUST [invoke callee] [temporal constraint] Source: [req ID, chain ID, integration point ID]`

**Key distinction**:
- **POST** says: "what is true after" (end-state — can be satisfied by ANY path)
- **SEQ** says: "what must be called, by whom, in what order" (integration path — constrains the path itself)

**Why SEQ exists**: POST clauses can be satisfied by mocked components.
SEQ clauses cannot — either __init__ calls start_monitoring() or it doesn't.
A mock cannot fake a call sequence. This makes SEQ inherently un-theater-able.

**Testing SEQ clauses**: Tests for SEQ clauses MUST use the actual
construction/lifecycle path, not direct method calls. If testing that
`__init__` calls `start_monitoring()`, you MUST construct the object
via `__init__` and verify the downstream effect — NOT call
`start_monitoring()` directly on a standalone instance.

**Anti-pattern** (THEATER — violates SEQ testing discipline):
```python
# Creates pool, then REPLACES dependency after construction
pool = GlobalLanguageServerPool()
pool.timeout_manager = mock_timeout_manager  # Bypasses __init__ wiring
```

**Correct pattern**:
```python
# Tests through actual construction path
pool = GlobalLanguageServerPool(timeout_manager=mock_timeout_manager)
assert pool.timeout_manager.is_monitoring()  # Verifies __init__ wiring
```

## Polyglot Implementation

### Python (icontract)
```python
from icontract import require, ensure, invariant

@require(lambda user_id: len(user_id) == 36)
@ensure(lambda result: "id" in result and "name" in result)
def get_user(user_id: str) -> dict:
    """
    PRE: user_id is valid UUID v4 (36 chars)
    POST: Returns dict with keys ["id", "name"]
    """
```

### Rust (contracts crate)
```rust
use contracts::*;

#[requires(user_id.len() == 36)]
#[ensures(ret.is_ok() -> ret.unwrap().id == user_id)]
pub fn get_user(user_id: &str) -> Result<User, Error> {
    // PRE: user_id is valid UUID
    // POST: Returns User with matching id
}
```

### Haskell (LiquidHaskell / QuickCheck)
```haskell
-- | Get user by ID
-- PRE: length userId == 36
-- POST: userId result == userId input
{-@ getUser :: {v:String | len v == 36} -> Maybe User @-}
getUser :: String -> Maybe User
```

## Theater Contract Detection

**Core Question**: "Can implementation return wrong data and contract still be satisfied?"

| Contract | Theater? | Fix |
|----------|----------|-----|
| `POST: returns dict` | YES | Specify required keys |
| `POST: returns int` | YES | Specify value constraints |
| `PRE: input is valid` | YES | Define "valid" precisely |
| `POST: returns dict with keys ["a", "b"]` | NO | Specific |
| `POST: returns int in range [0, 100]` | NO | Bounded |

## Contract Template

```python
def method_name(param1: Type1, param2: Type2) -> ReturnType:
    """
    Brief description of what this method does.

    PRE: param1 [constraint]
    PRE: param2 [constraint]
    POST: [what is guaranteed about return value]
    POST: [what side effects occur]
    INV: [what remains unchanged]
    ERRORS: [what exceptions and when]

    Example:
        >>> method_name(valid_input)
        expected_output
    """
```

## Test Traceability (CL12-E)

Every test MUST cite the clause it enforces:

```python
def test_get_user_returns_required_keys():
    """Enforces: POST-1 (returns dict with keys [id, name])"""
    result = get_user(valid_id)
    assert "id" in result, "POST-1 violation: missing 'id' key"
    assert "name" in result, "POST-1 violation: missing 'name' key"
```

## Contract Granularity Framework

### The Four Tiers

Not everything needs a contract. Use this framework to decide where specifications belong:

| Tier | Scope | Example | When to Add |
|------|-------|---------|-------------|
| **1. Behavioral Contracts** | Observable state changes at module boundaries | `POST-1: "Valid token stored after authenticate()"` | User-facing requirements |
| **1.5 Integration Contracts** | Sequencing & dependency obligations between components | `SEQ-1: "__init__ MUST call start_monitoring()"` | Integration Points Checklist (from /req-elicit Phase 2.5) |
| **2. Structural Contracts** | Data formats at trust boundaries (external APIs) | `"GoogleIDToken conforms to RFC 7519"` | External provider changes could break system |
| **3. Implementation Tests** | Parsing details, field optionality | `testEmailVerifiedOptional()` | Discovered during implementation |

### Decision Heuristics

> **If client code can observe the difference** → Behavioral contract candidate (Tier 1)
> **If two components have a dependency edge** → Integration contract candidate (Tier 1.5)
> **If only implementation observes** → Implementation test with traceability (Tier 3)

### Pre-Test Gate: Integration Points Verification

**Before /adversarial-test-writer starts**, verify:

```
For each Integration Point (IP-N) in the REQUIREMENT_MANIFEST:
  [ ] Does a SEQ clause exist in the contract?
  [ ] Does the SEQ clause cite the Integration Point ID?
  [ ] Does the SEQ clause specify the exact caller and callee?

If ANY integration point lacks a SEQ clause → BLOCK → return to /design-by-contract
```

This gate ensures every component handoff identified during requirements
elicitation has a corresponding integration contract before tests are written.

### When NOT to Create a Contract

- Field optionality in parsed data (Tier 3)
- Internal validation logic (Tier 3)
- Implementation accommodations for interoperability (Tier 3)
- Details that don't affect observable module behavior

### Implementation Test Pattern (Tier 3)

When a low-level detail is discovered during implementation, write a test that **traces back** to the behavioral contract it enables:

```swift
/// Tests for GoogleIDTokenClaims parsing robustness
/// CONTRACT TRACEABILITY: POST-1 (valid token stored after authenticate)
///
/// These tests verify implementation-level parsing that ENABLES POST-1,
/// not a separate behavioral requirement.
func testEmailVerifiedOptional_MCPJWTCompatibility() {
    // GIVEN: MCP JWT without email_verified field (server uses different claims)
    let mcpJWT = """
    {"iss":"ai-panel.ketema.net","sub":"123","aud":"ios","exp":999,"iat":100,"email":"test@example.com"}
    """

    // WHEN: Parsing claims
    let claims = try! JSONDecoder().decode(GoogleIDTokenClaims.self, from: mcpJWT.data(using: .utf8)!)

    // THEN: Parsing succeeds (enables POST-1)
    // POST-1 TRACEABILITY: If this fails, authenticate() cannot extract email from token
    XCTAssertEqual(claims.email, "test@example.com")
    XCTAssertNil(claims.emailVerified) // Optional field handled gracefully
}
```

### Historical Basis

This framework aligns with classical DbC principles:

- **Meyer (1986)**: Contracts describe WHAT, not HOW — behavioral specs at module boundaries
- **Hoare Logic**: PRE/POST formalized without implementation details
- **Liskov**: Behavioral subtyping tests observable behavior
- **Parnas**: Information hiding — contracts expose interface, hide internals

**Key insight**: Creating contracts for every implementation detail leads to brittle specs. Tests for low-level details that trace to behavioral contracts maintain correctness without proliferation.

**Extension (2026)**: For integration contracts, the HOW IS the WHAT. Meyer's
"WHAT, not HOW" applies to component contracts (Tier 1). Integration contracts
(Tier 1.5) specify the calling path because the path IS the behavior. This is not
a violation of Meyer — it is a recognition that component composition has its own
behavioral contract distinct from component behavior.

## Integration with CCABDD

```
/req-elicit → Requirements with ambiguity ≤ 2
     ↓ Phase 2.5: Dependency Graph + Sequencing Specs + Integration Points
/design-by-contract → PRE/POST/INV/SEQ for each public method (Tier 1 + 1.5 + 2)
     ↓ Pre-test gate: every Integration Point has a SEQ clause
/adversarial-test-writer → Tests that enforce contracts (including SEQ)
     ↓ SEQ tests MUST use actual construction/lifecycle paths
/adversarial-coder → Implementation satisfying contracts
     ↓
[Discovery] → Implementation tests with traceability (Tier 3)
```

**Contract Template (updated)**:

```python
def method_name(param1: Type1, param2: Type2) -> ReturnType:
    """
    Brief description of what this method does.

    PRE: param1 [constraint]
    PRE: param2 [constraint]
    POST: [what is guaranteed about return value]
    POST: [what side effects occur]
    INV: [what remains unchanged]
    SEQ-1: [who must call whom, when — integration obligations]
           Source: [REQ-ID, CHAIN-ID, IP-ID]
    ERRORS: [what exceptions and when]

    Example:
        >>> method_name(valid_input)
        expected_output
    """
```

<!-- © 2024-2026 Ketema Harris. All rights reserved. SPDX-License-Identifier: LicenseRef-CCABDD-Proprietary -->
