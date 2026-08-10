# Skill: repo-bootstrap-audit

## Purpose
Perform a structured first-pass audit of an unfamiliar repository before beginning any implementation work. Produces an orientation report covering project structure, entry points, constraints, and missing configuration — without making any changes.

## When to Use
- First time working in a repository
- Resuming work after an extended break
- Onboarding a new sub-agent to the codebase
- Before estimating scope for a new feature

## Inputs Required
- None required. Optionally provide:
  - `focus_area`: subdirectory or concern to prioritize (e.g., `src/api`, `tests`, `config`)
  - `depth`: `shallow` | `full` (default: `shallow`)

## Output Expectations
An orientation report with the following sections:

### 1. Entry Points
- Main source directory
- Test runner and test locations
- Build command (if discoverable)
- Package manager (if applicable)

### 2. Package/Module Boundaries
- List of top-level packages or modules
- Any workspace configuration found
- Apparent dependency direction (which depends on which)

### 3. Configuration Health
- Are lint, test, typecheck commands defined?
- Is there a `.claude/hooks/config.json`? Is it populated?
- Is there a `CLAUDE.md` or equivalent constraints file?
- Missing configuration flagged explicitly

### 4. Code Quality Signals
- Presence of test files (ratio of test to source files, rough estimate)
- Any files exceeding 500 LOC (flag these)
- TODO/FIXME density (rough count only)
- Obvious code smells (deeply nested imports, circular-looking dependency names)

### 5. Open Questions
- Anything ambiguous that requires clarification before implementing
- List with explicit "I DO NOT KNOW" rather than guessing

## Constraints
- READ ONLY — do not modify any file
- Do not guess at framework from a single file — check multiple signals before concluding
- If a CLAUDE.md or constraints file exists, read it first and surface its rules
- Report must include an explicit "Ready to implement: YES / NO / NEEDS CLARIFICATION" verdict

## Example Invocation
```
/repo-bootstrap-audit
/repo-bootstrap-audit focus_area=src/api depth=full
```

## Common Failure Modes This Prevents
- Starting implementation without understanding the dependency graph
- Introducing a package manager assumption (pnpm vs npm vs cargo vs pip)
- Violating constraints that were documented but not read
- Touching files in a layer that has an existing owner (agent or team member)
- Introducing a framework import into a framework-free module
