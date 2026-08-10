# CL12 Contract Anti-Patterns

Common violations to avoid when writing Design by Contract specifications.

## Anti-Pattern 1: Type-as-Contract

**VIOLATION**: Using type hints as behavioral specifications.

```python
# ❌ WRONG - Type hint is NOT a contract
def get_session(self, id: str) -> Session | None:
    """Get a session."""  # NO CONTRACT

# ✅ CORRECT - Behavioral contract specifies WHAT, not just structure
def get_session(self, id: str) -> Session | None:
    """
    Retrieve session by identifier.

    PRE: id is non-empty string
    POST: Returns Session if id exists in registry, None otherwise
    INV: Registry state unchanged
    INV: No side effects
    """
```

## Anti-Pattern 2: Missing INV Section

**VIOLATION**: Contracts with PRE/POST but no invariants.

```python
# ❌ WRONG - Missing INV entirely
def bind_session(self, session_id: str, workspace: Path) -> SessionContext:
    """
    PRE: session_id is non-empty
    POST: Returns SessionContext
    """

# ✅ CORRECT - All 5 INV dimensions addressed
def bind_session(self, session_id: str, workspace: Path) -> SessionContext:
    """
    PRE: session_id is non-empty
    POST: Returns SessionContext

    INV: Other sessions unaffected (state invariance)
    INV: No database writes (side effect prohibition)
    INV: Lock held during operation (ordering constraint)
    INV: No resource leaks (resource invariant)
    INV: On error, no partial state changes (exception safety)
    """
```

## Anti-Pattern 3: Theater Contracts

**VIOLATION**: Contracts so vague any implementation satisfies them.

```python
# ❌ WRONG - Theater contract (too vague)
def get_overview(self) -> dict:
    """
    POST: Returns dict
    """
    # ANY dict satisfies this - implementation could return {"garbage": True}

# ✅ CORRECT - Genuine contract (specific and verifiable)
def get_overview(self) -> dict:
    """
    POST: Returns dict with exactly keys "sessions" and "total_count"
    POST: result["sessions"] is list of dicts with keys "session_id", "workspace_root"
    POST: result["total_count"] == len(result["sessions"])
    """
```

**Theater Test**: "Can implementation be WRONG and contract still satisfied?"
- If YES → Theater contract → REJECT
- If NO → Genuine contract → ACCEPT

## Anti-Pattern 4: Undeclared Side Effects

**VIOLATION**: Implementation performs actions not specified in contract.

```python
# Contract says:
"""
POST: Creates Session bound to workspace
"""

# ❌ WRONG - Implementation does MORE than contract declares
def bind_session(self, session_id, workspace):
    session = Session(session_id, workspace)
    self._sessions[session_id] = session
    logger.info(f"Created session {session_id}")  # ← NOT IN CONTRACT
    metrics.increment("session_created")           # ← NOT IN CONTRACT
    self._notify_observers(session)                # ← NOT IN CONTRACT
    return session

# ✅ CORRECT - Either remove side effects OR declare them
"""
POST: Creates Session bound to workspace
POST: Debug log emitted with session_id
POST: Metric "session_created" incremented
POST: Observers notified with new session
"""
```

## Anti-Pattern 5: Monolithic Contract Files

**VIOLATION**: Single file containing all contracts for multiple domains.

```python
# ❌ WRONG - 800+ line monolithic file
# contracts/everything.py
class SessionContract: ...
class CleanupContract: ...
class PathContract: ...
class CompatContract: ...
class FactoryContract: ...
# Hard to test, audit, maintain

# ✅ CORRECT - Modular structure
# contracts/
# ├── session_context_contract.py    (SessionContract)
# ├── session_cleanup_contract.py    (CleanupContract)
# ├── path_validation_contract.py    (PathContract)
# ├── backward_compat_contract.py    (CompatContract)
# └── mcp_factory_contract.py        (FactoryContract)
```

## Anti-Pattern 6: Helper Functions Without Contracts

**VIOLATION**: Public helper functions missing PRE/POST/INV/ERRORS.

