#!/usr/bin/env bash
# tools/film.sh -- cast the EGO demo video headlessly (film mode, #60).
#
#   tools/film.sh                  # PNG sequence + tools/out/film/weatherglass-demo-card.mp4
#   tools/film.sh --check          # the same shoot, graded as the smoke lock
#   tools/film.sh --world [--check] # global showcase (Day, Golden Hour, Night + Dark/Light themes)
#
# This is the golden machine on a timer: the SAME disposable nested
# gnome-shell as shell-golden.sh, the SAME working-tree widget code the
# golden lock certifies, and a fixture-forced scene (clock + weather,
# cov-clear-night -- the hero golden). What differs is only the timer:
# beats fire on the shell's live clock, chart morphs / the sky ticker /
# the fades run in real time on the nested frame clock, and one PNG per
# ~33 ms lands through the in-process composite chain (see the probe's
# giCapture core). Only the scene is a fixture; the timing is real.
#
# Beat sheet (direct calls into the panel, never synthetic input):
#   t+0.0s open (fade in) -> t+1.0s tab: Precipitation -> t+2.5s tab:
#   Wind -> t+4.0s tap day tile #2 (the #50 Today-morph + the night-to-
#   day sky beat) -> t+5.5s close (fade out). Override with
#   WG_FILM_BEATS / WG_FILM_FIXTURE (dev prototyping).
#
# THE SMOKE LOCK (--check), and why it is not in certify.sh: video
# frames are not byte-diffable (live animation has no blessed truth),
# so the goldens remain the pixel canon and this stays a standalone
# runnable lock: every frame a valid PNG of exactly the menu rect,
# every fully-open frame's menu region PAINTED (fade ramps exempt by
# design -- they are mid-animation by construction), frame count >=
# 120, ffmpeg exit 0, mp4 duration within +/-1 s of the beat sheet.
#
# Honesty rules, mirrored from shell-golden.sh: host-gated (SKIP loudly
# without gnome-shell; SKIP the encode loudly without ffmpeg -- never a
# fake PASS), and zero frames / a fatal probe report / an empty mp4 is
# a FAIL, never a silent PASS over emptiness. Nothing on this run
# touches the real session, dconf, or the goldens.
set -uo pipefail
cd "$(dirname "$0")/.."

CHECK=0
WORLD=0
for arg in "$@"; do
    case "$arg" in
        --check) CHECK=1 ;;
        --world|--world-tour) WORLD=1 ;;
        *)
            echo "usage: tools/film.sh [--world] [--check]"
            exit 2
            ;;
    esac
done

command -v gnome-shell >/dev/null 2>&1 || {
    echo "SKIP: no gnome-shell on this machine (film mode is host-gated; the goldens remain the pixel canon)"
    exit 0; }

HAVE_FFMPEG=0
command -v ffmpeg >/dev/null 2>&1 && command -v ffprobe >/dev/null 2>&1 && HAVE_FFMPEG=1

PROBE=probe@vijaybala.dev
OUT="${WG_FILM_OUT:-/tmp/opencode/wg-film.json}"
FILMDIR="${WG_FILM_DIR:-tools/out/film}"
SRC="${WG_FILM_SRC:-/tmp/opencode/wg-film-src}"
TIMEOUT="${WG_FILM_TIMEOUT:-300}"
if [ "$WORLD" = 1 ]; then
    MP4="${WG_FILM_MP4:-$FILMDIR/weatherglass-demo-world.mp4}"
    FIXTURE="${WG_FILM_FIXTURE:-world-cairo-clear-day}"
    BEATS='[{"t":0,"do":"open"},{"t":1.2,"do":"fixture","arg":"world-sydney-wind-day"},{"t":1.6,"do":"metric","arg":"wind"},{"t":2.4,"do":"fixture","arg":"world-rio-partly-day"},{"t":2.8,"do":"metric","arg":"temp"},{"t":3.6,"do":"fixture","arg":"world-london-drizzle-day"},{"t":4.8,"do":"fixture","arg":"world-berlin-rain-day"},{"t":5.2,"do":"metric","arg":"precip"},{"t":6.0,"do":"fixture","arg":"world-mumbai-showers-day"},{"t":7.2,"do":"fixture","arg":"world-zurich-hail-day"},{"t":7.6,"do":"metric","arg":"temp"},{"t":8.4,"do":"fixture","arg":"world-sf-cloud-golden"},{"t":9.6,"do":"fixture","arg":"world-vancouver-fog-golden"},{"t":10.8,"do":"fixture","arg":"world-montreal-freezing-golden"},{"t":12.0,"do":"fixture","arg":"world-oslo-sleet-golden"},{"t":13.2,"do":"fixture","arg":"world-reykjavik-snow-night"},{"t":14.4,"do":"fixture","arg":"world-anchorage-grains-night"},{"t":15.6,"do":"fixture","arg":"world-sapporo-snowshowers-night"},{"t":16.8,"do":"fixture","arg":"world-tokyo-storm-night"},{"t":18.0,"do":"fixture","arg":"world-santiago-moon-night"},{"t":19.2,"do":"fixture","arg":"world-ushuaia-unknown-night"},{"t":20.4,"do":"fixture","arg":"world-theme-solid-dark"},{"t":21.6,"do":"fixture","arg":"world-theme-solid-light"},{"t":22.8,"do":"fixture","arg":"world-theme-accent-dark"},{"t":24.0,"do":"fixture","arg":"world-theme-accent-light"},{"t":25.2,"do":"close"}]'
    MIN_FRAMES=450
