# Bridge Patterns

Common patterns for building bridges between OBSERVED and EXPECTED behavior. Bridges are **learning tools**—they help you understand the transformation well enough to write contracts.

## Core Principle

**Bridges are disposable.** Their purpose is learning, not permanence.

A bridge lets you:
1. Keep old behavior working (existing tests pass)
2. Experiment with new behavior (verify EXPECTED works)
3. Understand the transformation deeply enough to write contracts
4. Demolish safely in Phase 4 (RED)

---

## Pattern 1: Feature Flag Bridge

**Use When**: OVERRIDE—existing behavior must change

**Structure**:
```python
# Environment variable or config-driven
USE_NEW_AUTH = os.getenv("USE_NEW_AUTH", "false").lower() == "true"

def authenticate(token: str) -> bool:
    if USE_NEW_AUTH:
        # EXPECTED behavior (from req-elicit)
        return validate_jwt_signature(token) and not is_expired(token)
    else:
        # OBSERVED behavior (will be removed)
        return True  # Legacy stub
```

**Lifecycle**:
1. Deploy with flag OFF → old behavior, existing tests pass
2. Test with flag ON → new behavior, verify EXPECTED
3. Write contracts based on new behavior understanding
4. Phase 4: Remove flag and old path entirely

**Pros**: Safe rollback, gradual rollout possible
**Cons**: Code duplication, flag management overhead

---

## Pattern 2: Inheritance Bridge

**Use When**: OVERRIDE—behavior can be isolated to a class

**Structure**:
```python
# Original class (OBSERVED behavior)
class LegacyAuthenticator:
    def authenticate(self, token: str) -> bool:
        return True  # Always passes

# Bridge class (EXPECTED behavior)
class JWTAuthenticator(LegacyAuthenticator):
    def authenticate(self, token: str) -> bool:
        # EXPECTED: Actually validate
        if not self._validate_signature(token):
            return False
        if self._is_expired(token):
            return False
        return True

# Usage switches at configuration level
authenticator = JWTAuthenticator() if USE_NEW_AUTH else LegacyAuthenticator()
```

**Lifecycle**:
1. Create subclass with EXPECTED behavior
2. Test subclass in isolation
3. Gradually switch configuration to use new class
4. Phase 4: Delete parent class, subclass becomes the only implementation

**Pros**: Clean separation, testable in isolation
**Cons**: Requires OOP structure, inheritance can get messy

---

## Pattern 3: Decorator Bridge

**Use When**: OVERRIDE—adding behavior around existing function

**Structure**:
```python
def with_rate_limiting(func):
    """Bridge decorator: adds rate limiting (EXPECTED) around existing (OBSERVED)."""
    @functools.wraps(func)
    def wrapper(*args, **kwargs):
        if USE_NEW_RATE_LIMIT:
            # EXPECTED: Check rate limit before proceeding
            if rate_limiter.is_exceeded(get_client_id()):
                raise RateLimitExceeded()
        # OBSERVED: Original behavior
        return func(*args, **kwargs)
    return wrapper

@with_rate_limiting
def handle_request(request):
    # Original implementation unchanged
    ...
```

**Lifecycle**:
1. Wrap existing function with decorator
2. Toggle EXPECTED behavior via flag
3. Verify both paths work
4. Phase 4: Inline the decorator logic, remove old path

**Pros**: Non-invasive, function stays intact
**Cons**: Hidden behavior, debugging can be tricky

---

## Pattern 4: Adapter Bridge

**Use When**: NEW—creating new interface for existing functionality

