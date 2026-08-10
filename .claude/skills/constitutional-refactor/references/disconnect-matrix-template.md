# DISCONNECT MATRIX Template

The central artifact of Constitutional Refactoring. Maps EXPECTED behavior (from user dialogue) against OBSERVED behavior (from execution).

## Full Template

```markdown
# DISCONNECT MATRIX: [Component Name]

**Date**: YYYY-MM-DD
**Branch**: feature/constitutional-refactor-[component]
**Source Prose**: "[Original user description of what this should do]"

## Summary

| Metric | Count |
|--------|-------|
| Total Behaviors | N |
| OVERRIDE (change existing) | X |
| NEW (create missing) | Y |
| REMOVE (eliminate unwanted) | Z |
| KEEP (correct as-is) | W |

## Matrix

| ID | Behavior | EXPECTED | OBSERVED | DELTA | Location | Priority |
|----|----------|----------|----------|-------|----------|----------|
| B01 | [Name] | [What user says it should do] | [What execution showed] | OVERRIDE/NEW/REMOVE/KEEP | file:line | P1/P2/P3 |
| B02 | ... | ... | ... | ... | ... | ... |

## Evidence

### B01: [Behavior Name]

**EXPECTED Source**: req-elicit Phase [N], user stated: "[quote]"

**OBSERVED Source**: [observation-technique] execution:
```
[actual output/screenshot/response captured during observation]
```

**DELTA Rationale**: [Why this is OVERRIDE/NEW/REMOVE/KEEP]

**Location**: `path/to/file.py:45-60` - method `do_something()`

---

### B02: [Next Behavior]
...
```

## DELTA Classifications

| DELTA | Meaning | Action in Bridging | Action in Contracts |
|-------|---------|-------------------|---------------------|
| **OVERRIDE** | OBSERVED exists but wrong | Feature-flag bridge to new behavior | POST: new behavior replaces old |
| **NEW** | No OBSERVED implementation | Stub new method | POST: new behavior exists |
| **REMOVE** | OBSERVED exists but unwanted | Mark for deprecation | INV: behavior prohibited |
| **KEEP** | OBSERVED matches EXPECTED | No change needed | Document existing contract |

## Priority Guide

| Priority | Meaning | Criteria |
|----------|---------|----------|
| **P1** | Critical | Security, data integrity, core functionality |
| **P2** | Important | User-facing features, API contracts |
| **P3** | Nice-to-have | Internal improvements, edge cases |

## Example: API Authentication Refactor

```markdown
# DISCONNECT MATRIX: AuthService

**Date**: 2026-01-13
**Branch**: feature/constitutional-refactor-auth
**Source Prose**: "Users should authenticate with JWT tokens that expire after 24 hours"

## Summary

| Metric | Count |
|--------|-------|
| Total Behaviors | 5 |
| OVERRIDE | 2 |
| NEW | 2 |
| REMOVE | 1 |
| KEEP | 0 |

## Matrix

| ID | Behavior | EXPECTED | OBSERVED | DELTA | Location | Priority |
|----|----------|----------|----------|-------|----------|----------|
| B01 | Token validation | Validate JWT signature + expiry | Returns True always (stub) | OVERRIDE | auth.py:45 | P1 |
| B02 | Token expiry | 24-hour expiry | No expiry check | OVERRIDE | auth.py:52 | P1 |
| B03 | Refresh token | Issue refresh token on auth | Not implemented | NEW | N/A | P2 |
| B04 | Token revocation | Revoke on logout | Not implemented | NEW | N/A | P2 |
| B05 | Legacy session | N/A (remove) | Checks PHP session cookie | REMOVE | auth.py:30 | P3 |

## Evidence

### B01: Token validation

**EXPECTED Source**: req-elicit Phase 2, user stated: "Every API call must validate the JWT signature using our secret key"

**OBSERVED Source**: API observation with valid/invalid tokens:
```json
// Request with garbage token
POST /api/users HTTP/1.1
Authorization: Bearer garbage_not_a_real_token

// Response
HTTP/1.1 200 OK
{"users": [...]}  // Should have been 401!
```

**DELTA Rationale**: OVERRIDE - validation exists but always passes

**Location**: `src/auth.py:45` - method `validate_token()`

---

### B05: Legacy session

**EXPECTED Source**: req-elicit Phase 3, user stated: "We migrated from PHP years ago, no need for session cookies"

**OBSERVED Source**: Network observation showed cookie check:
```
Request headers examined for: PHPSESSID
Code path: if 'PHPSESSID' in request.cookies: ...
```

**DELTA Rationale**: REMOVE - legacy code path still active but unwanted

**Location**: `src/auth.py:30` - conditional block
```

## Halfstepping from Matrix

The DELTA + Location columns tell you WHERE to start coding:

| DELTA | Halfstep Strategy |
|-------|-------------------|
| OVERRIDE at `file:line` | Go to that location, understand current impl, build bridge |
| NEW with N/A location | Find appropriate insertion point (same module, new file?) |
| REMOVE at `file:line` | Mark for deletion AFTER bridges prove new behavior works |
| KEEP at `file:line` | Document existing behavior, write contract to preserve it |

## Validation Checklist

Before proceeding to Phase 2 (Bridging):

- [ ] Every behavior has EXPECTED from user dialogue (req-elicit)
- [ ] Every behavior has OBSERVED from execution (observation techniques)
- [ ] No OBSERVED came from code reading alone
- [ ] DELTA classification is clear for each row
- [ ] Location is specific (file:line) for OVERRIDE/REMOVE
- [ ] Priority reflects actual importance
- [ ] Evidence section has concrete execution artifacts

## Common Mistakes

| Mistake | Why It's Wrong | Fix |
|---------|---------------|-----|
| OBSERVED from code reading | Code shows intent, not actual behavior | Re-observe via execution |
| Missing Location for OVERRIDE | Can't halfstep without knowing where | Trace execution to find code path |
| Too many P1 items | Can't focus if everything is critical | Ruthlessly prioritize |
| Vague EXPECTED | "Should work better" isn't testable | Return to req-elicit for specifics |
