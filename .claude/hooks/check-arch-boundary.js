#!/usr/bin/env node
/**
 * check-arch-boundary.js
 * Hook type : PreToolUse — Write | Edit | MultiEdit
 * Purpose   : Enforce package boundary rules defined in config.json.
 *             Exits 2 (block) on violation so Claude Code sees the message
 *             and self-corrects. Exits 0 (allow) when all checks pass.
 *
 * Inputs (via stdin JSON):
 *   { tool_name, tool_input: { file_path, content } }
 *
 * Config used:
 *   .claude/hooks/config.json → arch_rules.enabled, arch_rules.rules[]
 */

import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

// ── Locate config relative to this script ────────────────────────────────
const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const CONFIG_PATH = resolve(SCRIPT_DIR, 'config.json');

function warn(msg) {
  process.stderr.write(`[arch-boundary] WARN: ${msg}\n`);
}

function block(violations) {
  process.stderr.write('\n⛔ ARCH-BOUNDARY VIOLATION — fix before proceeding\n\n');
  violations.forEach(v => process.stderr.write(`   • ${v}\n`));
  process.stderr.write('\n');
  process.exit(2);
}

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ── Load config ───────────────────────────────────────────────────────────
let config;
try {
  config = JSON.parse(readFileSync(CONFIG_PATH, 'utf8'));
} catch {
  warn(`config.json not found or invalid at ${CONFIG_PATH} — skipping arch checks`);
  process.exit(0);
}

if (!config.arch_rules?.enabled) {
  // Arch checking is opt-in. Silent pass when not enabled.
  process.exit(0);
}

const rules = config.arch_rules.rules ?? [];
if (rules.length === 0) {
  warn('arch_rules.enabled is true but no rules are defined in config.json — add rules or set enabled=false');
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
    // Cannot parse stdin — allow and move on (do not block on hook failure)
    process.exit(0);
  }

  const filePath = (payload?.tool_input?.file_path ?? '').replace(/\\/g, '/');
  const content  = payload?.tool_input?.content ?? '';

  if (!filePath) process.exit(0);

  // ── Run rules ───────────────────────────────────────────────────────────
  process.stderr.write(`[arch-boundary] Checking: ${filePath}\n`);

  const violations = [];

  for (const rule of rules) {
    if (!rule.package_path) continue;
    if (!filePath.includes(rule.package_path)) continue;

    // Forbidden import paths (e.g. "apps/ui")
    for (const forbidden of rule.forbidden_imports ?? []) {
      const pattern = new RegExp(`from ['"][^'"]*${escapeRegex(forbidden)}`);
      if (pattern.test(content)) {
        violations.push(`${rule.package_path} must not import from ${forbidden}`);
      }
    }

    // Forbidden framework imports (e.g. "react", "vue")
    for (const framework of rule.forbidden_frameworks ?? []) {
      const pattern = new RegExp(`from ['"]${escapeRegex(framework)}['"]`);
      if (pattern.test(content)) {
        violations.push(
          `${rule.package_path} must not import '${framework}' — keep this package framework-free`
        );
      }
    }

    // Hardcoded content strings (optional heuristic, expects a regex string)
    if (rule.forbidden_content_pattern) {
      try {
        if (new RegExp(rule.forbidden_content_pattern).test(content)) {
          violations.push(
            `${rule.package_path}: file appears to hardcode content strings ` +
            `matching /${rule.forbidden_content_pattern}/ — move content to a dedicated data package`
          );
        }
      } catch {
        warn(`forbidden_content_pattern for '${rule.package_path}' is not valid regex — skipping that check`);
      }
    }
  }

  if (violations.length > 0) {
    block(violations);
  }

  process.stderr.write('[arch-boundary] OK\n');
  process.exit(0);
});
