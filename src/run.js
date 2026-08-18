'use strict';

const mainRepo = require('./main-repo');
const submodules = require('./submodules');

/**
 * Composes the full run: the top-level repo, then — only if it succeeded — every submodule
 * recursively. Stops without ever touching submodules if the main repo fails, matching SPEC's
 * per-repo independence (a repo is only processed once its predecessor in the walk has
 * succeeded).
 *
 * `initSubmodules` (checking each submodule out to the commit its parent currently has pinned)
 * always runs, even under `dryRun` — it's what makes an uninitialized submodule exist on disk to
 * preview at all, and is a no-op for one already at its pinned commit (the common case). What
 * `dryRun` actually skips is the branch switch and the merge/update themselves.
 *
 * `onEntry`, if given, is called with `{ label, ...result }` for the main repo and then for each
 * submodule as soon as its own result is known, before the rest of the tree is processed — see
 * `submodules.js#processSubmodulesRecursive`'s doc comment for why a caller would want this
 * instead of just using the returned object once `run()` resolves.
 */
function run(cwd, {
  dryRun = false, branchOverride, onEntry,
} = {}) {
  const main = mainRepo.processMainRepo(cwd, { dryRun });
  if (onEntry) onEntry({ label: 'main', ...main });
  if (!main.ok) {
    return { ok: false, main, submodules: [] };
  }

  submodules.initSubmodules(cwd);
  const submoduleResults = submodules.processSubmodulesRecursive(cwd, {
    branchOverride, dryRun, onEntry,
  });

  return {
    ok: submoduleResults.every((r) => r.ok),
    main,
    submodules: submoduleResults,
  };
}

module.exports = { run };
