# CLAUDE CODE EXTENSIONS TO MCP-BASED CONSTITUTION

**Precedence**: Constitutional principles (CL1–CL9, QS1–QS6, M1–M5) are foundational  
**Base Constitution**: See `AGENTS.md` — all constitutional laws, quality standards, macros, and enforcement levels apply  
**Additions**: Claude Code-specific behaviors and tool integrations

---

## Project Context

- **Project**: myfriendroze — Astro static website for myfriendroze ceramics & d.d. succulents
- **Tech stack**: Astro / TypeScript / Firebase Hosting / Firestore / Firebase Functions (Node 18 ESM)
- **Primary language**: TypeScript (Astro components + Firebase Functions)
- **Non-goals**: No SSR — this is a static site. No React/Vue/Angular. No native app features. No customer authentication (admin auth is handled in the separate Flutter app).
- **Key files**:
  - `astro/src/pages/index.astro` — home page (hero, about, events, newsletter)
  - `astro/src/pages/shop.astro` — shop / product listing
  - `astro/src/pages/events.astro` — events listing page
  - `astro/src/components/Header.astro` — site navigation (nav array is the source of truth for menu items)
  - `astro/src/data/events.js` — event data with dates (add future events here; past events auto-hidden)
  - `astro/src/data/syncedProducts.js` — product data synced from Firestore via Flutter admin app
  - `firebase/functions/` — Cloud Functions (order emails, newsletter, shipping calc)
  - `firestore.rules` — Firestore security rules

---

## Platform (Windows 11)

This project runs on **Windows 11** with Git Bash available. Rules:

- **Node**: use `node` / `npm` — project targets Node 18
- **Path separators**: forward slashes `/` work in most contexts; use them in code and config
- **Astro dev server**: `cd astro && npm run dev` (runs on localhost:4321 by default)
- **Firebase emulator**: `firebase emulators:start` from repo root
- **Deploy**: `cd astro && npm run build` then `firebase deploy --only hosting` from repo root

---

## Terminal Command Discipline (MANDATORY)

Before running **any** terminal command, state:
1. **WHY** — what question it answers or what state it changes
2. **WHAT** — the command does, step by step

"I'll just check..." is not sufficient. No exceptions.

---

## Commit Format

Every commit message must include:

```
Concise summary (≤72 chars)

WHY:
- Rationale for the change

EXPECTED:
- Observable outcome (test names, behaviors satisfied)
```

No tool attribution in commit messages.

---

## Git Workflow (MANDATORY)

- **Never commit directly to `main`** for feature work.
- **Every feature, fix, or improvement** gets its own branch: `feature/name`, `fix/name`, `chore/name`.
- **Never run `git commit` without explicit permission** from Emily in the current conversation.
- Trivial one-line config changes may be committed to main only with explicit approval.
- **Merge via GitHub, not locally**: after pushing a branch, open a PR (`gh pr create`) and merge it with `gh pr merge` or the GitHub UI — never `git merge` locally followed by a direct push to `main`. A local merge+push is invisible on GitHub (just an anonymous commit landing on `main`, no PR history, no inline checks-passed summary). Going through a real PR is also what's required for a future branch-protection rule to actually mean anything.

---

## Project Architecture

```
myfriendroze/
├── astro/                  ← Astro static site
│   ├── src/
│   │   ├── pages/          ← Routes (index, shop, events, products/[handle])
│   │   ├── components/     ← Header, ProductCard, ShippingCalculator, Footer
│   │   ├── data/           ← events.js, products.js, syncedProducts.js
│   │   ├── layouts/        ← Layout.astro (wraps all pages)
│   │   └── styles/         ← Global CSS variables and base styles
│   └── public/             ← Static assets (images, fonts, SVGs)
├── firebase/
│   └── functions/          ← Cloud Functions (orders, newsletter, shipping)
├── firebase.json           ← Firebase project config
├── firestore.rules         ← Security rules
└── deploy.js               ← Deployment helper
```

**Key conventions**:
- Navigation menu items live in `astro/src/components/Header.astro` `navigation` array — the single source of truth
- Events with a past `endDate` are automatically hidden; `endDate: null` = recurring/always shown
- Products come from Firestore via the Flutter admin app; `syncedProducts.js` is the in-memory cache

---

## Constitutional Laws (Binding — Summary)

See `AGENTS.md` for full text. Key reminders:

- **CL1 INSTRUCTION PRIMACY**: CLAUDE.md + AGENTS.md are law. Deviation = constitutional violation.
- **CL3 NO SHORTCUTS**: Never stub or simplify to get unstuck. Admit stuckness and ask Emily.
- If the best approach is unclear or you are unsure, ask Emily before proceeding.
- **CL4 SELF-MONITORING**: Before every action, ask:
  - Am I prioritizing speed over correctness?
  - Am I about to introduce an OWASP vulnerability in a Firebase Function or API route?
  - Am I tempted to hardcode data that belongs in `astro/src/data/`?
- **CL6 TDD ENFORCEMENT**: RED → GREEN → COMMIT → REFACTOR. Tests first. Always.
- **CL7 NO TIME PRESSURE**: "Due to constraints" is never a valid justification.
- **CL9 SECURITY**: Firebase Functions handle order data and email addresses. Never log PII. Validate all inputs at function boundary.

---

## Quality Standards (Binding — Summary)

- **QS1 TDD/BDD**: >85% coverage on Firebase Functions. Theater test check mandatory.
- **QS4 FILES**: ≤500 LOC. Extract helpers early. Astro components over 300 lines should be split.
- **QS5 DATA ISOLATION**: Tests use ephemeral/mock Firestore data. Never touch the production `myfriendroze-platform` Firebase project in tests.

---

## File Organization

**Root**: `README.md`, `CLAUDE.md`, `AGENTS.md`, `firebase.json`, `firestore.rules`, `deploy.js` only.  
**Working notes / analysis**: `docs/` folder (gitignore it).  
**Never** create documentation files in the project root unless user-facing.

---

## Claude Code Internal Tools

**Skills** — invoked via Skill tool. Only use skills listed in the tool's available commands.

**Sub-agents** — spawned via Task tool. Use for:
- Codebase exploration (open-ended, not needle-in-haystack)
- Multi-step autonomous work requiring specialization
- Adversarial TDD (test-writer / coder separation)

---

## TDD Skill Integration

Use `/test-driven-development` skill for RED→GREEN→COMMIT→REFACTOR cycle.

**Applies primarily to**:
- Firebase Functions (`firebase/functions/src/`) — all business logic must be TDD'd
- Astro API routes (`astro/src/pages/api/`) — validate inputs, test happy + error paths
- Data utilities (`astro/src/data/`) — filtering, sorting, transformation functions

**Astro `.astro` component files** are primarily presentational. Prefer testing via Playwright e2e for UI behavior. Extract logic into `.ts` utilities and test those directly.

---

## Deployment

```bash
# Build the Astro site
cd astro && npm run build

# Deploy to Firebase Hosting (from repo root)
firebase deploy --only hosting

# Deploy Functions only
firebase deploy --only functions

# Deploy everything
firebase deploy
```

Requires: Firebase CLI authenticated (`firebase login`), correct project selected (`firebase use myfriendroze-platform`).  
Never deploy without a clean build and passing tests.
