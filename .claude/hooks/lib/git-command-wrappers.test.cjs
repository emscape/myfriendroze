// git-command-wrappers.test.cjs
// Behavioral tests for the `eval` and `xargs` wrapper handling in
// git-command.cjs — run with `node --test lib/*.test.cjs` from the hooks
// directory.
//
// These are security guards (they block `git push`, `gh pr merge`, branch
// deletes). A wrapper form that is not unwrapped is a silent bypass, so every
// assertion message names WHAT was expected, the INPUT, and WHY it matters.

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const { commandSegments, firstPushSegment, isGitPush } = require('./git-command.cjs');

const START = path.join(os.tmpdir(), 'wrapper-tests-start');

function normalizedList(cmd) {
  return commandSegments(cmd, START).map((s) => s.normalized);
}

function expectPush(cmd, expected, why) {
  assert.equal(
    isGitPush(cmd),
    true,
    `isGitPush should be true for input ${JSON.stringify(cmd)}. ${why} ` +
      'Missing it lets a push run unguarded.'
  );
  const seg = firstPushSegment(cmd, START);
  assert.ok(
    seg,
    `firstPushSegment should return a segment for input ${JSON.stringify(cmd)} ` +
      `but returned ${seg}. segments=${JSON.stringify(normalizedList(cmd))}`
  );
  if (expected !== undefined) {
    assert.equal(
      seg.normalized,
      expected,
      `firstPushSegment(${JSON.stringify(cmd)}).normalized should be ` +
        `${JSON.stringify(expected)}: wrapper and its own options must be dropped, ` +
        'the inner command and its fixed args kept verbatim, so downstream guards ' +
        'can inspect the real refspec.'
    );
  }
}

function expectNoPush(cmd, why) {
  assert.equal(
    isGitPush(cmd),
    false,
    `isGitPush should be false for input ${JSON.stringify(cmd)}. ${why} ` +
      `segments=${JSON.stringify(normalizedList(cmd))}`
  );
  assert.equal(
    firstPushSegment(cmd, START),
    undefined,
    `firstPushSegment should be undefined for input ${JSON.stringify(cmd)}. ${why}`
  );
}

function expectSegment(cmd, expected, why) {
  const list = normalizedList(cmd);
  assert.ok(
    list.includes(expected),
    `commandSegments(${JSON.stringify(cmd)}) should include a segment normalized ` +
      `${JSON.stringify(expected)}. ${why} Got ${JSON.stringify(list)}.`
  );
}

function expectNoSegment(cmd, notExpected, why) {
  const list = normalizedList(cmd);
  assert.ok(
    !list.includes(notExpected),
    `commandSegments(${JSON.stringify(cmd)}) must NOT include a segment normalized ` +
      `${JSON.stringify(notExpected)}. ${why} Got ${JSON.stringify(list)}.`
  );
}

