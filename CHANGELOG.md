# @iyulab/git-fresh

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
