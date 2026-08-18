'use strict';

const path = require('node:path');
const { runGit } = require('./git');
const checks = require('./checks');
const merge = require('./merge');

/** Checks out every submodule (recursively) at the commit its parent repo has pinned. */
function initSubmodules(cwd) {
  runGit(['submodule', 'update', '--init', '--recursive', '--quiet'], { cwd });
}

/**
 * This repo's direct (non-recursive) submodule entries, read from its own `.gitmodules` — never
 * the caller's. Each nested submodule resolves its target branch from its own `.gitmodules` when
 * `processSubmodulesRecursive` descends into it, which is what makes plain JS recursion (rather
 * than `git submodule foreach --recursive`) the right shape here (see `02-ARCHITECTURE.md`: the
 * bash reference's shell-string-into-foreach approach had real quoting problems).
 */
function listSubmoduleEntries(cwd) {
  const result = runGit(
    ['config', '-f', '.gitmodules', '--get-regexp', '^submodule\\..*\\.path$'],
    { cwd, allowFailure: true },
  );
  if (!result.ok || !result.stdout) return [];

  return result.stdout.split('\n').filter(Boolean).map((line) => {
    const match = line.match(/^submodule\.(.+)\.path (.+)$/);
    if (!match) return null;
    const [, name, relativePath] = match;

    const branchResult = runGit(
      ['config', '-f', '.gitmodules', `submodule.${name}.branch`],
      { cwd, allowFailure: true },
    );
    const branch = branchResult.ok && branchResult.stdout ? branchResult.stdout : 'main';

    return { name, path: relativePath, branch };
  }).filter(Boolean);
}

/**
 * True if `candidatePath` (resolved relative to `parentDir`) stays inside `parentDir`. Guards
 * against a malicious or compromised `.gitmodules` naming a path like `../../../etc` — a known
 * real class of git submodule vulnerability. git itself validates this for its own submodule
 * commands; `listSubmoduleEntries` parses `.gitmodules` independently of those, so it needs its
 * own check rather than trusting the file's content is well-formed.
 */
function isPathContained(parentDir, candidatePath) {
  const relative = path.relative(path.resolve(parentDir), path.resolve(parentDir, candidatePath));
  return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative);
}

/**
 * Returns `{ ok: true }` on success, or `{ ok: false, stderr }` on failure — `stderr` is the
 * fallback `checkout` attempt's own error text (e.g. "pathspec '<branch>' did not match any
 * file(s) known to git" when `.gitmodules` names a branch that no longer exists), the only
 * evidence available for *why* a switch that reached this point still failed. Without it,
 * `branch-switch-failed` was the one failure reason with no `detail` — an AI agent resuming from
 * this stop had a reason string and nothing to diagnose it with.
 */
function switchBranch(cwd, branch) {
  const switched = runGit(['switch', '--quiet', branch], { cwd, allowFailure: true });
  if (switched.ok) return { ok: true };
  const checkedOut = runGit(['checkout', '--quiet', branch], { cwd, allowFailure: true });
  return checkedOut.ok ? { ok: true } : { ok: false, stderr: checkedOut.stderr };
}

/**
 * Processes one submodule per SPEC 처리 순서 1–5: fetch, abort on dirty or unsafe push status,
 * switch to its target branch if not already on it (only reachable once safety has already been
 * confirmed), then update.
 *
 * `dryRun` skips the mutating switch/merge and previews instead. When `targetBranch` already
 * exists locally, `assessLocalBranchSafety` reads its real upstream and push status without
 * checking it out, so the preview is exact. Only when `targetBranch` doesn't exist locally yet
 * does it fall back to previewing against `origin/<targetBranch>` — the ref a `git switch`/
 * `checkout` DWIM checkout would track by convention, since there's no local branch to query.
 * That fallback assumes a single `origin` remote; an unconventional setup would make the preview
 * inaccurate, but the real (non-dry-run) run is unaffected either way, since it re-resolves the
 * upstream for real after actually switching.
 *
 * The first `assessBranchSafety` call below judges the branch this submodule is *currently* on —
 * not `targetBranch` when a switch is needed. A target branch that already exists locally (left
 * over from earlier work in this submodule, or restored by `initSubmodules`) can carry its own
 * unpushed commits that the pre-switch check never saw. Both the real run (re-running
 * `assessBranchSafety` after actually switching) and the `dryRun` preview (via
 * `assessLocalBranchSafety`, below) close that gap — without it, a branch with unpushed local
 * commits would be fast-forwarded straight past, or previewed as if it would be, exactly the
 * state this tool exists to stop on.
 */
