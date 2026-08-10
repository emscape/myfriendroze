#!/usr/bin/env node
// check-bash-description.js
// PreToolUse hook — Bash
//
// Enforces terminal command discipline: every Bash call must have a non-empty
// `description` field explaining WHY and WHAT before the command runs.
//
// Exit codes:
//   0  — description present, allow
//   2  — no description, block (PreToolUse exit 2 = Claude Code rejects the call)

const chunks = [];
process.stdin.on('data', (d) => chunks.push(d));
process.stdin.on('end', () => {
  let input;
  try {
    input = JSON.parse(Buffer.concat(chunks).toString());
  } catch {
    process.exit(0); // malformed input — don't block
  }

  const desc = (input?.tool_input?.description || '').trim();

  if (!desc) {
    const msg = JSON.stringify({
      continue: false,
      stopReason:
        'Terminal command discipline: every Bash call requires a `description` field explaining WHY (what question it answers or state it changes) and WHAT (what the command does). Add a description to the tool call before proceeding.',
    });
    process.stdout.write(msg);
    process.exit(2);
  }

  process.exit(0);
});
