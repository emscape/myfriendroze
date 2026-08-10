#!/usr/bin/env node
/**
 * check-script-exists.js
 * Hook type : PreToolUse — Bash
 * Purpose   : Two checks combined:
 *
 *   1. SCRIPT EXISTENCE: When Claude runs "npm run X", "pnpm run X", etc.,
 *      verify that script X exists in package.json before the command runs.
 *      Prevents silent no-ops from mis-spelled or missing script names.
 *
 *   2. NO-OP DETECTION: Warn when a Bash command appears to be a trivial
 *      no-op (standalone `true`, `exit 0`, or empty echo). These are often
 *      placeholder commands that were never filled in.
 *
 * Inputs (via stdin JSON):
 *   { tool_name, tool_input: { command } }
 *
 * Config used:
 *   .claude/hooks/config.json → script_guard.enabled,
 *                               script_guard.package_json_paths[],
 *                               script_guard.on_missing ("warn" | "block")
 */

import { readFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const CONFIG_PATH = resolve(SCRIPT_DIR, 'config.json');
const CWD = process.cwd();

function log(msg) {
  process.stderr.write(`[script-guard] ${msg}\n`);
}

// ── Load config ───────────────────────────────────────────────────────────
let config;
try {
  config = JSON.parse(readFileSync(CONFIG_PATH, 'utf8'));
} catch {
  log(`WARN: config.json not found at ${CONFIG_PATH} — skipping script guard`);
  process.exit(0);
}

if (!config.script_guard?.enabled) {
  process.exit(0);
}

const {
  package_json_paths = ['package.json'],
  on_missing = 'warn',
} = config.script_guard;

// ── Load all package.json scripts from configured paths ───────────────────
const availableScripts = new Set();
for (const pkgPath of package_json_paths) {
  const fullPath = resolve(CWD, pkgPath);
  if (!existsSync(fullPath)) continue;
  try {
    const pkg = JSON.parse(readFileSync(fullPath, 'utf8'));
    for (const name of Object.keys(pkg.scripts ?? {})) {
      availableScripts.add(name);
    }
  } catch {
    log(`WARN: Could not parse ${fullPath} — skipping`);
  }
}

// ── No-op patterns ────────────────────────────────────────────────────────
const NOOP_PATTERNS = [
  /^\s*true\s*$/,
  /^\s*exit\s+0\s*$/,
  /^\s*:\s*$/,             // Bash no-op colon command
  /^\s*echo\s*""\s*$/,
  /^\s*echo\s*''\s*$/,
];

function isNoOp(command) {
  return NOOP_PATTERNS.some(p => p.test(command));
}

// ── Extract script name from run commands ─────────────────────────────────
// Matches: npm run X, pnpm run X, yarn run X, npx X, pnpm X (shorthand)
function extractScriptName(command) {
  const runMatch = command.match(/\b(?:npm|pnpm|yarn)\s+run\s+([^\s;&|]+)/);
  if (runMatch) return runMatch[1];
  return null;
}

// ── Read stdin ────────────────────────────────────────────────────────────
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

  log(`Checking command`);

  // ── No-op detection ───────────────────────────────────────────────────────
  if (isNoOp(command.trim())) {
    process.stderr.write(`⚠️  SCRIPT-GUARD: Command appears to be a no-op: ${command.trim()}\n`);
    process.stderr.write(`   If this is intentional, remove this command. If not, replace it with the real command.\n`);
    // No-op detection is always non-blocking (warn only)
    process.exit(0);
  }

  // ── Script existence check ────────────────────────────────────────────────
  if (availableScripts.size === 0) {
    // No package.json found — skip script existence check silently
    process.exit(0);
  }

  const scriptName = extractScriptName(command);
  if (!scriptName) {
    // Not a run command — nothing to validate
    process.exit(0);
  }

  if (!availableScripts.has(scriptName)) {
    const severity = on_missing === 'block' ? '❌' : '⚠️ ';
    process.stderr.write(`\n${severity} SCRIPT-GUARD: Script "${scriptName}" not found in package.json\n`);
    process.stderr.write(`   Command  : ${command}\n`);
    process.stderr.write(`   Available: ${[...availableScripts].sort().join(', ') || '(none found)'}\n`);
    process.stderr.write(`   Check for a typo or add the script to package.json before running.\n\n`);

    if (on_missing === 'block') {
      process.exit(1);
    }
  }

  process.exit(0);
});