test('eval and xargs wrappers', async (t) => {
  await t.test('eval: quoted and unquoted forms are analysed like bash -c', () => {
    for (const cmd of [
      'eval "git push origin main"',
      "eval 'git push origin main'",
      'eval git push origin main',
    ]) {
      expectPush(cmd, 'git push origin main', 'eval runs its args as a command line.');
    }
  });

  await t.test('eval: chain inside tracks cd into the push cwd', () => {
    const cmd = 'eval "cd repo && git push origin main"';
    expectPush(cmd, 'git push origin main', 'eval body is a command chain.');
    const seg = firstPushSegment(cmd, START);
    assert.equal(
      seg.cwd,
      path.resolve(START, 'repo'),
      `push segment cwd for ${JSON.stringify(cmd)} should be path.resolve(startDir,'repo') ` +
        'because the cd inside eval precedes the push; a wrong cwd makes branch/repo ' +
        `lookups inspect the wrong repository. Got ${seg.cwd}.`
    );
  });

  await t.test('eval: nested wrapper inside eval', () => {
    expectPush(
      'eval "bash -c \'git push origin main\'"',
      'git push origin main',
      'eval containing bash -c must be unwrapped twice.'
    );
  });

  await t.test('eval: env prefix and position in a chain', () => {
    expectPush('FOO=1 eval "git push origin main"', 'git push origin main',
      'an env assignment prefix must not hide eval.');
    expectPush('echo hi && eval "git push origin main"', 'git push origin main',
      'eval after && is a separate command.');
    expectPush('eval "git push origin main" && echo done', 'git push origin main',
      'eval before && is a separate command.');
  });

  await t.test('eval: other guarded commands are exposed', () => {
    expectSegment('eval "gh pr merge 5"', 'gh pr merge 5',
      'the merge guard relies on seeing gh pr merge through eval.');
  });

  await t.test('eval: negatives are not pushes', () => {
    expectNoPush('eval "echo git push origin main"',
      'the pushed text is only an argument to echo.');
    expectNoPush('echo eval "git push origin main"',
      'eval is merely an argument of echo here, nothing is executed.');
    expectNoPush('eval "ls -la"', 'ls is not a push.');
    expectNoPush('eval', 'eval with no args runs nothing.');
    expectNoPush('eval ""', 'eval of an empty string runs nothing.');
  });

  await t.test('eval: robustness on unterminated quote and variable expansion', () => {
    let result;
    assert.doesNotThrow(
      () => { result = isGitPush('eval "git push origin main'); },
      'isGitPush must not throw on an unterminated quote: eval "git push origin main'
    );
    assert.equal(typeof result, 'boolean',
      'isGitPush must return a boolean for an unterminated-quote eval input.');
    let result2;
    assert.doesNotThrow(
      () => { result2 = isGitPush('eval "$CMD"'); },
      'isGitPush must not throw on eval "$CMD"'
    );
    assert.equal(result2, false,
      'isGitPush(\'eval "$CMD"\') should be false: an unexpanded variable is not a detectable push.');
  });

  await t.test('xargs: plain and piped', () => {
    expectPush('xargs git push origin main', 'git push origin main',
      'xargs runs its COMMAND; the xargs name must be dropped.');
    expectPush('echo main | xargs git push origin', 'git push origin',
      'xargs after a pipe still runs git push.');
    expectPush('/usr/bin/xargs git push origin main', 'git push origin main',
      'a path-qualified xargs must be recognised.');
  });

  await t.test('xargs: options without values', () => {
    for (const cmd of [
      'xargs -r git push',
      'xargs -0 git push',
      'xargs -t git push',
      'xargs --no-run-if-empty git push',
      'xargs -p git push',
    ]) {
      expectPush(cmd, 'git push', 'valueless xargs options must be skipped.');
    }
  });

  await t.test('xargs: options with a separate value', () => {
    for (const cmd of [
      'xargs -n 1 git push origin',
      'xargs -P 4 git push',
      'xargs -L 1 git push',
      "xargs -d '\\n' git push",
      'xargs -E EOF git push',
      'xargs -s 100 git push',
      'xargs -a list.txt git push',
    ]) {
      const exp = cmd.includes('origin') ? 'git push origin' : 'git push';
      expectPush(cmd, exp,
        'the option AND its separate value must both be skipped, otherwise the ' +
        'value is mistaken for the command.');
    }
  });

  await t.test('xargs: options with an attached value', () => {
    expectPush('xargs -n1 git push', 'git push', 'attached -n1 is one token.');
    expectPush('xargs -I{} git push origin {}', 'git push origin {}',
      'placeholder text must be kept verbatim.');
    expectPush('xargs -I {} git push origin {}', 'git push origin {}',
      '-I with a separate value must skip both tokens.');
    expectPush('xargs --replace={} git push origin {}', 'git push origin {}',
      'long option with =value is a single token.');
    expectPush('xargs --max-args=1 git push', 'git push',
      'long option with =value is a single token.');
    expectPush('xargs -i git push origin {}', 'git push origin {}',
      '-i takes only an attached optional value, so the next token is the command.');
  });

  await t.test('xargs: -- ends options', () => {
    expectPush('xargs -- git push origin main', 'git push origin main',
      'after -- the next token is the command.');
    expectSegment('xargs -- gh pr merge 27', 'gh pr merge 27',
      'after -- the next token is the command; the merge guard must still see gh pr merge.');
    expectSegment('xargs -r -- gh pr merge 27', 'gh pr merge 27',
      'options before -- must not stop the command from being exposed.');
  });

  await t.test('xargs: other guarded commands are exposed', () => {
    expectSegment('xargs gh pr merge', 'gh pr merge', 'merge guard must see through xargs.');
    expectSegment('xargs -I{} gh pr merge {}', 'gh pr merge {}',
      'merge guard must see through xargs -I.');
    expectSegment('xargs git branch -D', 'git branch -D',
      'branch-delete guard must see through xargs.');
    expectSegment('xargs git -C repo push', 'git push',
      'git global options are stripped as for plain git.');
    expectPush('xargs git -C repo push', 'git push', 'xargs git -C repo push is a push.');
  });

  await t.test('xargs: negatives are not pushes', () => {
    expectNoPush('xargs echo git push origin main', 'the inner command is echo.');
    expectNoPush('xargs rm -f', 'rm is not a push.');
    expectNoPush('xargs', 'xargs alone has no command (defaults to echo).');
    expectNoPush('git log --oneline | xargs echo', 'no push anywhere.');
    expectNoPush('xargs -I{} echo git push {}', 'the inner command is echo.');
  });

  await t.test('xargs inside other wrappers', () => {
    expectPush('bash -c "echo main | xargs git push origin"', 'git push origin',
      'bash -c body containing xargs.');
    expectPush('eval "echo main | xargs git push origin"', 'git push origin',
      'eval body containing xargs.');
    expectPush('(echo main | xargs git push origin)', 'git push origin',
      'subshell containing xargs.');
  });

  await t.test('xargs: robustness on options missing values', () => {
    for (const cmd of ['xargs -n', 'xargs -I']) {
      assert.doesNotThrow(
        () => commandSegments(cmd, START),
        `commandSegments must not throw for malformed input ${JSON.stringify(cmd)}`
      );
      assert.doesNotThrow(
        () => isGitPush(cmd),
        `isGitPush must not throw for malformed input ${JSON.stringify(cmd)}`
      );
    }
  });

  await t.test('regression: pre-existing behavior still holds', () => {
    expectPush('git push origin main', 'git push origin main', 'plain push.');
    expectPush('cd repo && git push', 'git push', 'chain push.');
    expectPush('bash -c "git push origin main"', 'git push origin main', 'bash -c push.');
    expectPush('echo $(git push origin main)', 'git push origin main', 'command substitution.');
    expectNoPush('git status', 'git status is not a push.');
    expectNoPush('git commit -m "xargs git push"',
      'a commit message mentioning xargs git push is not a push.');
    expectNoPush("git commit -m 'eval \"git push\"'",
      'a commit message mentioning eval is not a push.');
    expectNoSegment('git commit -m "xargs git push"', 'git push',
      'message text must not become a segment.');
  });
});

