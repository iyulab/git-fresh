'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  mkTempDir, initMainWithSubmodule, initMainWithNestedSubmodule, commitFile, git, cleanup,
} = require('./fixtures/setup');

const checks = require('../src/checks');
const mainRepo = require('../src/main-repo');
const submodules = require('../src/submodules');

// `03-TEST-SCENARIOS.md` scenarios A-E, ported to exercise `main-repo.js` + `submodules.js`
// end-to-end instead of the bash reference implementation they were originally verified against.
// (Scenario F — fast-forward-impossible-but-conflict-free-merge — is already covered at the unit
// level by `merge.test.js`; its conflict variant stays parked pending D-01, per the doc's note.)

test('scenario A: clean workspace fast-forwards the submodule to a new remote commit', (t) => {
  const base = mkTempDir('git-fresh-orch-a-');
  t.after(() => cleanup(base));
  const fixture = initMainWithSubmodule(base);

  commitFile(fixture.subSeedDir, 'new.txt', 'remote advances\n', 'sub remote advances');
  git(fixture.subSeedDir, ['push', '--quiet', 'origin', 'main']);
  const newSubHead = git(fixture.subSeedDir, ['rev-parse', '--short', 'HEAD']);

  const mainResult = mainRepo.processMainRepo(fixture.workspaceDir);
  assert.equal(mainResult.ok, true);

  submodules.initSubmodules(fixture.workspaceDir);
  const subResults = submodules.processSubmodulesRecursive(fixture.workspaceDir);

  assert.equal(subResults.length, 1);
  assert.equal(subResults[0].label, 'sub');
  assert.equal(subResults[0].ok, true);
  assert.equal(subResults[0].strategy, 'fast-forward');
  assert.equal(subResults[0].head, newSubHead);
});

test('scenario B: uncommitted changes inside the submodule stop processing at the main-repo check', (t) => {
  const base = mkTempDir('git-fresh-orch-b-');
  t.after(() => cleanup(base));
  const fixture = initMainWithSubmodule(base);

  fs.writeFileSync(path.join(fixture.subDir, 'README.md'), 'uncommitted local edit\n');

  const mainResult = mainRepo.processMainRepo(fixture.workspaceDir);

  assert.equal(mainResult.ok, false);
  assert.equal(mainResult.reason, 'dirty');
  assert.match(mainResult.detail, /sub/);
});

test('scenario C: an unpushed commit on a new submodule branch stops at the main-repo check, preserving it', (t) => {
  const base = mkTempDir('git-fresh-orch-c-');
  t.after(() => cleanup(base));
  const fixture = initMainWithSubmodule(base);

  git(fixture.subDir, ['checkout', '--quiet', '-b', 'feature/wip']);
  commitFile(fixture.subDir, 'wip.txt', 'work in progress\n', 'wip commit');
  const wipHead = git(fixture.subDir, ['rev-parse', 'HEAD']);

  const mainResult = mainRepo.processMainRepo(fixture.workspaceDir);

  assert.equal(mainResult.ok, false);
  assert.equal(mainResult.reason, 'dirty');

  // Nothing about the submodule's own state was touched — the failure happened before
  // git-fresh ever looked at it.
  assert.equal(git(fixture.subDir, ['branch', '--show-current']), 'feature/wip');
  assert.equal(git(fixture.subDir, ['rev-parse', 'HEAD']), wipHead);
});

test('scenario D: same-commit submodule branch with no upstream is conservatively unsafe', (t) => {
  const base = mkTempDir('git-fresh-orch-d-');
  t.after(() => cleanup(base));
  const fixture = initMainWithSubmodule(base);

  // Detach at the pinned commit's own SHA first (as a fresh --recurse-submodules clone leaves
  // it), then give that exact commit a branch name with no upstream.
  git(fixture.subDir, ['switch', '--quiet', '-c', 'local-alias']);

  const mainResult = mainRepo.processMainRepo(fixture.workspaceDir);
  assert.equal(mainResult.ok, true); // same commit as recorded => no pointer change => clean

  submodules.initSubmodules(fixture.workspaceDir);
  const subResults = submodules.processSubmodulesRecursive(fixture.workspaceDir);

  assert.equal(subResults.length, 1);
  assert.equal(subResults[0].ok, false);
  assert.equal(subResults[0].reason, 'no-upstream');
  assert.equal(subResults[0].branch, 'local-alias');
});

test('scenario E: a different but fully-pushed submodule branch is safe to switch off of', (t) => {
  const base = mkTempDir('git-fresh-orch-e-');
  t.after(() => cleanup(base));
  const fixture = initMainWithSubmodule(base);

  git(fixture.subDir, ['checkout', '--quiet', '-b', 'release']);
  git(fixture.subDir, ['push', '--quiet', '-u', 'origin', 'release']);

  const mainResult = mainRepo.processMainRepo(fixture.workspaceDir);
  assert.equal(mainResult.ok, true);

  submodules.initSubmodules(fixture.workspaceDir);
  const subResults = submodules.processSubmodulesRecursive(fixture.workspaceDir);

  assert.equal(subResults.length, 1);
  assert.equal(subResults[0].ok, true);
  assert.equal(subResults[0].branch, 'main');
  assert.equal(subResults[0].strategy, 'fast-forward');
  assert.equal(checks.isDirty(fixture.workspaceDir), false);
});

