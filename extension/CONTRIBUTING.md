# Contributing to Weatherglass

Thanks for your interest in Weatherglass!

Before your first change, [`docs/onboarding.md`](docs/onboarding.md)
explains the shape of the system — how the extension loads inside the
shell and how data flows in, with diagrams.

## Branching policy

`main` is the default branch: all changes must land on a feature branch
and be merged through a pull request. Follow the monorepo worktree and
approval rules in [`../AGENTS.md`](../AGENTS.md).

```sh
git checkout -b topic/short-description   # branch off current main
# ... commit, then:
git push origin topic/short-description   # open a PR against main
```

## Development loop

Run these from the topic worktree's `extension/` directory:

- `gjs -m tools/syntax-check.mjs` — parse-gate every JS source.
- `bash install.sh` — compile schemas and sync the checkout directly
  into the user extension directory. No ZIP is needed. The installer
  stamps the installed version as 99 and clears staged EGO updates so
  an older website build does not overwrite the local build at login.
- Log out and back in to load changed JavaScript in the desktop shell.
  GJS caches modules per process; disabling/re-enabling does not reload
  code. On Xorg, restarting Shell with Alt+F2 then `r` also starts a
  fresh process; this is not supported on Wayland.
- Once loaded, Display → Panel indicator → Panel position moves the
  indicator immediately between Left, Center, Center Left, Center Right,
  and Right. Center Left and Center Right insert before or after the
  existing center-box contents; GNOME centers the combined group.
  Center retains the original Center Left behavior. Changing this
  setting needs neither reinstalling nor logging out. Position values
  are shared by runtime and preferences through the `PanelPosition`
  enum in `panel-position.js`; a test locks schema choices to that enum.

For automated UI checks without disturbing the desktop session,
`bash tools/shell-golden.sh card check all` runs the working-tree card
widgets in a disposable headless Shell. This checks the card, not the
live desktop panel placement. GNOME 50 removed the older windowed
nested backend; the repository harness uses headless virtual monitors.

Before shipping, `bash tools/certify.sh` runs the complete gate,
including packaging and a nested-session boot of the ZIP. Packaged
release installation follows the release skill, not the development
sync route above.

## Conventions

- Commit author email must stay the GitHub noreply address; no personal
  emails anywhere in the tree or history.
- Verify merged commits remain noreply-clean after landing; use the
  merge method the operator requests for the PR.
- Match the existing code style; keep comments factual and specific.
- Bump `version` in `metadata.json` (integer) with every packaged
  upload to extensions.gnome.org — except a needs-work resubmission,
  which re-uploads the same version number (it replaces the pending
  package rather than stranding the flagged one in review).

## Ideas and bugs

Open an issue on the GitHub repository first for anything larger than a
typo — design direction happens there.
