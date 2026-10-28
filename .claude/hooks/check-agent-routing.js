#!/usr/bin/env node
/**
 * check-agent-routing.js
 * Hook type : UserPromptSubmit
 * Purpose   : Remind Claude Code to follow the correct workflow or invoke
 *             the right skill/agent before starting implementation work.
 *
 * Inputs (via stdin JSON):
 *   { prompt: string }
 *
 * Exit 0 = allow silently
 * Exit 1 = allow + print reminder to stderr (informational, not blocking)
 *
 * Routing table (prompt keywords → recommended workflow):
 *   schema / data model / type / interface       → model-first, plan before code
 *   test / tdd / failing test                    → /test-driven-development
 *   component / ui / layout / screen / panel     → UI best practices
 *   content / copy / document / write            → keep content out of code
 *   refactor                                     → scope check before changes
 *   bug / fix / broken / error                   → diagnose before changing
 *   plan / architect / design / structure        → plan before implement
 *   release / ship / deploy                      → pre-ship checklist
 *   implement / build / add feature / scaffold   → agent routing checklist
 */

// ─── HOW TO ADAPT THIS FILE FOR A NEW PROJECT ────────────────────────────────
// Each route has two parts:
//   keywords  — lowercase phrases matched against the user's prompt (substring match).
//               Add project-specific vocabulary here: domain nouns, file/package names,
//               framework names, feature-area jargon, custom skill/agent names, etc.
//   reminder  — lines printed to stderr when a keyword matches. These are informational
//               only (exit 1, not blocking). Point to your project's actual skills,
//               agents, package paths, commands, and constraints.
//
// Tips:
//   • Keep keywords lowercase; the prompt is .toLowerCase()'d before matching.
//   • Use leading/trailing spaces in keywords (' fix ') to avoid false positives.
//   • Add a new route object for any domain that doesn't fit the defaults below.
//   • Remove routes that have no equivalent in your project.
// ─────────────────────────────────────────────────────────────────────────────