function processSubmodule(cwd, targetBranch, { dryRun = false } = {}) {
  runGit(['fetch', '--all', '--prune', '--quiet'], { cwd });

  if (checks.isDirty(cwd)) {
    return { ok: false, reason: 'dirty', detail: checks.getDirtyStatus(cwd) };
  }

  const safety = checks.assessBranchSafety(cwd);
  if (!safety.safe) {
    return checks.describeUnsafeBranch(cwd, safety);
  }

  const wouldSwitch = safety.branch !== targetBranch;

  if (dryRun) {
    if (!wouldSwitch) {
      return {
        branch: targetBranch,
        wouldSwitch,
        ...merge.mergeOntoUpstream(cwd, safety.upstream, { dryRun: true }),
      };
    }

    // targetBranch may already exist locally (e.g. left over from earlier work in this
    // submodule) with its own unpushed commits — assessLocalBranchSafety judges *that* branch
    // without checking it out, closing the same blind spot the real (non-dry-run) path closed
    // above. If it doesn't exist locally yet, a real switch would create it fresh tracking a
    // remote branch, so fall back to the origin/<targetBranch> DWIM convention.
    const localTargetSafety = checks.assessLocalBranchSafety(cwd, targetBranch);
    if (localTargetSafety && !localTargetSafety.safe) {
      return {
        ...checks.describeUnsafeBranch(cwd, localTargetSafety), wouldSwitch, dryRun: true,
      };
    }
    const previewUpstream = localTargetSafety ? localTargetSafety.upstream : `origin/${targetBranch}`;
    return {
      branch: targetBranch,
      wouldSwitch,
      ...merge.mergeOntoUpstream(cwd, previewUpstream, { dryRun: true }),
    };
  }

  if (!wouldSwitch) {
    return { branch: targetBranch, ...merge.mergeOntoUpstream(cwd, safety.upstream) };
  }

  const switched = switchBranch(cwd, targetBranch);
  if (!switched.ok) {
    return {
      ok: false, reason: 'branch-switch-failed', branch: targetBranch, detail: switched.stderr,
    };
  }

  const targetSafety = checks.assessBranchSafety(cwd);
  if (!targetSafety.safe) {
    return checks.describeUnsafeBranch(cwd, targetSafety);
  }

  return { branch: targetBranch, ...merge.mergeOntoUpstream(cwd, targetSafety.upstream) };
}

/**
 * Walks this repo's submodules depth-first. Stops at, and does not descend past, the first
 * failing submodule — later siblings and nested submodules of already-processed ones are left
 * untouched, per SPEC: "어느 한 단계에서든 실패하면 그 시점에서 전체 프로세스를 중단[하고]...
 * 이미 처리된 앞선 저장소는 그대로 두고... 아직 처리 안 된 나머지는 건드리지 않는다."
 *
 * `branchOverride` forces every submodule at every depth onto the same branch, ignoring each
 * level's own `.gitmodules` (CLI `--branch`). `dryRun` previews instead of mutating.
 */
function processSubmodulesRecursive(cwd, {
  branchOverride, labelPrefix = '', dryRun = false,
} = {}) {
  const results = [];

  for (const entry of listSubmoduleEntries(cwd)) {
    const label = labelPrefix ? `${labelPrefix}/${entry.path}` : entry.path;

    if (!isPathContained(cwd, entry.path)) {
      results.push({
        label,
        ok: false,
        reason: 'unsafe-path',
        detail: `.gitmodules path '${entry.path}' escapes the repo — refusing to follow it`,
      });
      return results;
    }

    const targetBranch = branchOverride || entry.branch;
    const submoduleCwd = path.join(cwd, entry.path);

    const result = processSubmodule(submoduleCwd, targetBranch, { dryRun });
    results.push({ label, ...result });
    if (!result.ok) return results;

    const nested = processSubmodulesRecursive(submoduleCwd, {
      branchOverride, labelPrefix: label, dryRun,
    });
    results.push(...nested);
    if (nested.length > 0 && !nested[nested.length - 1].ok) return results;
  }

  return results;
}

module.exports = {
  initSubmodules, listSubmoduleEntries, processSubmodule, processSubmodulesRecursive,
};
