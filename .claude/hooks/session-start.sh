#!/usr/bin/env bash
# session-start.sh
# Hook type : UserPromptSubmit (or run manually)
# Purpose   : Print project orientation at the start of a session so Claude
#             Code has architectural context without re-reading CLAUDE.md.
#
# All the actual logic lives in session-start.cjs, invoked below via a path
# relative to this script's own directory (not `pwd`/cwd) so it works
# whether the hook is run from the project root or anywhere else. See the
# comment at the top of session-start.cjs for why the logic isn't inlined
# here as `node -e "..."` — that broke silently on Windows.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
node "$SCRIPT_DIR/session-start.cjs"
