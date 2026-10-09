#!/usr/bin/env bash
# tools/certify.sh -- full certification run before any EGO re-publish.
#
# One command that answers "can this build go to extensions.gnome.org?"
# Stages (fast -> slow, each gate blocks the next):
#   1. syntax + import graph         (tools/syntax-check.mjs, imports-check.mjs)
#   2. unit locks (plain gjs, no shell): color-space gates, the WCAG
#      bar verdicts, chart slot/plateau regressions, WMO/day-night
#      mapping, almanac, unit formatting    (tests/*.test.mjs)
#   3. scenario matrix: every glyph pose x ground tier x day/night
#      rendered offscreen, then PIXEL-GRADED for the contrast each
#      ground was promised (tests/scenarios.mjs + tools/certify-pixels.py)
#   4. full-card previews for human eyes   (tools/card-preview.mjs)
#   4b. coverage grid: every scene x day/night/golden-hour as a full card,
#       each strip glyph's family re-derived from measured ring pixels
#       (card-preview --coverage + certify-pixels.py --grid)
#   4c. golden lock, tier 2 (the ONLY golden lock): every golden-named
#       fixture rendered as REAL St widgets inside a disposable headless
#       gnome-shell, byte-diffed against BLESSED RENDERED TRUTH
#       (tools/golden/shell/, one boot for all 47). Same engine, no
#       cross-rasterizer floor, no boot noise: the lock is byte-exact.
#       bless = deliberate ceremony (tools/shell-golden.sh card bless).
#       Host-gated: SKIPs (not fails) without gnome-shell.
#       (tools/shell-golden.sh card check all)
#   5. zip build + headless nested-shell boot & menu paint (package.sh
#      -> zipcheck.sh: installs the real dist zip the EGO way)
#
# Exit 0 == certified; attach tools/out/certify/ + the dist zip to the upload.
# The suite exists because the v6 WCAG-bar regression passed code review,
# prose review, and zipcheck -- and only died in pixels. Pixels now vote.

set -u
PROJ="$(cd "$(dirname "$0")/.." && pwd)"
cd "$PROJ" || exit 1
FAILED=0

stage() {
    local name="$1"; shift
    printf '\n=== %s ===\n' "$name"
    if "$@"; then
        printf 'PASS  %s\n' "$name"
    else
        printf 'FAIL  %s\n' "$name"
        FAILED=$((FAILED + 1))
    fi
}

stage "syntax"            gjs -m tools/syntax-check.mjs
stage "imports"           gjs -m tools/imports-check.mjs

for t in tests/*.test.mjs; do
    stage "unit: $(basename "$t" .test.mjs)" gjs -m "$t"
done || true

stage "scenario render"   gjs -m tests/scenarios.mjs
stage "pixel certify"     python3 tools/certify-pixels.py
stage "card previews"     gjs -m tools/card-preview.mjs
stage "demo cards render" gjs -m tools/card-demo.mjs
stage "demo coverage"     gjs -m tools/card-demo.mjs --coverage
stage "grid certify"      python3 tools/certify-pixels.py --grid tools/out/demo
stage "golden lock (shell)" bash tools/shell-golden.sh card check all
stage "package + zipcheck" bash tools/package.sh

git checkout -- po/ 2>/dev/null   # packaging stamps po/ mtimes; keep the tree clean

printf '\n────────────────────────────────────────\n'
if [ "$FAILED" -eq 0 ]; then
    printf 'CERTIFIED: all stages green -- safe to upload dist/\n'
    printf 'artifacts: dist/*.zip, tools/out/certify/, tools/out/demo/\n'
else
    printf 'NOT CERTIFIED: %d stage(s) failed -- do not upload\n' "$FAILED"
fi
exit "$FAILED"
