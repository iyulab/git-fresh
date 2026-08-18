# @iyulab/git-fresh

## 0.1.2

### Patch Changes

- 17c5627: Print each repo's result as soon as it's known, instead of buffering the whole report until the
  run finishes. Previously, a run over a tree with many submodules produced no terminal output at
  all until every repo had been processed — indistinguishable from a hang. `--json` output is
  unchanged (still one parseable result printed once the run completes).

## 0.1.1

### Patch Changes

- f098d94: Fix a safety gap in submodule branch switching: when switching a submodule onto its configured
  target branch, git-fresh now re-verifies push safety on the branch it actually switched onto
  (both for a real run and under `--dry-run`), not only the branch it switched from. Previously, a
  target branch that already existed locally with its own unpushed commits could be silently
  fast-forwarded or merged past instead of being reported.
  
  Also enriches stop output for easier diagnosis: `branch-switch-failed` now includes the
  underlying git error, and `conflict`/`would-conflict` results always report which upstream ref
  they ran against.