else
    MP4="${WG_FILM_MP4:-$FILMDIR/weatherglass-demo-card.mp4}"     # the manifest demo-URL asset name
    FIXTURE="${WG_FILM_FIXTURE:-cov-clear-night}"
    # NB: no ${VAR:-[json]} here -- bash ends the expansion at the first '}'
    # in the JSON default and leaks the rest. Unset-and-assign only.
    BEATS='[{"t":0,"do":"open"},{"t":1,"do":"metric","arg":"precip"},{"t":2.5,"do":"metric","arg":"wind"},{"t":4,"do":"day","arg":2},{"t":5.5,"do":"close"}]'
    MIN_FRAMES=120
fi
[ -n "${WG_FILM_BEATS:-}" ] && BEATS="$WG_FILM_BEATS"
FPS=30
# fade-ramp exemption for the painted check: must stay in step with
# FADE_MS+TAIL_MS in tools/harness/probe@vijaybala.dev/film-mode.js
# (frames inside a ramp are mid-animation; "painted" is demanded only
# once the menu is fully open)
RAMP_MS=300

# ---------------- 1. capture: nested shell boot (mirrors shell-golden.sh) --

rm -f "$OUT" "${OUT}.final" "$MP4" "$FILMDIR"/frame_*.png
rm -rf "$SRC"
mkdir -p "$FILMDIR"
# the probe resolves paths inside gnome-shell's own CWD: hand it absolutes
FILMDIR_ABS="$(realpath "$FILMDIR")"

DATA="$(mktemp -d)" CONF="$(mktemp -d)"
cleanup() {
    kill $SHELL_PID 2>/dev/null
    sleep 1
    # same harness-only pattern as shell-golden.sh (the real session's
    # cmdline never matches)
    pkill -9 -f "gnome-shell --wayland --headless" 2>/dev/null
    wait $SHELL_PID 2>/dev/null
    rm -rf "$DATA" "$CONF"
}
SHELL_PID=""
trap cleanup EXIT

mkdir -p "$DATA/gnome-shell/extensions"
cp -r "tools/harness/$PROBE" "$DATA/gnome-shell/extensions/"
# the panel's whole module graph, copied next to the probe (card mode's list)
for m in menu.js chart.js sky.js painter.js moon.js weather.js \
         animation.js ink-policy.js; do
    cp "$m" "$DATA/gnome-shell/extensions/$PROBE/"
done

# keyfile gsettings backend: the nested shell enables only our probe
mkdir -p "$CONF/glib-2.0/settings"
cat > "$CONF/glib-2.0/settings/keyfile" <<EOF
[org/gnome/shell]
enabled-extensions=['$PROBE']
EOF

export XDG_DATA_HOME="$DATA" XDG_CONFIG_HOME="$CONF" GSETTINGS_BACKEND=keyfile
export NO_AT_BRIDGE=1
export WG_PROBE_OUT="$OUT" WG_PROBE_SRC="$SRC" WG_PROBE_PNG="$FILMDIR_ABS"
export WG_PROBE_CSS="$PWD/stylesheet.css"
export WG_PROBE_FILM="$BEATS" WG_PROBE_FILM_FIXTURE="$FIXTURE"

echo "==> headless nested gnome-shell -- film/$FIXTURE"
setsid dbus-run-session -- gnome-shell --wayland --headless --virtual-monitor 1024x768 \
    >/tmp/opencode/wg-film-nested.log 2>&1 &
