'use strict';

const { runGit } = require('./git');
const { getHeadCommit } = require('./checks');

/** True while a merge is in progress (i.e. `MERGE_HEAD` exists). */
function isMergeInProgress(cwd) {
  return runGit(['rev-parse', '-q', '--verify', 'MERGE_HEAD'], { cwd, allowFailure: true }).ok;
}

/** Paths with unresolved conflict markers in the worktree. */
function getConflictedFiles(cwd) {
  const result = runGit(['diff', '--name-only', '--diff-filter=U'], { cwd, allowFailure: true });
  if (!result.ok || !result.stdout) return [];
  return result.stdout.split('\n').filter(Boolean);
}

/**
 * The conflict-aftermath seam (SPEC "미해결 설계 결정 1", D-01 in ROADMAP.md): what state to
 * leave the repo in after a conflicting merge. Currently implements the SPEC step-5 / bash
 * reference behavior — abort back to the pre-merge clean state. Kept as its own function, called
 * from exactly one place, so switching to "leave conflict markers for an AI agent to resolve
 * directly" (D-01's B안) is a one-line change here rather than a rewrite of `updateToTarget`.
 *
 * A no-op if there is no merge in progress (e.g. the merge attempt failed for a reason other than
 * a conflict, such as unrelated histories) — `merge --abort` itself errors in that case, which
 * would otherwise mask the real failure.
 */
function abortConflictedMerge(cwd) {
  if (isMergeInProgress(cwd)) {
    runGit(['merge', '--abort'], { cwd, allowFailure: true });
  }
}

/**
 * Updates `cwd`'s current branch to `upstream` (e.g. "origin/main"): fast-forward if possible,
 * otherwise attempt a real merge, aborting on conflict (SPEC 처리 순서 5). Callers are expected to
 * have already confirmed the repo is clean and safe to update (`checks.isDirty` /
 * `checks.assessBranchSafety`) — this function does not re-check either.
 */
function updateToTarget(cwd, upstream) {
  const ff = runGit(['merge', '--ff-only', upstream], { cwd, allowFailure: true });
  if (ff.ok) {
    return {
      ok: true, strategy: 'fast-forward', head: getHeadCommit(cwd), conflicted: null,
    };
  }

  const merge = runGit(['merge', '--no-edit', upstream], { cwd, allowFailure: true });
  if (merge.ok) {
    return {
      ok: true, strategy: 'merge', head: getHeadCommit(cwd), conflicted: null,
    };
  }

  const conflicted = getConflictedFiles(cwd);
  abortConflictedMerge(cwd);
  return {
    ok: false, strategy: null, head: null, conflicted,
  };
}

/** True if `HEAD` can reach `upstream` by fast-forwarding (i.e. `upstream` is a descendant). */
function wouldFastForward(cwd, upstream) {
  return runGit(['merge-base', '--is-ancestor', 'HEAD', upstream], { cwd, allowFailure: true }).ok;
}

/**
 * Previews a real (non-fast-forward) merge of `upstream` into `HEAD` via
 * `git merge-tree --write-tree`, which computes the result entirely in-memory — it touches
 * neither the index, the working tree, nor `HEAD`, unlike an actual `git merge`. On conflict, its
 * output lists each conflicted path three times (one per merge stage: base/ours/theirs), tab-
 * separated after the mode+blob-sha columns — parsed here rather than left unreported, since a
 * dry run should show real data, not a guess.
 */
function previewMerge(cwd, upstream) {
  const result = runGit(['merge-tree', '--write-tree', 'HEAD', upstream], { cwd, allowFailure: true });
  if (result.ok) {
    return { ok: true, conflicted: null };
  }
  if (result.status !== 1) {
    // Not a conflict (e.g. invalid ref) — nothing meaningful to report as "conflicted files".
    return { ok: false, conflicted: null };
  }
  const conflicted = [...new Set(
    result.stdout
      .split('\n')
      .map((line) => line.match(/^\d+ [0-9a-f]+ [123]\t(.+)$/))
      .filter(Boolean)
      .map((match) => match[1]),
  )];
  return { ok: false, conflicted };
}

/**
 * Non-mutating counterpart to `updateToTarget`, for `--dry-run`: reports what strategy an actual
 * update would use and whether it would succeed, touching nothing.
 */
function previewUpdate(cwd, upstream) {
  if (wouldFastForward(cwd, upstream)) {
    return {
      ok: true, strategy: 'fast-forward', conflicted: null,
    };
  }
  const preview = previewMerge(cwd, upstream);
  return {
    ok: preview.ok, strategy: preview.ok ? 'merge' : null, conflicted: preview.conflicted,
  };
}

/**
 * Shared tail of `main-repo.js#processMainRepo` and `submodules.js#processSubmodule`: given an
 * already-resolved `upstream`, either updates for real or previews (`dryRun`), and shapes the
 * result the same way either caller needs. Deliberately leaves `branch` out — the caller adds
 * it, since a main repo's is simply its current branch while a submodule's is its *target*
 * branch, which can differ from what it's currently on.
 *
 * Always includes `upstream` itself in the result — the ref this merge/preview ran against.
 * Without it, a `conflict`/`would-conflict` failure named which files but not what they conflicted
 * with, leaving an agent to infer the merge target from `branch` (main repo) or the target branch
 * (submodule) instead of being told directly.
 */
function mergeOntoUpstream(cwd, upstream, { dryRun = false } = {}) {
  if (dryRun) {
    const preview = previewUpdate(cwd, upstream);
    return {
      ok: preview.ok,
      dryRun: true,
      upstream,
      strategy: preview.strategy,
      conflicted: preview.conflicted,
      reason: preview.ok ? null : 'would-conflict',
    };
  }

  const result = updateToTarget(cwd, upstream);
  if (!result.ok) {
    return {
      ok: false, reason: 'conflict', upstream, conflicted: result.conflicted,
    };
  }
  return {
    ok: true, upstream, head: result.head, strategy: result.strategy,
  };
}

module.exports = {
  updateToTarget,
  previewUpdate,
  mergeOntoUpstream,
  isMergeInProgress,
  getConflictedFiles,
  abortConflictedMerge,
};
