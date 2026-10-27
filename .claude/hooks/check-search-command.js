#!/usr/bin/env node
/**
 * check-search-command.js
 * Hook type : PreToolUse — Bash
 * Purpose   : Nudge (or optionally block) raw shell search/read commands
 *             (grep, find, cat, head, tail, ...) in favor of the assistant's
 *             own dedicated Grep/Glob/Read-equivalent tools, which return
 *             structured, token-bounded results instead of raw stdout dumps.
 *
 *             Claude Code's own Bash tool description already discourages
 *             this by default — this hook exists so the same nudge (a) shows
 *             up even in environments/harnesses that don't carry that tool
 *             description, and (b) can be turned into a hard block, since a
 *             prompt-level nudge is easy for a model to talk itself past.
 *
 * Inputs (via stdin JSON):
 *   { tool_name, tool_input: { command } }
 *
 * Config used:
 *   .claude/hooks/config.json → search_guard.enabled, search_guard.commands[],
 *                               search_guard.on_violation ("warn" | "block"),
 *                               search_guard.allow_patterns[]
 */

const { loadHookConfig } = require('./lib/hook-config.cjs');
const { commandSegments, stripSurroundingQuotes } = require('./lib/git-command.cjs');
const { resolve } = require('path');

const CONFIG_PATH = resolve(__dirname, 'config.json');

const DEFAULT_COMMANDS = ['grep', 'egrep', 'fgrep', 'rg', 'find', 'cat', 'head', 'tail'];

const TOOL_EQUIVALENT = {
  grep: 'Grep',
  egrep: 'Grep',
  fgrep: 'Grep',
  rg: 'Grep',
  find: 'Glob (for file patterns) or Grep (for content)',
  cat: 'Read',
  head: 'Read (with an offset/limit)',
  tail: 'Read (with an offset/limit)',
};

function log(msg) {
  process.stderr.write(`[search-guard] ${msg}\n`);
}

// The watched commands (lowercased basenames) that a Bash command runs.
// Uses the shared parser in lib/git-command.cjs, so operators inside quotes
// don't create fake segments (`printf '%s\n' 'a | cat b'` has no `cat`),
// and env/sudo/command/exec prefixes, `bash -c '...'` wrappers, and
// `$(...)` substitutions are seen through the same way the git guards see
// through them. Then looks at the leading word of each segment.
function rawSearchCommands(command, commands = DEFAULT_COMMANDS) {
  const commandSet = new Set(commands.map(c => c.toLowerCase()));
  const hits = [];

  for (const { normalized } of commandSegments(command)) {
    const head = stripSurroundingQuotes(normalized.split(/\s+/)[0]);
    if (!head) continue;

    const basename = head.split(/[\\/]/).pop().toLowerCase().replace(/\.exe$/, '');
    if (commandSet.has(basename)) {
      hits.push(basename);
    }
  }
  return [...new Set(hits)];
}

module.exports = { rawSearchCommands };

// Only run the stdin-driven hook lifecycle when executed directly (how
// Claude Code invokes it) — not when require()'d from the test file.
if (require.main === module) {
  runHook();
}

function runHook() {
  // ── Load config ─────────────────────────────────────────────────────────
  let config;
  try {
    config = loadHookConfig({ hooksDir: __dirname });
  } catch {
    log(`WARN: config.json not found at ${CONFIG_PATH} — skipping search guard`);
    process.exit(0);
  }

  if (!config.search_guard?.enabled) {
    process.exit(0);
  }

  const {
    commands = DEFAULT_COMMANDS,
    on_violation = 'warn',
    allow_patterns = [],
  } = config.search_guard;

  // ── Read stdin ──────────────────────────────────────────────────────────
  const chunks = [];
  process.stdin.on('data', c => chunks.push(c));
  process.stdin.on('end', () => {
    let payload;
    try {
      payload = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    } catch {
      process.exit(0);
    }

    const command = payload?.tool_input?.command ?? '';
    if (!command) process.exit(0);

    // Explicit allowlist escape hatch — e.g. a legitimate build/CI command
    // that happens to invoke grep/cat internally.
    if (allow_patterns.some(p => command.includes(p))) {
      process.exit(0);
    }

    log('Checking command');

    const unique = rawSearchCommands(command, commands);
    if (unique.length === 0) {
      process.exit(0);
    }

    const severity = on_violation === 'block' ? '❌' : '⚠️ ';
    process.stderr.write(`\n${severity} SEARCH-GUARD: Raw shell search/read command detected: ${unique.join(', ')}\n`);
    process.stderr.write(`   Command   : ${command}\n`);
    for (const cmd of unique) {
      process.stderr.write(`   Prefer    : ${TOOL_EQUIVALENT[cmd] ?? 'the dedicated search/read tool'} instead of "${cmd}"\n`);
    }
    process.stderr.write('   Why       : the dedicated tools return structured, token-bounded results; raw shell output can dump an entire file or match set into context.\n');
    if (on_violation !== 'block') {
      process.stderr.write('   This is a nudge, not a block — proceed if the dedicated tool genuinely cannot do this (e.g. piping into another shell command).\n\n');
    } else {
      process.stderr.write('\n');
    }

    process.exit(on_violation === 'block' ? 2 : 0);
  });
}