SHELL_PID=$!

deadline=$((SECONDS + TIMEOUT))
while [ $SECONDS -lt $deadline ] && [ ! -f "${OUT}.final" ]; do
    kill -0 $SHELL_PID 2>/dev/null || break
    sleep 0.5
done
if [ ! -f "${OUT}.final" ]; then
    echo "FAIL: no final probe report after ${TIMEOUT}s -- nested shell log tail:"
    tail -15 /tmp/opencode/wg-film-nested.log
    [ -f "$OUT" ] && { echo "-- last heartbeat:"; cat "$OUT"; }
    exit 1
fi

# ---------------- 2. encode -----------------------------------------------

ENCODED=0
if [ "$HAVE_FFMPEG" = 0 ]; then
    echo "SKIP: no ffmpeg/ffprobe on this machine -- the PNG sequence stands, mp4 NOT produced"
else
    # NB: no `ffmpeg -encoders | grep -q` under pipefail -- grep's early
    # exit SIGPIPEs ffmpeg and poisons the pipeline status. Snapshot first.
    ENCS="$(ffmpeg -hide_banner -encoders 2>/dev/null || true)"
    ENC=""
    for c in libx264 libopenh264; do
        case "$ENCS" in *" ${c} "*) ENC="$c"; break ;; esac
    done
    if [ -z "$ENC" ]; then
        echo "SKIP: this ffmpeg carries no h264 encoder (libx264/libopenh264) -- the PNG sequence stands, mp4 NOT produced"
    else
        if [ "$ENC" = libx264 ]; then
            QUAL=(-crf 18 -preset slow)
        else
            QUAL=(-b:v 4M)     # libopenh264 has no crf; a rate that holds chart text legible
        fi
        # -vf even-sizes the frame: the menu rect may be odd and h264 demands even.
        # In --world mode, 20 live fixture rebuilds add capture overhead, so read
        # the PNG sequence at the measured capture rate (frames / (endMs / 1000))
        # and emit a standard 30 fps stream matching the beat sheet's real duration.
        IN_FPS="$FPS"
        if { [ "$WORLD" = 1 ] || [ -n "${WG_FILM_BEATS:-}" ]; } && [ -f "${OUT}.final" ]; then
            IN_FPS="$(python3 -c "import json; r=json.load(open('${OUT}.final')); print(f'{len(r[\"frames\"]) / (r[\"endMs\"] / 1000.0):.4f}')")"
        fi
        echo "==> encode: ffmpeg -framerate $IN_FPS -r $FPS -> $MP4 (encoder $ENC)"
        if ffmpeg -y -v error -framerate "$IN_FPS" -i "$FILMDIR/frame_%03d.png" \
                -vf 'scale=trunc(iw/2)*2:trunc(ih/2)*2' -r "$FPS" -c:v "$ENC" "${QUAL[@]}" \
                -pix_fmt yuv420p -movflags +faststart "$MP4"; then
            [ -s "$MP4" ] && ENCODED=1
            [ "$ENCODED" = 1 ] || { echo "FAIL: ffmpeg exited 0 but produced no bytes -- refusing a PASS over emptiness"; exit 1; }
        else
            echo "FAIL: ffmpeg exited nonzero -- the encode is void, not a SKIP"
            exit 1
        fi
    fi
fi

# ---------------- 3. smoke lock: grade the shoot --------------------------

BEATS="$BEATS" python3 - "$FILMDIR" "$FIXTURE" "$MIN_FRAMES" "$RAMP_MS" \
    "$OUT" "$MP4" "$CHECK" "$ENCODED" <<'PYCHK'
import json, os, subprocess, sys

filmdir, fixture, min_frames, ramp_ms, out, mp4, check, encoded = sys.argv[1:9]
beats = json.loads(os.environ["BEATS"])
fail = []

rep = json.load(open(f"{out}.final"))
if "fatal" in rep:
    print("FAIL: probe reported a fatal error -- this film is void")
    sys.exit(1)
if rep.get("failures"):
    print(f"FAIL: probe reported failures: {rep['failures']}")
    sys.exit(1)
if rep.get("fixture") != fixture:
    fail.append(f"report fixture {rep.get('fixture')!r} != requested {fixture!r}")

frames = rep.get("frames") or []
if not frames:
    print("FAIL: zero captured frames -- refusing a PASS over emptiness")
    sys.exit(1)
