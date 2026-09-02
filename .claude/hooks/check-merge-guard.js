#!/usr/bin/env node
// check-merge-guard.js
// PreToolUse hook — Bash
//
// Unconditionally blocks any command that would merge a PR or land commits
// on master/main from this session — `gh pr merge`, a PUT to the
// equivalent `gh api .../pulls/{n}/merge` REST endpoint, a local `git
// merge` performed while on (or checking out to) master/main, and a push
// (refspec or plain branch name) that lands commits directly on
// master/main.
//
// This exists because "CI is green and there are no open review comments"
// was treated as implicit permission to merge two PRs that a fresh Copilot
// review pass had explicitly been requested for first — see myfriendroze
// project_backlog memory, 2026-09-02. That was a judgment failure, not a
// missing fact the hook could have surfaced; a hook can't read the
// conversation to know whether permission was actually given. So this
// hook does not try to — it blocks every single time, unconditionally,
// and the fix for that judgment failure is procedural: ask first, wait
// for an explicit yes in the conversation, and have the merge itself
// happen somewhere this hook can't intercept — the GitHub PR page.
//
// Deliberately not configurable with a "confirmed" bypass flag/env var on
// the command itself: anything checkable from inside a Bash tool call is
// something this session could set on its own, which would make the check
// meaningless against the exact failure mode it exists to prevent. The
// only real bypass is `merge_guard.enabled: false` in config.json — a
// separate, deliberate file edit, not something a merge command's own
// invocation can satisfy inline.
//
// Config used:
//   .claude/hooks/config.json → merge_guard.enabled
//
// Exit codes:
//   0  — PASS: not a merge-shaped command, or guard disabled
//   2  — BLOCK: always, for any matching command

'use strict';

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const CONFIG_PATH = path.resolve(__dirname, 'config.json');
const PROTECTED_BRANCHES = ['master', 'main'];

function isEnabled() {
  try {
    const config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
    // Same fail-toward-safety default as the other guards in this file set:
    // only an explicit `false` opts out, missing/invalid config.json means
    // the check still runs.
    return config.merge_guard?.enabled !== false;
  } catch {
    return true;
  }
}

