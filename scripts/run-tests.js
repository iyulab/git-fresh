'use strict';

// Runs the suite via an explicit file list instead of `node --test "test/**/*.test.js"`.
// That glob-as-CLI-argument form only works on Node >=21 (nodejs/node's test runner added glob
// support there); this project's own `engines.node` floor is 20, and CI pins exactly Node 20 —
// so the glob form silently fails there ("Could not find '.../test/**/*.test.js'"), passing only
// on a dev machine that happens to run a newer Node. A bare `node --test test/` isn't a safe
// substitute either: it throws MODULE_NOT_FOUND on Windows. Walking the directory ourselves in
// plain JS avoids both — no shell glob expansion (platform-dependent) and no reliance on Node's
// own glob-arg parsing (version-dependent).
//
// `execFileSync` (never a shell), matching `src/git.js#runGit`'s reasoning: arguments are passed
// as an array, so there is no shell-injection surface here either.

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const testDir = path.join(__dirname, '..', 'test');

/** Every `*.test.js` file under `dir`, recursively — excludes helpers like `test/fixtures/`. */
function collectTestFiles(dir) {
  const files = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectTestFiles(full));
    } else if (entry.isFile() && entry.name.endsWith('.test.js')) {
      files.push(full);
    }
  }
  return files;
}

// `npm test -- test/checks.test.js` runs just that file; with no extra args, the full suite.
const explicit = process.argv.slice(2);
const files = explicit.length > 0 ? explicit : collectTestFiles(testDir);

if (files.length === 0) {
  process.stderr.write(`No test files found under ${testDir}\n`);
  process.exit(1);
}

try {
  execFileSync(process.execPath, ['--test', ...files], { stdio: 'inherit' });
} catch (err) {
  process.exit(typeof err.status === 'number' ? err.status : 1);
}
