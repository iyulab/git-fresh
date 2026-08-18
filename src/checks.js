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

/** The branch's configured upstream (e.g. "origin/main"), or null if unset. */
function getUpstream(cwd) {
  const result = runGit(
    ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}'],
    { cwd, allowFailure: true },
  );
  return result.ok && result.stdout ? result.stdout : null;
}

/** Count of local commits not present on `upstream`. */
function getAheadCount(cwd, upstream) {
  const result = runGit(['rev-list', '--count', `${upstream}..HEAD`], { cwd, allowFailure: true });
  if (!result.ok || !result.stdout) return 0;
  const n = Number.parseInt(result.stdout, 10);
  return Number.isNaN(n) ? 0 : n;
}

/** One-line summaries of local commits not present on `upstream`. */
function getUnpushedCommits(cwd, upstream) {
  const result = runGit(['log', '--oneline', `${upstream}..HEAD`], { cwd, allowFailure: true });
  if (!result.ok || !result.stdout) return [];
  return result.stdout.split('\n').filter(Boolean);
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

module.exports = {
  isDirty,
  getDirtyStatus,
  getCurrentBranch,
  getUpstream,
  getAheadCount,
  getUnpushedCommits,
  getHeadCommit,
  assessBranchSafety,
};
