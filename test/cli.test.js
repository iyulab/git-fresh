'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  mkTempDir, initBareAndClone, initMainWithSubmodule, commitFile, git, cleanup,
} = require('./fixtures/setup');

const cli = require('../src/cli');
const gitWrapper = require('../src/git');
const { version } = require('../package.json');

function captureOutput(fn) {
  let out = '';
  let err = '';
  const origOut = process.stdout.write.bind(process.stdout);
  const origErr = process.stderr.write.bind(process.stderr);
  process.stdout.write = (chunk) => { out += chunk; return true; };
  process.stderr.write = (chunk) => { err += chunk; return true; };
  try {
    const result = fn();
    return { result, stdout: out, stderr: err };
  } finally {
    process.stdout.write = origOut;
    process.stderr.write = origErr;
  }
}

test('parseArgs: defaults when nothing is passed', () => {
  const { opts, errors } = cli.parseArgs([]);
  assert.deepEqual(opts, {
    dryRun: false, branch: null, yes: false, verbose: false, json: false, help: false, version: false,
  });
  assert.deepEqual(errors, []);
});

test('parseArgs: recognizes every documented flag', () => {
  const { opts, errors } = cli.parseArgs(['--dry-run', '--branch', 'develop', '-y', '--verbose', '--json']);
  assert.equal(opts.dryRun, true);
  assert.equal(opts.branch, 'develop');
  assert.equal(opts.yes, true);
  assert.equal(opts.verbose, true);
  assert.equal(opts.json, true);
  assert.deepEqual(errors, []);
});

test('parseArgs: --branch without a value is an error, not a silent no-op', () => {
  const { errors: missingAtEnd } = cli.parseArgs(['--branch']);
  assert.equal(missingAtEnd.length, 1);

  const { errors: missingBeforeFlag } = cli.parseArgs(['--branch', '--json']);
  assert.equal(missingBeforeFlag.length, 1);
});

test('parseArgs: an unrecognized flag is reported, not silently ignored', () => {
  const { errors } = cli.parseArgs(['--nope']);
  assert.deepEqual(errors, ['unknown option: --nope']);
});

test('exitCodeFor: 0 on success, the reason-specific code on the first failure found', () => {
  assert.equal(cli.exitCodeFor({ ok: true }), 0);
  assert.equal(cli.exitCodeFor({ ok: false, main: { ok: false, reason: 'dirty' }, submodules: [] }), 10);
  assert.equal(
    cli.exitCodeFor({
      ok: false,
      main: { ok: true },
      submodules: [{ ok: true }, { ok: false, reason: 'conflict' }],
    }),
    13,
  );
  assert.equal(
    cli.exitCodeFor({ ok: false, main: { ok: false, reason: 'something-unmapped' }, submodules: [] }),
    1,
  );
});

test('main: --help prints usage and exits 0 without touching any repo', () => {
  const { result, stdout } = captureOutput(() => cli.main(['--help']));
  assert.equal(result, 0);
  assert.match(stdout, /Usage: git-fresh/);
});

test('main: --version prints the package version and exits 0', () => {
  const { result, stdout } = captureOutput(() => cli.main(['--version']));
  assert.equal(result, 0);
  assert.equal(stdout, `${version}\n`);
});

test('main: an unknown flag exits 1 and reports the problem on stderr', () => {
  const { result, stderr } = captureOutput(() => cli.main(['--nope']));
  assert.equal(result, 1);
  assert.match(stderr, /unknown option: --nope/);
});

test('main: a clean repo exits 0 and reports success on stdout', (t) => {
  const base = mkTempDir('git-fresh-cli-clean-');
  t.after(() => cleanup(base));
  const fixture = initBareAndClone(base);

  const { result, stdout } = captureOutput(() => cli.main([], { cwd: fixture.cloneDir }));

  assert.equal(result, 0);
  assert.match(stdout, /done: fresh\./);
});

test('main: a submodule tree prints each repo\'s line as it\'s processed, not just a final blob', (t) => {
  const base = mkTempDir('git-fresh-cli-streaming-');
  t.after(() => cleanup(base));
  const fixture = initMainWithSubmodule(base);

  const seenAtWriteTime = [];
  const origWrite = process.stdout.write.bind(process.stdout);
  process.stdout.write = (chunk) => { seenAtWriteTime.push(chunk); return true; };

  let result;
  try {
    result = cli.main([], { cwd: fixture.workspaceDir });
  } finally {
    process.stdout.write = origWrite;
  }

  assert.equal(result, 0);
  // Two entry lines plus the summary line, written as three separate stdout.write calls — not
  // one call carrying the whole report, which is what would happen if output were still
  // buffered until run() fully resolved.
  assert.equal(seenAtWriteTime.length, 3);
  assert.match(seenAtWriteTime[0], /\[main]/);
  assert.match(seenAtWriteTime[1], /\[sub]/);
  assert.match(seenAtWriteTime[2], /done: fresh\./);
});

test('main: --json prints a parseable, accurate result', (t) => {
  const base = mkTempDir('git-fresh-cli-json-');
  t.after(() => cleanup(base));
  const fixture = initBareAndClone(base);

  const { result, stdout } = captureOutput(() => cli.main(['--json'], { cwd: fixture.cloneDir }));

  assert.equal(result, 0);
  const parsed = JSON.parse(stdout);
  assert.equal(parsed.ok, true);
  assert.equal(parsed.main.branch, 'main');
});

test('main: a dirty repo exits with the dirty-specific code and reports why', (t) => {
  const base = mkTempDir('git-fresh-cli-dirty-');
  t.after(() => cleanup(base));
  const fixture = initBareAndClone(base);
  commitFile(fixture.cloneDir, 'tracked.txt', 'a\n', 'seed a tracked file');
  require('node:fs').writeFileSync(require('node:path').join(fixture.cloneDir, 'tracked.txt'), 'changed\n');

  const { result, stdout } = captureOutput(() => cli.main([], { cwd: fixture.cloneDir }));

  assert.equal(result, 10);
  assert.match(stdout, /dirty/);
});

test('main: --dry-run reports a preview without changing the repo', (t) => {
  const base = mkTempDir('git-fresh-cli-dryrun-');
  t.after(() => cleanup(base));
  const fixture = initBareAndClone(base);
  commitFile(fixture.seedDir, 'new.txt', 'remote advances\n', 'remote advances');
  git(fixture.seedDir, ['push', '--quiet', 'origin', 'main']);

  const before = git(fixture.cloneDir, ['rev-parse', 'HEAD']);
  const { result, stdout } = captureOutput(() => cli.main(['--dry-run'], { cwd: fixture.cloneDir }));

  assert.equal(result, 0);
  assert.match(stdout, /dry run/);
  assert.equal(git(fixture.cloneDir, ['rev-parse', 'HEAD']), before);
});

test('main: --verbose echoes the underlying git commands to stderr', (t) => {
  const base = mkTempDir('git-fresh-cli-verbose-');
  t.after(() => {
    gitWrapper.setVerbose(false);
    cleanup(base);
  });
  const fixture = initBareAndClone(base);

  const { stderr } = captureOutput(() => cli.main(['--verbose'], { cwd: fixture.cloneDir }));

  assert.match(stderr, /\+ git fetch/);
});

test('main: an unexpected error (cwd is not a git repo) is reported cleanly, not as a stack trace', (t) => {
  const base = mkTempDir('git-fresh-cli-notrepo-');
  t.after(() => cleanup(base));

  const { result, stderr } = captureOutput(() => cli.main([], { cwd: base }));

  assert.equal(result, 1);
  assert.match(stderr, /unexpected error/);
});
