# Claude Code Hooks — Portable Base Template

A repo-agnostic set of Claude Code hooks that enforce architecture rules, guard dependency installs, block .env reads, require terminal-command descriptions, validate commit-message format, unconditionally block PR/protected-branch merges, audit pushes for secrets, block deleting a branch a stacked PR still bases off, verify CI status after a push, validate content files, and print a project orientation banner at session start.

All behavior is controlled by **`config.json`** — no project logic is hardcoded in the hook scripts.

---

## Files

| File | Purpose |
|---|---|
| `config.json` | Shared defaults for the config-aware hooks; four hooks ignore it (see "Hooks that ignore config") (per-project overrides: `<project>/.claude/hooks.config.json`, see "Project-local overrides") |
| `lib/hook-config.cjs` | Shared loader: reads `config.json` from the hooks directory and merges the optional project-local override over it |
| `lib/git-command.cjs` | Shared command parser for the git/gh guards (merge, branch-delete, push-audit, CI status): quote-aware segment splitting, env/sudo/`bash -c` unwrapping, path-qualified binaries, git/gh global options such as `git -C "<dir>"`, `$(...)`/backtick substitutions and `( ... )` subshells parsed as commands of their own, and the working directory each command runs in, tracked through `cd`/`pushd` and `git -C` (unknown for `cd "$VAR"`, `cd -` and the like) |
| `check-arch-boundary.js` | PreToolUse: block file writes that violate package rules |
| `check-dep-guard.js` | PreToolUse: warn on dependency installs |
| `check-script-exists.js` | PreToolUse: warn/block when an npm run script doesn't exist; detect no-op commands |
| `check-env-guard.js` | PreToolUse: block reads of `.env` files |
| `check-bash-description.js` | PreToolUse: block Bash calls without a description |
| `check-commit-message.js` | PreToolUse: block `git commit` commands that do not include WHY/EXPECTED |
| `check-merge-guard.js` | PreToolUse: unconditionally block `gh pr merge`, a merge-REST `PUT`, a local `git merge` on master/main, or a push that lands commits directly on master/main |
| `check-git-push-audit.js` | PreToolUse: audit a `git push` diff for secrets (blocks), debug statements, commented-out code, lockfile drift, missing tests |
| `check-branch-delete-guard.js` | PreToolUse: block `git push --delete`/`:branch` when an open PR still bases off that branch |
| `check-search-command.js` | PreToolUse: nudge (or block) raw shell `grep`/`find`/`cat`/`head`/`tail` in favor of dedicated search/read tools |
| `validate-content.js` | PostToolUse: run validation after watched files change |
| `check-empty-tests.js` | PostToolUse: fail when test files have empty blocks or no assertions |
| `check-todo-format.js` | PostToolUse: warn/block on non-conforming TODO comment format |
| `check-ci-status-after-push.js` | PostToolUse: after a push, block until the matching GitHub Actions run completes and report the real result |
| `session-start.sh` | Optional manual wrapper that invokes session-start.cjs (no longer registered in hooks.json) |
| `session-start.cjs` | SessionStart: loads config through `lib/hook-config.cjs` and prints the project orientation banner (project name defaults to the project directory basename) |
| `hooks.json` | Human-readable reference copy of the settings.json hooks block |
| `check-branch-delete-guard.test.js`, `check-merge-guard.test.js`, `check-git-push-audit.test.js`, `check-ci-status-after-push.test.js`, `check-search-command.test.js`, `lib/git-command.test.cjs` | Behavioral tests for each guard's detection/extraction logic, plus lifecycle tests that run the hook on stdin JSON (the push audit against throwaway git repos) |
| `hook-config-integration.test.cjs`, `lib/hook-config.test.cjs` | Tests for the config loader, project-local overrides and hook registration |

Run every test from the hooks directory with `node --test *.test.js *.test.cjs lib/*.test.cjs`. A bare
directory argument (`node --test .claude/hooks/`) errors on Node 22.

The actual hook registration lives in **`.claude/settings.json`**, not `hooks.json`.

---

## Quick Start

### 1. Copy the hooks directory

```
cp -r .claude/hooks/ <your-project>/.claude/hooks/
```

### 2. Configure the project

