'use strict';

const { runGit } = require('./git');
const checks = require('./checks');
const merge = require('./merge');

/**
 * Processes the top-level repo per SPEC 처리 순서 1–3 + 5. Unlike a submodule, the main repo
 * never does step 4 (branch switch) — it updates whatever branch it's currently on.
 *
 * A detached HEAD at the top level is an edge case (a user-initiated state, not the normal
 * baseline a submodule clone leaves you in) with no branch to check push status of or merge
 * against; mirrors the bash reference's behavior of warning and proceeding as-is rather than
 * treating it as an error.
 */
function processMainRepo(cwd, { dryRun = false } = {}) {
  runGit(['fetch', '--all', '--prune', '--quiet'], { cwd });

  if (checks.isDirty(cwd)) {
    return { ok: false, reason: 'dirty', detail: checks.getDirtyStatus(cwd) };
  }

  const safety = checks.assessBranchSafety(cwd);

  if (safety.detached) {
    return { ok: true, detached: true, head: checks.getHeadCommit(cwd) };
  }

  if (!safety.safe) {
    return {
      ok: false,
      reason: safety.reason,
      branch: safety.branch,
      detail: safety.reason === 'unpushed' ? checks.getUnpushedCommits(cwd, safety.upstream) : null,
    };
  }

  return { branch: safety.branch, ...merge.mergeOntoUpstream(cwd, safety.upstream, { dryRun }) };
}

module.exports = { processMainRepo };
