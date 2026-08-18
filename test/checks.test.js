'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  mkTempDir, initRepo, initBareAndClone, commitFile, git, cleanup,
} = require('./fixtures/setup');

const checks = require('../src/checks');

test('isDirty: clean repo reports not dirty', (t) => {
  const base = mkTempDir('git-fresh-dirty-clean-');
  t.after(() => cleanup(base));
  const repo = initRepo(path.join(base, 'repo'));
  commitFile(repo, 'a.txt', 'hello\n', 'root commit');

  assert.equal(checks.isDirty(repo), false);
});

test('isDirty: modified tracked file reports dirty', (t) => {
  const base = mkTempDir('git-fresh-dirty-mod-');
  t.after(() => cleanup(base));
  const repo = initRepo(path.join(base, 'repo'));
  commitFile(repo, 'a.txt', 'hello\n', 'root commit');

  fs.writeFileSync(path.join(repo, 'a.txt'), 'changed\n');

  assert.equal(checks.isDirty(repo), true);
  assert.match(checks.getDirtyStatus(repo), /a\.txt/);
});

test('getCurrentBranch: named branch vs. detached HEAD', (t) => {
  const base = mkTempDir('git-fresh-branch-');
  t.after(() => cleanup(base));
  const repo = initRepo(path.join(base, 'repo'));
  commitFile(repo, 'a.txt', 'hello\n', 'root commit');

  assert.equal(checks.getCurrentBranch(repo), 'main');

  const head = git(repo, ['rev-parse', 'HEAD']);
  git(repo, ['checkout', '--quiet', head]);

  assert.equal(checks.getCurrentBranch(repo), null);
});

test('assessBranchSafety: detached HEAD is safe (fresh --recurse-submodules clone case)', (t) => {
  const base = mkTempDir('git-fresh-safety-detached-');
  t.after(() => cleanup(base));
  const { cloneDir } = initBareAndClone(base);

  const head = git(cloneDir, ['rev-parse', 'HEAD']);
  git(cloneDir, ['checkout', '--quiet', head]);

  const result = checks.assessBranchSafety(cloneDir);
  assert.deepEqual(result, {
    branch: null, detached: true, upstream: null, ahead: null, safe: true, reason: null,
  });
});

test('assessBranchSafety: named branch without upstream is unsafe', (t) => {
  const base = mkTempDir('git-fresh-safety-noupstream-');
  t.after(() => cleanup(base));
  const repo = initRepo(path.join(base, 'repo'));
  commitFile(repo, 'a.txt', 'hello\n', 'root commit');
  git(repo, ['checkout', '--quiet', '-b', 'local-only']);

  const result = checks.assessBranchSafety(repo);
  assert.equal(result.safe, false);
  assert.equal(result.reason, 'no-upstream');
  assert.equal(result.branch, 'local-only');
});

test('assessBranchSafety: branch tracking upstream with nothing ahead is safe', (t) => {
  const base = mkTempDir('git-fresh-safety-safe-');
  t.after(() => cleanup(base));
  const { cloneDir } = initBareAndClone(base);

  const result = checks.assessBranchSafety(cloneDir);
  assert.equal(result.safe, true);
  assert.equal(result.reason, null);
  assert.equal(result.ahead, 0);
});

test('assessBranchSafety: unpushed commits on a tracked branch are unsafe', (t) => {
  const base = mkTempDir('git-fresh-safety-unpushed-');
  t.after(() => cleanup(base));
  const { cloneDir } = initBareAndClone(base);
  commitFile(cloneDir, 'b.txt', 'new\n', 'local only commit');

  const result = checks.assessBranchSafety(cloneDir);
  assert.equal(result.safe, false);
  assert.equal(result.reason, 'unpushed');
  assert.equal(result.ahead, 1);

  const unpushed = checks.getUnpushedCommits(cloneDir, result.upstream);
  assert.equal(unpushed.length, 1);
  assert.match(unpushed[0], /local only commit/);
});

test('branchExistsLocally: true for a local branch, false for one that was never created', (t) => {
  const base = mkTempDir('git-fresh-branchexists-');
  t.after(() => cleanup(base));
  const repo = initRepo(path.join(base, 'repo'));
  commitFile(repo, 'a.txt', 'hello\n', 'root commit');
  git(repo, ['branch', 'release']);

  assert.equal(checks.branchExistsLocally(repo, 'release'), true);
  assert.equal(checks.branchExistsLocally(repo, 'does-not-exist'), false);
});

test('assessLocalBranchSafety: null when the branch does not exist locally', (t) => {
  const base = mkTempDir('git-fresh-localsafety-missing-');
  t.after(() => cleanup(base));
  const repo = initRepo(path.join(base, 'repo'));
  commitFile(repo, 'a.txt', 'hello\n', 'root commit');

  assert.equal(checks.assessLocalBranchSafety(repo, 'does-not-exist'), null);
});

test('assessLocalBranchSafety: no-upstream for a local branch that was never pushed', (t) => {
  const base = mkTempDir('git-fresh-localsafety-noupstream-');
  t.after(() => cleanup(base));
  const repo = initRepo(path.join(base, 'repo'));
  commitFile(repo, 'a.txt', 'hello\n', 'root commit');
  git(repo, ['branch', 'local-only']);

  const result = checks.assessLocalBranchSafety(repo, 'local-only');
  assert.equal(result.safe, false);
  assert.equal(result.reason, 'no-upstream');
  assert.equal(result.branch, 'local-only');

  // Judged without ever checking it out.
  assert.equal(checks.getCurrentBranch(repo), 'main');
});

test('assessLocalBranchSafety: safe for a local branch that is fully pushed, judged without checking it out', (t) => {
  const base = mkTempDir('git-fresh-localsafety-safe-');
  t.after(() => cleanup(base));
  const { cloneDir } = initBareAndClone(base);

  git(cloneDir, ['checkout', '--quiet', '-b', 'release']);
  git(cloneDir, ['push', '--quiet', '-u', 'origin', 'release']);
  git(cloneDir, ['checkout', '--quiet', 'main']);

  const result = checks.assessLocalBranchSafety(cloneDir, 'release');
  assert.equal(result.safe, true);
  assert.equal(result.reason, null);
  assert.equal(result.upstream, 'origin/release');
  assert.equal(result.ahead, 0);
  assert.equal(checks.getCurrentBranch(cloneDir), 'main');
});

test('assessLocalBranchSafety: unpushed for a local branch with a commit its upstream does not have, judged without checking it out', (t) => {
  const base = mkTempDir('git-fresh-localsafety-unpushed-');
  t.after(() => cleanup(base));
  const { cloneDir } = initBareAndClone(base);

  git(cloneDir, ['checkout', '--quiet', '-b', 'release']);
  git(cloneDir, ['push', '--quiet', '-u', 'origin', 'release']);
  commitFile(cloneDir, 'unpushed.txt', 'never pushed\n', 'unpushed commit on release');
  git(cloneDir, ['checkout', '--quiet', 'main']);

  const result = checks.assessLocalBranchSafety(cloneDir, 'release');
  assert.equal(result.safe, false);
  assert.equal(result.reason, 'unpushed');
  assert.equal(result.ahead, 1);
  assert.equal(checks.getCurrentBranch(cloneDir), 'main');

  const unpushed = checks.getUnpushedCommits(cloneDir, result.upstream, 'release');
  assert.equal(unpushed.length, 1);
  assert.match(unpushed[0], /unpushed commit on release/);
});
