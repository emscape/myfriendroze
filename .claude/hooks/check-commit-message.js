#!/usr/bin/env node
const chunks = [];
process.stdin.on('data', chunk => chunks.push(chunk));
process.stdin.on('end', () => {
  let input;
  try {
    input = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    process.exit(0);
  }

  const command = (input?.tool_input?.command || '').trim();
  if (!/^git\s+commit\b/.test(command)) {
    process.exit(0);
  }

  const hasWhy = /WHY:/.test(command);
  const hasExpected = /EXPECTED:/.test(command);

  if (!hasWhy || !hasExpected) {
    process.stdout.write(
      JSON.stringify({
        continue: false,
        stopReason:
          'Commit messages must include WHY and EXPECTED sections. Use the required format before proceeding.',
      })
    );
    process.exit(2);
  }

  process.exit(0);
});
