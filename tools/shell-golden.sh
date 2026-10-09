#!/usr/bin/env bash
# tools/shell-golden.sh -- nested gnome-shell harness (the golden lock).
#
# Boots a throwaway gnome-shell on its own dbus session bus, with its own
# XDG_DATA_HOME/XDG_CONFIG_HOME: nothing can touch the real session, the
# real dconf, or the real extension set. It loads ONLY the dev probe
# extension (tools/harness/).
#
#   tools/shell-golden.sh                       # stage 1: capture self-test
#   tools/shell-golden.sh card check [SLUG...|all]
#                                               #   lock: render each
#                                               #   fixture and diff against
#                                               #   its BLESSED shell golden
#                                               #   ('all' = the 47-slug
#                                               #   registry, one boot)
#   tools/shell-golden.sh card bless [SLUG...|all]
#                                               #   re-canonise the shell
#                                               #   goldens (deliberate act)
#
# THE canon is RENDERED TRUTH: tools/golden/shell/<slug>.png, produced by
# this pipeline from a reviewed commit and checked in. Fresh renders are
# graded against it with no tolerance story: same engine (real St paint
# vs real St paint) has no cross-rasterizer floor and no boot noise --
# measured byte-identical across boots, 47/47. Budget 0 at a strict
# delta-8; WG_SHELL_BUDGET/WG_SHELL_THRESHOLD exist as escape hatches
# for a SECOND blessed machine, not for excuses (raise with evidence).
# bless is a ceremony: it prints which files moved; the re-bless commit
# carries the why, and bless provenance (gnome-shell/font stack) belongs
# in its message.
#
# Card mode copies the extension's runtime modules next to the probe and,
# in ONE boot, renders each fixture SLUG as the REAL ForecastPanel (real
# St widgets, real stylesheet.css, real painter/chart/sky code), capturing
# each card rect through the in-process GI chain. Location + weather are
# mocked by construction: the panel gets a fixture state object; the
# provider never exists. Determinism is pinned PER CARD, so bless order
# can never matter.
#
# This lock is host-gated (rendered truth bakes in this box's shell/font
# stack); everywhere else certify's property stages still vote. The old
# canvas goldens (a simulation's self-consistency) were retired in favor
# of this -- the simulation (tools/card-demo.mjs) stays as the human
# preview lab and the roster whose slug names this registry mirrors.
#
# VERDICT of stage 1 (banked): Eval is gated; the Screenshot DBus API
# answers AccessDenied for everyone except its allowlist (MediaKeys + the
# portal), including the shell asking itself; the GI methods behind that
# gate (screenshot_stage_to_content + composite_to_stream) work from
# inside an extension, ungated. giCapture ok => the lock needs no VM.
#
# The session is HEADLESS (--virtual-monitor: zero monitors mean zero-size
# captures). Nothing appears on your desktop; killed unconditionally.
set -uo pipefail
cd "$(dirname "$0")/.."

MODE="${1:-probe}"
shift || true
VERB=check
if [ "$MODE" = card ] && { [ "${1:-}" = check ] || [ "${1:-}" = bless ]; }; then
    VERB="$1"; shift
