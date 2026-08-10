#!/usr/bin/env node
/**
 * check-dep-guard.js
 * Hook type : PreToolUse — Bash
 * Purpose   : Warn (non-blocking) when Claude runs a command that installs
 *             a dependency. Gives the developer a chance to review it first.
 *
 * Inputs (via stdin JSON):
 *   { tool_name, tool_input: { command } }
 *
 * Config used:
 *   .claude/hooks/config.json → dep_guard.enabled, dep_guard.warn_patterns[],
 *                               dep_guard.custom_message
 */

import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

// ── Locate config ─────────────────────────────────────────────────────────
const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const CONFIG_PATH = resolve(SCRIPT_DIR, 'config.json');

// ── Load config ───────────────────────────────────────────────────────────
let config;
try {
  config = JSON.parse(readFileSync(CONFIG_PATH, 'utf8'));
} catch {
  process.stderr.write('[dep-guard] WARN: config.json not found or invalid — skipping dep guard\n');
  process.exit(0);
}

if (!config.dep_guard?.enabled) {
  process.exit(0);
}

const patterns = config.dep_guard.warn_patterns ?? [];
if (patterns.length === 0) {
  process.exit(0);
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

  // ── Check command against patterns ─────────────────────────────────────
  process.stderr.write(`[dep-guard] Checking command\n`);

  const matched = patterns.some(p =>
    command.toLowerCase().includes(p.toLowerCase())
  );

  if (matched) {
    const custom = config.dep_guard.custom_message;
    if (custom) {
      process.stderr.write(`⚠️  DEP-GUARD: ${custom}\n`);
    } else {
      process.stderr.write('⚠️  DEP-GUARD: A dependency install was detected.\n');
      process.stderr.write(`   Command : ${command}\n`);
      process.stderr.write('   Action  : Confirm the dependency is appropriate before proceeding.\n');
    }
  }

  // Always exit 0 — dep-guard warns but does not block
  process.exit(0);
});
