# git-fresh

[![npm version](https://img.shields.io/npm/v/%40iyulab%2Fgit-fresh.svg)](https://www.npmjs.com/package/@iyulab/git-fresh)
[![CI](https://github.com/iyulab/git-fresh/actions/workflows/ci.yml/badge.svg)](https://github.com/iyulab/git-fresh/actions/workflows/ci.yml)
[![license](https://img.shields.io/npm/l/%40iyulab%2Fgit-fresh.svg)](LICENSE)

Bring a git repo and all its submodules — recursively — to a fresh, up-to-date state against
their remotes. If anything could lose local work, git-fresh stops immediately instead of guessing.

## Why

Submodule-heavy workflows tend to accumulate small, easy-to-miss risks: a submodule left on the
wrong branch, a commit that was never pushed, a merge that silently produced conflict markers deep
in a tree you weren't looking at. git-fresh's only job is to notice those risks and stop — it
never guesses, and it never leaves a repo in a state you didn't ask for.

- **Safe by construction** — updates a repo only once it's proven there's nothing to lose:
  no uncommitted changes, no unpushed commits, no unverifiable push status.
- **Recursive** — walks the main repo and every submodule, including submodules of submodules,
  each against its own configured branch and remote.
- **Zero runtime dependencies**, plain Node.js. Every git command runs through `execFile`
  (never a shell), so there's no shell-injection surface to worry about.
- **Scriptable** — a distinct exit code per failure reason and a `--json` output mode, so CI or
  an automated agent can branch on *why* a run stopped without parsing text.

## Install

```sh
npx @iyulab/git-fresh
```

or install it globally:

```sh
npm install --global @iyulab/git-fresh
```

## Quick start

Run it with no arguments from anywhere inside a repo (or one of its submodules):

```sh
git-fresh
```

A clean repo with nothing to update:

```
✔ [main] main — updated (fast-forward) -> a1b2c3d
done: fresh.
```

git-fresh stops the moment it finds something it can't safely resolve on its own — for example,
a commit that hasn't been pushed yet:

```
✖ [main] unpushed (main)
  2fbabd8 work in progress
stopped — see above for where and why.
```

Not sure what a run would do? `--dry-run` shows it without changing anything:

```sh
git-fresh --dry-run
```
```
✔ [main] main — would fast-forward or merge
dry run — no changes were made.
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

### What it actually does

For the main repo, then every submodule (recursively), git-fresh:

1. Fetches the remote (refs only — never touches the working tree).
2. Stops if there are uncommitted changes.
3. Stops if the current branch has commits that aren't pushed, or has no upstream configured at
   all (an unverifiable push status is treated as unsafe, not as safe).
4. For a submodule only: switches to its configured target branch, but only once steps 2–3 have
   confirmed that's safe to do.
5. Updates: fast-forwards if possible, otherwise attempts a real merge — and if that merge would
   conflict, aborts it and stops rather than leaving conflict markers behind.

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

## Requirements

Node.js 20 or later, and `git` on `PATH`.

## Development

```sh
git clone https://github.com/iyulab/git-fresh.git
cd git-fresh
npm install
npm test        # node:test — spins up real throwaway git repos, no mocks
npm run lint     # eslint
```

There are no build steps — `src/` is run directly. Pull requests are welcome; please make sure
`npm test` and `npm run lint` pass first.

## License

MIT — see [LICENSE](LICENSE).
