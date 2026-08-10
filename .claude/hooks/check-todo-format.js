#!/usr/bin/env node
/**
 * check-todo-format.js
 * Hook type : PostToolUse — Write | Edit | MultiEdit
 * Purpose   : Enforce a consistent TODO comment format. Bare "TODO" comments
 *             with no owner or description are invisible technical debt.
 *             Optionally blocks (exit 1) or warns (exit 0) on violation.
 *
 * Inputs (via stdin JSON):
 *   { tool_name, tool_input: { file_path, content } }
 *
 * Config used:
 *   .claude/hooks/config.json → todo_format.enabled,
 *                               todo_format.required_pattern,
 *                               todo_format.on_violation ("warn" | "block")
 *
 * Default pattern enforces: TODO(owner): description
 * Example compliant:  // TODO(alice): refactor after schema v2
 * Example violation:  // TODO fix this later
 */

import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const CONFIG_PATH = resolve(SCRIPT_DIR, 'config.json');

function log(msg) {
  process.stderr.write(`[todo-format] ${msg}\n`);
}

// ── Load config ───────────────────────────────────────────────────────────
let config;
try {
  config = JSON.parse(readFileSync(CONFIG_PATH, 'utf8'));
} catch {
  log(`WARN: config.json not found at ${CONFIG_PATH} — skipping TODO format check`);
  process.exit(0);
}

if (!config.todo_format?.enabled) {
  process.exit(0);
}

const {
  required_pattern = 'TODO\\([^)]+\\):',
  on_violation = 'warn',
} = config.todo_format;

let requiredRegex;
try {
  requiredRegex = new RegExp(required_pattern);
} catch {
  log(`WARN: todo_format.required_pattern is not valid regex — skipping TODO check`);
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

  const filePath = (payload?.tool_input?.file_path ?? '').replace(/\\/g, '/');
  const content  = payload?.tool_input?.content ?? '';

  if (!filePath || !content) process.exit(0);

  log(`Checking: ${filePath}`);

  // ── Find all TODO lines ──────────────────────────────────────────────────
  const lines = content.split('\n');
  const violations = [];

  lines.forEach((line, i) => {
    // Match lines containing TODO (case-insensitive for detection, then validate format)
    if (/\bTODO\b/i.test(line)) {
      if (!requiredRegex.test(line)) {
        violations.push({
          line: i + 1,
          text: line.trim(),
        });
      }
    }
  });

  if (violations.length === 0) {
    log('OK');
    process.exit(0);
  }

  // ── Report violations ────────────────────────────────────────────────────
  const severity = on_violation === 'block' ? '❌' : '⚠️ ';
  process.stderr.write(`\n${severity} TODO FORMAT — ${violations.length} non-conforming TODO(s) in ${filePath}\n\n`);
  process.stderr.write(`   Required format: ${required_pattern}\n`);
  process.stderr.write(`   Example:  // TODO(owner): description of what needs doing\n\n`);
  violations.forEach(({ line, text }) => {
    process.stderr.write(`   Line ${line}: ${text}\n`);
  });
  process.stderr.write('\n');

  if (on_violation === 'block') {
    process.exit(1);
  } else {
    process.exit(0);
  }
});
