'use strict';

const path = require('node:path');
const { version } = require('../package.json');
const git = require('./git');
const log = require('./log');
const { run } = require('./run');

const HELP_TEXT = `Usage: git-fresh [options]

Bring this repo and all its submodules (recursively) to a fresh, up-to-date
state against their remotes — stopping immediately on anything that risks
losing local work (uncommitted changes, unpushed commits, or a merge
conflict). See https://github.com/iyulab/git-fresh for details.

Options:
  --dry-run          Show what would happen without changing anything
  --branch <name>    Force this branch for every submodule, ignoring .gitmodules
  --yes, -y          Accepted for CI scripts; git-fresh only ever acts once a
                      step is already confirmed safe, so this is currently a no-op
  --verbose          Print each underlying git command before it runs
  --json             Print the result as JSON instead of a human-readable report
  --version          Print the installed version and exit
  --help             Print this help and exit
`;

// Exit codes distinguish *why* a run stopped (SPEC "실패 시 보고 형식") so a CI pipeline or an
// AI agent can branch on the reason without parsing text. Provisional (ROADMAP.md D-02 covers
// --json's schema; this table isn't itself specified anywhere and is just as easy to revise).
const EXIT_CODES = {
  dirty: 10,
  unpushed: 11,
  'no-upstream': 12,
  conflict: 13,
  'would-conflict': 13,
  'branch-switch-failed': 14,
  'unsafe-path': 15,
  error: 1,
};

function parseArgs(argv) {
  const opts = {
    dryRun: false, branch: null, yes: false, verbose: false, json: false, help: false, version: false,
  };
  const errors = [];

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    switch (arg) {
      case '--dry-run':
        opts.dryRun = true;
        break;
      case '--yes':
      case '-y':
        opts.yes = true;
        break;
      case '--verbose':
        opts.verbose = true;
        break;
      case '--json':
        opts.json = true;
        break;
      case '--help':
      case '-h':
        opts.help = true;
        break;
      case '--version':
        opts.version = true;
        break;
      case '--branch': {
        const value = argv[i + 1];
        if (!value || value.startsWith('-')) {
          errors.push('--branch requires a value');
        } else {
          opts.branch = value;
          i += 1;
        }
        break;
      }
      default:
        errors.push(`unknown option: ${arg}`);
    }
  }

  return { opts, errors };
}

function exitCodeFor(result) {
  if (result.ok) return 0;
  const failure = !result.main.ok ? result.main : result.submodules.find((r) => !r.ok);
  return EXIT_CODES[failure && failure.reason] ?? EXIT_CODES.error;
}

/**
 * Runs the CLI for one invocation and returns the process exit code — never calls
 * `process.exit` itself, so `bin/git-fresh.js` (or a test) stays in control of the process.
 */
function main(argv, { cwd = process.cwd() } = {}) {
  const { opts, errors } = parseArgs(argv);

  if (opts.help) {
    process.stdout.write(HELP_TEXT);
    return 0;
  }
  if (opts.version) {
    process.stdout.write(`${version}\n`);
    return 0;
  }
  if (errors.length > 0) {
    process.stderr.write(`${errors.join('\n')}\n\n${HELP_TEXT}`);
    return 1;
  }

  git.setVerbose(opts.verbose);

  let result;
  try {
    result = run(path.resolve(cwd), { dryRun: opts.dryRun, branchOverride: opts.branch });
  } catch (err) {
    const detail = err.stderr ? err.stderr.toString().trim() : err.message;
    process.stderr.write(`unexpected error: ${detail}\n`);
    return EXIT_CODES.error;
  }

  process.stdout.write(`${opts.json ? log.formatJson(result) : log.formatHuman(result)}\n`);
  return exitCodeFor(result);
}

module.exports = { main, parseArgs, exitCodeFor };