const ROUTES = [
  {
    // Add project-specific schema vocabulary here:
    //   e.g. your ORM model names, proto/GraphQL type keywords, domain aggregate names,
    //   validation library keywords ('joi', 'yup', 'zod', 'pydantic', …), or the names
    //   of foundational shared packages that own your type contracts.
    keywords: ['schema', 'data model', 'domain type', 'domain logic', 'zod', 'type definition', 'interface definition'],
    reminder: [
      '📐 SCHEMA / DATA MODEL WORK DETECTED',
      '   1. Define types/schemas before writing any implementation or UI.',
      // Replace with your project's review gate, e.g.:
      //   '   2. Get architect review before touching packages/core-types.'
      '   2. Get architect review before changing shared or foundational models.',
      '   3. Follow TDD: write a failing test against the new shape first.',
    ],
  },
  {
    // Add your project's test framework keywords if relevant:
    //   e.g. 'jest', 'vitest', 'pytest', 'rspec', 'go test', 'cypress', 'playwright'
    keywords: ['write test', 'failing test', 'tdd', 'red green', 'unit test', 'add test', 'test coverage'],
    reminder: [
      '🧪 TDD WORK DETECTED',
      // Replace /test-driven-development with your project's TDD skill name if different.
      '   Invoke /test-driven-development skill.',
      '   Follow RED → GREEN → COMMIT → REFACTOR.',
      '   Do NOT write implementation before the test exists and fails.',
    ],
  },
  {
    // Add UI-layer keywords specific to your stack:
    //   e.g. 'tailwind', 'shadcn', 'mui', 'chakra', 'swiftui', 'jetpack compose',
    //   or area names like 'dashboard', 'drawer', 'toast', 'wizard', 'page'
    keywords: ['component', 'ui ', ' ui', 'layout', 'screen', 'panel', 'sidebar', 'modal', 'styling', 'styles'],
    reminder: [
      '🎨 UI WORK DETECTED',
      // Replace with your project's UI constraints, e.g.:
      //   '   No direct store/service imports in presentational components — pass props.'
      //   '   UI agent: ui-builder. Domain types must exist before UI is scaffolded.'
      '   Presentational components should receive props only — avoid tight coupling to stores/services.',
      '   Ensure domain types and data contracts are defined before building UI on top of them.',
    ],
  },
  {
    // Add your project's content/copy vocabulary:
    //   e.g. CMS entry types, localisation keys, content package names, markdown file paths,
    //   or domain-specific content nouns ('blog post', 'email template', 'help article')
    keywords: ['write content', 'add copy', 'document content', 'static content', 'copy change'],
    reminder: [
      '📜 CONTENT / COPY WORK DETECTED',
      // Replace with your project's content location and validation command, e.g.:
      //   '   All content lives in packages/content — never hardcoded in source files.'
      //   '   Run `npm run validate:content` after editing JSON/YAML content files.'
      '   Keep content out of application logic — store in dedicated content files or a CMS.',
      '   Do not hardcode user-facing strings directly in component or logic files.',
    ],
  },
  {
    // 'refactor' is usually broad enough — add synonyms if your team uses specific terms,
    //   e.g. 'extract service', 'move to module', 'split package', 'rename module'
    keywords: ['refactor'],
    reminder: [
      '♻️  REFACTOR DETECTED',
      // Replace with your project's refactor skill if you have one, e.g.:
      //   '   Invoke /refactor-boundary-check before moving code across packages.'
      '   Scope the change before starting: what moves, what stays, what breaks?',
      '   Confirm tests pass before and after. Do not mix refactor with feature work.',
    ],
  },
  {
    // Adjust ' fix ' spacing / add synonyms as needed for your team's vocabulary.
    keywords: ['bug', ' fix ', 'broken', 'not working', 'error', 'failing', 'crash'],
    reminder: [
      '🐛 BUG / FIX DETECTED',
      // Replace with your project's QA agent name if you have one, e.g.:
      //   '   Use the qa-reviewer agent. Reproduce before patching.'
      '   Diagnose root cause before changing code — read the error, check assumptions.',
      '   Do not retry the identical fix blindly. Escalate to the user if stuck after investigation.',
    ],
  },
  {
    // Add your project's planning/design vocabulary if different.
    keywords: ['plan', 'architect', 'design', 'structure', 'how should', 'approach'],
    reminder: [
      '🏛️  PLANNING / ARCHITECTURE DETECTED',
      // Replace with your project's architect agent/skill name if you have one.
      '   Use the Plan (architect) subagent for design decisions.',
      '   Propose a short written plan before any implementation begins.',
      '   Get explicit approval before proceeding to code.',
    ],
  },
  {
    // Add your project's deploy/release vocabulary:
    //   e.g. 'merge to main', 'cut release', 'tag version', 'push to prod', CI pipeline names
    keywords: ['release', 'ship', 'deploy', 'publish'],
    reminder: [
      '🚀 RELEASE / DEPLOY DETECTED',
      // Replace with your project's release skill and checklist, e.g.:
      //   '   Invoke /release-readiness. Ensure CHANGELOG, version bump, and tag are ready.'
      //   '   Confirm deployment target (staging vs prod) and env-specific secrets.'
      '   Run the pre-ship checklist: tests green, changelog updated, no debug artifacts.',
      '   Confirm deployment target and any environment-specific config before pushing.',
    ],
  },
  {
    // Add your project's feature-work vocabulary:
    //   e.g. names of custom scaffold skills, multi-package workspace commands,
    //   or area-specific nouns that signal new feature work ('add route', 'new endpoint')
    keywords: ['implement', 'build', 'add feature', 'add support', 'scaffold'],
    reminder: [
      '⚙️  IMPLEMENTATION WORK DETECTED',
      '   Before writing code:',
      // Replace with your project's agent roster and scaffold skill, e.g.:
      //   '   1. Identify the correct agent (domain-engineer / ui-builder / content-editor).'
      //   '   2. Invoke /feature-scaffold if this touches multiple packages.'
      '   1. Identify the right subagent type (Plan / Explore / general-purpose).',
      '   2. Define or confirm data contracts/types first.',
      '   3. Start with a failing test via /test-driven-development.',
    ],
  },
];

const chunks = [];
process.stdin.on('data', c => chunks.push(c));
process.stdin.on('end', () => {
  let data;
  try {
    data = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    process.exit(0);
  }

  const prompt = (data?.prompt ?? '').toLowerCase();
  if (!prompt) process.exit(0);

  const matched = [];
  for (const route of ROUTES) {
    if (route.keywords.some(kw => prompt.includes(kw))) {
      matched.push(route);
    }
  }

  if (matched.length === 0) process.exit(0);

  process.stderr.write('\n┌─ AGENT ROUTING REMINDER ────────────────────────────────────────\n');
  for (const route of matched) {
    route.reminder.forEach(line => process.stderr.write(`│  ${line}\n`));
    if (matched.indexOf(route) < matched.length - 1) {
      process.stderr.write('│\n');
    }
  }
  process.stderr.write('└──────────────────────────────────────────────────────────────────\n\n');

  process.exit(1);
});
