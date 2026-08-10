# Skill: feature-boundary-check

## Purpose
Before beginning implementation of a new feature, map which architectural boundaries it will cross and produce a plan that keeps each layer clean. This is a **planning** skill — it runs before code is written.

Compare to `refactor-boundary-check` which audits boundaries **after** code has been written. This skill prevents violations before they happen.

## When to Use
- Before starting any feature that will touch more than one package or layer
- When unsure which layer owns a new concept
- Before adding a dependency from one module to another
- When a feature request is ambiguous about where logic should live

## Inputs Required
- `feature_name`: short name (e.g., `user-search`, `export-pdf`)
- `description`: what the feature does (1–3 sentences)
- `affected_layers`: which layers you expect to touch (optional — will be derived if omitted)

## Output Expectations
A feature boundary plan:

### 1. Layer Ownership Map
For each aspect of the feature:
- Which layer owns this concern?
- Which files will be created or modified?
- What data flows from layer to layer?

### 2. Boundary Crossing Points
Each place where data or control crosses a layer boundary:
- What is passed across?
- Is there a type contract for it?
- Who defines the contract (which layer)?

### 3. Forbidden Crossings
Explicit list of crossings that must NOT happen:
- "The feature must not add a runtime dependency from X to Y"
- "The UI layer must not contain any of this business logic"

### 4. Domain-First Check
Before UI work begins:
- What domain types or rules does this feature require?
- Are they already defined, or must they be created first?
- Is there a test that can validate the core logic without the UI?

### 5. Implementation Order
Recommended sequence that respects layer constraints:
1. Define types/schema (innermost layer)
2. Write failing tests for core logic
3. Implement logic (middle layer)
4. Wire to UI/API/consumer (outermost layer)

### 6. Verdict
- CLEAN PATH: feature can be implemented without boundary risk
- BOUNDARY RISK: flag specific crossings to watch
- REDESIGN NEEDED: current structure can't support the feature cleanly — propose restructure first

## Constraints
- Do not write any implementation code in this skill
- If the domain layer doesn't support the feature yet, that work must come first
- Content must never be hardcoded in UI or logic layers — flag this if the feature involves displayable content
- Every boundary crossing must have an explicit type contract

## Provenance Dependency Graph (reference for all checks)
```
packages/content-schema  →  (no local deps)
packages/domain          →  packages/content-schema only
packages/content         →  packages/content-schema only
apps/desktop             →  packages/domain + packages/content-schema + packages/content
```
Any other direction is a violation.

## Example Invocation
```
/feature-boundary-check feature_name=document-link description="Player can link two documents as related evidence"
/feature-boundary-check feature_name=unlock-gate description="Puzzle unlocks when required evidence is linked" affected_layers=domain,desktop
/feature-boundary-check feature_name=case-loader description="Load a case JSON file from disk via Tauri"
```

## Common Failure Modes This Prevents
- Writing a React component before the domain type it consumes exists
- Hardcoding story content strings inside domain logic or UI components
- Introducing a circular dependency (domain ↔ desktop)
- Adding a direct import from packages/domain into apps/desktop/src/components without a store layer
- Discovering mid-implementation that the puzzle unlock rule can't be tested without React
