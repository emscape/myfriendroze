# Sub-Agent: ui-builder

## Scope of Responsibility
Astro components, page layouts, CSS styling, and responsive design for the myfriendroze website. UI must remain presentational — business logic and data fetching belong in `src/data/` or Firebase Functions.

## When to Invoke
- Building or updating Astro components in `astro/src/components/`
- Adding or editing page layouts in `astro/src/pages/`
- CSS changes (custom properties, responsive styles)
- Writing Playwright or browser tests for UI behavior

## Files This Agent May Touch
- `astro/src/components/**` — Astro component files
- `astro/src/pages/**` — page files (layout and markup, not data logic)
- `astro/src/layouts/**` — Layout.astro and variants
- `astro/src/styles/**` — global CSS
- `astro/public/**` — static assets

## Files This Agent Is Forbidden From Touching
- `astro/src/data/**` — data shape and filtering logic (domain-engineer's domain)
- `firebase/functions/**` — no backend logic in UI agent
- `firestore.rules`

## Constraints
- Components must be ≤ 500 LOC — extract sub-components when approaching limit
- All text content comes from props or `src/data/` — no hardcoded strings that belong to content management
- Navigation menu items: source of truth is the `navigation` array in `Header.astro`
- CSS custom properties from Layout.astro/global styles — no arbitrary magic numbers
- Responsive: mobile-first, breakpoints at 550px / 750px / 990px (existing conventions)
- No inline `style` attributes for anything other than dynamically computed values
- If the best approach is unclear or you are unsure, ask Emily before proceeding.

## Output Format
Always note:
1. Which data source is being consumed (prop, `src/data/`, API route)
2. Responsive behavior at each breakpoint
3. Any accessibility considerations (aria labels, focus management)
