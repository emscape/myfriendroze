# Skill: puzzle-reviewer

## Purpose
Review a puzzle definition for logical correctness, playability, and architectural conformance before it enters a playable build.

## When to Use
- Before merging a new puzzle or case into `main`
- After modifying unlock conditions or evidence requirements
- When a tester reports a puzzle is unsolvable or softlocking

## Inputs Required
- `puzzle_id`: the puzzle to review (matches ID in `packages/content`)
- `case_id`: the parent case
- `review_mode`: `logic` | `playability` | `full` (default: `full`)

## Output Expectations
1. **Logic check**: Are all referenced evidence IDs resolvable? Do unlock conditions form a DAG (no cycles)?
2. **Playability check**: Is there at least one valid path from start to unlock? Are all required clues discoverable?
3. **Schema check**: Does the puzzle JSON conform to `PuzzleSchema`?
4. **Test coverage check**: Does `packages/domain` have at least one test for this puzzle's unlock logic?
5. Summary: PASS / FAIL with specific issues listed

## Constraints
- Reviewer must not modify content — only report
- If tests are missing, emit a BLOCKER (do not ship without coverage)
- Do not approve puzzles with cycles in unlock dependencies
- Do not approve puzzles that require content not yet authored

## Workflow
```
1. Load puzzle JSON from packages/content/cases/<case_id>/puzzles/<puzzle_id>.json
2. Validate against PuzzleSchema (Zod)
3. Trace all unlock_condition evidence references — verify each exists in case documents
4. Check for dependency cycles (build adjacency list, DFS)
5. Verify domain unit test exists for this puzzle's unlock rule
6. Emit report: PASS or list of FAIL items
```

## Example Invocation
```
/puzzle-reviewer puzzle_id=ledger_reconciliation case_id=case_001_the_missing_ledger review_mode=full
```

## Escalation
If any FAIL items are found, raise as BLOCKER in the response template.
Never ship a case with unresolved FAIL items.