```python
# ❌ WRONG - Public function with no contract
def verify_session_invariants(ctx: SessionContext) -> None:
    """Verify invariants."""  # NO PRE/POST/INV
    assert ctx.session_id
    assert ctx.workspace_root.is_absolute()

# ✅ CORRECT - All public functions contracted
def verify_session_invariants(ctx: SessionContext) -> None:
    """
    Verify SessionContext invariants.

    PRE: ctx is SessionContext instance
    POST: No return value (raises on violation)
    INV: ctx unchanged

    ERRORS:
    - AssertionError: if any invariant violated
    """
```

## Anti-Pattern 7: Incomplete ERRORS Section

**VIOLATION**: Contract doesn't specify error conditions.

```python
# ❌ WRONG - No ERRORS section
def bind_session(self, session_id: str, workspace: Path) -> SessionContext:
    """
    PRE: session_id is non-empty
    POST: Returns SessionContext
    INV: Other sessions unaffected
    """
    # What happens if session_id is empty? Unclear!

# ✅ CORRECT - ERRORS section specifies all failure modes
def bind_session(self, session_id: str, workspace: Path) -> SessionContext:
    """
    PRE: session_id is non-empty
    POST: Returns SessionContext
    INV: Other sessions unaffected

    ERRORS:
    - ValueError: if session_id is empty
    - FileNotFoundError: if workspace does not exist
    - TypeError: if workspace is not Path
    """

## Anti-Pattern 8: Conflicting Authoritative Sources

**VIOLATION**: Two or more files declare themselves authoritative for the same domain.

```python
# ❌ WRONG - Two authoritative sources
# contracts/issue6_contract_index.py
"""AUTHORITATIVE index for Issue #6 contracts"""

# contracts/issue6_multi_project_contract.py
"""AUTHORITATIVE contract for Issue #6"""
```

**Fix**: Choose ONE authoritative source. If an index exists, it is the sole authority and all others must be explicitly deprecated.
```

## Anti-Pattern 9: Tests Without Contract References

**VIOLATION**: Tests that don't trace to specific PRE/POST/INV clauses.

```python
# ❌ WRONG - Test without contract traceability
def test_bind_session():
    registry.bind_session("test", Path("/tmp"))
    assert registry.get_session("test") is not None  # Which contract clause?

# ✅ CORRECT - Every assertion traces to contract
def test_post_get_session_returns_context():
    """
    Contract: SessionRegistry.bind_session()
    Enforces: POST: get_session(session_id) returns this SessionContext
    """
    registry.bind_session("test", Path("/tmp"))
    result = registry.get_session("test")

    assert result is not None, (
        "POST violation: get_session() returned None after bind_session()\\n"
        "Contract: SessionRegistry.bind_session() POST clause\\n"
        "EXPECTED: SessionContext for 'test'\\n"
        "ACTUAL: None"
    )
```

## Anti-Pattern 10: Unenforceable Caller Responsibility

**VIOLATION**: Contract relies on external obligation without structural enforcement.

**Pattern**: "Caller MUST X" without mechanism to detect/prevent bypass.

```python
# ❌ WRONG - Caller responsibility without enforcement
"""
INV: last_activity_time updated on every call
     CALLER MUST call touch() before every operation
"""
# If caller forgets, invariant silently violated - undetectable

# ✅ CORRECT - Structural enforcement with observable detection
"""
INV: last_activity_time updated on every call
     MANDATORY ENFORCEMENT MECHANISM:
     1. DECORATOR: All entry points wrapped with @auto_touch_wrapper
     2. GATE: Registration rejects undecorated methods
     3. DETECTION: If (now - last_activity) > THRESHOLD after call,
        framework bug detected (not caller error)
"""
```

**CL12-A Test**: "Can caller bypass contract silently?" If YES → Add enforcement mechanism.

## Anti-Pattern 11: Claim-Only Exception Safety

**VIOLATION**: Contract claims "never raises" without protective implementation.

**Pattern**: ERRORS says "None" but code has unprotected operations.

