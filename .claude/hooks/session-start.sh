#!/usr/bin/env bash
# session-start.sh
# Hook type : UserPromptSubmit (or run manually)
# Purpose   : Print project orientation at the start of a session so Claude
#             Code has architectural context without re-reading CLAUDE.md.
#             All content is driven by config.json — no hardcoded project info.
#
# Config used:
#   .claude/hooks/config.json → project_name, session_start.custom_notes[]
#                               arch_rules.rules[]

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONFIG_PATH="$SCRIPT_DIR/config.json"

# ── Check config exists ───────────────────────────────────────────────────
if [ ! -f "$CONFIG_PATH" ]; then
  echo ""
  echo "═══════════════════════════════════════════════════"
  echo "  SESSION START"
  echo "═══════════════════════════════════════════════════"
  echo ""
  echo "  WARN: .claude/hooks/config.json not found."
  echo "  Copy config.json from the hooks template and"
  echo "  customize for this project."
  echo ""
  echo "═══════════════════════════════════════════════════"
  echo ""
  exit 0
fi

# ── Extract fields from config.json using node ────────────────────────────
# node is required to run the arch-boundary hook anyway, so this is safe.
read -r PROJECT_NAME ARCH_ENABLED <<< "$(node -e "
const c = require('$CONFIG_PATH');
process.stdout.write([
  c.project_name ?? 'Unnamed Project',
  c.arch_rules?.enabled ? 'true' : 'false'
].join('\t'));
" 2>/dev/null || echo -e "Unnamed Project\tfalse")"

NOTES=$(node -e "
const c = require('$CONFIG_PATH');
const notes = c.session_start?.custom_notes ?? [];
notes.forEach(n => process.stdout.write('  • ' + n + '\n'));
" 2>/dev/null || echo "")

ARCH_RULES=""
if [ "$ARCH_ENABLED" = "true" ]; then
  ARCH_RULES=$(node -e "
const c = require('$CONFIG_PATH');
const rules = c.arch_rules?.rules ?? [];
rules.forEach(r => {
  if (!r.package_path) return;
  const forbidden = [
    ...(r.forbidden_imports ?? []),
    ...(r.forbidden_frameworks ?? [])
  ].join(', ');
  process.stdout.write('  ' + r.package_path + ' must not import: ' + (forbidden || '(none configured)') + '\n');
});
" 2>/dev/null || echo "  (could not parse rules)")
fi

# ── Print session banner ──────────────────────────────────────────────────
echo ""
echo "═══════════════════════════════════════════════════"
echo "  SESSION START — $PROJECT_NAME"
echo "═══════════════════════════════════════════════════"
echo ""

if [ -n "$NOTES" ]; then
  echo "  Project notes:"
  echo "$NOTES"
  echo ""
fi

if [ "$ARCH_ENABLED" = "true" ] && [ -n "$ARCH_RULES" ]; then
  echo "  Architecture boundaries (arch_rules enforced):"
  echo "$ARCH_RULES"
  echo ""
fi

echo "  Hooks active:"
echo "  • arch-boundary check on Write/Edit ($([ "$ARCH_ENABLED" = "true" ] && echo "ENABLED" || echo "disabled"))"
echo "  • dep-guard warning on Bash installs"

CONTENT_ENABLED=$(node -e "const c=require('$CONFIG_PATH'); process.stdout.write(c.content_watch?.enabled?'true':'false');" 2>/dev/null || echo "false")
echo "  • content validation on file write ($([ "$CONTENT_ENABLED" = "true" ] && echo "ENABLED" || echo "disabled"))"

echo ""
echo "  Configure: .claude/hooks/config.json"
echo "═══════════════════════════════════════════════════"
echo ""
