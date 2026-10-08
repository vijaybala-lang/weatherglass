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
stage "package + zipcheck" bash tools/package.sh

git checkout -- po/ 2>/dev/null   # packaging stamps po/ mtimes; keep the tree clean

printf '\n────────────────────────────────────────\n'
if [ "$FAILED" -eq 0 ]; then
    printf 'CERTIFIED: all stages green -- safe to upload dist/\n'
    printf 'artifacts: dist/*.zip, tools/out/certify/, tools/out/cards/\n'
else
    printf 'NOT CERTIFIED: %d stage(s) failed -- do not upload\n' "$FAILED"
fi
exit "$FAILED"
