'use strict';

// Shared command parsing for the git/gh guard hooks (check-merge-guard.js,
// check-branch-delete-guard.js, check-ci-status-after-push.js).
//
// Every guard anchors its checks on a bare `git push` / `gh pr merge` /
// etc. at the start of a command segment, so all of them need the same
// normalization first: split the command on chain operators outside
// quotes, strip env/sudo/command/exec prefixes, unwrap `bash -c "..."`
// wrappers, drop a path prefix on the binary, and skip git/gh global
// options that sit before the subcommand. Each hook used to carry its own
// copy of some subset of this, and the copies drifted — the less thorough
// ones could be bypassed by forms the thorough one already handled.
//
// This is a guard against an assistant's mistakes, not a full shell
// parser: it covers the forms seen in practice and in review, and errs
// toward recognizing a command rather than missing it.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// One shell word as it appears in the raw command string: any run of
// unquoted non-space characters and quoted regions, concatenated —
// `"C:\Work Tree"`, `'/a b'`, and `user.name="A B"` are each one word. An
// option value pattern of `\S+` stops at the first space inside quotes,
// leaving the rest of the path behind as a fake subcommand.
const WORD = `(?:[^\\s"']|"[^"]*"|'[^']*')+`;
const OPTIONAL_WORD = `(?:${WORD})?`;

// Index just past the closing `"` of a double-quoted string opening at
// `i`, or the end of `str` if unterminated. A backslash escapes the next
// character (so `\"` doesn't end the quote), and a `$(...)` or backtick
// substitution inside is skipped whole — its own quotes don't close this
// one.
function doubleQuoteEnd(str, i) {
  for (let j = i + 1; j < str.length; j++) {
    const ch = str[j];
    if (ch === '\\') {
      j++;
    } else if (ch === '"') {
      return j + 1;
    } else if (ch === '`' || (ch === '$' && str[j + 1] === '(')) {
      j = substitutionEnd(str, j) - 1;
    }
  }
  return str.length;
}

// Index just past the end of a `$(...)` or backtick command substitution
// opening at `i`, or the end of `str` if unterminated. Parentheses nest,
// and quotes and inner substitutions are skipped whole, so the `)` in
// `$(echo ")")` or `$(cd $(pwd) && x)` doesn't end the outer one.
function substitutionEnd(str, i) {
  if (str[i] === '`') {
    for (let j = i + 1; j < str.length; j++) {
      if (str[j] === '\\') j++;
      else if (str[j] === '`') return j + 1;
    }
    return str.length;
  }
  let depth = 0;
  for (let j = i + 1; j < str.length; j++) {
    const ch = str[j];
    if (ch === '\\') {
      j++;
    } else if (ch === "'") {
      const close = str.indexOf("'", j + 1);
      if (close === -1) return str.length;
      j = close;
    } else if (ch === '"') {
      j = doubleQuoteEnd(str, j) - 1;
    } else if (ch === '`' || (ch === '$' && str[j + 1] === '(')) {
      j = substitutionEnd(str, j) - 1;
    } else if (ch === '(') {
      depth++;
    } else if (ch === ')') {
      depth--;
      if (depth === 0) return j + 1;
    }
  }
  return str.length;
}

// Index just past a quoted string, an escaped character, or a command
// substitution opening at `i` — text that goes into a segment whole and is
// never split — or -1 if `i` opens none of those. Single quotes are fully
// literal.
function unsplittableEnd(str, i) {
  const ch = str[i];
  if (ch === '\\') return Math.min(i + 2, str.length);
  if (ch === "'") {
    const close = str.indexOf("'", i + 1);
    return close === -1 ? str.length : close + 1;
  }
  if (ch === '"') return doubleQuoteEnd(str, i);
  if (ch === '`' || (ch === '$' && str[i + 1] === '(')) return substitutionEnd(str, i);
  return -1;
}

