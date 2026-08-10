#!/usr/bin/env node
// check-env-guard.js
// PreToolUse hook — Read
//
// Blocks reads of .env files. Environment files often contain secrets and
// should never be read by the assistant.
//
// Exit codes:
//   0  — file is not a .env file, allow
//   2  — .env file detected, block

const path = require('path');
const chunks = [];
process.stdin.on('data', (d) => chunks.push(d));
process.stdin.on('end', () => {
  let input;
  try {
    input = JSON.parse(Buffer.concat(chunks).toString());
  } catch {
    process.exit(0);
  }

  const filePath = input?.tool_input?.file_path || '';
  const basename = path.basename(filePath);

  if (basename === '.env' || basename.startsWith('.env.')) {
    const msg = JSON.stringify({
      continue: false,
      stopReason: `.env files are off-limits. If you need an environment variable value, ask the user to provide it or check the project's .env.example file instead.`,
    });
    process.stdout.write(msg);
    process.exit(2);
  }

  process.exit(0);
});
