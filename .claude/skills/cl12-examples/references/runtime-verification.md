# Runtime Verification by Language

CL12 requires runtime verification tools. Use language-appropriate libraries.
Runtime checks DO NOT replace contract docstrings. Every public method must still
declare PRE/POST/INV/ERRORS in its docstring (or language-equivalent contract block).

## Python (`icontract`)

```python
from icontract import require, ensure, invariant

@invariant(lambda self: len(self._sessions) >= 0)
class SessionRegistry:
    """Registry with class-level invariants."""

    @require(lambda session_id: session_id and len(session_id) > 0,
             "PRE: session_id non-empty")
    @require(lambda workspace: workspace.is_absolute(),
             "PRE: workspace is absolute path")
    @ensure(lambda result: result is not None,
            "POST: Returns Session on success")
    def create_session(self, session_id: str, workspace: Path) -> Session:
        """
        Create new session.

        PRE: session_id is non-empty string
        PRE: workspace is absolute path
        POST: Returns Session (never None on success)
        INV: _sessions count increases by exactly 1
        ERRORS: ValueError if session_id empty or workspace not absolute
        """
        # implementation
```

**Installation**: `pip install icontract`

## Rust (debug_assert + contracts crate)

```rust
use contracts::*;

#[invariant(self.sessions.len() >= 0)]
impl SessionRegistry {
    #[requires(session_id.len() > 0, "PRE: session_id non-empty")]
    #[requires(workspace.is_absolute(), "PRE: workspace absolute")]
    #[ensures(ret.is_some(), "POST: returns Session on success")]
    #[ensures(self.sessions.len() >= 1, "INV: sessions length valid")]
    pub fn create_session(&mut self, session_id: &str, workspace: &Path) -> Option<Session> {
        // implementation
    }
}
```

**Cargo.toml**: `contracts = "0.6"`

## TypeScript (ts-contract or explicit assert)

```typescript
import assert from 'assert';

class SessionRegistry {
    createSession(sessionId: string, workspace: string): Session {
        // PRE: sessionId non-empty
        assert(sessionId.length > 0, "PRE violation: sessionId must be non-empty");

        // PRE: workspace absolute
        assert(path.isAbsolute(workspace), "PRE violation: workspace must be absolute");

        const result = /* ... */;

        // POST: returns Session
        assert(result !== null, "POST violation: must return Session");

        // INV: no external side effects declared
        // INV: registry state remains internally consistent (example check)
        return result;
    }
}
```

## Go (explicit checks + panic)

```go
func (r *SessionRegistry) CreateSession(sessionID string, workspace string) (*Session, error) {
    // PRE: sessionID non-empty
    if len(sessionID) == 0 {
        panic("PRE violation: sessionID must be non-empty")
    }
    // PRE: workspace absolute
    if !filepath.IsAbs(workspace) {
        panic("PRE violation: workspace must be absolute path")
    }

    result := &Session{/* ... */}

    // POST: result non-nil (implicit in Go - would return error otherwise)
    // INV: registry state remains consistent after creation
    return result, nil
}
```

## Haskell (LiquidHaskell refinement types)

```haskell
-- Using LiquidHaskell for refinement types
{-@ createSession :: {id : String | len id > 0}
                  -> {p : FilePath | isAbsolute p}
                  -> Session @-}
createSession :: String -> FilePath -> Session
createSession sessionId workspace = ...
```

**Setup**: Install LiquidHaskell (`cabal install liquidhaskell`)

## Java (Jakarta Bean Validation + custom annotations)

```java
import jakarta.validation.constraints.*;

public class SessionRegistry {
    @NotNull
    public Session createSession(
        @NotBlank(message = "PRE: sessionId non-empty") String sessionId,
        @NotNull @AssertTrue(message = "PRE: workspace absolute")
        Path workspace
    ) {
        // implementation
        Session result = ...;
        assert result != null : "POST: must return Session";
        // INV: registry state unchanged except new session entry
        return result;
    }
}
```

## CI Integration

Runtime verification should be enforced in CI:

```yaml
# .github/workflows/contracts.yml
name: Contract Verification
on: [push, pull_request]

jobs:
  contracts:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Run contract tests
        run: pytest -m contract --tb=short
      - name: Check icontract violations
        run: |
          # icontract raises ViolationError on contract breach
          pytest --strict-markers -x
```
