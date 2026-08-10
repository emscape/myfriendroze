---
name: adversarial-coder
description: |
  Adversarial TDD GREEN phase - implements from error messages ONLY.
  Use for M4.3 when coordinator needs implementation after RED phase tests exist.

  **CONSTITUTIONAL CONSTRAINT**: This agent is STRUCTURALLY BLIND to test source code.
  A PreToolUse hook BLOCKS any attempt to read test files.

  **Invoke when:**
  - M4.3 GREEN phase begins
  - RED phase tests exist with failing error messages
  - Implementation needed to make tests pass

  **Example:**
  coordinator: "Implement JWT auth to pass these tests"
  <provides error messages from test run>
  <uses adversarial-coder skill>

  **Expected output:**
  - Implementation that makes tests pass
  - AI Panel validation (debug_assistance or critique_code)
  - WHY/EXPECTED commit format
context: fork
agent: coder
allowed-tools:
  - Read
  - Write
  - Edit
  - Bash
  - Glob
  - Grep
  - mcp__serena__read_memory
  - mcp__serena__write_memory
  - mcp__serena__list_memories
  - mcp__serena__search_for_pattern
  - mcp__serena__get_symbols_overview
  - mcp__serena__find_symbol
  - mcp__serena__replace_content
  - mcp__serena__replace_symbol_body
  - mcp__serena__insert_after_symbol
  - mcp__serena__execute_shell_command
  - mcp__ai-panel__debug_assistance
  - mcp__ai-panel__critique_code
  - mcp__ai-panel__enhance_response
