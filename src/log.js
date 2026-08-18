'use strict';

function colorize(code, text) {
  return process.stdout.isTTY ? `\x1b[${code}m${text}\x1b[0m` : text;
}

const red = (s) => colorize('31', s);
const green = (s) => colorize('32', s);

function reasonDetail(result) {
  switch (result.reason) {
    case 'dirty':
      return result.detail || '';
    case 'unpushed':
      return Array.isArray(result.detail) ? result.detail.join('\n') : '';
    case 'no-upstream':
      return `branch '${result.branch}' has no upstream configured (push status can't be verified)`;
    case 'branch-switch-failed':
      return result.detail
        ? `could not switch to '${result.branch}':\n${result.detail}`
        : `could not switch to '${result.branch}'`;
    case 'unsafe-path':
      return result.detail || '';
    case 'conflict':
    case 'would-conflict': {
      const against = result.upstream ? `against ${result.upstream}\n` : '';
      return Array.isArray(result.conflicted) && result.conflicted.length > 0
        ? `${against}conflicted files:\n${result.conflicted.map((f) => `  ${f}`).join('\n')}`
        : `${against}conflict (specific files unknown — preview only)`;
    }
    default:
      return '';
  }
}

function indent(text) {
  return text.split('\n').map((line) => `  ${line}`).join('\n');
}

function formatEntry(label, result) {
  if (result.ok) {
    if (result.detached) {
      return green(`✔ [${label}] detached HEAD, left as-is -> ${result.head}`);
    }
    const verb = result.dryRun ? 'would fast-forward or merge' : `updated (${result.strategy})`;
    const head = result.dryRun ? '' : ` -> ${result.head}`;
    return green(`✔ [${label}] ${result.branch} — ${verb}${head}`);
  }

  const branchSuffix = result.branch ? ` (${result.branch})` : '';
  const header = red(`✖ [${label}] ${result.reason}${branchSuffix}`);
  const detail = reasonDetail(result);
  return detail ? `${header}\n${indent(detail)}` : header;
}

/** The trailing summary line `formatHuman` and streamed output both end on. */
function formatSummary(runResult) {
  if (runResult.ok) {
    return green(runResult.main.dryRun ? 'dry run — no changes were made.' : 'done: fresh.');
  }
  return red('stopped — see above for where and why.');
}

/**
 * Human-readable multi-line report for a *complete* `run()` result (see `run.js`). Building the
 * whole report only once everything has finished is fine for tests and for `--json` mode, but
 * `cli.js` does not use this for its default human-readable output — a run over many submodules
 * can take a while, and printing nothing at all until the very end is indistinguishable from a
 * hang. `cli.js` instead streams each entry via `formatEntry` as `run()`'s `onEntry` callback
 * fires, then prints `formatSummary` once at the end; this function stays for anything (tests,
 * potential future callers) that wants the whole report as one string.
 */
function formatHuman(runResult) {
  const lines = [formatEntry('main', runResult.main)];
  for (const sub of runResult.submodules) {
    lines.push(formatEntry(sub.label, sub));
  }
  lines.push(formatSummary(runResult));
  return lines.join('\n');
}

/**
 * JSON report for a `run()` result. Schema is provisional (ROADMAP.md "Pending Human Decisions"
 * D-02 — the failure-reporting shape hasn't been confirmed by a human yet); this is the raw
 * `run()` result structure, not a hand-designed wire format.
 */
function formatJson(runResult) {
  return JSON.stringify(runResult, null, 2);
}

module.exports = {
  formatEntry, formatSummary, formatHuman, formatJson,
};