`.claude/hooks/config.json` holds the shared defaults used by every project, so leave it alone for
project-specific settings. Instead, create `<project>/.claude/hooks.config.json` containing only the
keys you want to change (see "Project-local overrides" below). Available keys:

- `project_name` — shown in the session banner (optional; defaults to the project directory name)
- `arch_rules` — set `enabled: true` and define your package boundary rules
- `content_watch` — set `enabled: true` and point to your content path + validation command
- `dep_guard` — enabled by default, extend `warn_patterns` if needed
- `empty_test_guard` — enabled by default, catches theater tests
- `todo_format` — set `enabled: true` to enforce TODO comment format
- `script_guard` — set `enabled: true` to validate npm run scripts before they run
- `bash_description_guard` — requires terminal command explanations; always on when registered (the hook does not read this setting yet)
- `env_guard` — blocks `.env` reads; always on when registered (the hook does not read this setting)
- `commit_guard` — requires WHY/EXPECTED in git commit messages; always on when registered (the hook does not read this setting yet)
- `merge_guard` — enabled by default, unconditionally blocks any command that merges a PR or lands commits on master/main
- `push_audit` — blocks pushes whose diff contains hardcoded secrets; always on when registered (the hook does not read this setting yet)
- `branch_delete_guard` — enabled by default, blocks deleting a branch a stacked PR still bases off (requires `gh`)
- `ci_status_check` — enabled by default, blocks after a push until the matching CI run completes (requires `gh`)
- `search_guard` — enabled by default in warn mode, nudges away from raw shell `grep`/`find`/`cat`/`head`/`tail`
- `commands` — document your lint/test/typecheck commands (reference only)

### 3. Register hooks in settings.json