**Structure**:
```python
# NEW interface (EXPECTED from req-elicit)
class TokenService:
    """New interface that doesn't exist yet."""

    def validate(self, token: str) -> ValidationResult:
        """EXPECTED: Returns structured result, not just bool."""
        ...

    def refresh(self, token: str) -> str:
        """EXPECTED: Refresh token capability (doesn't exist)."""
        ...

# Bridge adapter (connects NEW interface to OBSERVED implementation)
class TokenServiceAdapter(TokenService):
    def __init__(self, legacy_auth):
        self._legacy = legacy_auth

    def validate(self, token: str) -> ValidationResult:
        # Bridge: Use OBSERVED behavior, wrap in EXPECTED interface
        is_valid = self._legacy.authenticate(token)
        return ValidationResult(valid=is_valid, reason="legacy")

    def refresh(self, token: str) -> str:
        # NEW: No OBSERVED equivalent, implement from scratch
        raise NotImplementedError("Awaiting GREEN phase")
```

**Lifecycle**:
1. Define new interface (from EXPECTED)
2. Create adapter that wraps old behavior
3. Callers migrate to new interface
4. Phase 4: Implement new interface directly, remove adapter

**Pros**: Clean new interface, gradual migration
**Cons**: Adapter layer adds complexity

---

## Pattern 5: Strangler Fig Bridge

**Use When**: Large-scale OVERRIDE—replacing entire subsystem

**Structure**:
```python
# Router that directs to old or new implementation
class AuthRouter:
    def __init__(self):
        self.legacy_auth = LegacyAuthSystem()
        self.new_auth = JWTAuthSystem()
        self.migration_percent = 0  # 0-100

    def authenticate(self, token: str) -> bool:
        # Gradually shift traffic to new system
        if random.randint(1, 100) <= self.migration_percent:
            return self.new_auth.authenticate(token)
        else:
            return self.legacy_auth.authenticate(token)
```

**Lifecycle**:
1. Both systems run in parallel
2. Gradually increase migration_percent
3. Monitor for discrepancies
4. At 100%, remove legacy system entirely

**Pros**: Safe for critical systems, measurable progress
**Cons**: Running two systems is expensive

---

## Pattern 6: Null Object Bridge

**Use When**: REMOVE—eliminating unwanted behavior

**Structure**:
```python
# OBSERVED: Legacy behavior that must go
class LegacySessionChecker:
    def check(self, request):
        if 'PHPSESSID' in request.cookies:
            return self._validate_php_session(request.cookies['PHPSESSID'])
        return True

# Bridge: Null object that does nothing
class NullSessionChecker:
    def check(self, request):
        # EXPECTED: No session checking at all
        return True

# Toggle between them
session_checker = NullSessionChecker() if REMOVE_LEGACY_SESSIONS else LegacySessionChecker()
```

**Lifecycle**:
1. Inject null object instead of legacy
2. Verify nothing breaks (tests still pass)
3. Phase 4: Remove the legacy class entirely
4. Remove the null object too (it was just a bridge)

**Pros**: Safe removal, easy rollback
**Cons**: Temporary code that must be cleaned up

---

## Bridge Validation Checklist

Before proceeding to Phase 3 (Contracts):

- [ ] All OVERRIDE rows have bridges in place
- [ ] All NEW rows have stub implementations or adapters
- [ ] Existing tests still pass (old behavior preserved)
- [ ] New behavior can be toggled on for testing
- [ ] You understand the transformation deeply
- [ ] AI Panel `critique_code` reviewed the bridges

---

## Anti-Patterns

| Anti-Pattern | Why It's Wrong | Fix |
|--------------|---------------|-----|
| Bridge becomes permanent | Defeats purpose, adds complexity | Set demolition deadline |
| Testing only new path | Old tests may break in production | Verify both paths |
| Bridge with no toggle | Can't safely verify new behavior | Add feature flag |
| Too many nested bridges | Complexity explosion | Refactor to single bridge |
| Bridge without tests | Can't verify it works | Test bridge in isolation |

---

## Bridge → Contract Transition

The bridge teaches you what the contract should say:

| Bridge Observation | Contract Clause |
|-------------------|-----------------|
| New path returns X on success | POST: Returns X when valid |
| New path raises Y on failure | ERRORS: Raises Y when invalid |
| Old path must not run | INV: Legacy behavior prohibited |
| New path requires Z input | PRE: Z must be provided |

Document these observations—they become Phase 3 input.
