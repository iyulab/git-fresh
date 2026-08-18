'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

// A single empty config file, shared by every test process, that stands in
// for the user's real global/system git config. Without this, whatever the
// machine running the tests happens to have configured (aliases, a different
// init.defaultBranch, autocrlf, commit signing) leaks into fixture repos and
// makes the suite non-reproducible across machines.
// `protocol.file.allow = always` is needed for tests that add a local bare repo as a submodule
// (recent git disallows local-filesystem submodule/clone URLs by default as a supply-chain
// hardening measure — irrelevant to trusted, same-machine fixtures).
const NULL_CONFIG = path.join(os.tmpdir(), 'git-fresh-test-null-gitconfig');
// Always (re)written, not just created-if-missing: a stale copy from a previous run/version of
// this file would otherwise silently keep applying, since the path is deterministic across runs.
fs.writeFileSync(NULL_CONFIG, '[protocol "file"]\n\tallow = always\n');

function testEnv() {
  return {
    ...process.env,
    GIT_CONFIG_GLOBAL: NULL_CONFIG,
    GIT_CONFIG_SYSTEM: NULL_CONFIG,
  };
}

function git(cwd, args) {
  return execFileSync('git', args, {
    cwd,
    env: testEnv(),
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

function mkTempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function configureIdentity(dir) {
  git(dir, ['config', 'user.name', 'git-fresh test']);
  git(dir, ['config', 'user.email', 'test@example.invalid']);
  git(dir, ['config', 'commit.gpgsign', 'false']);
  git(dir, ['config', 'core.autocrlf', 'false']);
}

/** Creates a repo with a deterministic identity/branch/line-ending config, isolated from the host's git config. */
function initRepo(dir) {
  fs.mkdirSync(dir, { recursive: true });
  git(dir, ['init', '--quiet', '-b', 'main']);
  configureIdentity(dir);
  return dir;
}

function commitFile(dir, filename, content, message) {
  fs.writeFileSync(path.join(dir, filename), content);
  git(dir, ['add', filename]);
  git(dir, ['commit', '--quiet', '-m', message]);
}

/**
 * A bare "remote" plus a clone that tracks it — the minimal setup for
 * exercising upstream/ahead-count logic. `cloneDir`'s `main` branch tracks
 * `origin/main` with nothing ahead, which is the scenario-A / scenario-E
 * "safe" baseline.
 */
function initBareAndClone(baseDir) {
  const bareDir = path.join(baseDir, 'remote.git');
  fs.mkdirSync(bareDir, { recursive: true });
  git(bareDir, ['init', '--quiet', '--bare', '-b', 'main']);

  const seedDir = initRepo(path.join(baseDir, 'seed'));
  commitFile(seedDir, 'README.md', 'seed\n', 'root commit');
  git(seedDir, ['remote', 'add', 'origin', bareDir]);
  git(seedDir, ['push', '--quiet', 'origin', 'main']);

  const cloneDir = path.join(baseDir, 'clone');
  git(baseDir, ['clone', '--quiet', bareDir, cloneDir]);
  configureIdentity(cloneDir);

  return { bareDir, seedDir, cloneDir };
}

/**
 * A main repo with one submodule, each backed by its own bare remote — the shape
 * `03-TEST-SCENARIOS.md`'s "공통 fixture" describes: `remotes/main.git` + `remotes/sub.git`,
 * `main.git` carrying a root commit and a "submodule added" commit already pushed, and a
 * `workspaceDir` cloned from `main.git` with `--recurse-submodules` standing in for a real
 * developer's local checkout. `.gitmodules` carries no `branch` setting (so the default, `main`,
 * applies), matching the doc's fixture exactly.
 */
function initMainWithSubmodule(baseDir) {
  const subBareDir = path.join(baseDir, 'remotes', 'sub.git');
  fs.mkdirSync(subBareDir, { recursive: true });
  git(subBareDir, ['init', '--quiet', '--bare', '-b', 'main']);

  const subSeedDir = initRepo(path.join(baseDir, 'sub-seed'));
  commitFile(subSeedDir, 'README.md', 'sub seed\n', 'sub root commit');
  git(subSeedDir, ['remote', 'add', 'origin', subBareDir]);
  git(subSeedDir, ['push', '--quiet', 'origin', 'main']);

  const mainBareDir = path.join(baseDir, 'remotes', 'main.git');
  fs.mkdirSync(mainBareDir, { recursive: true });
  git(mainBareDir, ['init', '--quiet', '--bare', '-b', 'main']);

  const mainSeedDir = initRepo(path.join(baseDir, 'main-seed'));
  commitFile(mainSeedDir, 'README.md', 'main seed\n', 'root commit');
  git(mainSeedDir, ['submodule', 'add', '--quiet', subBareDir, 'sub']);
  git(mainSeedDir, ['commit', '--quiet', '-m', 'add submodule']);
  git(mainSeedDir, ['remote', 'add', 'origin', mainBareDir]);
  git(mainSeedDir, ['push', '--quiet', 'origin', 'main']);

  const workspaceDir = path.join(baseDir, 'workspace');
  git(baseDir, ['clone', '--quiet', '--recurse-submodules', mainBareDir, workspaceDir]);
  configureIdentity(workspaceDir);
  const subDir = path.join(workspaceDir, 'sub');
  configureIdentity(subDir);

  return {
    subBareDir, subSeedDir, mainBareDir, mainSeedDir, workspaceDir, subDir,
  };
}

/**
 * Three levels: main repo -> submodule "sub" -> nested submodule "nested", each backed by its
 * own bare remote. Exercises `processSubmodulesRecursive`'s actual recursive descent, which
 * `initMainWithSubmodule` (one level only) can't — a submodule-of-a-submodule is SPEC-required
 * ("모든 서브모듈, 재귀적으로 — 서브모듈의 서브모듈까지") but was previously untested end-to-end.
 */
function initMainWithNestedSubmodule(baseDir) {
  const nestedBareDir = path.join(baseDir, 'remotes', 'nested.git');
  fs.mkdirSync(nestedBareDir, { recursive: true });
  git(nestedBareDir, ['init', '--quiet', '--bare', '-b', 'main']);

  const nestedSeedDir = initRepo(path.join(baseDir, 'nested-seed'));
  commitFile(nestedSeedDir, 'README.md', 'nested seed\n', 'nested root commit');
  git(nestedSeedDir, ['remote', 'add', 'origin', nestedBareDir]);
  git(nestedSeedDir, ['push', '--quiet', 'origin', 'main']);

  const subBareDir = path.join(baseDir, 'remotes', 'sub.git');
  fs.mkdirSync(subBareDir, { recursive: true });
  git(subBareDir, ['init', '--quiet', '--bare', '-b', 'main']);

  const subSeedDir = initRepo(path.join(baseDir, 'sub-seed'));
  commitFile(subSeedDir, 'README.md', 'sub seed\n', 'sub root commit');
  git(subSeedDir, ['submodule', 'add', '--quiet', nestedBareDir, 'nested']);
  git(subSeedDir, ['commit', '--quiet', '-m', 'add nested submodule']);
  git(subSeedDir, ['remote', 'add', 'origin', subBareDir]);
  git(subSeedDir, ['push', '--quiet', 'origin', 'main']);

  const mainBareDir = path.join(baseDir, 'remotes', 'main.git');
  fs.mkdirSync(mainBareDir, { recursive: true });
  git(mainBareDir, ['init', '--quiet', '--bare', '-b', 'main']);

  const mainSeedDir = initRepo(path.join(baseDir, 'main-seed'));
  commitFile(mainSeedDir, 'README.md', 'main seed\n', 'root commit');
  git(mainSeedDir, ['submodule', 'add', '--quiet', subBareDir, 'sub']);
  git(mainSeedDir, ['commit', '--quiet', '-m', 'add submodule']);
  git(mainSeedDir, ['remote', 'add', 'origin', mainBareDir]);
  git(mainSeedDir, ['push', '--quiet', 'origin', 'main']);

  const workspaceDir = path.join(baseDir, 'workspace');
  git(baseDir, ['clone', '--quiet', '--recurse-submodules', mainBareDir, workspaceDir]);
  configureIdentity(workspaceDir);
  const subDir = path.join(workspaceDir, 'sub');
  configureIdentity(subDir);
  const nestedDir = path.join(subDir, 'nested');
  configureIdentity(nestedDir);

  return {
    nestedBareDir,
    nestedSeedDir,
    subBareDir,
    subSeedDir,
    mainBareDir,
    mainSeedDir,
    workspaceDir,
    subDir,
    nestedDir,
  };
}

/** Recursive, retrying removal — plain `rm -rf` intermittently hits EPERM on Windows on `.git` pack files. */
function cleanup(dir) {
  fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5 });
}

module.exports = {
  git,
  mkTempDir,
  initRepo,
  commitFile,
  initBareAndClone,
  initMainWithSubmodule,
  initMainWithNestedSubmodule,
  cleanup,
};
