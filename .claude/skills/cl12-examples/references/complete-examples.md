# Complete Contract File Templates

## Modular Contract File Template

Each contract file should follow this structure:

```python
"""
<Domain> Contract - <Brief Description>

Constitutional Reference: CL12 Design by Contract
Domain: <session management | path validation | cleanup | etc.>
Version: 1.0
Last Updated: YYYY-MM-DD

AUTHORITY: This contract is AUTHORITATIVE for <domain> behavior.
All implementations MUST satisfy these specifications.
"""

from dataclasses import dataclass
from pathlib import Path
from typing import Protocol, runtime_checkable


# =============================================================================
# DATA CONTRACTS (Immutable Value Objects)
# =============================================================================

@dataclass(frozen=True)
class SessionContext:
    """
    Immutable session state container.

    PRE: session_id is non-empty string
    PRE: workspace_root is absolute path to existing directory
    PRE: binding_source is one of: "explicit", "implicit", "inherited"

    POST: All fields are immutable after creation
    POST: workspace_root.resolve() == workspace_root (already resolved)

    INV: Once created, instance is immutable
    INV: No methods modify state
    """
    session_id: str
    workspace_root: Path
    binding_source: str


# =============================================================================
# BEHAVIORAL CONTRACTS (Interface Specifications)
# =============================================================================

@runtime_checkable
class SessionRegistryContract(Protocol):
    """
    Contract for session registry behavior.

    Class Invariants:
    - INV: _sessions dict is always valid (no None keys or values)
    - INV: Thread-safe access via _lock
    - INV: _sessions.keys() are all valid session_id strings
    """

    def bind_session(
        self,
        session_id: str,
        workspace_root: Path,
        binding_source: str = "explicit"
    ) -> SessionContext:
        """
        Bind a session to a workspace.

        PRE: session_id is non-empty string
        PRE: workspace_root exists and is absolute path
        PRE: binding_source in ("explicit", "implicit", "inherited")

        POST: Returns SessionContext with provided values
        POST: get_session(session_id) returns this SessionContext
        POST: Session count increases by 1 if new, unchanged if update

        INV: Other sessions unaffected
        INV: Thread-safe (holds _lock during operation)
        INV: No I/O operations (logging allowed if declared)

        ERRORS:
        - ValueError: if session_id is empty
        - FileNotFoundError: if workspace_root does not exist
        - ValueError: if binding_source not in allowed values
        """
        ...

    def unbind_session(self, session_id: str) -> bool:
        """
        Remove session binding.

        PRE: session_id is string (may or may not exist)

        POST: Returns True if session existed and was removed
        POST: Returns False if session did not exist
        POST: get_session(session_id) returns None after call

        INV: Other sessions unaffected
        INV: Idempotent (unbinding non-existent session is no-op)
        INV: Thread-safe (holds _lock during operation)

        ERRORS: None (never raises)
        """
        ...

    def get_session(self, session_id: str) -> SessionContext | None:
        """
        Retrieve session by ID.

        PRE: session_id is string

        POST: Returns SessionContext if session exists
        POST: Returns None if session does not exist

        INV: Registry state unchanged (read-only operation)
        INV: Thread-safe (acquires _lock for read)
        INV: No side effects

        ERRORS: None (never raises)
        """
        ...

    def get_session_overview(self) -> dict:
        """
        Get overview of all sessions.

        PRE: None (always callable)

        POST: Returns dict with exactly keys "sessions" and "total_count"
        POST: result["sessions"] is list of dict, each with "session_id", "workspace_root", "binding_source"
        POST: result["total_count"] == len(result["sessions"])

        INV: Registry state unchanged (read-only operation)
        INV: Thread-safe (acquires _lock for read)
        INV: No side effects

        ERRORS: None (never raises)
        """
        ...


# =============================================================================
# TEST CASE SPECIFICATIONS
# =============================================================================

# Each PRE/POST/INV clause should have corresponding test(s)

TEST_CASES = {
    "bind_session": [
        {
            "name": "test_pre_session_id_empty_raises_valueerror",
            "contract": "PRE: session_id is non-empty string",
            "input": {"session_id": "", "workspace_root": Path("/tmp")},
            "expected": "ValueError",
        },
        {
            "name": "test_post_get_session_returns_context",
            "contract": "POST: get_session(session_id) returns this SessionContext",
            "setup": "bind_session('test-id', Path('/tmp'))",
            "assertion": "get_session('test-id') is not None",
        },
        {
            "name": "test_inv_other_sessions_unaffected",
            "contract": "INV: Other sessions unaffected",
            "setup": "bind two sessions",
            "action": "modify first session",
            "assertion": "second session unchanged",
        },
    ],
    "unbind_session": [
        {
            "name": "test_inv_idempotent",
            "contract": "INV: Idempotent (unbinding non-existent session is no-op)",
            "action": "unbind_session('nonexistent') twice",
            "assertion": "both return False, no error",
        },
    ],
}


# =============================================================================
# VERIFICATION HELPERS
# =============================================================================

def verify_session_context_invariants(ctx: SessionContext) -> None:
    """
    Verify SessionContext invariants.

    PRE: ctx is SessionContext instance
    POST: No return value (raises on violation)
    INV: ctx unchanged

    ERRORS:
    - AssertionError: if any invariant violated
    """
    assert ctx.session_id, "INV: session_id must be non-empty"
    assert ctx.workspace_root.is_absolute(), "INV: workspace_root must be absolute"
    assert ctx.binding_source in ("explicit", "implicit", "inherited"), \
        "INV: binding_source must be valid enum value"
```

## Contract Index File Template

```python
"""
Contract Index - Issue #6 Multi-Project Support

Imports all contracts and provides audit capabilities.

AUTHORITY: This index is the single authoritative entrypoint for this domain.
Any monolithic or alternate contract file MUST be explicitly deprecated.
"""

from .session_context_contract import (
    SessionContext,
    SessionRegistryContract,
    verify_session_context_invariants,
)
from .session_cleanup_contract import SessionCleanupContract
from .path_validation_contract import PathValidationContract
from .backward_compat_contract import BackwardCompatibilityContract
from .mcp_factory_activation_contract import MCPFactoryActivationContract


__all__ = [
    # Data contracts
    "SessionContext",
    # Behavioral contracts
    "SessionRegistryContract",
    "SessionCleanupContract",
    "PathValidationContract",
    "BackwardCompatibilityContract",
    "MCPFactoryActivationContract",
    # Verification helpers
    "verify_session_context_invariants",
]


def audit_contract_coverage() -> dict:
    """
    Audit contract coverage.

    PRE: All contract modules importable
    POST: Returns dict mapping contract method -> PRE/POST/INV/ERRORS counts
    INV: Read-only, no side effects
    ERRORS: ImportError if a contract module cannot be loaded
    """
    contracts = [
        SessionRegistryContract,
        SessionCleanupContract,
        PathValidationContract,
        BackwardCompatibilityContract,
        MCPFactoryActivationContract,
    ]

    result = {}
    for contract in contracts:
        methods = [m for m in dir(contract) if not m.startswith("_")]
        for method in methods:
            doc = getattr(contract, method).__doc__ or ""
            result[f"{contract.__name__}.{method}"] = {
                "pre_count": doc.count("PRE:"),
                "post_count": doc.count("POST:"),
                "inv_count": doc.count("INV:"),
                "errors_count": doc.count("ERRORS:"),
            }
    return result
```
