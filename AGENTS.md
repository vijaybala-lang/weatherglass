# AGENTS.md — WeatherGlass (app + extension monorepo)

Rules for AI agents working in this repository. Read before writing anything.

## Scope routing

This root file owns monorepo workflow: worktrees, branch base, identity,
push/merge approval, and cleanup. Extension work must also follow
[extension/AGENTS.md](extension/AGENTS.md) for extension-specific
verification gates, codebase rules, and pre-upload release review. If a
workflow rule conflicts, this root file wins; if an extension-specific
technical rule conflicts, the extension file wins.

## Common tasks & entry points

| Task | Canonical entry point / guide |
|------|-------------------------------|
| Install extension locally for live testing | [`extension/install.sh`](extension/install.sh) — compiles schemas, syncs into `~/.local/share/gnome-shell/extensions/weatherglass@vijaybala.dev/`, stamps `"version": 99`, and clears `extension-updates/` so GNOME Shell's session-start EGO updater never overwrites local builds with an older EGO serial on login |
| Cut, certify, or install a release | [`extension/skills/weatherglass-release/SKILL.md`](extension/skills/weatherglass-release/SKILL.md) — mandatory reading before any version bump, `certify.sh` run, or release install |
| Full extension certification gate | [`extension/tools/certify.sh`](extension/tools/certify.sh) (host shell) and [`extension/tools/certify-all-shells.sh`](extension/tools/certify-all-shells.sh) (all declared Shell majors) |
| Headless GNOME Shell goldens & UI captures | [`extension/tools/shell-golden.sh`](extension/tools/shell-golden.sh) (`card check` / `card bless`) and fixtures in [`extension/tools/harness/probe@vijaybala.dev/card-mode.js`](extension/tools/harness/probe@vijaybala.dev/card-mode.js) |
| Rebuild i18n catalogs (`po/*.po` → `locale/*.mo`) | [`extension/tools/i18n-build.sh`](extension/tools/i18n-build.sh) |
| Check design & canvas parity (`extension` ↔ `shared/art` ↔ `app`) | `python3 scripts/check-design-parity.py` ([`scripts/check-design-parity.py`](scripts/check-design-parity.py)) |
| Cast demo video / transition GIFs | [`extension/skills/weatherglass-demo/SKILL.md`](extension/skills/weatherglass-demo/SKILL.md) and [`extension/tools/film.sh`](extension/tools/film.sh) |

## Worktree discipline (mandatory)

**Never write code in this main checkout.** It is the deployment tree: the
launcher (`~/.local/bin/weatherglass`), the desktop entry, and the running
instance all point here. Edits in-place mutate the live app mid-run and dirty
the tree operators rely on being clean.

Before any code change:

1. `git fetch` (once `origin` is pushed; otherwise branch from local `main`)
2. Create a topic-branch worktree and work there:
   ```bash
   git worktree add ../wg-work/<slug> -b <slug> main
   ```
3. Do all editing, testing (`gjs -m app/tests/*.js`), and committing there.
   To run the app FROM the worktree, launch it explicitly
   (`gjs -m <worktree>/app/src/main.js` or a temp launcher) — do not
   repoint `~/.local/bin/weatherglass` at a worktree.
4. Merge/fast-forward into `main` in this checkout only when the suite is
   green, and leave the main checkout clean (`git status --porcelain` empty).
5. Remove the worktree after merging: `git worktree remove ../wg-work/<slug>`

Exceptions requiring the operator's explicit OK (not self-service): docs-only
typo fixes, and emergency patches the operator directs onto the live tree.

## Identity & PII (repo-wide hard rules)

- Every commit uses
  `--author="vijaybala-lang <vijaybala-lang@users.noreply.github.com>"`.
- No personal/gmail address may ever appear in commits, history, or docs;
  if one slips in, stop and escalate to the operator before more merges.
- Merge/squash commits must be verified noreply-clean after landing
  (`git log -1 --format='%ae'`).

## Verification culture (learned the hard way here)

- Batch-heredoc file writes have reported success while writing nothing —
  re-verify every scripted edit with grep/read.
- A gate you have not watched FAIL is a rumor: tamper-test new checks.
- Before UI test suites: `kill $(pgrep -x gjs)` (a running app absorbs the
  single-instance handshake and the suite silently passes on nothing).
- Design tokens flow extension → `shared/art` → app mirrors; run
  `python3 scripts/check-design-parity.py` after touching art/painter/moon.

## Do not push

Remotes stay unpushed until the operator says the word. Local commits only.