function currentBranch() {
  try {
    return execSync('git rev-parse --abbrev-ref HEAD', { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
  } catch {
    return null; // not a git repo / no commits yet — nothing to protect
  }
}

// Splits on shell chain operators so each command in a chain is checked on
// its own terms — but only operators actually outside any quoted string.
// A naive split found in practice, not just in theory: a `git commit -m
// "... e.g. git switch main && git push origin ..."` message that merely
// *discusses* a push pattern in prose got split on the `&&` inside its own
// quoted -m argument, and the fragment starting with "git push origin"
// (which also happened to contain the bare word "main" later in the same
// sentence) was flagged as a real push — blocking an ordinary commit
// because its message talked about push commands. Tracking quote state
// while scanning avoids splitting inside a quoted argument at all, so
// this only ever splits on operators a shell would actually treat as
// chaining, not ones sitting inertly inside a string literal.
function segmentsOf(fullCmd) {
  const segments = [];
  let current = '';
  let quote = null; // null | '"' | "'"

  for (let i = 0; i < fullCmd.length; i++) {
    const ch = fullCmd[i];

    if (quote === '"') {
      // Double-quote escaping: a backslash immediately before another
      // character is consumed as one literal unit, so an escaped quote
      // (`\"`, e.g. inside a commit message like `-m "He said \"hi\" &&
      // ..."`) doesn't end the quoted region early — reproduced in
      // review: without this, the `&&` after an escaped `\"` was treated
      // as a real chain operator again, the exact false-positive class
      // this function exists to prevent. Bash only treats \", \\, \$,
      // and \` as escapes inside double quotes (any other backslash is
      // literal), but consuming any \X pair here errs toward keeping
      // more of the string un-split, which is the safe direction — it
      // can never cause an operator that should be treated as literal to
      // be missed, only the reverse.
      if (ch === '\\' && i + 1 < fullCmd.length) {
        current += ch + fullCmd[i + 1];
        i++;
        continue;
      }
      current += ch;
      if (ch === '"') quote = null;
      continue;
    }
    if (quote === "'") {
      // Single quotes are fully literal in POSIX/bash — no escaping at
      // all, not even for a backslash. Only a real closing quote ends it.
      current += ch;
      if (ch === "'") quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      current += ch;
      continue;
    }
    if ((ch === '&' && fullCmd[i + 1] === '&') || (ch === '|' && fullCmd[i + 1] === '|')) {
      segments.push(current);
      current = '';
      i++; // consume the second character of the two-char operator too
      continue;
    }
    // A newline is an ordinary command separator too — a Bash tool call
    // can legitimately be a multi-line command string, and the shell runs
    // each line as its own statement exactly like `;` would. Without
    // this, `echo hi\ngh pr merge 27` was one un-split segment starting
    // with "echo", never "gh", so the merge on the second line was
    // invisible to every anchored check.
    if (ch === ';' || ch === '&' || ch === '|' || ch === '\n') {
      segments.push(current);
      current = '';
      continue;
    }
    current += ch;
  }
  segments.push(current);

  return segments.map((s) => s.trim()).filter(Boolean);
}

// `bash -c "..."` / `sh -c "..."` (and combined-flag forms like `-lc`,
// `-ic`, `-lic`) run their quoted argument as a nested command string —
// not a different, unwatched command, just the same gh/git invocation one
// layer further in. Because segmentsOf() deliberately never splits inside
// a quoted region (that's what fixed the earlier commit-message
// false-positive), a wrapped segment like `bash -c "gh pr merge 27"`
// never starts with "gh"/"git" at all — it starts with "bash" — so
// without unwrapping it, the entire inner command was invisible to every
// check in this file. Only the common `-c`/`-lc`/`-ic`/`-lic`/`--command`
// forms are recognized, not a full shell-flag grammar; greedy matching to
// the *last* occurrence of the opening quote character handles an inner
// command that itself contains a different quote style, though not a
// literal escaped instance of the same quote character (a narrower case
// than segmentsOf() itself handles, and one this hook can't fully resolve
// without a real shell parser).
// Finds the index of the true closing quote for a quoted argument that
// starts at `startIdx` in `str` (the character right after the opening
// quote), honoring double-quote backslash-escaping the same way
// segmentsOf() does — an escaped `\"` doesn't count as the close. Returns
// -1 if the quote is never closed.
function findClosingQuote(str, startIdx, quoteChar) {
  for (let i = startIdx; i < str.length; i++) {
    const ch = str[i];
    if (quoteChar === '"' && ch === '\\' && i + 1 < str.length) {
      i++; // the escaped character doesn't end the quote — skip it too
      continue;
    }
    if (ch === quoteChar) return i;
  }
  return -1;
}

function unwrapShellDashC(segment) {
  const opener = segment.match(/^(?:\S*[\\/])?(?:bash|sh|zsh|dash|ksh)(?:\.exe)?\s+(?:-[a-zA-Z]*c[a-zA-Z]*|--command)\s+(["'])/);
  if (!opener) return null;

  const quoteChar = opener[1];
  const contentStart = opener[0].length;
  const closeIdx = findClosingQuote(segment, contentStart, quoteChar);
  if (closeIdx === -1) return null; // unterminated quote — malformed, nothing safe to unwrap

  // Anything after the closing quote — `bash -c "cmd" arg0 arg1` is valid
  // syntax, where trailing words become $0/$1/... for the executed
  // string — is deliberately ignored rather than required to be absent.
  // They can't change what's inside the quotes, and requiring them to be
  // absent (an earlier version anchored the match to end-of-string) meant
  // this whole form went unrecognized, hiding the real command entirely.
  const content = segment.slice(contentStart, closeIdx);

  // A double-quoted outer wrapper allows bash's own limited escaping
  // (\", \\, \$, \`) — undo exactly that before treating the content as a
  // fresh command string, so a nested wrapper (e.g. `bash -c "sh -c
  // \"gh pr merge 27\""`) is captured with real, bare quote characters
  // rather than the literal backslash-quote pairs the outer shell would
  // already have resolved before the inner shell ever saw them. A
  // single-quoted outer wrapper is always fully literal in bash — no
  // un-escaping applies there.
  return quoteChar === '"' ? content.replace(/\\(["\\$`])/g, '$1') : content;
}

// Replaces any segment that's a shell -c wrapper with the segments of its
// unwrapped inner command (re-run through segmentsOf(), since the inner
// command can have its own chaining/quoting), recursively — so nested
// wrapping (`bash -c "sh -c \"gh pr merge 27\""`) is fully flattened
// before any anchored check runs.
function expandShellWrappers(segments) {
  const expanded = [];
  for (const segment of segments) {
    const inner = unwrapShellDashC(segment);
    if (inner !== null) {
      expanded.push(...expandShellWrappers(segmentsOf(inner)));
    } else {
      expanded.push(segment);
    }
  }
  return expanded;
}

// Env-var-prefix stripping, duplicated from check-branch-delete-guard.js
// rather than shared — each hook is a standalone script Claude Code
// invokes independently, and the two files are small enough that a shared
// module would add more indirection than it saves. Kept in sync by hand;
// see that file's more heavily-commented version for the full rationale
// per pattern.
const ENV_ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=(?:"[^"]*"|'[^']*'|\S*)\s*/;
const ENV_NO_ARG_FLAG = /^(?:-i|--ignore-environment|-0|--null|-v|--debug)\s*/;
const ENV_ARG_FLAG_SEPARATE = /^(?:-u|--unset|-C|--chdir|-S|--split-string)\s+(?:"[^"]*"|'[^']*'|\S*)\s*/;
const ENV_ARG_FLAG_COMBINED = /^(?:--unset|--chdir|--split-string)=(?:"[^"]*"|'[^']*'|\S*)\s*/;
const ENV_END_OPTIONS = /^--\s+/;

function stripLeadingEnvPrefix(segment) {
  let s = segment.replace(/^env(?=\s|$)\s*/, '');
  let prev;
  do {
    prev = s;
    s = s
      .replace(ENV_END_OPTIONS, '')
      .replace(ENV_ARG_FLAG_COMBINED, '')
      .replace(ENV_ARG_FLAG_SEPARATE, '')
      .replace(ENV_NO_ARG_FLAG, '')
      .replace(ENV_ASSIGNMENT, '');
  } while (s !== prev);
  return s;
}

// Strips a leading path component off the command name itself, so
// `/usr/bin/gh pr merge 27` or `./bin/git push ...` are recognized the
// same as a bare `gh`/`git` invocation — invoking the same binary by an
// explicit path instead of relying on $PATH isn't a different, unwatched
// command, and every check below is anchored on the bare command name.
// Also handles a Windows-style absolute path containing spaces (which
// must be quoted as a single shell token to be one argument at all, e.g.
// `"C:\Program Files\Git\bin\git.exe" push origin master` — this project
// targets Windows 11) and an optional `.exe` suffix on the binary name,
// quoted or not.
function stripCommandPathPrefix(segment) {
  const quoted = segment.match(/^(["'])([^"']*[\\/](gh|git)(?:\.exe)?)\1(\s.*)?$/);
  if (quoted) {
    return `${quoted[3]}${quoted[4] || ''}`;
  }
  return segment.replace(/^(\S*[\\/])(gh|git)(?:\.exe)?\b/, '$2');
}

// Whitespace-splitting a raw command string doesn't understand quoting, so
// a quoted argument like `"main"` keeps its literal quote characters as
// part of the token. Strips one matching pair of surrounding quotes, if
// present — duplicated from check-branch-delete-guard.js's identical
// helper rather than shared, matching the pattern already used for
// env-prefix stripping in this file.
function stripSurroundingQuotes(token) {
  if (token.length >= 2) {
    const first = token[0];
    const last = token[token.length - 1];
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      return token.slice(1, -1);
    }
  }
  return token;
}

// git's own global options can sit between `git` and the actual
// subcommand — e.g. `git -C /some/dir push origin master` runs in a
// different directory but is still exactly the push this hook cares
// about. Only the value-taking forms are handled explicitly (the risk is
// a bare `-C`/`-c`/etc. swallowing the *next* token as its own argument
// rather than as part of the subcommand); a few common no-argument global
// flags are stripped too for the same reason env's own flags were.
const GIT_GLOBAL_ARG_FLAG_SEPARATE = /^(?:-C|-c|--git-dir|--work-tree|--namespace|--exec-path)\s+\S+\s*/;
const GIT_GLOBAL_ARG_FLAG_COMBINED = /^(?:--git-dir|--work-tree|--namespace|--exec-path)=\S*\s*/;
const GIT_GLOBAL_NO_ARG_FLAG = /^(?:-p|--paginate|--no-pager|--bare|--no-replace-objects|--literal-pathspecs)\s*/;

function stripGitGlobalOptions(afterGit) {
  let s = afterGit;
  let prev;
  do {
    prev = s;
    s = s
      .replace(GIT_GLOBAL_ARG_FLAG_COMBINED, '')
      .replace(GIT_GLOBAL_ARG_FLAG_SEPARATE, '')
      .replace(GIT_GLOBAL_NO_ARG_FLAG, '');
  } while (s !== prev);
  return s;
}

// gh's global options relevant here: -R/--repo (an explicit repo selector
// between `gh` and the subcommand) and --hostname — the specific forms
// found in review (`gh -R owner/repo pr merge 27`).
const GH_GLOBAL_ARG_FLAG_SEPARATE = /^(?:-R|--repo|--hostname)\s+\S+\s*/;
const GH_GLOBAL_ARG_FLAG_COMBINED = /^--(?:repo|hostname)=\S*\s*/;

function stripGhGlobalOptions(afterGh) {
  let s = afterGh;
  let prev;
  do {
    prev = s;
    s = s
      .replace(GH_GLOBAL_ARG_FLAG_COMBINED, '')
      .replace(GH_GLOBAL_ARG_FLAG_SEPARATE, '');
  } while (s !== prev);
  return s;
}

// `sudo`, `command`, and `exec` invoke the real command as a subprocess
// without being a different, unwatched command themselves — `sudo gh pr
// merge 27` or `command git push origin main` both still run exactly the
// gh/git invocation this hook cares about. Only each wrapper's most
// common flags are handled explicitly here, not their full option
// surface: this project targets Windows 11, where none of these are the
// primary shell anyway, so the goal is closing the realistic gap found in
// review, not replicating every real CLI's complete grammar.
const SUDO_ARG_FLAG = /^(?:-u|--user)\s+\S+\s*/;
const SUDO_NO_ARG_FLAG = /^(?:-n|--non-interactive|-i|--login|-E|--preserve-env|-H|--set-home)\s*/;
const COMMAND_NO_ARG_FLAG = /^-[pvV]\s*/;

function stripLeadingWrapperPrefix(segment) {
  const m = segment.match(/^(sudo|command|exec)\b\s*/);
  if (!m) return segment;

  let s = segment.slice(m[0].length);
  let prev;
  do {
    prev = s;
    if (m[1] === 'sudo') {
      s = s.replace(SUDO_ARG_FLAG, '').replace(SUDO_NO_ARG_FLAG, '');
    } else if (m[1] === 'command') {
      s = s.replace(COMMAND_NO_ARG_FLAG, '');
    }
  } while (s !== prev);
  return s;
}

// Normalizes a segment before any anchored gh/git pattern is tested
// against it — strips a leading env-var prefix (plus env's own flags), a
// leading `sudo`/`command`/`exec` wrapper (in any mix/order with the env
// prefix — e.g. both `sudo GIT_TRACE=1 git push ...` and `GIT_TRACE=1
// sudo git push ...` are ordinary ways to write the same thing), a
// leading path prefix on the command name, and any of the command's own
// global options that can appear before its subcommand. Every pattern in
// this file is anchored on a bare `gh pr`/`gh api`/`git push`/`git
// merge`/`git checkout`/`git switch` start, so without this, `GH_
// TOKEN=... gh pr merge 27`, `/usr/bin/git merge ...`, `gh -R owner/repo
// pr merge 27`, `git -C /some/dir push origin master`, or `sudo gh pr
// merge 27` would all silently bypass every check here.
function normalizeSegment(segment) {
  let s = segment;
  let prev;
  do {
    prev = s;
    s = stripLeadingWrapperPrefix(stripLeadingEnvPrefix(s));
  } while (s !== prev);

  s = stripCommandPathPrefix(s);
  if (/^git\s+/.test(s)) {
    s = `git ${stripGitGlobalOptions(s.slice('git '.length))}`;
  } else if (/^gh\s+/.test(s)) {
    s = `gh ${stripGhGlobalOptions(s.slice('gh '.length))}`;
  }
  return s;
}

// Extracts the branch a `git checkout`/`git switch` invocation moves HEAD
// to, if any. A plain `git checkout master` or `git switch main` takes the
// branch name as an ordinary positional argument, but `-b`/`-B`
// (checkout) and `-c`/`-C` (switch) create-and-switch flags take the new
// branch name as *their own* argument instead — `git checkout -B main`
// force-resets and switches to main with no separate "main" positional to
// find. Missing that form meant effectiveBranch() could fall back to the
// pre-checkout branch and miss an implicit push/merge onto master/main
// immediately after — silently contradicting this hook's "unconditional"
// premise for exactly the case (force-creating/resetting the protected
// branch itself) that matters most.
function checkoutTarget(segment) {
  const m = segment.match(/^git\s+(?:checkout|switch)\s+(.*)$/);
  if (!m) return null;

  const tokens = m[1].split(/\s+/).filter(Boolean);
  const createFlagIdx = tokens.findIndex((t) => t === '-b' || t === '-B' || t === '-c' || t === '-C');
  if (createFlagIdx !== -1) {
    const raw = tokens[createFlagIdx + 1];
    // This hook sees the raw command string, quotes and all — a quoted
    // branch name (`git switch "main"`) otherwise yields a checkout
    // target of `"main"`, which never matches PROTECTED_BRANCHES and
    // bypasses the implicit-push/local-merge checks for the rest of the
    // chain.
    return raw ? stripSurroundingQuotes(raw) : null;
  }
  const raw = tokens.find((t) => !t.startsWith('-'));
  return raw ? stripSurroundingQuotes(raw) : null;
}

// A refspec token is `<src>:<dest>` with no spaces, and a bare branch-name
// token (no colon) pushes a local branch of that name to a remote branch
// of the same name. Once flags are filtered out, every remaining non-flag
// token is checked as a candidate — not just tokens assumed to follow a
// remote — for two reasons found in review:
//   1. A rigid `git push <remote> <refspec>` shape (nothing else) missed
//      `git push --force origin feature:main` and `git push origin
//      --force feature:main` entirely, since a flag anywhere breaks a
//      fixed-position match. Tokenizing and filtering flags, the same
//      approach check-branch-delete-guard.js uses for --delete, closes
//      that gap regardless of flag position.
//   2. Requiring at least a remote + one more token missed both
//      `git push feature:main` (remote omitted — git still resolves this
//      via config in some setups) and, more importantly, a *plain*
//      `git push origin master` with no colon at all, which lands commits
//      on master just as directly as any refspec does. Checking every
//      non-flag token — including a lone one — for either a colon-refspec
//      or an exact match against a protected branch name closes both,
//      erring toward blocking rather than trying to perfectly replicate
//      git's own remote-vs-refspec argument resolution.
function protectedRefspecPush(segment) {
  if (!/^git\s+push\b/.test(segment)) return null;

  const tokens = segment.split(/\s+/); // tokens[0] === 'git', tokens[1] === 'push'
  const nonFlags = tokens.slice(2).filter((t) => !t.startsWith('-'));

  for (const rawToken of nonFlags) {
    // This hook sees the raw command string, quotes and all — the shell
    // hasn't stripped them yet the way it would before argv reaches git
    // itself. `git push origin "main"` or `git push origin "feature:main"`
    // would otherwise leave a trailing quote character on the token
    // (`main"`), which never matches PROTECTED_BRANCHES even though the
    // quoting changes nothing about what actually gets pushed.
    const token = stripSurroundingQuotes(rawToken);
    const colonIdx = token.indexOf(':');
    if (colonIdx !== -1) {
      let src = token.slice(0, colonIdx);
      // An empty dest (`git push origin branch:`) means "push to a remote
      // ref with the same name as src" — git's own default-dest behavior
      // for a trailing-colon refspec.
      let dest = token.slice(colonIdx + 1) || src;
      src = src.replace(/^refs\/heads\//, '');
      dest = dest.replace(/^refs\/heads\//, '');
      // No `src !== dest` requirement — `git push origin main:main` (or
      // the trailing-colon form `main:`) lands commits on main exactly as
      // directly as any other refspec targeting it, so there's no case
      // where src and dest being equal makes this any less a direct push
      // to a protected branch.
      if (PROTECTED_BRANCHES.includes(dest)) {
        return { src, dest };
      }
      continue;
    }

    // A bare protected-branch-name token only counts once at least a
    // remote/repository has also been given (`git push origin master`) —
    // a single lone token (`git push master`) is what git itself treats
    // as the repository argument, not a branch, so there's no push of
    // anything named master/main to react to yet.
    if (nonFlags.length >= 2 && PROTECTED_BRANCHES.includes(token)) {
      return { src: token, dest: token };
    }
  }
  return null;
}

// `getCurrentBranch` defaults to the real `currentBranch()` (a live `git
// rev-parse` call) but is overridable — tests inject a fixed value instead
// of depending on whatever branch happens to be checked out in the real
// repo when they run, which would otherwise make any test exercising the
// "no explicit branch/refspec given" fallback path non-deterministic.
function findMergeReason(fullCmd, getCurrentBranch = currentBranch) {
  const segments = expandShellWrappers(segmentsOf(fullCmd));
  // Every anchored check below runs against the normalized form (env
  // prefix and command-path prefix stripped) — the original, raw segment
  // is kept only for the human-readable "matched:" text in a block
  // report, so the reason shown still looks like what was actually typed.
  const normalized = segments.map(normalizeSegment);

  // Resolved once per command and reused by both the push and merge
  // checks below: a branch this command chain explicitly checks out to
  // (textually — the actual HEAD hasn't moved yet when this hook runs),
  // falling back to whatever branch is actually currently checked out.
  // Lazy since a real `git rev-parse` call is only worth paying for when
  // nothing in the command already answers the question textually.
  const checkedOutTo = normalized
    .map(checkoutTarget)
    .find((target) => target && PROTECTED_BRANCHES.includes(target));
  let effectiveBranchCache;
  function effectiveBranch() {
    if (effectiveBranchCache === undefined) {
      effectiveBranchCache = checkedOutTo || getCurrentBranch();
    }
    return effectiveBranchCache;
  }

  for (let i = 0; i < segments.length; i++) {
    const segment = normalized[i];

    if (/^gh\s+pr\s+merge\b/.test(segment)) {
      return `\`gh pr merge\` — matched: ${segments[i]}`;
    }
    // The merge REST endpoint only actually merges on PUT — a GET to the
    // same path (checking merge state/method, used by ordinary read-only
    // status tooling) doesn't merge anything and shouldn't be blocked.
    // -X's value can be space-separated (`-X PUT`) or concatenated
    // curl-style (`-XPUT`, no space at all) — `\s*` covers both in one
    // alternative rather than requiring a separator that may not be there.
    if (
      /^gh\s+api\b/.test(segment) &&
      /\/pulls\/[^\s/]+\/merge\b/.test(segment) &&
      /(?:^|\s)(?:-X\s*PUT|--method(?:\s+|=)PUT)\b/i.test(segment)
    ) {
      return `\`gh api\` PUT call to a PR's /merge REST endpoint — matched: ${segments[i]}`;
    }
    // Push (refspec or plain branch name) that lands commits directly on
    // master/main, bypassing PR + merge entirely — e.g.
    // `git push origin some-branch:master` or a plain `git push origin master`.
    const refspec = protectedRefspecPush(segment);
    if (refspec) {
      const detail = refspec.src === refspec.dest
        ? `pushes directly to protected branch "${refspec.dest}"`
        : `push refspec targets protected branch "${refspec.dest}" directly from "${refspec.src}"`;
      return `${detail} — matched: ${segments[i]}`;
    }
    // A `git push` with no explicit branch/refspec argument (at most a
    // remote) pushes the *current* branch via git's own defaults — e.g.
    // `git switch main && git push origin`. protectedRefspecPush() only
    // catches an explicit mention of a protected branch, so this implicit
    // form landed commits on master/main completely undetected. Only
    // applies when nothing explicit was given (nonFlags.length <= 1):
    // an explicit branch/refspec naming a *different* branch (e.g.
    // `git push origin some-other-branch` while sitting on master) is a
    // deliberate, legitimate push of something else and shouldn't be
    // swept in just because HEAD happens to be on a protected branch.
    if (/^git\s+push\b/.test(segment)) {
      const tokens = segment.split(/\s+/);
      const rest = tokens.slice(2);
      // --all/--mirror push every local branch (or the whole repo,
      // including local master/main if either exists) to the remote,
      // regardless of which branch is currently checked out — unlike an
      // ordinary implicit push, this isn't gated on the current branch
      // being protected at all, since it can land commits on master/main
      // even when run from an unrelated feature branch. Blocked
      // unconditionally whenever either flag is present, matching this
      // hook's stated "err toward blocking" direction.
      if (rest.includes('--all') || rest.includes('--mirror')) {
        return `push includes --all/--mirror, which can update protected branches regardless of the current branch — matched: ${segments[i]}`;
      }
      const nonFlags = rest.filter((t) => !t.startsWith('-'));
      if (nonFlags.length <= 1) {
        const branch = effectiveBranch();
        if (branch && PROTECTED_BRANCHES.includes(branch)) {
          return `implicit push (no explicit branch/refspec given) while on protected branch "${branch}" — matched: ${segments[i]}`;
        }
      }
    }
  }

  // Local `git merge` while sitting on (or about to check out to) a
  // protected branch.
  const hasMerge = normalized.some((s) => /^git\s+merge\b/.test(s));
  if (hasMerge) {
    const branch = effectiveBranch();
    if (branch && PROTECTED_BRANCHES.includes(branch)) {
      return `local \`git merge\` on protected branch "${branch}"`;
    }
  }

  return null;
}

module.exports = { findMergeReason, protectedRefspecPush, isEnabled, currentBranch };

// Only run the stdin-driven hook lifecycle when this file is executed
// directly (`node check-merge-guard.js`, which is how Claude Code invokes
// it) — not when it's require()'d, e.g. from check-merge-guard.test.js.
if (require.main === module) {
  runHook();
}

function runHook() {
  const chunks = [];
  process.stdin.on('data', (d) => chunks.push(d));
  process.stdin.on('end', () => {
    if (!isEnabled()) process.exit(0);

    let input;
    try {
      input = JSON.parse(Buffer.concat(chunks).toString());
    } catch {
      process.exit(0);
    }

    const cmd = (input?.tool_input?.command || '').trim();
    if (!cmd) process.exit(0);

    const reason = findMergeReason(cmd);
    if (!reason) process.exit(0);

    const report = [
      'MERGE GUARD — BLOCK (always, by design)',
      '',
      `This command would merge a PR or land commits on a protected branch: ${reason}`,
      '',
      'This hook does not check whether permission was already given in the',
      'conversation — it can\'t read the chat, and any bypass this session',
      'could set on the command itself would defeat the point. It blocks every',
      'matching command, unconditionally.',
      '',
      'Fix: get explicit confirmation in this conversation that this specific',
      'PR should be merged now, then have the merge happen via the GitHub PR',
      'page (or a terminal outside this session) — not from this session.',
    ].join('\n');

    console.error(report);
    process.stdout.write(JSON.stringify({ continue: false, stopReason: report }));
    process.exit(2);
  });
}
