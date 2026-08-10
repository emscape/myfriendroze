# Skill: refactor-boundary-check

## Purpose
Verify that a proposed or completed refactor does not violate architectural package boundaries before committing or merging.

## When to Use
- Before any refactor that touches more than one package
- When moving code between packages
- After a large edit session that spanned multiple directories
- When adding a new import across packages

## Inputs Required
- `changed_files`: list of files modified (or `git diff --name-only` output)
- `refactor_intent`: one-sentence description of what the refactor does

## Output Expectations
A boundary check report with:
1. **Import audit**: any cross-package imports that violate the dependency graph
2. **Dependency graph violations**: allowed → `content-schema → (none)`, `domain → content-schema`, `desktop → domain + content-schema + content`
3. **UI logic leak**: any business logic found in `apps/desktop/src/components/`
4. **Domain contamination**: any React/Tauri/UI imports found in `packages/domain`
5. Verdict: CLEAN | VIOLATIONS FOUND (list each)

## Allowed Dependency Graph
```
packages/content-schema   →  (no deps on other local packages)
packages/domain           →  packages/content-schema
packages/content          →  packages/content-schema
apps/desktop              →  packages/domain, packages/content-schema, packages/content
```

## Constraints
- Reverse dependencies are ALWAYS violations (e.g., domain importing from desktop)
- `packages/domain` must have zero browser/React/Tauri imports
- `packages/content-schema` must have zero runtime logic beyond Zod schemas
- Never approve a refactor with open violations — fix before proceeding (CL3)

## Workflow
```
1. Run: git diff --name-only HEAD (or review provided file list)
2. For each changed file, determine package ownership
3. Check imports in each changed file for cross-package violations
4. Cross-reference against allowed dependency graph
5. Scan domain files for UI contamination
6. Scan desktop components for business logic
7. Emit CLEAN or list violations
```

## Example Invocation
```
/refactor-boundary-check changed_files="packages/domain/src/unlock.ts,apps/desktop/src/store/gameStore.ts" refactor_intent="extract unlock logic from store into domain"
```