Merge the `hooks` block from `hooks.json` into your project's `.claude/settings.json`:

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Write|Edit|MultiEdit",
        "hooks": [{ "type": "command", "command": "node .claude/hooks/check-arch-boundary.js" }]
      },
      {
        "matcher": "Bash",
        "hooks": [
          { "type": "command", "command": "node .claude/hooks/check-bash-description.js" },
          { "type": "command", "command": "node .claude/hooks/check-dep-guard.js" },
          { "type": "command", "command": "node .claude/hooks/check-script-exists.js" },
          { "type": "command", "command": "node .claude/hooks/check-commit-message.js" },
          { "type": "command", "command": "node .claude/hooks/check-merge-guard.js" },
          { "type": "command", "command": "node .claude/hooks/check-git-push-audit.js" },
          { "type": "command", "command": "node .claude/hooks/check-branch-delete-guard.js" },
          { "type": "command", "command": "node .claude/hooks/check-search-command.js" }
        ]
      },
      {
        "matcher": "Read",
        "hooks": [{ "type": "command", "command": "node .claude/hooks/check-env-guard.js" }]
      }
    ],
    "PostToolUse": [
      {
        "matcher": "Write|Edit|MultiEdit",
        "hooks": [
          { "type": "command", "command": "node .claude/hooks/validate-content.js" },
          { "type": "command", "command": "node .claude/hooks/check-empty-tests.js" },
          { "type": "command", "command": "node .claude/hooks/check-todo-format.js" }
        ]
      },
      {
        "matcher": "Bash",
        "hooks": [{ "type": "command", "command": "node .claude/hooks/check-ci-status-after-push.js" }]
      }
    ],
    "SessionStart": [
      {
        "matcher": "",
        "hooks": [{ "type": "command", "command": "node .claude/hooks/session-start.cjs" }]
      }
    ]
  }
}
```

### 4. Verify

Run the session banner manually to confirm config loads correctly:

```bash
node .claude/hooks/session-start.cjs
```

---

## Configuration Reference

### `arch_rules`

Enforce import restrictions across packages. Set `enabled: true` and define rules:

```json
"arch_rules": {
  "enabled": true,
  "rules": [
    {
      "package_path": "packages/core",
      "forbidden_imports": ["apps/ui", "apps/server"],
      "forbidden_frameworks": ["react", "vue"],
      "forbidden_content_pattern": null
    }
  ]
}
```

- `package_path` — substring matched against the file path being written
- `forbidden_imports` — import path substrings that must not appear in this package
- `forbidden_frameworks` — framework names matched as exact `from 'x'` imports
- `forbidden_content_pattern` — optional regex; triggers a violation if matched in file content

When a rule is violated, the hook exits 2 (block) and Claude Code sees the error and self-corrects.

---

### `content_watch`

Run a validation command after specific files are written:

```json
"content_watch": {
  "enabled": true,
  "path_pattern": "packages/content",
  "file_extensions": [".json", ".yaml"],
  "validate_command": "pnpm --filter content run validate"
}
```

- `path_pattern` — substring matched against the written file path
- `file_extensions` — only these extensions trigger validation (empty = all files in path)
- `validate_command` — shell command to run; must exit 0 on success

---

### `dep_guard`

Warn when a dependency install is detected:

```json
"dep_guard": {
  "enabled": true,
  "warn_patterns": ["npm install", "yarn add", "pnpm add", "pip install"],
  "custom_message": ""
}
```

- `warn_patterns` — case-insensitive substring list; any match triggers the warning
- `custom_message` — override the default warning text (optional)

This hook always exits 0 (non-blocking). It warns to stderr; Claude Code shows it to the model.

---

### `bash_description_guard`

Require a non-empty `description` on every Bash call:

```json
"bash_description_guard": {
  "enabled": true
}
```

No fields beyond `enabled`, and `check-bash-description.js` does not read config at all, so the block is
unconditional today and the `enabled` flag has no effect. Blocks (exit 2) any Bash call whose `tool_input.description` is
missing or empty — enforces the WHY/WHAT terminal-command discipline before a command runs.

---

### `env_guard`

Block reads of `.env` files:

```json
"env_guard": {
  "enabled": true
}
```

No fields beyond `enabled`, and `check-env-guard.js` does not read config at all, so the block is
unconditional today and the `enabled` flag has no effect. Blocks (exit 2) any `Read` call whose file path matches `.env` or
`.env.*`. Environment files carry secrets and must never be read into context.

---

### `search_guard`

Nudge (or block) raw shell search/read commands in favor of the assistant's own dedicated
search/read tools (Grep, Glob, Read or their equivalents), which return structured,
token-bounded results instead of dumping raw stdout into context:

```json
"search_guard": {
  "enabled": true,
  "commands": ["grep", "egrep", "fgrep", "rg", "find", "cat", "head", "tail"],
  "on_violation": "warn",
  "allow_patterns": []
}
```

- `commands` — binary names (matched as the leading word of a pipeline segment, not a substring)
  that trigger the check
- `on_violation` — `"warn"` prints to stderr (exit 0) | `"block"` exits 2 and rejects the tool call
- `allow_patterns` — substrings that, if present anywhere in the command, skip the check entirely
  (e.g. a known-legitimate build/CI command that happens to invoke `grep`/`cat` internally)

This is a nudge by default, not a hard rule — a model can talk itself past prose-only guidance, so
this makes the same guidance visible and, if you flip `on_violation` to `"block"`, enforceable.
Start with `"warn"`; only switch to `"block"` once you've confirmed it isn't firing on legitimate
shell usage (e.g. `grep` inside a script `validate_command`, `cat` used to build a file in a
pipeline) — `allow_patterns` is the escape hatch for those.

---

### `merge_guard`

Unconditionally block anything that would merge a PR or land commits on a protected branch:

```json
"merge_guard": {
  "enabled": true
}
```

No fields beyond `enabled` — deliberately not configurable with a per-command bypass flag, since
anything checkable from inside a Bash call is something the session itself could set, which would
defeat the point. Blocks (exit 2), every time, with no exceptions:

- `gh pr merge`
- a `gh api` `PUT` to a PR's `/merge` REST endpoint (a `GET` to the same path — checking merge
  state/method — is not blocked)
- a local `git merge` performed while on, or checking out to, `master`/`main`
- a `git push` (refspec or plain branch name) that lands commits directly on `master`/`main`,
  bypassing PR + merge entirely
- an implicit push (`git push` with no refspec) or a `git merge` whose repository or current
  branch can't be determined (`cd "$VAR" && git push`) — rather than guessing from the hook's own
  directory, it asks for a literal path or branch

This hook doesn't try to tell whether permission to merge was already given earlier in the
conversation — it can't read the chat, and it exists specifically because "no objections raised"
was once treated as implicit go-ahead to merge. The fix is procedural, not something a flag on the
command can satisfy: get an explicit yes in the conversation, then perform the merge somewhere
this hook can't intercept it — the GitHub PR page (or a terminal outside this session). The only
real bypass is flipping `merge_guard.enabled` to `false` in `config.json` — a separate, deliberate
file edit.

---

### `push_audit`

Audit a `git push`'s diff before it goes out:

```json
"push_audit": {
  "enabled": true
}
```

No fields beyond `enabled` (extend `check-git-push-audit.js` directly for different patterns).
`check-git-push-audit.js` does not read config, so the audit runs whenever the hook is registered
and the `enabled` flag has no effect.
Runs on every `git push`, in the repository the push targets (after any `cd`/`git -C`). It audits
the staged diff together with the patch of every commit the push sends:
`git log -p <pushed refs> --not --remotes=<remote>`.

- **Pushed refs** are each refspec's source (`release` in `git push origin release:main`, not
  `HEAD`), `--branches` for `--all`/`--branches`, `--all` for `--mirror`, `--tags` for `--tags`. With no
  refspec: every ref if the remote has configured push refspecs, every branch under
  `push.default=matching`, otherwise `HEAD`. A pushed ref that doesn't resolve to a commit (`"$BRANCH"`, a
  typo) blocks the push.
- **The remote** is the one being pushed to (or, for a bare `git push`, the one git would push
  to), so a commit already on `origin` is still audited when pushed to `backup`. A remote given as
  a URL or path has no tracking refs, so the pushed refs' whole history is audited.

Commits are read one patch at a time, so a secret added in one commit and deleted in a later one
is still caught, and a new branch's first push has all its commits audited, not just the last.
Only when no commit is outgoing does it fall back to `HEAD~1..HEAD` (or the empty tree for a root
commit). When the target repository can't be determined (`cd "$VAR" && git push`), the push is
blocked instead of auditing some other directory. It checks for:

| Check | Severity | Trigger |
|---|---|---|
| `secrets` | HIGH — blocks the push | API keys, passwords, tokens, private keys in added lines |
| `debug_statements` | MEDIUM (reported only) | `console.log`, `debugger`, `pprint` in non-test files |
| `commented_code` | LOW (reported only) | 3+ commented-out code lines added in a single file |
| `lockfile_drift` | MEDIUM (reported only) | `package.json` changed without a lockfile update |
| `missing_tests` | MEDIUM (reported only) | source files changed with zero test file changes |

Only the `secrets` check actually blocks (exit 2); everything else is reported to stderr but
non-blocking.

A trailing `// nosecret` or `# nosecret` marker suppresses a secret finding on that line, but only
in test files and docs (`docs/`, `.md`, `.mdx`, `.rst`, `.txt`). In production source the marker is
ignored and the block message asks to stop and check with the user, so a real credential can't be
waved through by annotating it.