test('xargs short-option clustering (POSIX/GNU getopt)', async (t) => {
  await t.test('valueless letters clustered', () => {
    expectPush('xargs -rt git push', 'git push',
      'cluster -rt is two valueless options; treating it as the command hides the push.');
    expectPush('xargs -0r git push origin main', 'git push origin main',
      'cluster -0r is two valueless options.');
    expectPush('xargs -trp git push', 'git push',
      'cluster -trp is three valueless options.');
    expectPush('echo main | xargs -rt git push origin', 'git push origin',
      'clustered options after a pipe.');
  });

  await t.test('value letter with attached remainder', () => {
    expectPush('xargs -rn1 git push', 'git push',
      'in -rn1 the value 1 is attached to n; the next token is the command.');
    expectPush('xargs -0I{} git push origin {}', 'git push origin {}',
      'in -0I{} the replace string {} is attached to I; placeholder kept verbatim.');
  });

  await t.test('value letter ending the cluster takes the next token', () => {
    expectPush('xargs -rn 1 git push origin', 'git push origin',
      'in -rn 1 the value is the NEXT token; it must be skipped, not taken as the command.');
    expectPush('xargs -rI {} git push origin {}', 'git push origin {}',
      'in -rI {} the replace string is the NEXT token and must be skipped.');
  });

  await t.test('mixed cluster then separate option', () => {
    expectPush('xargs -rt -n 1 git push origin', 'git push origin',
      'cluster followed by a separate -n 1 option: both must be consumed.');
  });

  await t.test('other guarded commands behind clusters', () => {
    expectSegment('xargs -rt gh pr merge', 'gh pr merge',
      'the merge guard must see through clustered xargs options.');
    expectSegment('xargs -rt git branch -D', 'git branch -D',
      'the branch-delete guard must see through clustered xargs options.');
  });

  await t.test('clustered xargs inside other wrappers', () => {
    expectPush('bash -c "echo main | xargs -rt git push origin"', 'git push origin',
      'bash -c body containing clustered xargs.');
    expectPush('eval "echo main | xargs -rt git push origin"', 'git push origin',
      'eval body containing clustered xargs.');
  });

  await t.test('negatives: inner command is not git push', () => {
    expectNoPush('xargs -rt echo git push', 'the inner command is echo.');
    expectNoPush('xargs -rn1 echo git push', 'the inner command is echo; 1 is the n value.');
    expectNoPush('xargs -0r rm -f', 'rm is not a push.');
  });

  await t.test('robustness: clusters missing a value', () => {
    for (const cmd of ['xargs -rn', 'xargs -rt', 'xargs -0I']) {
      assert.doesNotThrow(
        () => { commandSegments(cmd, START); isGitPush(cmd); },
        `commandSegments/isGitPush must not throw for malformed input ${JSON.stringify(cmd)}`
      );
    }
  });
});

