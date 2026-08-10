# Skill: content-case-author

## Purpose
Author a new investigation case as structured data, conforming to `packages/content-schema` Zod schemas.

## When to Use
- Adding a new case (investigation scenario) to `packages/content`
- Writing documents, clues, cross-references, or unlock conditions for an existing case
- Extending an existing case with new content nodes

## Inputs Required
- `case_id`: stable snake_case identifier (e.g., `case_001_the_missing_ledger`) — never rename after publish
- `title`: human-readable case title
- `documents`: list of document stubs (id, type, title, content_summary)
- `puzzles`: list of puzzle definitions (id, unlock_condition, required_evidence)
- `author_notes`: optional narrative/tone guidance

## Output Expectations
1. New case directory: `packages/content/cases/<case_id>/`
2. `index.json` — case metadata conforming to `CaseSchema`
3. `documents/*.json` — each document conforming to `DocumentSchema`
4. `puzzles/*.json` — each puzzle conforming to `PuzzleSchema`
5. Schema validation passes: `pnpm --filter content validate`

## Constraints
- IDs are IMMUTABLE once defined — never rename without a migration note in `docs/MIGRATIONS.md`
- NO story content inside React components or domain code — content lives here exclusively
- Every document must have a stable `id` field
- Unlock conditions must reference existing evidence IDs — no forward references unless documented
- Keep individual content files under 200 lines; split large documents into sections

## Workflow
```
1. Review existing cases in packages/content/cases/ for ID conventions
2. Draft case index.json with metadata only (no embedded documents)
3. Author each document as a separate JSON file
4. Define puzzles referencing document IDs
5. Run content validation: pnpm --filter content validate
6. Fix any schema errors before committing
7. Commit: "content: add case <case_id>"
```

## Example Invocation
```
/content-case-author case_id=case_001_the_missing_ledger title="The Missing Ledger" documents=[invoice_1847,ledger_page_3,correspondence_foyle]
```

## Validation Gate
Content MUST pass schema validation before any UI work references it.
If validation fails — fix content, do not adjust schemas to fit bad content.