fi
SLUGS=("$@")
[ ${#SLUGS[@]} -gt 0 ] || SLUGS=(style-solid-dark)
# 'all' = the probe's full 47-slug registry; the runner learns the list
# from the probe report (bless) or assumes the canonical set (check)
ALL_SET="all"
[ "${SLUGS[0]}" = all ] || ALL_SET=""
TIMEOUT_DEFAULT=150
[ -z "$ALL_SET" ] || TIMEOUT_DEFAULT=300

PROBE=probe@vijaybala.dev
OUT="${WG_PROBE_OUT:-/tmp/opencode/wg-probe.json}"
PNGDIR="${WG_PROBE_PNG:-/tmp/opencode/wg-cards}"
PNG_PROBE="${WG_PROBE_PNG_FILE:-/tmp/opencode/wg-probe.png}"
SRC="${WG_PROBE_SRC:-/tmp/opencode/wg-shell-src}"
TIMEOUT="${WG_PROBE_TIMEOUT:-$TIMEOUT_DEFAULT}"   # extension load waits out portal activation
SGOLD="tools/golden/shell"           # blessed rendered truth lives here


# same-engine lock: rendered truth vs fresh render. Measured byte-
# identical across boots (bless + full checks, 47/47, max delta 0): the
# budget is zero. WG_SHELL_BUDGET exists for a SECOND blessed machine's
# honest jitter (raise it with evidence, not superstition).
S_THRESHOLD="${WG_SHELL_THRESHOLD:-8}"
S_BUDGET="${WG_SHELL_BUDGET:-0}"

if ! command -v gnome-shell >/dev/null 2>&1; then
    echo "SKIP: no gnome-shell on this machine (tier 2 is host-gated)"
    exit 0
fi

rm -f "$OUT" "${OUT}.final"
rm -rf "$PNGDIR" "$SRC"
[ "$MODE" = card ] && rm -f "$PNG_PROBE"
mkdir -p "$PNGDIR"

DATA="$(mktemp -d)" CONF="$(mktemp -d)"
cleanup() {
    kill $SHELL_PID 2>/dev/null
    sleep 1
    # dbus-run-session forwards TERM but a hung shell ignores it; these
    # flags are unique to this harness so the pattern can't hit the real
    # session (and a script file's cmdline never matches it itself).
    pkill -9 -f "gnome-shell --wayland --headless" 2>/dev/null
    wait $SHELL_PID 2>/dev/null
    rm -rf "$DATA" "$CONF"
}
SHELL_PID=""
trap cleanup EXIT

mkdir -p "$DATA/gnome-shell/extensions"
cp -r "tools/harness/$PROBE" "$DATA/gnome-shell/extensions/"

if [ "$MODE" = card ]; then
    # the panel's whole module graph, copied next to the probe so its
    # relative imports resolve inside the extension sandbox
    for m in menu.js chart.js sky.js painter.js moon.js weather.js \
             animation.js ink-policy.js; do
        cp "$m" "$DATA/gnome-shell/extensions/$PROBE/"
    done
fi

# keyfile gsettings backend: the nested shell enables only our probe --
# the real dconf database is never opened.
# (glib >=2.82 keyfile backend: $XDG_CONFIG_HOME/glib-2.0/settings/keyfile,
#  sections are PATH-style ids, not dotted ones -- gsettings.ini is ignored)
mkdir -p "$CONF/glib-2.0/settings"
cat > "$CONF/glib-2.0/settings/keyfile" <<EOF
[org/gnome/shell]
enabled-extensions=['$PROBE']
EOF

export XDG_DATA_HOME="$DATA" XDG_CONFIG_HOME="$CONF" GSETTINGS_BACKEND=keyfile
export NO_AT_BRIDGE=1
if [ "$MODE" = card ]; then
    export WG_PROBE_OUT="$OUT" WG_PROBE_SRC="$SRC"
    export WG_PROBE_CARD="$(IFS=,; echo "${SLUGS[*]}")"
    export WG_PROBE_PNG="$PNGDIR"
    export WG_PROBE_CSS="$PWD/stylesheet.css"
else
    export WG_PROBE_OUT="$OUT" WG_PROBE_PNG="$PNG_PROBE" WG_PROBE_SRC="$SRC"
fi

# Headless is the only nestable mode on mutter 50: the old wayland-client
# nested backend is gone (src/backends has only `native`), plain --wayland
# is the native backend and aborts fighting the real session for login1
# seat control (TakeControl -> EBUSY). --headless boots on the real
# GBM/EGL renderer but starts with ZERO monitors, which makes every
# capture a 0x0 texture; --virtual-monitor gives it one.
echo "==> headless nested gnome-shell -- $MODE/$VERB (${SLUGS[*]})"
setsid dbus-run-session -- gnome-shell --wayland --headless --virtual-monitor 1024x768 \
    >/tmp/opencode/wg-nested.log 2>&1 &
SHELL_PID=$!

# The probe heartbeats $OUT at import/enable; only $OUT.final means the
# async pipeline (capture, and in card mode every render) has landed.
deadline=$((SECONDS + TIMEOUT))
while [ $SECONDS -lt $deadline ] && [ ! -f "${OUT}.final" ]; do
    kill -0 $SHELL_PID 2>/dev/null || break
    sleep 0.5
done

if [ ! -f "${OUT}.final" ]; then
    echo "FAIL: no final probe report after ${TIMEOUT}s -- nested shell log tail:"
    tail -15 /tmp/opencode/wg-nested.log
    [ -f "$OUT" ] && { echo "-- last heartbeat:"; cat "$OUT"; }
    exit 1
fi
echo "==> probe report:"
python3 -m json.tool "${OUT}.final"

# a fatal report means the probe died mid-pipeline: everything downstream
# (registry, PNGs) is missing, and a lock that checks nothing must never
# report PASS on emptiness -- that is exactly how the isDay crash hid
if python3 -c "import json,sys;sys.exit(0 if 'fatal' in json.load(open('${OUT}.final')) else 1)"; then
    echo "FAIL: probe reported a fatal error -- this golden run is void"
    exit 1
fi

if [ "$MODE" = card ] && [ -n "$ALL_SET" ]; then
    mapfile -t SLUGS < <(python3 -c "import json;print('\n'.join(json.load(open('${OUT}.final'))['cards'].keys()))")
    echo "==> expanded 'all' to ${#SLUGS[@]} slugs from the probe registry"
fi

if [ "$MODE" = card ] && [ "${#SLUGS[@]}" -eq 0 ]; then
    echo "FAIL: no slugs to $VERB -- refusing an empty lock"
    exit 1
fi

if [ "$MODE" = card ]; then
    failed=0
    mkdir -p "$SGOLD"
    for s in "${SLUGS[@]}"; do
        card="$PNGDIR/$s.png"
        if [ ! -f "$card" ]; then
            echo "FAIL: $s produced no PNG"
            failed=$((failed + 1))
            continue
        fi
        if [ "$VERB" = bless ]; then
            if [ -f "$SGOLD/$s.png" ] && tools/shot-diff "$SGOLD/$s.png" \
                    "$card" --max-changed 0 --threshold "$S_THRESHOLD" \
                    --out /dev/null >/dev/null 2>&1; then
                echo "bless: $s unchanged (pixels match; PNG bytes may differ by encoder state)"
            else
                cp "$card" "$SGOLD/$s.png"
                echo "bless: $SGOLD/$s.png RE-CANONISED (review + commit with a why)"
            fi
        else
            if [ ! -f "$SGOLD/$s.png" ]; then
                echo "FAIL: $s has no blessed golden -- bless first"
                failed=$((failed + 1))
                continue
            fi
            echo "==> same-engine lock: $s vs $SGOLD/$s.png (budget ${S_BUDGET}% at delta $S_THRESHOLD):"
            tools/shot-diff "$SGOLD/$s.png" "$card" \
                --max-changed "$S_BUDGET" --threshold "$S_THRESHOLD" \
                --out "/tmp/opencode/wg-card-diff-$s.png" || failed=$((failed + 1))
        fi
    done
    if [ "$VERB" != bless ]; then
        echo "==> diff sheets: /tmp/opencode/wg-card-diff-*.png"
    fi
    exit $((failed > 0 ? 1 : 0))
fi
echo "==> png written: $(test -f "$PNG_PROBE" && stat -c '%n (%s bytes)' "$PNG_PROBE" || echo 'no')"
echo "==> shell source dumped to $SRC: $(test -d "$SRC" && ls "$SRC" | tr '\n' ' ' || echo 'no')"