test('xargs long options with an attached value', async (t) => {
  await t.test('any --name=value is one token, not the command', () => {
    expectPush('xargs --process-slot-var=SLOT git push origin', 'git push origin',
      'a long option with an attached value outside the common list must still be skipped.');
    expectPush('xargs --max-procs=4 --process-slot-var=X -rt git push', 'git push',
      'attached long options mixed with a short cluster must all be skipped.');
    expectNoPush('xargs --process-slot-var=X echo git push', 'the inner command is echo.');
  });
});

function segmentFor(cmd, normalized) {
  return commandSegments(cmd, START).find((s) => s.normalized === normalized);
}

test('eval edge cases', async (t) => {
  await t.test('deep eval chains do not throw, stay fast, and expose the inner command', () => {
    const deepMerge = 'eval '.repeat(20000) + 'gh pr merge 5';
    const deepPush = 'eval '.repeat(20000) + 'git push origin main';
    const started = Date.now();
    let segs;
    assert.doesNotThrow(
      () => { segs = commandSegments(deepMerge, START); },
      'commandSegments must not throw (e.g. stack overflow) for "eval " x20000 + "gh pr merge 5"; ' +
        'a crash in a security hook can fail open.'
    );
    assert.ok(
      segs.some((s) => s.normalized === 'gh pr merge 5'),
      'commandSegments of "eval " x20000 + "gh pr merge 5" should include a segment normalized ' +
        `'gh pr merge 5'; deep eval nesting must not hide the merge. Got ${segs.length} segments.`
    );
    let pushed;
    assert.doesNotThrow(
      () => { pushed = isGitPush(deepPush); },
      'isGitPush must not throw for "eval " x20000 + "git push origin main".'
    );
    assert.equal(pushed, true,
      'isGitPush should be true for "eval " x20000 + "git push origin main"; ' +
        'padding with evals must not bypass the push guard.');
    const elapsed = Date.now() - started;
    assert.ok(
      elapsed < 2000,
      `20000-deep eval inputs took ${elapsed} ms (limit 2000 ms). A quadratic parser is a ` +
        'DoS/timeout risk for a security hook that runs on every command.'
    );
  });

  await t.test('two-level quoted eval is detected', () => {
    expectPush('eval "eval \\"git push origin main\\""', 'git push origin main',
      'eval nested inside a quoted eval must be unwrapped twice.');
  });

  await t.test('cd inside eval persists to later commands (eval runs in the current shell)', () => {
    for (const cmd of ['eval "cd repo"; git push origin main', 'eval cd repo; git push origin main']) {
      const seg = segmentFor(cmd, 'git push origin main');
      assert.ok(seg, `commandSegments(${JSON.stringify(cmd)}) should include 'git push origin main'.`);
      assert.equal(
        seg.cwd,
        path.resolve(START, 'repo'),
        `push cwd for ${JSON.stringify(cmd)} should be path.resolve(startDir,'repo'): eval runs in ` +
          'the current shell so its cd persists; a wrong cwd makes the guard inspect the wrong ' +
          `repository/branch. Got ${seg.cwd}.`
      );
    }
    const cmd = 'eval "cd repo && cd .." ; git push';
    const seg = segmentFor(cmd, 'git push');
    assert.ok(seg, `commandSegments(${JSON.stringify(cmd)}) should include 'git push'.`);
    assert.equal(
      seg.cwd,
      path.resolve(START),
      `push cwd for ${JSON.stringify(cmd)} should be the start dir (cd repo then cd ..). Got ${seg.cwd}.`
    );
  });

  await t.test('regression: cd inside bash -c does not leak (subprocess)', () => {
    const cmd = 'bash -c "cd repo"; git push origin main';
    const seg = segmentFor(cmd, 'git push origin main');
    assert.ok(seg, `commandSegments(${JSON.stringify(cmd)}) should include 'git push origin main'.`);
    assert.equal(
      seg.cwd,
      path.resolve(START),
      `push cwd for ${JSON.stringify(cmd)} should stay the start dir: a bash -c subprocess's cd ` +
        `does not affect the parent shell. Got ${seg.cwd}.`
    );
  });

  await t.test('eval -- is accepted', () => {
    expectPush('eval -- "git push origin main"', 'git push origin main',
      'eval accepts -- to end options; it must not hide the push.');
    expectPush('eval -- git push origin main', 'git push origin main',
      'eval accepts -- to end options; unquoted form.');
    expectNoPush('eval -- "echo git push"', 'the pushed text is only an argument to echo.');
  });
});

