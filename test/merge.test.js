'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  mkTempDir, initBareAndClone, commitFile, git, cleanup,
} = require('./fixtures/setup');

const checks = require('../src/checks');
const merge = require('../src/merge');

/** initBareAndClone's seed/clone start one commit (README.md) apart from "shared.txt" existing. */
function withSharedFile(fixture) {
  commitFile(fixture.seedDir, 'shared.txt', 'a\n', 'add shared.txt');
  git(fixture.seedDir, ['push', '--quiet', 'origin', 'main']);
  git(fixture.cloneDir, ['pull', '--quiet', 'origin', 'main']);
  return fixture;
}

test('updateToTarget: fast-forwards when local has no divergent commits', (t) => {
  const base = mkTempDir('git-fresh-merge-ff-');
  t.after(() => cleanup(base));
  const fixture = initBareAndClone(base);

  commitFile(fixture.seedDir, 'new.txt', 'remote change\n', 'remote advances');
  git(fixture.seedDir, ['push', '--quiet', 'origin', 'main']);
  git(fixture.cloneDir, ['fetch', '--quiet']);

  const result = merge.updateToTarget(fixture.cloneDir, 'origin/main');

  assert.equal(result.ok, true);
  assert.equal(result.strategy, 'fast-forward');
  assert.equal(result.head, git(fixture.seedDir, ['rev-parse', '--short', 'HEAD']));
  assert.equal(checks.isDirty(fixture.cloneDir), false);
});

test('updateToTarget: already up to date is a no-op fast-forward success', (t) => {
  const base = mkTempDir('git-fresh-merge-noop-');
  t.after(() => cleanup(base));
  const fixture = initBareAndClone(base);
  git(fixture.cloneDir, ['fetch', '--quiet']);

  const before = checks.getHeadCommit(fixture.cloneDir);
  const result = merge.updateToTarget(fixture.cloneDir, 'origin/main');

  assert.equal(result.ok, true);
  assert.equal(result.strategy, 'fast-forward');
  assert.equal(result.head, before);
});

test('updateToTarget: falls back to a real merge when divergent but non-conflicting', (t) => {
  const base = mkTempDir('git-fresh-merge-real-');
  t.after(() => cleanup(base));
  const fixture = initBareAndClone(base);

  commitFile(fixture.cloneDir, 'local-only.txt', 'local change\n', 'local diverges');
  commitFile(fixture.seedDir, 'remote-only.txt', 'remote change\n', 'remote diverges');
  git(fixture.seedDir, ['push', '--quiet', 'origin', 'main']);
  git(fixture.cloneDir, ['fetch', '--quiet']);

  const result = merge.updateToTarget(fixture.cloneDir, 'origin/main');

  assert.equal(result.ok, true);
  assert.equal(result.strategy, 'merge');
  assert.ok(fs.existsSync(path.join(fixture.cloneDir, 'local-only.txt')));
  assert.ok(fs.existsSync(path.join(fixture.cloneDir, 'remote-only.txt')));
  assert.equal(checks.isDirty(fixture.cloneDir), false);
  assert.equal(merge.isMergeInProgress(fixture.cloneDir), false);
});

test('updateToTarget: aborts and reports conflicts, restoring a clean state', (t) => {
  const base = mkTempDir('git-fresh-merge-conflict-');
  t.after(() => cleanup(base));
  const fixture = withSharedFile(initBareAndClone(base));

  const localHead = git(fixture.cloneDir, ['rev-parse', 'HEAD']);
  commitFile(fixture.cloneDir, 'shared.txt', 'local change\n', 'local edits shared.txt');
  commitFile(fixture.seedDir, 'shared.txt', 'remote change\n', 'remote edits shared.txt');
  git(fixture.seedDir, ['push', '--quiet', 'origin', 'main']);
  git(fixture.cloneDir, ['fetch', '--quiet']);

  const localHeadAfterCommit = git(fixture.cloneDir, ['rev-parse', 'HEAD']);
  const result = merge.updateToTarget(fixture.cloneDir, 'origin/main');

  assert.equal(result.ok, false);
  assert.equal(result.strategy, null);
  assert.deepEqual(result.conflicted, ['shared.txt']);

  assert.equal(checks.isDirty(fixture.cloneDir), false);
  assert.equal(merge.isMergeInProgress(fixture.cloneDir), false);
  assert.equal(git(fixture.cloneDir, ['rev-parse', 'HEAD']), localHeadAfterCommit);
  assert.notEqual(localHeadAfterCommit, localHead);
});

