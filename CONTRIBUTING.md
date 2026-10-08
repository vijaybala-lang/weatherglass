# Contributing to Weatherglass

Thanks for your interest in Weatherglass!

## Branching policy

`master` is protected: all changes must land on a feature branch and be
merged through a pull request. Direct pushes to `master` are rejected by
a repository ruleset (no approvals required — a PR alone is enough to
merge).

```sh
git checkout -b topic/short-description   # branch off current master
# ... commit, then:
git push origin topic/short-description   # open a PR against master
```

## Development loop

- `gjs -m tools/syntax-check.mjs` — parse-gate every JS source.
- `bash tools/package.sh` — build `dist/*.zip` and run the zipcheck,
  which installs the packaged extension in a nested session and boots
  it; it is the real gate before shipping.
- `gnome-extensions install --force dist/weatherglass@vijaybala.dev.zip`
  then log out and back in (GJS caches modules per session).

## Conventions

- Commit author email must stay the GitHub noreply address; no personal
  emails anywhere in the tree or history.
- PRs land via **squash merge** (`gh pr merge --squash`): GitHub stamps
  a plain merge commit with the account's primary email as author,
  which leaks into history even when every commit is clean; a squash
  commit keeps the commits' own (noreply) author instead.
- Match the existing code style; keep comments factual and specific.
- Bump `version` in `metadata.json` (integer) with every packaged
  upload to extensions.gnome.org.

## Ideas and bugs

Open an issue on the GitHub repository first for anything larger than a
typo — design direction happens there.