test('quoted command words', async (t) => {
  await t.test('a quoted eval is still eval', () => {
    for (const cmd of [
      '"eval" "git push origin main"',
      "'eval' 'git push origin main'",
      'e"va"l git push origin main',
      '\\eval git push origin main',
    ]) {
      expectPush(cmd, 'git push origin main',
        'quote removal runs before the shell looks up the command word, so this is the eval builtin.');
    }
  });

  await t.test('other quoted wrapper words are still wrappers', () => {
    expectPush('"sudo" git push origin main', 'git push origin main',
      'a quoted sudo still runs its command.');
    expectPush("'xargs' -0 git push origin main", 'git push origin main',
      'a quoted xargs still runs its command.');
    expectPush('"env" FOO=1 git push origin main', 'git push origin main',
      'a quoted env still runs its command.');
    expectPush('"bash" -c "git push origin main"', 'git push origin main',
      'a quoted bash still runs its -c string.');
    expectPush('xargs "git" push origin main', 'git push origin main',
      'a quoted command word after xargs is still the command xargs runs.');
  });

  await t.test('a backslash anywhere in a command word is removed', () => {
    expectPush('g\\it push origin main', 'git push origin main',
      'quote removal turns g\\it into git.');
    expectPush('sud\\o git push origin main', 'git push origin main',
      'quote removal turns sud\\o into sudo.');
    expectPush('xarg\\s git push origin main', 'git push origin main',
      'quote removal turns xarg\\s into xargs.');
    expectPush('C:\\Git\\bin\\git.exe push origin main', 'git push origin main',
      'an unquoted Windows path to git is still recognised as git.');
  });

  await t.test('quoted wrapper options are still options', () => {
    expectPush("xargs '-r' git push origin main", 'git push origin main',
      'quote removal makes -r an xargs option.');
    expectPush('xargs "--no-run-if-empty" git push origin main', 'git push origin main',
      'quote removal makes --no-run-if-empty an xargs option.');
    expectPush("xargs '-n' 1 git push origin main", 'git push origin main',
      'a quoted value-taking option still takes the next word.');
    expectPush("env '-i' git push origin main", 'git push origin main',
      'quote removal makes -i an env option.');
    expectPush("sudo '-n' git push origin main", 'git push origin main',
      'quote removal makes -n a sudo option.');
  });

  await t.test('a quoted git or gh is still git or gh', () => {
    expectPush('"git" push origin main', 'git push origin main',
      'a quoted git is the same binary.');
    expectSegment("'gh' pr merge 5", 'gh pr merge 5',
      'the merge guard relies on seeing gh pr merge.');
  });

  await t.test('eval joins all of its arguments', () => {
    expectPush('eval "git push" origin main', 'git push origin main',
      'eval runs every argument, joined by spaces; dropping the rest loses the refspec.');
    expectPush('eval "git" "push" "origin" "+main"', 'git push origin +main',
      'eval runs every argument, joined by spaces; the force refspec must survive.');
    expectPush('eval git push origin "main"', 'git push origin main',
      'eval re-parses its joined arguments after quote removal.');
  });

  await t.test('escaped quotes inside an eval string stay quoted', () => {
    expectPush('eval "git push origin \\"my branch\\""', 'git push origin "my branch"',
      'an escaped quote is literal text, so the inner command keeps it.');
  });

  await t.test('negatives: quoted words that are only arguments', () => {
    expectNoPush('echo "eval" "git push origin main"',
      'eval is an argument of echo here, nothing is executed.');
    expectNoPush('"eval" "echo git push origin main"',
      'the pushed text is only an argument to echo.');
    expectNoPush('"git push" origin main',
      'a single quoted word "git push" names a command that does not exist.');
  });
});

