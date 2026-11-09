#!/usr/bin/env node
/**
 * session-start.cjs
 * Hook type : SessionStart (also runnable manually, or via session-start.sh)
 * Purpose   : Print project orientation at the start of a session so Claude
 *             Code has architectural context without re-reading CLAUDE.md.
 *             All content is driven by config.json (plus an optional project-local — .claude/hooks.config.json override) - no hardcoded project info.
 *
 * Why this exists as a separate .cjs file rather than inline `node -e` calls
 * in session-start.sh: embedding a shell-resolved path (from `pwd` in Git
 * Bash, which yields a POSIX-style `/c/...` path) into a JS string for
 * `require()` breaks silently on a native Windows Node install, which does
 * not resolve that path form. Resolving the config path via `__dirname`
 * here sidesteps the whole shell/path-translation problem. Multi-line
 * `node -e "..."` invocations were also observed to fail unpredictably
 * depending on the invoking shell — a real file avoids that class of bug
 * entirely.
 */

const path = require("node:path");

const { loadHookConfig, resolveProjectDir } = require("./lib/hook-config.cjs");

function loadConfig() {
  try {
    return loadHookConfig({ hooksDir: __dirname });
  } catch {
    return null;
  }
}

const bar = "═".repeat(53);

function main() {
  const config = loadConfig();

  console.log("");
  console.log(bar);

  if (!config) {
    console.log("  SESSION START");
    console.log(bar);
    console.log("");
    console.log("  WARN: .claude/hooks/config.json not found or invalid.");
    console.log("  Copy config.json from the hooks template and");
    console.log("  customize for this project.");
    console.log("");
    console.log(bar);
    console.log("");
    return;
  }

  const projectName = config.project_name ?? path.basename(resolveProjectDir());
  const archEnabled = Boolean(config.arch_rules?.enabled);
  const contentEnabled = Boolean(config.content_watch?.enabled);
  const notes = config.session_start?.custom_notes ?? [];
  const rules = archEnabled ? config.arch_rules?.rules ?? [] : [];

  console.log(`  SESSION START — ${projectName}`);
  console.log(bar);
  console.log("");

  if (notes.length > 0) {
    console.log("  Project notes:");
    for (const note of notes) console.log(`  • ${note}`);
    console.log("");
  }

  if (archEnabled && rules.length > 0) {
    console.log("  Architecture boundaries (arch_rules enforced):");
    for (const rule of rules) {
      if (!rule.package_path) continue;
      const forbidden = [
        ...(rule.forbidden_imports ?? []),
        ...(rule.forbidden_frameworks ?? []),
      ].join(", ");
      console.log(`  ${rule.package_path} must not import: ${forbidden || "(none configured)"}`);
    }
    console.log("");
  }

  console.log("  Hooks active:");
  console.log(`  • arch-boundary check on Write/Edit (${archEnabled ? "ENABLED" : "disabled"})`);
  console.log("  • dep-guard warning on Bash installs");
  console.log(`  • content validation on file write (${contentEnabled ? "ENABLED" : "disabled"})`);
  console.log("");
  console.log("  Shared defaults: .claude/hooks/config.json");
  console.log("  Project settings: .claude/hooks.config.json (optional override)");
  console.log(bar);
  console.log("");
}

main();