test('previewUpdate: reports a fast-forward without touching HEAD or the worktree', (t) => {
  const base = mkTempDir('git-fresh-preview-ff-');
  t.after(() => cleanup(base));
  const fixture = initBareAndClone(base);

  commitFile(fixture.seedDir, 'new.txt', 'remote change\n', 'remote advances');
  git(fixture.seedDir, ['push', '--quiet', 'origin', 'main']);
  git(fixture.cloneDir, ['fetch', '--quiet']);

  const before = git(fixture.cloneDir, ['rev-parse', 'HEAD']);
  const result = merge.previewUpdate(fixture.cloneDir, 'origin/main');

  assert.equal(result.ok, true);
  assert.equal(result.strategy, 'fast-forward');
  assert.equal(git(fixture.cloneDir, ['rev-parse', 'HEAD']), before);
  assert.equal(checks.isDirty(fixture.cloneDir), false);
});

test('previewUpdate: reports a clean merge without touching HEAD or the worktree', (t) => {
  const base = mkTempDir('git-fresh-preview-merge-');
  t.after(() => cleanup(base));
  const fixture = initBareAndClone(base);

  commitFile(fixture.cloneDir, 'local-only.txt', 'local change\n', 'local diverges');
  commitFile(fixture.seedDir, 'remote-only.txt', 'remote change\n', 'remote diverges');
  git(fixture.seedDir, ['push', '--quiet', 'origin', 'main']);
  git(fixture.cloneDir, ['fetch', '--quiet']);

  const before = git(fixture.cloneDir, ['rev-parse', 'HEAD']);
  const result = merge.previewUpdate(fixture.cloneDir, 'origin/main');

  assert.equal(result.ok, true);
  assert.equal(result.strategy, 'merge');
  assert.equal(git(fixture.cloneDir, ['rev-parse', 'HEAD']), before);
  assert.equal(fs.existsSync(path.join(fixture.cloneDir, 'remote-only.txt')), false);
  assert.equal(checks.isDirty(fixture.cloneDir), false);
});

test('mergeOntoUpstream: reports which upstream it ran against, on conflict and on would-conflict', (t) => {
  const base = mkTempDir('git-fresh-mergeontoupstream-conflict-');
  t.after(() => cleanup(base));
  const fixture = withSharedFile(initBareAndClone(base));

  commitFile(fixture.cloneDir, 'shared.txt', 'local change\n', 'local edits shared.txt');
  commitFile(fixture.seedDir, 'shared.txt', 'remote change\n', 'remote edits shared.txt');
  git(fixture.seedDir, ['push', '--quiet', 'origin', 'main']);
  git(fixture.cloneDir, ['fetch', '--quiet']);

  const conflictResult = merge.mergeOntoUpstream(fixture.cloneDir, 'origin/main');
  assert.equal(conflictResult.ok, false);
  assert.equal(conflictResult.reason, 'conflict');
  assert.equal(conflictResult.upstream, 'origin/main');
  assert.deepEqual(conflictResult.conflicted, ['shared.txt']);

  const dryRunResult = merge.mergeOntoUpstream(fixture.cloneDir, 'origin/main', { dryRun: true });
  assert.equal(dryRunResult.ok, false);
  assert.equal(dryRunResult.reason, 'would-conflict');
  assert.equal(dryRunResult.upstream, 'origin/main');
});

test('mergeOntoUpstream: reports which upstream it ran against, on a successful fast-forward too', (t) => {
  const base = mkTempDir('git-fresh-mergeontoupstream-ff-');
  t.after(() => cleanup(base));
  const fixture = initBareAndClone(base);

  commitFile(fixture.seedDir, 'new.txt', 'remote change\n', 'remote advances');
  git(fixture.seedDir, ['push', '--quiet', 'origin', 'main']);
  git(fixture.cloneDir, ['fetch', '--quiet']);

  const result = merge.mergeOntoUpstream(fixture.cloneDir, 'origin/main');
  assert.equal(result.ok, true);
  assert.equal(result.strategy, 'fast-forward');
  assert.equal(result.upstream, 'origin/main');
});

test('previewUpdate: reports conflicted files without touching HEAD or the worktree', (t) => {
  const base = mkTempDir('git-fresh-preview-conflict-');
  t.after(() => cleanup(base));
  const fixture = withSharedFile(initBareAndClone(base));

  commitFile(fixture.cloneDir, 'shared.txt', 'local change\n', 'local edits shared.txt');
  commitFile(fixture.seedDir, 'shared.txt', 'remote change\n', 'remote edits shared.txt');
  git(fixture.seedDir, ['push', '--quiet', 'origin', 'main']);
  git(fixture.cloneDir, ['fetch', '--quiet']);

  const before = git(fixture.cloneDir, ['rev-parse', 'HEAD']);
  const result = merge.previewUpdate(fixture.cloneDir, 'origin/main');

  assert.equal(result.ok, false);
  assert.equal(result.strategy, null);
  assert.deepEqual(result.conflicted, ['shared.txt']);
  assert.equal(git(fixture.cloneDir, ['rev-parse', 'HEAD']), before);
  assert.equal(checks.isDirty(fixture.cloneDir), false);
  assert.equal(merge.isMergeInProgress(fixture.cloneDir), false);
});