test('--dry-run: previews the submodule fast-forward without mutating anything', (t) => {
  const base = mkTempDir('git-fresh-orch-dryrun-');
  t.after(() => cleanup(base));
  const fixture = initMainWithSubmodule(base);

  commitFile(fixture.subSeedDir, 'new.txt', 'remote advances\n', 'sub remote advances');
  git(fixture.subSeedDir, ['push', '--quiet', 'origin', 'main']);

  const mainHeadBefore = git(fixture.workspaceDir, ['rev-parse', 'HEAD']);
  const subHeadBefore = git(fixture.subDir, ['rev-parse', 'HEAD']);

  const mainResult = mainRepo.processMainRepo(fixture.workspaceDir, { dryRun: true });
  assert.equal(mainResult.ok, true);
  assert.equal(mainResult.dryRun, true);

  submodules.initSubmodules(fixture.workspaceDir);
  const subResults = submodules.processSubmodulesRecursive(fixture.workspaceDir, { dryRun: true });

  assert.equal(subResults.length, 1);
  assert.equal(subResults[0].ok, true);
  assert.equal(subResults[0].dryRun, true);
  assert.equal(subResults[0].strategy, 'fast-forward');
  assert.equal(subResults[0].wouldSwitch, true); // still detached before any real switch

  assert.equal(git(fixture.workspaceDir, ['rev-parse', 'HEAD']), mainHeadBefore);
  assert.equal(git(fixture.subDir, ['rev-parse', 'HEAD']), subHeadBefore);
  assert.equal(checks.isDirty(fixture.workspaceDir), false);
});

test('--branch override forces every submodule onto the given branch, ignoring .gitmodules', (t) => {
  const base = mkTempDir('git-fresh-orch-branchoverride-');
  t.after(() => cleanup(base));
  const fixture = initMainWithSubmodule(base);

  git(fixture.subDir, ['checkout', '--quiet', '-b', 'release']);
  git(fixture.subDir, ['push', '--quiet', '-u', 'origin', 'release']);

  submodules.initSubmodules(fixture.workspaceDir);
  const subResults = submodules.processSubmodulesRecursive(
    fixture.workspaceDir,
    { branchOverride: 'release' },
  );

  assert.equal(subResults.length, 1);
  assert.equal(subResults[0].ok, true);
  assert.equal(subResults[0].branch, 'release');
});

test('recursion: a submodule-of-a-submodule is actually walked, not just one level deep', (t) => {
  const base = mkTempDir('git-fresh-orch-nested-');
  t.after(() => cleanup(base));
  const fixture = initMainWithNestedSubmodule(base);

  commitFile(fixture.nestedSeedDir, 'new.txt', 'nested remote advances\n', 'nested remote advances');
  git(fixture.nestedSeedDir, ['push', '--quiet', 'origin', 'main']);
  const newNestedHead = git(fixture.nestedSeedDir, ['rev-parse', '--short', 'HEAD']);

  submodules.initSubmodules(fixture.workspaceDir);
  const subResults = submodules.processSubmodulesRecursive(fixture.workspaceDir);

  assert.equal(subResults.length, 2);
  assert.equal(subResults[0].label, 'sub');
  assert.equal(subResults[0].ok, true);
  assert.equal(subResults[1].label, 'sub/nested');
  assert.equal(subResults[1].ok, true);
  assert.equal(subResults[1].strategy, 'fast-forward');
  assert.equal(subResults[1].head, newNestedHead);
});

test('recursion: a failure at the nested level stops without corrupting the outer level\'s result', (t) => {
  const base = mkTempDir('git-fresh-orch-nested-fail-');
  t.after(() => cleanup(base));
  const fixture = initMainWithNestedSubmodule(base);

  git(fixture.nestedDir, ['checkout', '--quiet', '-b', 'local-only']);

  submodules.initSubmodules(fixture.workspaceDir);
  const subResults = submodules.processSubmodulesRecursive(fixture.workspaceDir);

  assert.equal(subResults.length, 2);
  assert.equal(subResults[0].label, 'sub');
  assert.equal(subResults[0].ok, true);
  assert.equal(subResults[1].label, 'sub/nested');
  assert.equal(subResults[1].ok, false);
  assert.equal(subResults[1].reason, 'no-upstream');
});

test('security: a .gitmodules path that escapes the repo is rejected, not followed', (t) => {
  const base = mkTempDir('git-fresh-orch-traversal-');
  t.after(() => cleanup(base));
  const fixture = initMainWithSubmodule(base);

  git(fixture.workspaceDir, ['config', '-f', '.gitmodules', 'submodule.sub.path', '../escaped']);

  const subResults = submodules.processSubmodulesRecursive(fixture.workspaceDir);

  assert.equal(subResults.length, 1);
  assert.equal(subResults[0].ok, false);
  assert.equal(subResults[0].reason, 'unsafe-path');
  assert.match(subResults[0].detail, /escapes the repo/);
});
