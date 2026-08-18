'use strict';

const { execFileSync } = require('node:child_process');

// Module-level rather than threaded through every call site: `--verbose` is a cross-cutting
// concern (every `runGit` call everywhere should honor it), and every git-fresh invocation is a
// single fresh process, so there's no cross-run leakage to worry about outside of tests (which
// reset it explicitly where it matters).
let verbose = false;

/** Enables or disables command-echoing for every subsequent `runGit` call (CLI `--verbose`). */
function setVerbose(value) {
  verbose = Boolean(value);
}

/**
 * Run a git command via execFile (never a shell) so arguments can never be
 * reinterpreted by a shell. `allowFailure` turns a non-zero exit into a
 * structured `{ ok: false }` result instead of a thrown error, for the many
 * git queries (e.g. `@{u}` on a branch with no upstream) whose failure is an
 * expected, meaningful outcome rather than an exceptional one.
 */
function runGit(args, { cwd, allowFailure = false, env } = {}) {
  if (verbose) {
    process.stderr.write(`+ git ${args.join(' ')}${cwd ? ` (in ${cwd})` : ''}\n`);
  }
  try {
    const stdout = execFileSync('git', args, {
      cwd,
      env,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return {
      ok: true, stdout: stdout.trim(), stderr: '', status: 0,
    };
  } catch (err) {
    if (!allowFailure) throw err;
    return {
      ok: false,
      stdout: (err.stdout || '').toString().trim(),
      stderr: (err.stderr || '').toString().trim(),
      status: typeof err.status === 'number' ? err.status : null,
    };
  }
}

module.exports = { runGit, setVerbose };