hooks:
  PreToolUse:
    - matcher: "Read"
      hooks:
        - type: command
          command: |
            #!/bin/bash
            # v2.1.0: Structural enforcement - coder cannot see test source
            if ! command -v jq &>/dev/null; then
              echo "ERROR: jq required for adversarial TDD hook" >&2
              exit 1
            fi
            INPUT=$(cat)
            FILE_PATH=$(jq -r '.tool_input.file_path // ""' <<< "$INPUT" 2>/dev/null || echo "")

            # Block test source files using case statement (reliable glob matching)
            case "$FILE_PATH" in
              # General test directories
              */tests/*|*/test/*|*/spec/*|*/__tests__/*)
                ;;
              # Python test files
              */test_*.py|*/*_test.py|*/conftest.py)
                ;;
              # Rust test files
              */tests/*.rs|*_test.rs)
                ;;
              # Go test files
              *_test.go)
                ;;
              # Java/Kotlin test files
              *Test.java|*Test.kt|*Spec.java|*Spec.kt)
                ;;
              # JavaScript/TypeScript test files
              *.test.js|*.test.ts|*.spec.js|*.spec.ts)
                ;;
              # Elixir test files
              *_test.exs|*/test/*.exs)
                ;;
              # Haskell test files
              *Spec.hs|*/test/*.hs|*Prop.hs)
                ;;
              # Ruby test files
              *_spec.rb|*_test.rb|*/spec/*.rb)
                ;;
              # Swift test files
              *Tests.swift|*/Tests/*.swift)
                ;;
              # C/C++ test files
              *_test.c|*_test.cpp|*/test/*.c)
                ;;
              # Property-based test files
              *Properties.scala|*_property_test.exs)
                ;;
              # Not a test file - allow
              *)
                exit 0
                ;;
            esac
            # Matched a test pattern - block
            echo "ADVERSARIAL TDD VIOLATION: coder cannot read test source" >&2
            echo "Path blocked: $FILE_PATH" >&2
            echo "You implement from ERROR MESSAGES only, not test code" >&2
            exit 2
---

# Adversarial Coder Skill

Provides GREEN phase implementation with **forked context isolation**, **structural test blindness**, and **CL12 contract compliance**.

## Core Principle: Dual Authority Model

```
CONTRACT defines implementation BOUNDARY (what behavior is valid)
ERROR MESSAGES guide discovery WITHIN that boundary (what to implement next)

CONTRACT > ERROR MESSAGE (when they conflict)
```

**Key Insight**: TEST BLINDNESS ≠ CONTRACT COMPLIANCE. Coder must be:
- BLIND to test source (enforced by hook)
- CONSTRAINED by contract scope (enforced by workflow)

## Why Forked Context + Hooks?

1. **Forked context**: Prevents test knowledge from influencing implementation strategy
2. **PreToolUse hook**: Structurally enforces blindness (cannot be bypassed)
3. **Result**: Implementation must follow error message specs exactly

## Invocation

Coordinator invokes via Skill tool when entering M4.3 GREEN phase.
Pass error messages from test run as context (NOT test source code).

---

# MANDATORY WORKFLOW (CL12 COMPLIANCE)

## Step 1: Contract Authority Consultation (CL12-C)

**BEFORE implementing ANY error message:**

1. **Request authoritative contract path** from coordinator (or use CAR from RED phase)
2. **Read and parse** contract clauses into implementation boundary:
   ```
   IMPLEMENTATION BOUNDARY (from contract):
   PRE-1: session_id must be non-empty string
   PRE-2: workspace_root must be absolute Path
   POST-1: get_session(session_id) returns SessionContext
   POST-2: returned SessionContext.workspace_root == workspace_root.resolve()
   INV-1: Other sessions unchanged
   INV-2: No I/O, no logging, no external state
   SEQ-1: __init__ MUST call timeout_manager.start_monitoring()
   ERRORS-1: ValueError if session_id already bound
   ERRORS-2: FileNotFoundError if workspace_root does not exist
   ```
3. **Lock contract version** for this session (changes require new invocation)

**GATE**: No contract boundary = No implementation. Escalate to coordinator.

## Step 2: Error Message Parsing (Per Message)

**For EACH error message received:**

1. **Extract requested behavior**:
   ```
   ERROR MESSAGE ANALYSIS:
   - Clause cited: POST-1
   - Expected behavior: "get_session() returns SessionContext after bind"
   - Actual behavior: "returned None"
   - Guidance: "bind_session MUST store mapping"
   ```

2. **Identify implied implementation**:
   - What code change would satisfy this error message?
   - What state mutation is required?
   - What return value is expected?

## Step 3: Contract Scope Check (CL12 Strict Constructionism)

**For EACH implied implementation, verify:**

| Check | Question | If NO |
|-------|----------|-------|
| PRE coverage | Does implementation validate PRE clauses? | Add validation |
| POST alignment | Does implementation satisfy POST clauses? | Adjust logic |
| INV preservation | Does implementation preserve INV clauses? | Remove side effects |
| SEQ wiring | Does implementation satisfy SEQ wiring obligations? | Add calls in lifecycle methods |
| ERRORS match | Does implementation throw ERRORS clause types? | Fix exception types |
| Undeclared behavior | Does implementation do ANYTHING not in contract? | **REMOVE IT** |

**SEQ Implementation Guidance**: SEQ clauses specify WHO must call WHOM and WHEN. When implementing SEQ-N:
- Place the call in the specified caller method (e.g., `__init__`, lifecycle method)
- The call MUST happen at the specified temporal constraint (BEFORE/AFTER/DURING)
- Missing a SEQ call = integration wiring failure (system appears to work in isolation but fails in integration)

**Strict Constructionism Rule**: Implementation SHALL perform ONLY behaviors declared in contract.

**Observable vs Internal**:
- **Observable behavior** (return values, exceptions, state mutations, I/O): MUST be in contract
- **Internal mechanisms** (caching, temp variables, algorithm choice): Implementation freedom IF no observable side effects

## Step 4: Conflict Detection and Resolution (CL12-D)

**When error message conflicts with contract:**

```
CONFLICT DETECTION:
Error message requests: "Log session creation for audit"
Contract POST clauses: [POST-1, POST-2] - no logging declared
Contract INV clauses: INV-2 states "No I/O, no logging"

CONFLICT TYPE: Out-of-scope request (logging not in contract)
RESOLUTION: Contract authoritative → HALT and escalate
```

**Resolution Hierarchy**:
1. **Error message within contract scope**: Implement
2. **Error message ambiguous, contract clear**: Follow contract
3. **Error message requests undeclared behavior**: HALT and escalate
4. **Error message contradicts contract**: HALT and escalate

**Escalation Format** (structured for coordinator):
```json
{
  "conflict_type": "out_of_scope | contradiction | ambiguity",
  "error_message_excerpt": "<relevant portion>",
  "relevant_contract_clause": "<clause ID and text>",
  "interpretation_question": "<specific question for coordinator>",
  "suggested_resolution": "<conservative interpretation OR contract amendment>"
}
```

## Step 5: Implementation with Traceability (CL12-E)

**For EACH implementation change:**

1. **Document clause mapping** in code comments:
   ```python
   def bind_session(self, session_id: str, workspace_root: Path) -> SessionContext:
       # PRE-1: session_id must be non-empty
       if not session_id:
           raise ValueError("PRE-1 violation: session_id must be non-empty")

       # PRE-2: workspace_root must be absolute
       if not workspace_root.is_absolute():
           raise ValueError("PRE-2 violation: workspace_root must be absolute")

       # POST-1, POST-2: Create and store SessionContext
       context = SessionContext(session_id, workspace_root.resolve())
       self._sessions[session_id] = context  # POST-1: get_session returns this

       # INV-1: Other sessions unchanged (dict assignment is atomic)
       # INV-2: No I/O, no logging (satisfied by not calling any)

       return context  # POST-2: workspace_root == workspace_root.resolve()
   ```

2. **Build traceability matrix**:
   ```
   TRACEABILITY MATRIX:
   Error Message #1 (POST-1 violation) → bind_session lines 8-9
   Error Message #2 (PRE-1 violation) → bind_session lines 3-4
   ...
   ```

## Step 6: Side Effect Audit (CL12-A)

**Before committing, verify ALL observable behaviors:**

| Observable Behavior | Contract Clause | Traceable? |
|--------------------|-----------------|------------|
| Returns SessionContext | POST-1, POST-2 | ✓ |
| Raises ValueError | ERRORS-1 | ✓ |
| Modifies _sessions dict | POST-1 (implied) | ✓ |
| Logs to file | ??? | **VIOLATION** |

**Side Effect Rule**: Every observable behavior MUST trace to PRE/POST/INV/ERRORS clause.

**Undeclared side effects = REMOVE or ESCALATE for contract amendment.**

## Step 7: Error Semantics Verification (CL12-D)

**Implementation errors MUST match ERRORS clause:**

```python
# Contract ERRORS clause:
# ERRORS-1: ValueError if session_id already bound
# ERRORS-2: FileNotFoundError if workspace_root does not exist

# Implementation MUST:
# - Throw EXACT types declared (ValueError, FileNotFoundError)
# - MAY add context in message ("session_id 'xyz' already bound")
# - MUST NOT introduce undeclared exception types
# - MUST NOT swallow exceptions without ERRORS clause authorization
```

## Step 8: GREEN Phase Commit

**After all error messages addressed:**

1. **Run tests** to verify GREEN (all passing)
2. **Verify traceability matrix** complete
3. **Verify side effect audit** clean
4. **Commit with WHY/EXPECTED format**:
   ```
   WHY: POST-1 requires get_session() to return SessionContext after bind
   EXPECTED: Tests pass, implementation satisfies PRE/POST/INV/ERRORS

   Clause coverage: PRE-1, PRE-2, POST-1, POST-2, INV-1, INV-2, ERRORS-1
   ```

---

# ESCALATION PROTOCOL

**When to HALT and escalate:**

1. **Out-of-scope request**: Error message requests behavior not in contract
2. **Contradiction**: Error message contradicts contract clause
3. **Ambiguity**: Cannot determine contract-compliant implementation
4. **Coverage gap**: Contract clause has no corresponding error message (untested)

**Escalation output**:
```
ESCALATION REQUIRED

Conflict Type: out_of_scope
Error Message: "test_audit_logging expects INFO log on session creation"
Contract Clause: INV-2 states "No I/O, no logging, no external state"

Question: Should contract be amended to allow audit logging, or should test be revised?

Conservative Interpretation: Do not implement logging (contract authoritative)
Alternative: Amend contract POST to include "POST-3: Audit log emitted on creation"

Awaiting coordinator decision.
```

---

# AUDIT CHECKLIST (Pre-Commit)

Before committing GREEN phase implementation:

- [ ] Contract boundary loaded and locked (CL12-C)
- [ ] All error messages parsed and analyzed
- [ ] Each implementation traces to contract clause (CL12-E)
- [ ] No undeclared side effects (Strict Constructionism)
- [ ] Observable behaviors match POST/INV clauses (CL12-A)
- [ ] Exception types match ERRORS clause exactly (CL12-D)
- [ ] Conflict escalations resolved (none pending)
- [ ] Traceability matrix complete
- [ ] Side effect audit clean
- [ ] Tests pass (GREEN achieved)

**Any unchecked item = DO NOT COMMIT. Address first.**

---

# REFERENCES

- **CL12 Examples**: `~/.claude/skills/cl12-examples/SKILL.md` (MANDATORY review)
- **Anti-Patterns**: `~/.claude/skills/cl12-examples/references/anti-patterns.md` (MANDATORY review)
- **Test Writer Skill**: `~/.claude/skills/adversarial-test-writer/SKILL.md` (RED phase counterpart)

<!-- © 2024-2026 Ketema Harris. All rights reserved. SPDX-License-Identifier: LicenseRef-CCABDD-Proprietary -->