// Splits on shell chain operators (`&&`, `||`, `;`, `&`, `|`, newline) —
// only those outside any quoted string or command substitution, so a
// commit message that merely *mentions* `git push origin main && ...` is
// not split into a fake push. A `(` subshell's parentheses are boundaries
// too: `(cd repo && git push origin main)` must not leave `main)` as the
// branch. A `$(...)`/backtick substitution stays inside its segment;
// substitutionsOf() pulls its body out separately.
function segmentsOf(fullCmd) {
  const segments = [];
  let current = '';

  for (let i = 0; i < fullCmd.length; i++) {
    const ch = fullCmd[i];

    const end = unsplittableEnd(fullCmd, i);
    if (end !== -1) {
      current += fullCmd.slice(i, end);
      i = end - 1;
      continue;
    }
    if ((ch === '&' && fullCmd[i + 1] === '&') || (ch === '|' && fullCmd[i + 1] === '|')) {
      segments.push(current);
      current = '';
      i++;
      continue;
    }
    if (ch === ';' || ch === '&' || ch === '|' || ch === '\n' || ch === '(' || ch === ')') {
      segments.push(current);
      current = '';
      continue;
    }
    current += ch;
  }
  segments.push(current);

  return segments.map((s) => s.trim()).filter(Boolean);
}

// The command strings inside a segment's `$(...)` and backtick
// substitutions — outside quotes or inside double quotes, where the shell
// runs them, but not inside single quotes, where it doesn't. Outermost
// level only: nested ones are found when each body is parsed in turn.
function substitutionsOf(segment) {
  const bodies = [];
  let inDouble = false;
  for (let i = 0; i < segment.length; i++) {
    const ch = segment[i];
    if (ch === '\\') {
      i++;
    } else if (ch === "'" && !inDouble) {
      const close = segment.indexOf("'", i + 1);
      if (close === -1) break;
      i = close;
    } else if (ch === '"') {
      inDouble = !inDouble;
    } else if (ch === '`' || (ch === '$' && segment[i + 1] === '(')) {
      const end = substitutionEnd(segment, i);
      bodies.push(segment.slice(ch === '`' ? i + 1 : i + 2, end - 1));
      i = end - 1;
    }
  }
  return bodies;
}

// Index of the closing quote for a quoted argument whose content starts at
// `startIdx`, honoring double-quote backslash escapes. -1 if unterminated.
function findClosingQuote(str, startIdx, quoteChar) {
  for (let i = startIdx; i < str.length; i++) {
    const ch = str[i];
    if (quoteChar === '"' && ch === '\\' && i + 1 < str.length) {
      i++;
      continue;
    }
    if (ch === quoteChar) return i;
  }
  return -1;
}

