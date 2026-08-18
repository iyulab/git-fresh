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

function switchBranch(cwd, branch) {
  const switched = runGit(['switch', '--quiet', branch], { cwd, allowFailure: true });
  if (switched.ok) return true;
  return runGit(['checkout', '--quiet', branch], { cwd, allowFailure: true }).ok;
}

/**
 * Processes one submodule per SPEC 처리 순서 1–5: fetch, abort on dirty or unsafe push status,
 * switch to its target branch if not already on it (only reachable once safety has already been
 * confirmed), then update.
 *
 * `dryRun` skips the mutating switch/merge and previews instead. It can't actually check out
 * `targetBranch` to discover its real upstream without mutating, so when a switch would be
 * needed it previews against `origin/<targetBranch>` — the ref a `git switch`/`checkout` DWIM
 * checkout would track by convention. This assumes a single `origin` remote; an unconventional
 * setup would make the preview inaccurate, but the real (non-dry-run) run is unaffected, since it
 * re-resolves the upstream for real after actually switching.
 */
function processSubmodule(cwd, targetBranch, { dryRun = false } = {}) {
  runGit(['fetch', '--all', '--prune', '--quiet'], { cwd });

  if (checks.isDirty(cwd)) {
    return { ok: false, reason: 'dirty', detail: checks.getDirtyStatus(cwd) };
  }

  const safety = checks.assessBranchSafety(cwd);
  if (!safety.safe) {
    return {
      ok: false,
      reason: safety.reason,
      branch: safety.branch,
      detail: safety.reason === 'unpushed' ? checks.getUnpushedCommits(cwd, safety.upstream) : null,
    };
  }

  const wouldSwitch = safety.branch !== targetBranch;

  if (dryRun) {
    const previewUpstream = wouldSwitch ? `origin/${targetBranch}` : safety.upstream;
    return {
      branch: targetBranch,
      wouldSwitch,
      ...merge.mergeOntoUpstream(cwd, previewUpstream, { dryRun: true }),
    };
  }

  if (wouldSwitch && !switchBranch(cwd, targetBranch)) {
    return { ok: false, reason: 'branch-switch-failed', branch: targetBranch };
  }

  const upstream = checks.getUpstream(cwd);
  if (upstream === null) {
    return { ok: false, reason: 'no-upstream', branch: targetBranch };
  }

  return { branch: targetBranch, ...merge.mergeOntoUpstream(cwd, upstream) };
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
