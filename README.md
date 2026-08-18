# git-fresh

Bring a git repo and all its submodules — recursively — to a fresh, up-to-date state against
their remotes. If anything could lose local work, git-fresh stops immediately instead of guessing.

## What it does

For the main repo, then every submodule (recursively), git-fresh:

1. Fetches the remote (refs only — never touches the working tree).
2. Stops if there are uncommitted changes.
3. Stops if the current branch has commits that aren't pushed, or has no upstream configured at
   all (an unverifiable push status is treated as unsafe, not as safe).
4. For a submodule only: switches to its configured target branch, but only once steps 2–3 have
   confirmed that's safe to do.
5. Updates: fast-forwards if possible, otherwise attempts a real merge — and if that merge would
   conflict, aborts it and stops rather than leaving conflict markers behind.

Any stop reports exactly which repo, and why (`dirty` / `unpushed` / `no-upstream` / `conflict`),
with a distinct exit code for each so scripts and CI don't have to parse text.

## Install

```sh
npx @iyulab/git-fresh
```

or install it globally:

```sh
npm install --global @iyulab/git-fresh
```

## Usage

```
git-fresh [options]

  --dry-run          Show what would happen without changing anything
  --branch <name>    Force this branch for every submodule, ignoring .gitmodules
  --yes, -y          Accepted for CI scripts; currently a no-op — git-fresh only
                     ever acts once a step is already confirmed safe
  --verbose          Print each underlying git command before it runs
  --json             Print the result as JSON instead of a human-readable report
  --version          Print the installed version and exit
  --help             Print this help and exit
```

Each submodule's target branch comes from `.gitmodules`'s `submodule.<name>.branch`, defaulting
to `main` when unset.

### Exit codes

| Code | Meaning |
| --- | --- |
| `0` | Everything is fresh (or, under `--dry-run`, would update cleanly). |
| `1` | An unexpected error, or a failure reason not covered below. |
| `10` | A repo has uncommitted changes. |
| `11` | A repo has commits that haven't been pushed. |
| `12` | A repo's current branch has no upstream configured. |
| `13` | An update would produce (or did produce) a merge conflict. |
| `14` | Switching a submodule to its target branch failed. |
| `15` | A submodule's `.gitmodules` path would escape the repo; refused rather than followed. |

### `--json` output

```sh
git-fresh --json
```

prints the full result as JSON instead of the human-readable report — useful for CI or for an
automated agent to branch on. Its exact shape is still settling as the tool matures; treat it as
provisional until this note is removed.

## Why

Submodule-heavy workflows tend to accumulate small, easy-to-miss risks: a submodule left on the
wrong branch, a commit that was never pushed, a merge that silently produced conflict markers deep
in a tree you weren't looking at. git-fresh's only job is to notice those risks and stop — it
never guesses, and it never leaves a repo in a state you didn't ask for.

## License

MIT