x, y, w, h = rep["rect"]
end_ms = rep["endMs"]
print(f"==> report: fixture={rep['fixture']} rect={rep['rect']} "
      f"endMs={end_ms} frames={len(frames)} wallMs={rep.get('wallMs')}")
if len(frames) < int(min_frames):
    fail.append(f"frame count {len(frames)} < floor {min_frames}")
if rep.get("wallMs", 0) - end_ms > 0.15 * end_ms:
    print(f"note: capture wall time overran the beat sheet by "
          f"{rep['wallMs'] - end_ms} ms -- slow captures play back slightly fast")

from PIL import Image, ImageStat
close_ts = [b["t"] for b in beats if b["do"] == "close"]
open_ts = [b["t"] for b in beats if b["do"] == "open"]

def painted(path):
    # the inner 70% of the menu rect is not flat: real card content
    # measures stddev in the tens; a never-painted capture sits near 0
    crop = Image.open(path).convert("L").crop(
        (int(w * 0.15), int(h * 0.15), int(w * 0.85), int(h * 0.85)))
    return ImageStat.Stat(crop).stddev[0] >= 3.0

def chart_painted(path):
    # the hourly chart band (y=35%..60%) carries the curve, value labels,
    # weather strip glyphs, and hour labels (stddev ~10-30). An empty
    # daySlice (e.g. unpopulated future day) leaves only the sky gradient
    # (~5.6), which must fail the smoke lock.
    crop = Image.open(path).convert("L").crop(
        (int(w * 0.08), int(h * 0.35), int(w * 0.92), int(h * 0.60)))
    return ImageStat.Stat(crop).stddev[0] >= 8.5

painted_n, ramp_n = 0, 0
for fr in frames:
    t, path = fr["t"], f"{filmdir}/frame_{fr['f']:03d}.png"
    if not os.path.isfile(path):
        fail.append(f"frame {fr['f']}: no PNG on disk")
        continue
    try:
        im = Image.open(path); im.verify()
        im = Image.open(path)
    except Exception as e:
        fail.append(f"frame {fr['f']}: not a decodable PNG ({e})")
        continue
    if im.size != (w, h):
        fail.append(f"frame {fr['f']}: size {im.size} != menu rect ({w}, {h})")
        continue
    in_ramp = (open_ts and t < open_ts[0] * 1000 + int(ramp_ms)) or \
              (close_ts and t >= close_ts[-1] * 1000)
    if in_ramp:
        ramp_n += 1
        if close_ts and t >= close_ts[-1] * 1000 + 250:
            bg_std = ImageStat.Stat(im.convert("L")).stddev[0]
            if bg_std >= 3.0:
                fail.append(f"frame {fr['f']} (t={t}ms): closed frame leaked stage window (stddev={bg_std:.2f} >= 3.0)")
    elif not painted(path):
        fail.append(f"frame {fr['f']} (t={t}ms): menu rect BLANK -- nothing painted")
    elif not chart_painted(path):
        fail.append(f"frame {fr['f']} (t={t}ms): hourly chart band BLANK after day/metric switch")
    else:
        painted_n += 1
print(f"==> PNGs: {len(frames)} total, {painted_n} menu-painted, "
      f"{ramp_n} fade-ramp (validity-only)")
if painted_n < int(min_frames):
    fail.append(f"painted frames {painted_n} < floor {min_frames}")

if encoded == "1":
    dur = float(subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration",
         "-of", "default=nk=1:nw=1", mp4],
        capture_output=True, text=True, check=True).stdout)
    delta = abs(dur - end_ms / 1000)
    print(f"==> mp4: {mp4} -- {dur:.2f}s, {os.path.getsize(mp4) / 1024:.0f} KiB "
          f"(beat sheet says {end_ms / 1000:.2f}s, drift {delta:.2f}s)")
    if delta > 1.0:
        fail.append(f"duration {dur:.2f}s off the beat sheet by {delta:.2f}s (> 1 s)")
elif check == "1":
    fail.append("--check demands a real mp4; the encode was skipped or failed")
else:
    print("note: no mp4 graded (encoder SKIP above) -- frames graded only")

for m in fail:
    print(f"  - {m}")
if fail:
    print("FAIL: film smoke lock")
    sys.exit(1)
if check == "1":
    print(f"CHECK OK: {len(frames)} frames, {painted_n} painted, "
          f"fixture {fixture} -- film smoke lock green")
PYCHK
exit $?