// `bash -c "..."` / `sh -lc '...'` / `--command` run their quoted argument
// as a nested command string. Returns that inner string (with the outer
// double-quote escaping undone), or null if `segment` isn't such a wrapper.
// Trailing words after the closing quote ($0/$1 for the inner script) are
// ignored — they can't change what runs.
function unwrapShellDashC(segment) {
  const opener = segment.match(/^(?:\S*[\\/])?(?:bash|sh|zsh|dash|ksh)(?:\.exe)?\s+(?:-[a-zA-Z]*c[a-zA-Z]*|--command)\s+(["'])/);
  if (!opener) return null;

  const quoteChar = opener[1];
  const contentStart = opener[0].length;
  const closeIdx = findClosingQuote(segment, contentStart, quoteChar);
  if (closeIdx === -1) return null;

  const content = segment.slice(contentStart, closeIdx);
  return quoteChar === '"' ? content.replace(/\\(["\\$`])/g, '$1') : content;
}

// A leading `env` (bare or path-qualified, with its own flags) and any
// number of `VAR=value` assignments — `GIT_SSH_COMMAND="ssh -vv" git push`
// is the same push.
const ENV_COMMAND = /^(?:\S*[\\/])?env(?=\s|$)\s*/;
const ENV_ASSIGNMENT = new RegExp(`^[A-Za-z_][A-Za-z0-9_]*=${OPTIONAL_WORD}\\s*`);
const ENV_NO_ARG_FLAG = /^(?:-i|--ignore-environment|-0|--null|-v|--debug)\s*/;
const ENV_ARG_FLAG_SEPARATE = new RegExp(`^(?:-u|--unset|-C|--chdir|-S|--split-string)\\s+${WORD}\\s*`);
const ENV_ARG_FLAG_COMBINED = new RegExp(`^(?:--unset|--chdir|--split-string)=${OPTIONAL_WORD}\\s*`);
const ENV_END_OPTIONS = /^--\s+/;

function stripLeadingEnvPrefix(segment) {
  let s = segment.replace(ENV_COMMAND, '');
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

// `sudo`, `command`, and `exec` run the real command without being a
// different, unwatched command themselves. Only each wrapper's common
// flags are handled.
const SUDO_ARG_FLAG = new RegExp(`^(?:-u|--user)\\s+${WORD}\\s*`);
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

// Shell control-flow words that put the next word in command position:
// once `if true; then git push; fi` is split on `;`, the push segment
// starts with `then`. Same for `do`/`else`/`elif`/`if`/`while`/`until`,
// `!`, and a `{` group. (segmentsOf() already splits off a `(` subshell.)
const CONTROL_FLOW_WORD = /^(?:if|then|else|elif|do|while|until|!|\{)\s+/;

function stripLeadingControlFlow(segment) {
  return segment.replace(CONTROL_FLOW_WORD, '');
}

// Env prefixes, sudo/command/exec wrappers, and control-flow words, in any
// mix and order.
function stripPrefixes(segment) {
  let s = segment;
  let prev;
  do {
    prev = s;
    s = stripLeadingWrapperPrefix(stripLeadingEnvPrefix(stripLeadingControlFlow(s)));
  } while (s !== prev);
  return s;
}

// `/usr/bin/git`, `./bin/gh.exe`, or a quoted Windows path such as
// `"C:\Program Files\Git\bin\git.exe"` → bare `git` / `gh`.
function stripCommandPathPrefix(segment) {
  const quoted = segment.match(/^(["'])([^"']*[\\/](gh|git)(?:\.exe)?)\1(\s.*)?$/);
  if (quoted) {
    return `${quoted[3]}${quoted[4] || ''}`;
  }
  return segment.replace(/^(\S*[\\/])(gh|git)(?:\.exe)?\b/, '$2');
}

// git's own global options between `git` and the subcommand
// (`git -C "C:\Work Tree" push ...`). Values are whole shell words, so a
// quoted path with spaces is consumed in full.
const GIT_GLOBAL_ARG_FLAG_SEPARATE = new RegExp(`^(?:-C|-c|--git-dir|--work-tree|--namespace|--exec-path|--config-env)\\s+${WORD}\\s*`);
const GIT_GLOBAL_ARG_FLAG_COMBINED = new RegExp(`^(?:--git-dir|--work-tree|--namespace|--exec-path|--config-env)=${OPTIONAL_WORD}\\s*`);
const GIT_GLOBAL_NO_ARG_FLAG = /^(?:-p|--paginate|-P|--no-pager|--bare|--no-replace-objects|--literal-pathspecs|--no-optional-locks)\s*/;

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

// gh's -R/--repo and --hostname selectors before the subcommand.
const GH_GLOBAL_ARG_FLAG_SEPARATE = new RegExp(`^(?:-R|--repo|--hostname)\\s+${WORD}\\s*`);
const GH_GLOBAL_ARG_FLAG_COMBINED = new RegExp(`^--(?:repo|hostname)=${OPTIONAL_WORD}\\s*`);

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

// One segment (no chain operators, not a shell wrapper) → its bare
// `git <subcommand> ...` / `gh <subcommand> ...` form, or the prefix-
// stripped segment unchanged if it's some other command.
function normalizeSegment(segment) {
  const s = stripCommandPathPrefix(stripPrefixes(segment));
  if (/^git\s+/.test(s)) {
    return `git ${stripGitGlobalOptions(s.slice('git '.length).trimStart())}`;
  }
  if (/^gh\s+/.test(s)) {
    return `gh ${stripGhGlobalOptions(s.slice('gh '.length).trimStart())}`;
  }
  return s;
}

// Git Bash spells Windows drives as `/c/repos/x`; Node on Windows would
// resolve that against the current drive as `C:\c\repos\x`.
function toNativePath(p) {
  if (process.platform !== 'win32') return p;
  const m = p.match(/^\/([a-zA-Z])(?:\/(.*))?$/);
  return m ? `${m[1].toUpperCase()}:\\${(m[2] || '').replace(/\//g, '\\')}` : p;
}

// A directory argument as written (`"C:\Work Tree"`, `~/x`, `../y`)
// resolved against `base`, or null when it can't be known statically —
// `cd -`, a `$VAR`, a command substitution, or no known base.
function resolveDirArg(base, rawArg) {
  if (base === null) return null;
  const arg = stripSurroundingQuotes(rawArg || '~');
  if (arg === '-' || /[$`]/.test(arg)) return null;
  if (arg === '~') return os.homedir();
  if (arg.startsWith('~/')) return path.join(os.homedir(), arg.slice(2));
  return path.resolve(base, toNativePath(arg));
}

const CD_COMMAND = new RegExp(`^(?:cd|pushd)(?:\\s+(${WORD}))?\\s*$`);
const GIT_DASH_C = new RegExp(`^-C\\s+(${WORD})\\s*`);

// The directory a git command runs in: each `-C <dir>` global option
// resolves against the one before it, as git itself does.
function gitDir(segment, base) {
  const s = stripCommandPathPrefix(stripPrefixes(segment));
  if (!/^git\s+/.test(s)) return base;
  let rest = s.slice('git '.length).trimStart();
  let dir = base;
  let prev;
  do {
    prev = rest;
    const m = rest.match(GIT_DASH_C);
    if (m) {
      dir = resolveDirArg(dir, m[1]);
      rest = rest.slice(m[0].length);
    } else {
      rest = rest
        .replace(GIT_GLOBAL_ARG_FLAG_COMBINED, '')
        .replace(GIT_GLOBAL_ARG_FLAG_SEPARATE, '')
        .replace(GIT_GLOBAL_NO_ARG_FLAG, '');
    }
  } while (rest !== prev);
  return dir;
}

// Every command a raw Bash command string would run, flattened: split on
// chain operators, with shell -c wrappers unwrapped and `$(...)`/backtick
// substitutions parsed recursively (`echo $(gh pr merge 27)` runs the
// merge). A substitution's commands come just before the segment holding
// it, since they run first, in the directory that segment starts in. Prefixes
// are stripped *before* testing for a wrapper — otherwise `env bash -c
// "gh pr merge 27"` is never seen as a wrapper (it starts with `env`) and
// stripping `env` afterward leaves an un-expanded `bash -c ...`.
//
// Returns [{ raw, normalized, cwd }]: `raw` is the segment as written, for
// human-readable reports; `normalized` is what anchored checks run on;
// `cwd` is the directory the command runs in, after any earlier `cd`/
// `pushd` and its own `git -C` (null when that can't be known statically).
// A `cd` inside a shell wrapper doesn't carry out of it, as in a real shell.
function commandSegments(fullCmd, startDir = process.cwd()) {
  const out = [];
  let dir = startDir;
  for (const raw of segmentsOf(fullCmd)) {
    const inner = unwrapShellDashC(stripPrefixes(raw));
    if (inner !== null) {
      out.push(...commandSegments(inner, dir));
      continue;
    }
    for (const body of substitutionsOf(raw)) {
      out.push(...commandSegments(body, dir));
    }
    const normalized = normalizeSegment(raw);
    if (/^(?:cd|pushd|popd)(?:\s|$)/.test(normalized)) {
      // A form this can't follow (`cd $(...)`, `popd`) makes the directory
      // unknown rather than silently leaving it where it was.
      const cd = normalized.match(CD_COMMAND);
      dir = cd && !normalized.startsWith('popd') ? resolveDirArg(dir, cd[1]) : null;
    }
    out.push({ raw, normalized, cwd: gitDir(raw, dir) });
  }
  return out;
}

// The first `git push` in the command, as a commandSegments() entry, or
// undefined if there is none.
function firstPushSegment(fullCmd, startDir = process.cwd()) {
  return commandSegments(fullCmd, startDir).find((s) => /^git\s+push(?:\s|$)/.test(s.normalized));
}

// The directory the first `git push` in the command runs in, if it can be
// determined and exists; otherwise null.
function pushTargetDir(fullCmd, startDir = process.cwd()) {
  const push = firstPushSegment(fullCmd, startDir);
  if (!push || push.cwd === null) return null;
  return fs.existsSync(push.cwd) ? push.cwd : null;
}

// True if any command in the string is an actual `git push`.
function isGitPush(fullCmd) {
  return commandSegments(fullCmd).some((s) => /^git\s+push(?:\s|$)/.test(s.normalized));
}

// Strips one matching pair of surrounding quotes from a whitespace-split
// token, so `"main"` compares equal to `main`.
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

// A segment's shell words with their quotes removed: `"/tmp/remote repo"`
// is one word, and `feat"ure"` is `feature`. Backslash escapes and
// expansions are left as written.
function shellWords(segment) {
  return (segment.match(new RegExp(WORD, 'g')) || []).map((word) =>
    word.replace(/"([^"]*)"|'([^']*)'/g, (_, dq, sq) => dq ?? sq)
  );
}

// `git push` options whose value is the next word, so it isn't mistaken
// for the remote or a refspec.
const PUSH_ARG_FLAGS = new Set(['-o', '--push-option', '--repo', '--receive-pack', '--exec']);

// Flags that push a whole set of refs instead of (or as well as) the
// refspecs given.
const PUSH_SET_FLAGS = new Set(['--all', '--branches', '--mirror', '--tags']);

// The arguments of a normalized `git push` segment: `remote` (the first
// positional, or `--repo`; null when omitted), `refspecs` (as written,
// `tag <name>` folded into `refs/tags/<name>`), `sets` (any of --all,
// --branches, --mirror, --tags) and `deletes` (--delete/-d given).
function pushArgs(segment) {
  const args = shellWords(segment).slice(2);
  const positional = [];
  const sets = [];
  let repo = null;
  let deletes = false;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--delete' || arg === '-d') deletes = true;
    else if (PUSH_SET_FLAGS.has(arg)) sets.push(arg);
    else if (arg === '--repo') repo = args[++i] || null;
    else if (arg.startsWith('--repo=')) repo = arg.slice('--repo='.length) || null;
    else if (PUSH_ARG_FLAGS.has(arg)) i++;
    else if (!arg.startsWith('-')) positional.push(arg);
  }
  const remote = repo ?? positional.shift() ?? null;
  const refspecs = [];
  for (let i = 0; i < positional.length; i++) {
    if (positional[i] === 'tag' && i + 1 < positional.length) refspecs.push(`refs/tags/${positional[++i]}`);
    else refspecs.push(positional[i]);
  }
  return { remote, refspecs, sets, deletes };
}

// A refspec's source and destination: `+feature:main` → { src: 'feature',
// dest: 'main' }; a bare `feature` is both. An empty `src` (`:feature`)
// is a delete.
function splitRefspec(refspec) {
  const spec = refspec.replace(/^\+/, '');
  const colon = spec.indexOf(':');
  const src = colon === -1 ? spec : spec.slice(0, colon);
  const dest = colon === -1 ? spec : spec.slice(colon + 1) || src;
  return { src, dest };
}

module.exports = {
  commandSegments,
  firstPushSegment,
  isGitPush,
  normalizeSegment,
  pushArgs,
  pushTargetDir,
  segmentsOf,
  splitRefspec,
  stripLeadingEnvPrefix,
  stripSurroundingQuotes,
};
