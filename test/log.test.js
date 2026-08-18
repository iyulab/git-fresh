'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const log = require('../src/log');

test('formatHuman: a successful run reports each repo and a final "done" line', () => {
  const output = log.formatHuman({
    ok: true,
    main: {
      ok: true, branch: 'main', head: 'abc1234', strategy: 'fast-forward',
    },
    submodules: [
      {
        label: 'sub', ok: true, branch: 'main', head: 'def5678', strategy: 'fast-forward',
      },
    ],
  });

  assert.match(output, /\[main]/);
  assert.match(output, /\[sub]/);
  assert.match(output, /done: fresh\./);
});

test('formatHuman: a dirty failure surfaces the git-status detail, indented', () => {
  const output = log.formatHuman({
    ok: false,
    main: { ok: false, reason: 'dirty', detail: ' M sub\n?? new.txt' },
    submodules: [],
  });

  assert.match(output, /\[main] dirty/);
  assert.match(output, / {2}M sub/);
  assert.match(output, /stopped — see above/);
});

test('formatHuman: a conflict lists each conflicted file', () => {
  const output = log.formatHuman({
    ok: false,
    main: {
      ok: false, reason: 'conflict', branch: 'main', conflicted: ['a.txt', 'b.txt'],
    },
    submodules: [],
  });

  assert.match(output, /conflicted files:/);
  assert.match(output, /a\.txt/);
  assert.match(output, /b\.txt/);
});

test('formatHuman: a conflict also states which upstream it conflicted against, when known', () => {
  const output = log.formatHuman({
    ok: false,
    main: {
      ok: false, reason: 'conflict', branch: 'main', upstream: 'origin/main', conflicted: ['a.txt'],
    },
    submodules: [],
  });

  assert.match(output, /against origin\/main/);
  assert.match(output, /conflicted files:/);
});

test('formatHuman: a branch-switch failure surfaces the git error, when known', () => {
  const output = log.formatHuman({
    ok: false,
    main: {
      ok: false,
      reason: 'branch-switch-failed',
      branch: 'release',
      detail: "error: pathspec 'release' did not match any file(s) known to git",
    },
    submodules: [],
  });

  assert.match(output, /\[main] branch-switch-failed/);
  assert.match(output, /did not match any file/);
});

test('formatHuman: a dry-run success says so without claiming a real update happened', () => {
  const output = log.formatHuman({
    ok: true,
    main: {
      ok: true, dryRun: true, branch: 'main', strategy: 'fast-forward',
    },
    submodules: [],
  });

  assert.match(output, /dry run/);
  assert.doesNotMatch(output, /done: fresh\./);
});

test('formatEntry + formatSummary: usable standalone, and produce the same text formatHuman does', () => {
  const runResult = {
    ok: true,
    main: {
      ok: true, branch: 'main', head: 'abc1234', strategy: 'fast-forward',
    },
    submodules: [
      {
        label: 'sub', ok: true, branch: 'main', head: 'def5678', strategy: 'fast-forward',
      },
    ],
  };

  const streamed = [
    log.formatEntry('main', runResult.main),
    ...runResult.submodules.map((sub) => log.formatEntry(sub.label, sub)),
    log.formatSummary(runResult),
  ].join('\n');

  assert.equal(streamed, log.formatHuman(runResult));
});

test('formatJson: round-trips the run result verbatim', () => {
  const runResult = {
    ok: true,
    main: {
      ok: true, branch: 'main', head: 'abc1234', strategy: 'fast-forward',
    },
    submodules: [],
  };

  assert.deepEqual(JSON.parse(log.formatJson(runResult)), runResult);
});
