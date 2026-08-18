---
"@iyulab/git-fresh": patch
---

Print each repo's result as soon as it's known, instead of buffering the whole report until the
run finishes. Previously, a run over a tree with many submodules produced no terminal output at
all until every repo had been processed — indistinguishable from a hang. `--json` output is
unchanged (still one parseable result printed once the run completes).
