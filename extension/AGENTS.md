# AGENTS.md — Weatherglass

GNOME Shell 45-50 weather extension (uuid `weatherglass@vijaybala.dev`,
GPL-2.0-or-later). JavaScript/GJS, Cairo painting, no build step.

## Workflow rules

Monorepo workflow lives in [../AGENTS.md](../AGENTS.md) and wins on
worktrees, branch base (`main`), identity, push/merge approval, and
cleanup. Do extension work in a topic-branch worktree from `main`; do
not push, open a pull request, or merge until the operator explicitly
says to. This file keeps only the extension-specific verification,
codebase, and release-review rules below.

## Identity & PII

Follow the repo-wide identity and PII hard rules in
[../AGENTS.md](../AGENTS.md) for every commit, merge, and release note.

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
(`tools/shell-golden.sh`, host-gated: SKIPs without gnome-shell);
finally `package.sh` → `zipcheck.sh` (nested-shell boot proof of the
real dist zip) and `shexli-check.sh` (the review engine EGO itself
runs -- host-gated; its exit code is a lie, the gate reads its JSON). Only `CERTIFIED` on its output counts as done for the host shell — and
when the host-gated golden lock does run, it must have real fixtures:
a fatal probe report or zero expanded slugs is a FAIL by design,
never a silent PASS over emptiness. A release ZIP additionally owes
the all-declared-shells certification owned by the release skill:
host green alone never proves the older majors in `shell-version`.

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
since the last released version and simplify the code in its wake
(the anchor is the commit whose bytes last shipped — ancestor-verified,
never the newest tag blindly — then read every hunk side-by-side; the
built artifact is additionally diffed against the zip EGO currently
serves. The commands are skill steps 0 and 2):

1. **Justify every hunk.** Each change must trace to a user-reported
   issue or a shipped PR description. Anything you cannot explain —
   leftovers from debugging rounds, superseded experiments (e.g. a
   signal that never existed, an option whose consumer was deleted) —
   gets removed in a follow-up commit before packaging.
2. **Sweep dead & repetitive code.** Every exported symbol,
   module-level `const`, and import must have a consumer — the sweep
   is a maintained tool (`tools/dead-code-sweep.py`, skill step 0),
   not a hand grep: the hand version covered only declaration-form
   exports and shipped a dead const plus an unused import for
   multiple releases. Delete orphans. Equal or near-equal blocks in
   ≥2 places become a helper (see gjs.guide "Use Helper Functions
   Instead of Code Duplication").
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
4. **Verify & bump.** The version bump rules, the certify gate on the
   release commit, the zip + sha record -- commands in the skill.
   Certification is per shell, not per machine: every major listed in
   `shell-version` must have presented a green guest cert on the same
   zip bytes, refreshed whenever shipped code changed since that cert
   was struck. A shell version without a current cert does not ride in
   the metadata -- and a version that would need branched code to keep
   is dropped, per BEST-PRACTICES.md.
5. **Live verification.** Headless gates prove the zip boots; only a
   live session proves the card. The install/login/surface-walk
   sequence and the byte-identity rule ("the verified zip IS the
   uploaded zip") live in the skill.

Every concrete release command -- review through upload to post-
approval hygiene -- lives in
[`skills/weatherglass-release/SKILL.md`](skills/weatherglass-release/SKILL.md),
in one canonical order (a `guide` lock enforces this file staying
command-free and the skill holding the ritual). Read the principles
above as the *why*; the skill is the *how*.

