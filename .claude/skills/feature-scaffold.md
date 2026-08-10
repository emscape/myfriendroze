# Skill: feature-scaffold

## Purpose
Scaffold a new feature across the correct architectural packages, respecting domain-first design and content-as-data principles.

## When to Use
- Adding a new gameplay mechanic or domain concept (e.g., cross-referencing, annotation, unlock trigger)
- Starting work that will touch both `packages/domain` and `apps/desktop`
- Any time a feature requires a new entity, rule, or state machine

## Inputs Required
- `feature_name`: short identifier (e.g., `document-link`, `unlock-gate`)
- `domain_concept`: what entity or rule this introduces
- `affected_packages`: which packages are in scope (default: domain + desktop)

## Output Expectations
1. Domain type definition stub in `packages/domain/src/types/`
2. Zod schema stub in `packages/content-schema/src/`
3. Unit test skeleton in `packages/domain/src/tests/`
4. React component stub in `apps/desktop/src/components/` (ONLY after domain types exist)
5. One-line entry in `docs/TODO.md` under the relevant phase

## Constraints
- NEVER write React code before domain types and tests exist
- NEVER hardcode content inside a React component
- Domain code must have zero imports from `apps/desktop`
- Keep each generated file under 100 LOC (stubs only)
- Follow QS4: no file may exceed 500 LOC at scaffold time
- Commit after domain scaffold and again after UI scaffold (two separate commits)

## Workflow
```
1. Define domain type (TypeScript interface / discriminated union)
2. Write failing test for the type's core invariant (RED)
3. Implement minimal type to pass test (GREEN)
4. Commit: "feat(domain): scaffold <feature_name> type"
5. Add Zod schema for content representation
6. Commit: "feat(content-schema): add <feature_name> schema"
7. Add React stub (props only, no logic)
8. Commit: "feat(desktop): add <feature_name> component stub"
```

## Example Invocation
```
/feature-scaffold feature_name=document-link domain_concept="bidirectional link between two documents"
```

## Architectural Reminder
Ask before acting: "Can this be implemented in the domain layer first?" (from CLAUDE.md)
If the answer is yes — it always is at scaffold time — start there.
