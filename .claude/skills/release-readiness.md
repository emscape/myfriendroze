# Skill: release-readiness

## Purpose
Validate that the application is in a shippable state before tagging a release or building a distributable.

## When to Use
- Before tagging a release version (`git tag vX.Y.Z`)
- Before running `tauri build` for distribution
- After completing a phase milestone

## Inputs Required
- `target_platform`: `windows` | `all` (default: `windows`)
- `release_type`: `alpha` | `beta` | `stable`

## Output Expectations
A release readiness checklist with PASS/FAIL per gate:

### Gate 1: Test Suite
- [ ] All Vitest unit tests pass (`pnpm test`)
- [ ] No skipped tests without documented reason
- [ ] Domain coverage ≥ 80%

### Gate 2: TypeScript
- [ ] `pnpm typecheck` exits 0 across all packages
- [ ] No `any` types introduced without comment

### Gate 3: Content Validation
- [ ] All cases pass schema validation
- [ ] No unreferenced evidence IDs
- [ ] No forward-reference unlock conditions

### Gate 4: Architecture
- [ ] No boundary violations (run `/refactor-boundary-check`)
- [ ] No business logic in UI components
- [ ] No hardcoded story content in React

### Gate 5: Build
- [ ] `pnpm build` exits 0
- [ ] Tauri build succeeds (Windows target)
- [ ] No console errors in production build

### Gate 6: Content Completeness
- [ ] At least one complete, playable case exists
- [ ] All puzzle unlock paths are reachable

## Constraints
- ALL gates must PASS for `stable` release
- Gates 1-4 must PASS for `alpha`/`beta`
- Never ship with known silent failures (QS5)
- Do not tag a release mid-feature-branch — merge to `main` first

## Example Invocation
```
/release-readiness target_platform=windows release_type=alpha
```
