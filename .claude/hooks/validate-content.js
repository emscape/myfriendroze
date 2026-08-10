#!/usr/bin/env node
/**
 * validate-content.js
 * Hook type : PostToolUse — Write | Edit | MultiEdit
 * Purpose   : Run a configurable validation command whenever a watched file
 *             is written. Fails loudly on validation errors (no silent skips).
 *
 * Inputs (via stdin JSON):
 *   { tool_name, tool_input: { file_path } }
 *
 * Config used:
 *   .claude/hooks/config.json → content_watch.enabled,
 *                               content_watch.path_pattern,
 *                               content_watch.file_extensions[],
 *                               content_watch.validate_command
 */

import { readFileSync } from 'fs';
import { resolve, dirname, extname } from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

// ── Locate config ─────────────────────────────────────────────────────────
const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const CONFIG_PATH = resolve(SCRIPT_DIR, 'config.json');

function log(msg) {
  process.stderr.write(`[validate-content] ${msg}\n`);
}

// ── Load config ───────────────────────────────────────────────────────────
let config;
try {
  config = JSON.parse(readFileSync(CONFIG_PATH, 'utf8'));
} catch {
  log(`WARN: config.json not found or invalid at ${CONFIG_PATH} — skipping content validation`);
  process.exit(0);
}

if (!config.content_watch?.enabled) {
  process.exit(0);
}

const { path_pattern, file_extensions, validate_command } = config.content_watch;

if (!path_pattern) {
  log('WARN: content_watch.path_pattern is not set in config.json — skipping');
  process.exit(0);
}

if (!validate_command) {
  log('WARN: content_watch.validate_command is not set in config.json — skipping');
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
  if (!filePath) process.exit(0);

  // ── Check if this file matches the watch config ─────────────────────────
  if (!filePath.includes(path_pattern)) {
    process.exit(0);
  }

  if (file_extensions && file_extensions.length > 0) {
    const ext = extname(filePath).toLowerCase();
    const watched = file_extensions.map(e => e.toLowerCase());
    if (!watched.includes(ext)) {
      process.exit(0);
    }
  }

  // ── Run validation ──────────────────────────────────────────────────────
  log(`File changed: ${filePath}`);
  log(`Running: ${validate_command}`);

  try {
    execSync(validate_command, { stdio: 'inherit', cwd: process.cwd() });
    log('Validation passed ✓');
    process.exit(0);
  } catch (err) {
    process.stderr.write('\n❌ CONTENT VALIDATION FAILED — fix errors before proceeding\n');
    process.stderr.write(`   Command : ${validate_command}\n`);
    if (err.status != null) {
      process.stderr.write(`   Exit code: ${err.status}\n`);
    }
    process.exit(1);
  }
});
