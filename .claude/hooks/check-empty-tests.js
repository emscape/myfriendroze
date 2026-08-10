#!/usr/bin/env node
/**
 * check-empty-tests.js
 * Hook type : PostToolUse — Write | Edit | MultiEdit
 * Purpose   : Detect theater testing — empty describe/it blocks that pass
 *             without asserting anything. Fails loudly when found.
 *
 * Inputs (via stdin JSON):
 *   { tool_name, tool_input: { file_path, content } }
 *
 * Config used:
 *   .claude/hooks/config.json → empty_test_guard.enabled,
 *                               empty_test_guard.test_file_patterns,
 *                               empty_test_guard.block_empty_describe,
 *                               empty_test_guard.block_empty_it,
 *                               empty_test_guard.block_todo_tests
 */

import { readFileSync } from 'fs';
import { resolve, dirname, basename } from 'path';
import { fileURLToPath } from 'url';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const CONFIG_PATH = resolve(SCRIPT_DIR, 'config.json');

function log(msg) {
  process.stderr.write(`[empty-test-guard] ${msg}\n`);
}

// ── Load config ───────────────────────────────────────────────────────────
let config;
try {
  config = JSON.parse(readFileSync(CONFIG_PATH, 'utf8'));
} catch {
  log(`WARN: config.json not found at ${CONFIG_PATH} — skipping empty test check`);
  process.exit(0);
}

if (!config.empty_test_guard?.enabled) {
  process.exit(0);
}

const {
  test_file_patterns = ['*.test.*', '*.spec.*'],
  block_empty_describe = true,
  block_empty_it = true,
  block_todo_tests = false,
} = config.empty_test_guard;

// ── Match filename against glob-style patterns (simplified: fnmatch-like) ─
function matchesPattern(filename, pattern) {
  // Convert glob pattern to regex: * matches anything except /
  const regex = new RegExp('^' + pattern.replace(/\./g, '\\.').replace(/\*/g, '[^/]*') + '$');
  return regex.test(filename);
}

function isTestFile(filePath) {
  const name = basename(filePath);
  return test_file_patterns.some(p => matchesPattern(name, p));
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
  if (!isTestFile(basename(filePath))) process.exit(0);

  log(`Checking test file: ${filePath}`);

  const violations = [];

  // ── Check for empty describe blocks: describe('...', () => {}) ──────────
  if (block_empty_describe) {
    // Matches describe/suite blocks with an empty or whitespace-only body
    const emptyDescribe = /\b(?:describe|suite)\s*\([^)]*\)\s*,\s*\(\s*\)\s*=>\s*\{\s*\}/g;
    const matches = content.match(emptyDescribe);
    if (matches) {
      violations.push(`Empty describe/suite block (${matches.length} found) — add tests or remove the block`);
    }
  }

  // ── Check for empty it/test blocks: it('...', () => {}) ─────────────────
  if (block_empty_it) {
    const emptyIt = /\b(?:it|test)\s*\([^)]*\)\s*,\s*(?:async\s*)?\(\s*\)\s*=>\s*\{\s*\}/g;
    const matches = content.match(emptyIt);
    if (matches) {
      violations.push(`Empty it/test block (${matches.length} found) — add assertions or delete the test`);
    }
  }

  // ── Check for todo tests ─────────────────────────────────────────────────
  if (block_todo_tests) {
    const todoTest = /\b(?:it|test)\.todo\s*\(/g;
    const matches = content.match(todoTest);
    if (matches) {
      violations.push(`it.todo/test.todo (${matches.length} found) — implement or remove placeholder tests`);
    }
  }

  // ── Check for describe with no assertions anywhere inside ────────────────
  // Heuristic: test file with zero expect/assert calls is theater
  const hasAssertions = /\b(?:expect|assert)\s*\(/.test(content);
  const hasTestBlocks = /\b(?:it|test)\s*\(/.test(content);
  if (hasTestBlocks && !hasAssertions) {
    violations.push('Test file contains test blocks but NO expect/assert calls — this is a theater test file');
  }

  if (violations.length > 0) {
    process.stderr.write('\n❌ EMPTY TEST GUARD — theater testing detected\n\n');
    violations.forEach(v => process.stderr.write(`   • ${v}\n`));
    process.stderr.write('\n   Tests must assert real behavior. Add assertions or remove empty blocks.\n\n');
    process.exit(1);
  }

  log('OK — test file has assertions');
  process.exit(0);
});
