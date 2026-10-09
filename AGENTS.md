# AGENTS.md — Weatherglass

GNOME Shell 50 weather extension (uuid `weatherglass@vijaybala.dev`,
GPL-2.0-or-later). JavaScript/GJS, Cairo painting, no build step.

## Workflow rules

1. **Feature work happens in a git worktree**, never in the main
   checkout:

   ```sh
   git worktree add ../wt/<topic> -b topic/short-name master
   # ... work, commit, verify inside that worktree
   ```

   Keep `~/projects/weatherglass` on `master` with a clean tree so the
   operator can inspect or package from it at any moment.

2. **Open a pull request only after the operator explicitly confirms.**
   Implement, verify, and report what changed and how it was verified;
   then stop. Do not push a branch to create a PR, and do not merge,
   until told to go ahead. When confirmed: `git push -u origin <branch>`,
   `gh pr create`, `gh pr merge --squash`.

3. Merging is the only way anything reaches `master` (branch protection:
   ruleset `master-branch-policy` + classic protection). Never force-push
   master, never merge without approval.

## Identity & PII (hard rules)

- Every commit: `--author="vijaybala-lang <vijaybala-lang@users.noreply.github.com>"`.
- No personal/gmail address may ever appear in commits, history, or docs;
  if one slips in, stop and escalate to the operator before more merges.
- Merge/squash commits must be verified noreply-clean after landing
  (`git log -1 --format='%ae'`).

## Verification gates (run in this order before reporting done)

```sh
bash tools/certify.sh        # THE gate: staged fast->slow and exit-0 gated
```

`certify.sh` runs, in order: syntax + import graph; the unit locks in
`tests/*.test.mjs` (color space, glyph-bar verdicts, chart slot/plateau
regressions, WMO day/night mapping, almanac, formatting, and the
`guide` lock — EGO best-practice token rules over the shipped modules,
see [BEST-PRACTICES.md](BEST-PRACTICES.md)); the scenario matrix —
every glyph pose × ground tier × day/night rendered offscreen and
**pixel-graded** by `tools/certify-pixels.py` against the contrast
each ground was promised; card previews and the coverage grid
(`tools/out/cards`, `tools/out/demo`, each glyph's family re-derived
from measured pixels); the ONLY golden lock — every golden-named
fixture rendered as REAL St widgets inside a disposable headless
gnome-shell, byte-diffed against blessed rendered truth
(`tools/shell-golden.sh`, host-gated: SKIPs without gnome-shell); and
finally `package.sh` → `zipcheck.sh` (nested-shell boot proof of the
real dist zip). Only `CERTIFIED` on its output counts as done — and
when the host-gated golden lock does run, it must have real fixtures:
a fatal probe report or zero expanded slugs is a FAIL by design,
never a silent PASS over emptiness.

- Every bug fixed gets a **named regression lock** in `tests/` —
  e.g. "the Kilimanjaro plateau keeps every hour column". Pure logic
  goes in a `*.test.mjs`; anything a screenshot could catch must also
  be representable as a matrix cell with an expected family.
- Visual changes cannot be confirmed locally: GJS caches extension
  modules per process, so toggles never reload code. Ask the operator
  for **one logout/login**, then verify from their screenshot
  (pixel forensics with PIL against measured grounds, never eyeball).
- `po/` churn from builds: `git checkout -- po/` before committing.

## Referee & palette rules (the bugs that shipped taught these)

- `lumOf()` is **WCAG (gamma-corrected) luminance**, not a plain
  channel mean: daylight grounds read ~0.3–0.7, never 0.8+. Never
  calibrate a threshold from plain-mean numbers (the v6 regression:
  a 0.62 bar in WCAG space silently made every day card "night").
  Prefer deriving gates from `pickInk` — the verdict labels get — over
  new magic numbers.
- The glyph legibility bar has **one home**: `painter.GLYPH_INK_BAR`
  re-exported as `chart.GLYPH_BAR` + `tileGlyphPale`. Menu verdict,
  chart strip, painter ink tier and the certification matrix all read
  that number — adding a fourth gate with its own constant is banned.
- Luminance sampling of composited grounds is useless (sky + glass +
  blur + fill); the day/night flag + sampled-ground referee is what
  works. Documented at `painter.groundLight()`.

## Codebase notes

