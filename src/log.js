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

/** Human-readable multi-line report for a `run()` result (see `run.js`). */
function formatHuman(runResult) {
  const lines = [formatEntry('main', runResult.main)];
  for (const sub of runResult.submodules) {
    lines.push(formatEntry(sub.label, sub));
  }
  if (runResult.ok) {
    lines.push(green(runResult.main.dryRun ? 'dry run — no changes were made.' : 'done: fresh.'));
  } else {
    lines.push(red('stopped — see above for where and why.'));
  }
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

module.exports = { formatHuman, formatJson };
