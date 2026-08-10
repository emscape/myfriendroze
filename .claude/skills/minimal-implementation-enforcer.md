# Skill: minimal-implementation-enforcer

## Purpose
Review completed or in-progress code for over-engineering: unnecessary abstractions, premature generalization, speculative design, and unused complexity. Returns a concrete list of simplifications with rationale.

This skill enforces the principle: **the right amount of code is the minimum that correctly solves the problem as stated**.

## When to Use
- After finishing a feature implementation before committing
- When a file has grown beyond its original intent
- When reviewing a PR that "feels too complex"
- When an implementation introduces an abstraction for a single use case
- Anytime you catch yourself adding a parameter "just in case"

## Inputs Required
- `files`: list of files to review (or describe the change in words)
- `original_requirement`: one sentence — what was actually asked for

## Output Expectations
A review report with:

### 1. Complexity Flags
For each flag:
- **Location**: file + line range
- **Pattern**: which anti-pattern (see list below)
- **Verdict**: remove | simplify | justify or remove

### 2. Anti-Patterns Checked
- **Unused parameters**: function accepts arguments that are never used
- **Single-use abstraction**: helper/utility exists for exactly one call site
- **Speculative generalization**: code handles cases the requirement doesn't mention
- **Premature interface**: interface or abstract class with one implementation
- **Config for one value**: configuration mechanism wrapping a single fixed value
- **Error handling for impossible states**: catching errors that can't occur
- **Comments explaining obvious code**: comment restates what the code already says
- **Dead code**: unreachable branches, commented-out blocks, unused exports
- **Feature flags with no toggle**: `if (true)` / `if (false)` wrappers left in
- **Validation at internal boundaries**: input validation where inputs are trusted

### 3. Verdict
- MINIMAL: no significant over-engineering found
- SIMPLIFY: list of specific changes to make before shipping
- REDESIGN: the abstraction itself is wrong — revisit the approach

## Constraints
- Do NOT suggest adding features, refactoring style, or improving names unless they mask a complexity problem
- Do NOT flag necessary complexity — if the requirement is complex, the code may be too
- Suggestions must be actionable: "remove lines 42–67 and inline the value" not "consider simplifying"
- If in doubt, keep the simpler version

## Example Invocation
```
/minimal-implementation-enforcer files=src/parser.ts original_requirement="parse a JSON config file"
/minimal-implementation-enforcer files=src/auth/ original_requirement="check if user token is valid"
```

## Common Failure Modes This Prevents
- Shipping a plugin system for code that will never have a second plugin
- Adding a configuration layer to a value that never changes
- Wrapping a 3-line operation in a class hierarchy
- Introducing error recovery for errors that cannot happen at the call site
- Writing adapters for external APIs that have one real implementation