- `painter.js` owns the glyph palettes and the palette referee
  (`groundLight()`): day/night flag on a sampled surface decides ink
  vs glow; `pale: true` is the caller override for dark slabs; label
  and glyph share one `pickInk` verdict per surface. Do not reintroduce
  luminance crossovers — they provably cannot survive the composited
  card.
- `menu.js` `_applyTileInk()` is the single place tile labels + glyph
  glow are judged together (hover glass / selection glass composited
  before `pickInk`). St.Button has **no** `hovered` property — hover
  tracking uses Clutter ENTER/LEAVE events into `panel._hoverDay`.
- Keep the reviewer's pet peeves away: no defensive try/catch without a
  concrete failure mode, no mojibake, no filler comments.
- GSettings `get_*` throws a GError (JS exception) when a key is absent
  from the resolved schema — the theme watcher's try/catch around
  `org.gnome.desktop.interface` is load-bearing, proven by zipcheck
  (removing it once failed the nested boot). Delete try/catch only
  around calls with a measured non-throwing contract.

## Pre-upload release review (mandatory before any EGO zip)

Before building the ZIP for extensions.gnome.org, review the full diff
since the last released version and simplify the code in its wake:

```sh
PREV=$(git tag --sort=-v:refname | head -1)        # e.g. v6
git diff "$PREV..master" --stat                     # what grew since release
tools/review-diff "$PREV" master                    # read every hunk (Meld or vimdiff)
```

1. **Justify every hunk.** Each change must trace to a user-reported
   issue or a shipped PR description. Anything you cannot explain —
   leftovers from debugging rounds, superseded experiments (e.g. a
   signal that never existed, an option whose consumer was deleted) —
   gets removed in a follow-up commit before packaging.
2. **Sweep dead & repetitive code.** Grep every exported symbol and
   module-level `const` for consumers (`grep -rn "name" *.js`); delete
   orphans. Equal or near-equal blocks in ≥2 places become a helper
   (see gjs.guide "Use Helper Functions Instead of Code Duplication").
3. **Audit against the official rules.** Apply [BEST-PRACTICES.md](BEST-PRACTICES.md)
   — our working distillation of the EGO
   [review guidelines](https://gjs.guide/extensions/review-guidelines/review-guidelines.html)
   and [best practices](https://gjs.guide/extensions/review-guidelines/best-practices.html)
   — to every file that changed since `$PREV`: lifecycle cleanup,
   process isolation, modern GJS, clean-code rules, settings/metadata
   hygiene, and ZIP contents. The token rules (no `?.` on guaranteed
   APIs, no `typeof`-function checks, silent catches, lifecycle flags,
   line length, schema hygiene, entry-point shape) are machine-enforced
   by the `guide` lock in `tests/guide.test.mjs` — this audit is the
   semantic half: what no regex can see. Fix findings in the same pass;
   escalate anything that contradicts how this extension works (e.g.
   the measured-ground referee) with a comment for the reviewer.
4. **Verify & bump:** bump `metadata.json` version by exactly one —
   unless EGO returned the SAME version as needs-work: a resubmission
   re-uploads the same number (it replaces the pending package; a bump
   would strand the flagged one in the reviewer's queue). Then run the
   full gate **on the release commit itself**: `bash tools/certify.sh`
   must print `CERTIFIED`. The upload kit (`ego-upload-notes.md`) and a
   fresh demo GIF accompany the ZIP.
5. **Manual install & live verification.** The automated gates prove
   the ZIP boots and paints headless; only a live session proves the
   card. Install the exact ZIP that will be uploaded and compile its
   schema — EGO compiles server-side but a local install ships only
   the XML, and the extension dies at first `_init` with a missing
   `gschemas.compiled` (the ERROR state then latches until the next
   session):

   ```sh
   gnome-extensions install --force dist/weatherglass@vijaybala.dev.zip
   glib-compile-schemas ~/.local/share/gnome-shell/extensions/weatherglass@vijaybala.dev/schemas
   ```

   then ask the operator for one logout/login (module cache) and have
   them walk the surface: panel + menu in dark and light theme, the
   animated / solid / accent menu styles, hover and selected tiles
   (glow family included), and the prefs dialog. Screenshot + pixel
   forensics stay the ground truth. The ZIP that gets verified must be
   byte-identical to the ZIP that gets uploaded — never verify a
   rebuild and ship a different one.