```python
# ❌ WRONG - Claim without guarantee
def audit_items(self) -> dict:
    """
    ERRORS: None (never raises)
    """
    for item in self._items:
        result[item.name] = item.value  # ← AttributeError if item malformed!

# ✅ CORRECT - Claim backed by implementation
def audit_items(self) -> dict:
    """
    INV: 5. Exception Safety: GUARANTEED never raises -
         all operations wrapped, errors recorded in result

    ERRORS: None (all exceptions caught, recorded with error_message key)
    """
    for item in self._items:
        try:
            result[item.name] = item.value
        except Exception as e:
            result[f"error_{i}"] = {"error_message": str(e)}
```

**CL12-D Test**: "Is error claim backed by try/except?" If claim-only → Add protection.

## Anti-Pattern 12: PRE/INV/ERRORS Contradiction

**VIOLATION**: Contract clauses contradict each other.

**Pattern**: PRE allows input that ERRORS says raises, or INV guarantees what POST violates.

```python
# ❌ WRONG - PRE allows what ERRORS rejects
"""
PRE: items is list (may be empty)
POST: Returns dict with item summaries
ERRORS:
- ValueError: if items is empty  # ← Contradicts PRE!
"""

# ✅ CORRECT - Consistent clauses
"""
PRE: items is non-empty list
POST: Returns dict with item summaries
ERRORS:
- ValueError: if items is empty (PRE violation)
"""
# OR
"""
PRE: items is list (may be empty)
POST: Returns empty dict if items empty, otherwise item summaries
ERRORS: None (empty input is valid)
"""
```

**CL12-B Test**: "∃ valid PRE input where POST/ERRORS contradict?" If YES → Fix clauses.

---

## Observable Enforcement Mechanisms

| Mechanism | When to Use | Detection Method |
|-----------|-------------|------------------|
| **Decorator** | Wrap all entry points | Registration rejects undecorated |
| **Gate** | Block invalid registration | Startup validation fails |
| **Threshold** | Detect bypass after-the-fact | `(now - last_X) > THRESHOLD` |
| **Audit Hook** | Log violations for analysis | Log level ERROR on detect |

**Rule (CL12-A)**: "Caller MUST X" requires at least ONE enforcement mechanism.

---

## Contract Authority Declaration Block

Use at top of authoritative contract file:

```python
"""
<Domain> Contract - <Purpose>

Constitutional Reference: CL12 Design by Contract
Domain: <what this contract governs>
Version: <semver>

AUTHORITY: This contract is AUTHORITATIVE for <domain>.
All implementations MUST satisfy these specifications.
There SHALL be NO other authoritative source for <domain>.
"""
```

**Rule (CL12-C)**: Exactly ONE file per domain may contain AUTHORITY declaration.

---

## Test Traceability Format

Every test assertion must trace to contract clause:

```python
def test_<contract>_<clause>():
    """
    Contract: <Class>.<method>()
    Enforces: <POST-N | PRE-N | INV-N>: <clause text>
    """
    result = obj.method(input)

    assert condition, (
        "<clause-id> violation: <description>\n"
        "Contract: <Class>.<method>() <clause-id>\n"
        "EXPECTED: <expected>\n"
        "ACTUAL: <actual>"
    )
```

**Rule (CL12-E)**: Untraceable assertions = VIOLATION.

---

## Quick Checklist

Before claiming contract complete:

- [ ] Every public method/function has PRE/POST/INV/ERRORS
- [ ] No type-only contracts (behavioral specs required)
- [ ] All 5 INV dimensions considered
- [ ] Theater test passed (vague contracts rejected)
- [ ] All side effects declared in POST
- [ ] Modular file structure (one domain per file)
- [ ] Every test traces to specific contract clause (CL12-E)
- [ ] "Caller MUST" has enforcement mechanism (CL12-A)
- [ ] "Never raises" backed by try/except (CL12-D)
- [ ] No PRE/INV/ERRORS contradictions (CL12-B)
- [ ] Single authoritative source per domain (CL12-C)
