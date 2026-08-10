# Skill: refactor-trigger-detector

## Purpose
Scan the codebase (or a specified scope) for concrete signals that refactoring is needed. Produces a prioritized list of refactor candidates with specific evidence — not subjective style opinions.

This skill identifies **when** to refactor. The actual refactoring uses other skills (`refactor-boundary-check`, `minimal-implementation-enforcer`).

## When to Use
- When work is slowing down and the cause is unclear
- After a phase of rapid feature development
- Before starting a new feature that touches old code
- Periodically as a health check on growing codebases
- When tests start breaking in unexpected places

## Inputs Required
- `scope`: directory or list of files to scan (default: entire source tree)
- `priority`: `size` | `coupling` | `tests` | `all` (default: `all`)

## Output Expectations
A prioritized refactor candidate list:

### Priority 1: Size Violations
- Files exceeding 500 LOC — list with current line count
- Functions exceeding 50 LOC — list with location
- These are hard signals: large files almost always contain mixed responsibilities

### Priority 2: Coupling Signals
- Files imported by more than 5 other files (high fan-in — change risk)
- Files that import from more than 5 other files (high fan-out — responsibility creep)
- Any import that crosses an architectural boundary (use config.json arch_rules)
- Circular imports or near-circular dependency chains

### Priority 3: Test Health
- Source files with no corresponding test file
- Test files with more describe/it blocks than assertions (theater tests)
- Tests that import from multiple layers (testing at the wrong level)
- TODO/SKIP markers in test files

### Priority 4: Duplication
- Similar function signatures appearing in multiple files
- Identical or near-identical code blocks (heuristic — flag candidates)
- Constants or magic values repeated in 3+ places

### 5. Refactor Priority Score
For each candidate:
- **Impact**: how many other files depend on it (higher = more important to fix)
- **Risk**: how many tests cover it (lower coverage = higher risk to touch)
- **Effort**: rough estimate (small / medium / large)
- **Recommendation**: extract | split | inline | delete | rewrite

## Constraints
- Report findings only — do not make changes
- Flag by evidence (line counts, import counts) not by opinion
- A file that is large but well-tested is lower priority than a small file with no tests
- Do not recommend refactoring recently-written code without evidence of a problem

## Example Invocation
```
/refactor-trigger-detector scope=packages/domain/src/ priority=all
/refactor-trigger-detector scope=packages/ priority=coupling
/refactor-trigger-detector scope=apps/desktop/src/ priority=tests
```

## Common Failure Modes This Prevents
- Accumulating 1000-LOC files until they become untouchable
- Discovering circular dependencies only when a build breaks
- Missing that a utility is being imported by everything (hidden global state risk)
- Shipping with zero test coverage on complex files
- Refactoring prematurely when there's no evidence of a problem yet
