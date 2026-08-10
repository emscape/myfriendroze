# Skill: state-consistency-check

## Purpose
Verify that state shapes are consistent between all their producers and consumers: the type that gets written into state must be the same type that gets read out. Catches the class of bugs where a state store, cache, or shared data structure drifts out of sync with the code that uses it.

## When to Use
- After modifying a domain type or data model
- When a store/cache/context has multiple writers
- After renaming or restructuring a type
- When a component or function is reading fields that "should be there"
- When state-related bugs appear at runtime but not in unit tests

## Inputs Required
- `state_owner`: file that defines or initializes the state (e.g., store, context, model)
- `consumers`: list of files that read from this state (or `auto` to search from the state_owner)
- `producers`: list of files that write to this state (or `auto`)

## Output Expectations
A state consistency report:

### 1. Type Map
- What type does the state owner declare?
- What type does each producer write?
- What type does each consumer expect?

### 2. Drift Points
For each mismatch:
- **Location**: which file and field
- **Expected**: what the consumer assumes
- **Actual**: what the producer writes
- **Risk**: data loss | silent wrong value | runtime crash

### 3. Null / Undefined Safety
- Fields read without null-check that can be absent
- Optional fields that consumers treat as required

### 4. Stale Reads
- Are there code paths where state is read before it has been written?
- Is initial/default state compatible with all consumers?

### 5. Verdict
- CONSISTENT: all shapes align
- DRIFT FOUND: list specific mismatches to fix
- STRUCTURAL MISMATCH: the state shape needs to be redesigned

## Constraints
- Do not modify any files — report only
- If types cannot be statically determined, note "runtime shape unknown" rather than guessing
- Flag every unchecked access to potentially-absent fields
- If multiple sources of truth exist for the same data, flag it explicitly

## Example Invocation
```
/state-consistency-check state_owner=apps/desktop/src/store/gameStore.ts consumers=auto producers=auto
/state-consistency-check state_owner=packages/domain/src/types/puzzle.ts consumers=apps/desktop/src/store/gameStore.ts,apps/desktop/src/components/EvidenceBoard.tsx producers=packages/domain/src/unlock.ts
```

## Common Failure Modes This Prevents in Provenance
- Renaming a field in `CaseState` or `PuzzleState` without updating the Zustand store slice
- Domain `loadCase()` returns `CaseState` but store assigns it to a field typed as `CaseState | null` — component reads it without null check
- `gameStore` initializes with `null` for `activeCase` but `DocumentViewer` reads it before first load
- Two producers (`loadCase` and `resetCase`) writing `puzzles` field with different shapes
- `EvidenceBoard` component reads `linkedEvidence` assuming it's always an array when it can be `undefined` on first render
