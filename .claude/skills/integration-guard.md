# Skill: integration-guard

## Purpose
Verify that two independently-developed modules, components, or services can actually be wired together at runtime — before integration work begins or is merged. Catches interface mismatches, assumption gaps, and missing contracts that only surface when the pieces meet.

This is distinct from `refactor-boundary-check` (which audits static import violations) — integration-guard checks **runtime wiring compatibility**.

## When to Use
- Before connecting a new backend function to a UI component
- Before wiring a new domain type into an existing state store
- Before replacing a stub/mock with a real implementation
- When two independently-developed pieces are about to be joined
- Before merging a feature branch that touches an integration seam

## Inputs Required
- `producer`: the module/function/component that produces data (name + file path)
- `consumer`: the module/function/component that consumes it (name + file path)
- `contract`: the expected interface between them (type name, function signature, or description)

## Output Expectations
An integration readiness report:

### 1. Interface Audit
- Does the producer's output type match the consumer's expected input type?
- Are optional fields handled on both sides?
- Are error/null states handled (what happens when producer returns nothing)?

### 2. Assumption Gaps
- What does the consumer assume that the producer does NOT guarantee?
- What does the producer emit that the consumer ignores?
- Are there implicit ordering or timing assumptions?

### 3. Missing Tests
- Is there a test that exercises this integration path end-to-end?
- Is there a test for the failure case (producer errors, consumer receives null)?

### 4. Verdict
- READY: wire it up
- GAPS FOUND: list of issues to resolve first
- BLOCKED: fundamental interface mismatch — redesign needed

## Constraints
- This skill is diagnostic only — do not implement fixes
- If the contract is ambiguous, emit BLOCKED and request clarification rather than guessing
- Integration tests (when missing) should be noted as BLOCKER, not skipped
- Do not approve integrations where error paths are unhandled

## Example Invocation
```
/integration-guard producer=packages/domain/src/case.ts consumer=apps/desktop/src/store/gameStore.ts contract=CaseState
/integration-guard producer=apps/desktop/src-tauri/src/lib.rs consumer=apps/desktop/src/store/gameStore.ts contract="invoke('load_case')"
/integration-guard producer=packages/domain/src/unlock.ts consumer=apps/desktop/src/store/gameStore.ts contract=UnlockResult
```

## Common Failure Modes This Prevents
- `loadCase()` returns `CaseState | null` but the Zustand store assigns it without a null check
- Tauri `invoke("load_case")` returns raw JSON but the store assigns it without Zod parsing
- Wiring unlock logic to a store slice before the domain type is fully defined
- Integrating without a Vitest test (or Playwright test for UI flow) that proves the wire works
- Shipping a stubbed `loadCase()` that returns hardcoded data — "works in dev, will fix later"