---

### `branch_delete_guard`

Block deleting a branch a stacked PR still bases off:

```json
"branch_delete_guard": {
  "enabled": true
}
```

No fields beyond `enabled`. Fires on `git push <remote> --delete <branch>` and the `:branch`
shorthand — local `git branch -D` is intentionally out of scope, since that alone can't break a
GitHub PR's base. Deleting a branch that's still an open PR's base doesn't merge that PR; GitHub
auto-closes it instead (its commits usually aren't in the new target yet), and a closed PR's base
can't be retargeted — the only recovery is opening a brand-new PR from the same commits. For each
deleted branch it asks GitHub for open PRs with that branch as their base (`gh pr list --base`), so
the check doesn't depend on how many PRs the repository has open. Every branch is looked up even
if one lookup fails, so a dependent PR found for one branch still blocks. Requires the `gh` CLI,
authenticated — fails open (allows, with a warning) if `gh` is unavailable or the target
repository can't be determined, so a stale check never blocks otherwise-normal work.

---

### `ci_status_check`

Block until the pushed commit's CI run actually finishes:

```json
"ci_status_check": {
  "enabled": true,
  "poll_interval_seconds": 5,
  "new_run_timeout_seconds": 60,
  "completion_timeout_seconds": 180
}
```

- `poll_interval_seconds` — how often to poll `gh run list` while waiting for a run to appear
- `new_run_timeout_seconds` — how long to wait for a run matching the just-pushed commit SHA to
  appear at all
- `completion_timeout_seconds` — currently unenforced; the hook waits via `gh run watch`, which
  blocks until the run finishes with no timeout flag of its own. Documented intent for a future
  implementer, not a working setting today.

Runs as a PostToolUse hook after a real `git push` and requires the `gh` CLI, authenticated. A
local test pass is not proof of a green remote run — this makes the wait for CI real instead of
implicit. If the repo has no GitHub Actions workflow, it harmlessly reports "no run found" once
per push and exits 1 informationally. Adds real wall-clock wait time to every push, roughly
however long CI takes to run.

It waits for the branch and commit the push actually sent, taken from the refspec
(`git push origin feature` from another branch, or `feature:main`), not the current branch.
It skips, with a message saying why, when no single branch commit stands for the push: a delete,
a tag or other non-branch destination, `--all`/`--branches`/`--mirror`/`--tags` (check each
branch's CI manually), or a target repository that can't be determined.

---

### `empty_test_guard`

Prevent theater testing — test files with no assertions:

```json
"empty_test_guard": {
  "enabled": true,
  "test_file_patterns": ["*.test.*", "*.spec.*"],
  "block_empty_describe": true,
  "block_empty_it": true,
  "block_todo_tests": false
}
```

- `test_file_patterns` — filenames matching these patterns are inspected (glob-style, `*` matches anything except `/`)
- `block_empty_describe/it` — fail when empty describe/it blocks are found
- `block_todo_tests` — set to `true` in strict mode to reject `it.todo()` placeholders

---

### `todo_format`

Enforce a consistent TODO comment format:

```json
"todo_format": {
  "enabled": true,
  "required_pattern": "TODO\\([^)]+\\):",
  "on_violation": "warn"
}
```

- `required_pattern` — regex that every TODO line must match (default: `TODO(owner): description`)
- `on_violation` — `"warn"` prints to stderr and exits 0; `"block"` exits 1

---

### `script_guard`

Validate npm run scripts before they execute:

```json
"script_guard": {
  "enabled": true,
  "package_json_paths": ["package.json", "packages/api/package.json"],
  "on_missing": "warn"
}
```

- `package_json_paths` — list of package.json files to check for script names (extend for monorepos)
- `on_missing` — `"warn"` prints to stderr and exits 0; `"block"` exits 1 and stops the command
- Also detects trivial no-op commands (`true`, `exit 0`, empty echo) regardless of `enabled`

---

### `commit_guard`

Require WHY/EXPECTED sections in every commit message:

```json
"commit_guard": {
  "enabled": false,
  "required_markers": ["WHY:", "EXPECTED:"],
  "on_violation": "warn"
}
```

- `required_markers` — every listed string must appear somewhere in the commit message
- `on_violation` — `"warn"` prints to stderr (exit 0) | `"block"` exits 2 and rejects the tool call

`check-commit-message.js` does not read config yet: whenever it is registered it requires `WHY:`
and `EXPECTED:` and blocks (exit 2), regardless of `enabled`, `required_markers` and `on_violation`.

---

### `commands`

Reference documentation for common commands (not auto-run):

```json
"commands": {
  "lint": "npm run lint",
  "test": "npm test",
  "typecheck": "npx tsc --noEmit"
}
```

These appear in the session banner when populated. To auto-run a command on file write, use `content_watch.validate_command` instead.

---

### `session_start`

Printed by the SessionStart hook (`session-start.cjs`), together with the project name and a pointer to `.claude/hooks.config.json`.

Control the orientation banner:

```json
"session_start": {
  "custom_notes": [
    "Domain logic must not import from UI packages",
    "All API calls go through the service layer"
  ]
}
```

---

## Project-local overrides

The hooks are shared by many projects (symlinked, or copied on Windows), so `config.json` is shared too. A project can override
it with an optional file at **`<project>/.claude/hooks.config.json`**. The project directory is
resolved from `CLAUDE_PROJECT_DIR`, then the current working directory.

- **Merge rules**: objects merge recursively (project keys win, shared-only keys are kept);
  arrays, scalars and `null` in the override replace the shared value wholesale.
- **Protected guards**: `merge_guard` and `branch_delete_guard` can be tightened or
  tuned but never disabled. In these sections only `enabled: true` is honoured; any other
  `enabled` value, or a section that is not an object, is ignored with a stderr warning.
  `env_guard` is protected the same way in the loader, but `check-env-guard.js` does not read
  config at all, so the block is unconditional and an `env_guard` override has no effect.
- **Hooks that ignore config**: `check-bash-description.js`, `check-commit-message.js`,
  `check-git-push-audit.js` and `check-env-guard.js` do not read config, so overrides for
  `bash_description_guard`, `commit_guard`, `push_audit` and `env_guard` have no effect; these
  hooks are on whenever they are registered. Every other guard reads the merged config and can be
  disabled from a project override.
- **Failure handling**: a missing override file is normal. An unreadable or invalid one (bad JSON,
  not a JSON object) is ignored with a one-line stderr warning and never breaks a hook. An
  unreadable shared `config.json` makes the loader throw, and each hook keeps its own previous
  behaviour: most skip their check (fail open), while the safety guards (`merge_guard`,
  `branch_delete_guard`) treat the missing config as enabled.
- **Safety limits**: override keys named `__proto__`, `constructor` and `prototype` are dropped
  with a warning, and an override nested deeper than 32 levels is ignored as a whole with a warning.

```json
{ "project_name": "Acme API", "dep_guard": { "enabled": false } }
```

---

## How Hooks Work

Claude Code invokes each registered command when the matching tool is used.

- **Input**: the tool call JSON is delivered on **stdin** as:
  ```json
  { "tool_name": "Write", "tool_input": { "file_path": "...", "content": "..." } }
  ```
- **Exit codes**:
  - `0` — allow / pass
  - `1` — validation failed (PostToolUse: Claude Code is informed but not blocked)
  - `2` — block action (PreToolUse: Claude Code rejects the tool call, shows stderr)
- **Stderr** is shown to the model. Use it for actionable messages.

---

## Debugging

**Hook doesn't run at all**
- Check that `settings.json` has the hook registered
- Verify the matcher string matches the tool name exactly (e.g. `Write|Edit|MultiEdit`)

**"config.json not found" warning**
- The scripts locate config.json relative to the script path (`__dirname/config.json`)
- Ensure `config.json` is in the same directory as the `.js` scripts

**Arch check runs but never blocks**
- Confirm `arch_rules.enabled` is `true` in config.json
- Confirm at least one rule has a `package_path` that matches your file paths

**Content validation never runs**
- Confirm `content_watch.enabled` is `true`
- Confirm `path_pattern` is a substring of the files you're writing
- Confirm `validate_command` is set and non-empty

**Empty test check always passes**
- Confirm `empty_test_guard.enabled` is `true`
- Confirm the test filename matches one of `test_file_patterns`
- Note: the check requires `it`/`test` blocks with `expect`/`assert` calls — files with only `beforeEach` and no test blocks will not trigger it

**TODO format check never fires**
- Confirm `todo_format.enabled` is `true`
- The check looks for the word `TODO` (case-insensitive) — if your convention spells it differently, adjust `required_pattern`

**Script guard not detecting missing script**
- Confirm `script_guard.enabled` is `true`
- Confirm `package_json_paths` includes the correct package.json for the workspace being used
- The check only matches `npm run X`, `pnpm run X`, `yarn run X` — not shorthand or `npx`

**`merge_guard` blocks a merge even though it was already agreed to in conversation**
- This is by design, not a bug — the hook can't read the conversation, so it doesn't try to; it
  blocks every matching command unconditionally rather than trusting a "confirmed" flag the same
  session could set on its own
- There is no per-command bypass. Perform the merge from the GitHub PR page (or a terminal outside
  this session) instead, or set `merge_guard.enabled: false` in `config.json` if the guard itself
  should be off for this project

**`branch_delete_guard` / `ci_status_check` never seem to fire, or always allow silently**
- Both require the `gh` CLI installed and authenticated (`gh auth status`) — both fail open (warn
  and allow) rather than block when `gh` is unavailable, so a missing/unauthenticated `gh` looks
  like "nothing happened" rather than an error
- `branch_delete_guard` only matches `git push <remote> --delete <branch>` or the `:branch`
  shorthand — a local `git branch -D` is intentionally not covered
- `ci_status_check` only fires after a real `git push` (PostToolUse) and only reports a result if
  a GitHub Actions run exists for that repo

**session-start.sh prints a blank banner (no project name, no notes)**
- This was a real bug in an earlier version that embedded a shell-resolved `pwd` path (Git Bash's
  POSIX-style `/c/...` form) inside a `node -e "..."` string. A native Windows Node install
  doesn't resolve that path form, and the failure was silent (empty stdout, exit 0) rather than
  an error. Fixed by moving the logic into `session-start.cjs`, which resolves its own config
  path via `__dirname` instead of a shell string — `session-start.sh` just invokes it. If you see
  this again, confirm you're on the current two-file version, not a copy of the old single-file
  inline-`node -e` version.
- Requires bash (Git Bash, WSL, or similar) for the wrapper; the `.cjs`/`.js` hooks work natively
  on Windows via Node.js

---

## Requirements

- **Node.js v22.7+** — required for all hooks. The ESM `.js` hooks rely on Node's automatic module-syntax detection (unflagged in v22.7), and `lib/hook-config.cjs` uses `structuredClone` and `Object.hasOwn`
- **bash** — required for `session-start.sh`
- No specific package manager assumed; any install-detecting pattern can be added to `dep_guard.warn_patterns`

---

## Known Limitations

- `check-arch-boundary.js` checks imports in the **content being written**, not the full file on disk. It won't catch pre-existing violations.
- `forbidden_content_pattern` is a simple regex heuristic — it can produce false positives in test files or comments.
- Hooks run in the **project root** working directory. Relative paths in `validate_command` are resolved from there.
- **Mixed module system**: `check-branch-delete-guard.js`, `check-ci-status-after-push.js`, `check-env-guard.js`, `check-git-push-audit.js`, and `check-merge-guard.js` are CommonJS (`require`); `check-dep-guard.js` and `check-search-command.js` were converted to CommonJS too (see changelog below). `check-arch-boundary.js`, `check-empty-tests.js`, `check-script-exists.js`, `check-todo-format.js`, and `validate-content.js` still use ESM `import`. On Node v22.7+ they run without any `package.json`, because Node detects the module syntax. On older Node they throw `Cannot use import statement outside a module` unless a `package.json` with `"type": "module"` sits next to `.claude/hooks/`, or the file is converted to `require(...)` the same way `check-dep-guard.js` was.

---

## What Was Removed from the Original

| Item | Reason |
|---|---|
| `check-arch-boundary.sh` | Duplicate of the JS hook; used nonexistent env vars (`$CLAUDE_TOOL_INPUT_FILE_PATH`) instead of stdin |
| `validate-content.sh` | Replaced by `validate-content.js`; hardcoded `pnpm` and `packages/content` |
| Inline dep-guard bash in hooks.json | Extracted to `check-dep-guard.js`; hardcoded `npm/yarn/pnpm` only |
| Hardcoded project references | All paths, commands, and names moved to `config.json` |
| CL1/CL4/QS5 internal rule codes | Replaced with generic, readable messages |
| `_notes.evolution` placeholder | Removed — not actionable in a generic template |

## Changelog

- Command parsing for the git/gh guards moved into `lib/git-command.cjs`. `check-branch-delete-guard.js`, `check-ci-status-after-push.js`, and `check-git-push-audit.js` previously recognized only a subset of the push forms `check-merge-guard.js` handled, so `sudo git push`, `/usr/bin/git push`, and `git -C <dir> push` skipped them. All four now share one parser. Option values are matched as whole shell words, so `git -C "C:\Work Tree" push origin main` is no longer cut off at the space, and prefixes are stripped before shell wrappers are unwrapped, so `env bash -c "gh pr merge 27"` is caught.
- `check-git-push-audit.js` generic secret floors restored to 8 characters (credentials) and 4 (passwords), from 20 and 12. Test fixtures that trip them use the existing trailing `// nosecret` marker.

- `check-dep-guard.js` and `check-search-command.js` converted from ESM (`import`) to CommonJS (`require`). Found while adapting these hooks for a project with no `package.json` at all (a scripts/Docker-Compose repo, not an npm project) — the ESM versions threw `Cannot use import statement outside a module` there. Five other hook files have the same latent issue and are documented under Known Limitations rather than converted, since nothing in this change touched them.