test('shell quoting forms inside wrappers', async (t) => {
  await t.test('ANSI-C quoting is unquoted', () => {
    expectPush("eval $'git push origin main'", 'git push origin main',
      "$'...' is one argument to eval, which runs it.");
    expectPush("eval $'git push origin \\'main\\''", "git push origin 'main'",
      "an escaped single quote inside $'...' is literal text.");
    expectPush("$'git' push origin main", 'git push origin main',
      "an ANSI-C quoted command word is still git.");
    expectPush("eval $'git\\tpush origin main'", 'git push origin main',
      'a \\t escape becomes a tab, which separates words like a space.');
  });

  await t.test('backslash-newline is a line continuation, not text', () => {
    expectPush('eval "g\\\nit push origin main"', 'git push origin main',
      'inside double quotes, backslash-newline is removed before eval sees it.');
    expectPush('eval g\\\nit push origin main', 'git push origin main',
      'unquoted, backslash-newline is removed before eval sees it.');
  });

  await t.test('xargs.exe and path-qualified Windows xargs', () => {
    expectPush('xargs.exe git push origin main', 'git push origin main',
      'xargs.exe is the same program on Windows.');
    expectPush('C:\\Git\\usr\\bin\\xargs.exe git push origin main', 'git push origin main',
      'a Windows path to xargs.exe is the same program.');
  });

  await t.test('xargs short options that take a separate value', () => {
    expectPush('xargs -R 1 git push origin main', 'git push origin main',
      '-R (max replacements) takes the next word as its value.');
    expectPush('xargs -J {} git push origin main', 'git push origin main',
      '-J (BSD replacement string) takes the next word as its value.');
    expectPush('xargs -S 1024 git push origin main', 'git push origin main',
      '-S (BSD replacement size) takes the next word as its value.');
  });
});
