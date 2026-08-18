'use strict';

const { runGit } = require('./git');

/** True if the worktree has staged or unstaged changes to tracked files. */
function isDirty(cwd) {
  const { stdout } = runGit(['status', '--porcelain', '--untracked-files=no'], { cwd });
  return stdout.length > 0;
}

/** Human-readable dirty status, for error reporting. */
function getDirtyStatus(cwd) {
  return runGit(['status', '--short'], { cwd }).stdout;
}

/** Current branch name, or null when HEAD is detached. */
function getCurrentBranch(cwd) {
  const result = runGit(['symbolic-ref', '--quiet', '--short', 'HEAD'], { cwd, allowFailure: true });
  return result.ok && result.stdout ? result.stdout : null;
}

/**
 * `ref`'s configured upstream (e.g. "origin/main"), or null if unset. `ref` defaults to `HEAD`
 * (the currently checked-out branch); passing a branch name checks *that* branch's upstream
 * without checking it out, which `assessLocalBranchSafety` uses to preview a branch git-fresh
 * hasn't switched onto (yet, or at all, under `--dry-run`).
 */
function getUpstream(cwd, ref = 'HEAD') {
  const result = runGit(
    ['rev-parse', '--abbrev-ref', '--symbolic-full-name', `${ref}@{u}`],
    { cwd, allowFailure: true },
  );
  return result.ok && result.stdout ? result.stdout : null;
}

/** Count of `ref`'s local commits not present on `upstream`. `ref` defaults to `HEAD`. */
function getAheadCount(cwd, upstream, ref = 'HEAD') {
  const result = runGit(['rev-list', '--count', `${upstream}..${ref}`], { cwd, allowFailure: true });
  if (!result.ok || !result.stdout) return 0;
  const n = Number.parseInt(result.stdout, 10);
  return Number.isNaN(n) ? 0 : n;
}

/** One-line summaries of `ref`'s local commits not present on `upstream`. `ref` defaults to `HEAD`. */
function getUnpushedCommits(cwd, upstream, ref = 'HEAD') {
  const result = runGit(['log', '--oneline', `${upstream}..${ref}`], { cwd, allowFailure: true });
  if (!result.ok || !result.stdout) return [];
  return result.stdout.split('\n').filter(Boolean);
}

/** True if `branch` exists as a local branch, whether or not it's currently checked out. */
function branchExistsLocally(cwd, branch) {
  return runGit(
    ['show-ref', '--verify', '--quiet', `refs/heads/${branch}`],
    { cwd, allowFailure: true },
  ).ok;
}

/** Short hash of the current HEAD commit. */
function getHeadCommit(cwd) {
  return runGit(['rev-parse', '--short', 'HEAD'], { cwd }).stdout;
}

/**
 * Judges whether it is safe to move this repo (leave it, or switch it to a
 * target branch) without risking loss of local work. Does not check for
 * dirty state — callers are expected to have already aborted on `isDirty`.
 *
 * Detached HEAD is treated as safe on its own: it has no branch name to lose
 * push-status of, and is the normal state a fresh `--recurse-submodules`
 * clone leaves a submodule in (SPEC's "no upstream => unsafe" rule targets
 * named local-only branches, not this baseline case).
 */
function assessBranchSafety(cwd) {
  const branch = getCurrentBranch(cwd);

  if (branch === null) {
    return {
      branch: null, detached: true, upstream: null, ahead: null, safe: true, reason: null,
    };
  }

  const upstream = getUpstream(cwd);
  if (upstream === null) {
    return {
      branch, detached: false, upstream: null, ahead: null, safe: false, reason: 'no-upstream',
    };
  }

  const ahead = getAheadCount(cwd, upstream);
  if (ahead > 0) {
    return {
      branch, detached: false, upstream, ahead, safe: false, reason: 'unpushed',
    };
  }

  return {
    branch, detached: false, upstream, ahead: 0, safe: true, reason: null,
  };
}

/**
 * Non-mutating counterpart to `assessBranchSafety`, for judging a *different* local branch than
 * the one currently checked out — the case `assessBranchSafety` can't cover, since it only ever
 * reads `HEAD`. Used to preview a submodule's target branch under `--dry-run` without checking it
 * out: a branch that already exists locally can carry its own unpushed commits regardless of
 * whether anything is currently checked out onto it.
 *
 * Returns `null` if `branch` doesn't exist locally at all — nothing to judge, since a real switch
 * would create it fresh, tracking a remote branch, with nothing local yet to have gone unpushed.
 */
function assessLocalBranchSafety(cwd, branch) {
  if (!branchExistsLocally(cwd, branch)) return null;

  const upstream = getUpstream(cwd, branch);
  if (upstream === null) {
    return {
      branch, upstream: null, ahead: null, safe: false, reason: 'no-upstream',
    };
  }

  const ahead = getAheadCount(cwd, upstream, branch);
  if (ahead > 0) {
    return {
      branch, upstream, ahead, safe: false, reason: 'unpushed',
    };
  }

  return {
    branch, upstream, ahead: 0, safe: true, reason: null,
  };
}

/**
 * Shapes an unsafe `assessBranchSafety`/`assessLocalBranchSafety` result into the
 * `{ ok: false, reason, branch, detail }` failure `main-repo.js`/`submodules.js` return — pulling
 * the unpushed-commit evidence (against `safety.branch`, not always `HEAD` — the two composites
 * above agree on that field either way) only when the reason calls for it. Callers must have
 * already checked `!safety.safe`.
 */
function describeUnsafeBranch(cwd, safety) {
  return {
    ok: false,
    reason: safety.reason,
    branch: safety.branch,
    detail: safety.reason === 'unpushed' ? getUnpushedCommits(cwd, safety.upstream, safety.branch) : null,
  };
}

module.exports = {
  isDirty,
  getDirtyStatus,
  getCurrentBranch,
  getUpstream,
  getAheadCount,
  getUnpushedCommits,
  getHeadCommit,
  branchExistsLocally,
  assessBranchSafety,
  assessLocalBranchSafety,
  describeUnsafeBranch,
};
