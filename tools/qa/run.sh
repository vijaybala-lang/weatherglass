#!/usr/bin/env bash
# tools/qa/run.sh — certify the CURRENT build against an OLDER gnome-shell
# running in a Fedora container (guest side; run inside the container).
#
#   /src  = repo, READ-ONLY bind (the dist zip is graded exactly as built
#           on the host -- same bytes we will upload to EGO)
#   /out  = rw artifact dir (summary.md, cards/, diffs/, logs/)
#
# Ladder (mirrors tools/certify.sh, but graded for FOREIGN-SHELL duties):
#   tier 1  pure-gjs property locks: syntax, imports, unit suites,
#           scenario matrix + pixel certify, previews, demo coverage.
#           These also exercise THIS release's GJS and cairo/pango.
#   tier 2  probe card capture in a real headless shell: every fixture
#           renders as the REAL ForecastPanel. Graded STRUCTURALLY (no
#           fatal, registry complete, every PNG decodes with real size);
#           the blessed goldens belong to the host's shell, so against
#           them we only REPORT per-slug changed% and bank diff sheets
#           for human eyes -- differing pixels are expectation, not a
#           failure, on a foreign raster stack.
#   tier 3  zipcheck: gnome-extensions install of the dist zip + headless
#           boot + menutest popup toggles; verdict must be PASS.
#   scan    zero GJS exceptions ("JS ERROR") across every nested-shell log.
set -u
WORK=/work
rm -rf "$WORK"; cp -r /src "$WORK"; cd "$WORK" || exit 1
chmod -R u+w "$WORK"
mkdir -p /tmp/opencode /out/cards /out/diffs

LABEL="${QA_SHELL_LABEL:-foreign}"
STAMPS=/out/stamps.txt
: > "$STAMPS"
gnome-shell --version                      >>"$STAMPS" 2>&1
gjs --version                              >>"$STAMPS" 2>&1
python3 -V                                 >>"$STAMPS" 2>&1
python3 -c "import PIL; print('pillow', PIL.__version__)" >>"$STAMPS" 2>&1
grep PRETTY_NAME /etc/os-release           >>"$STAMPS" 2>&1
echo "qa: guest identity: $(tr '\n' '|' < "$STAMPS")"

# Foreign shells die young without a system bus (see the bootstrap file)
. "$(dirname "$0")/system-bus-bootstrap.sh"

# Containers ship no writable /tmp/.X11-unix, and shell 48 treats a
# failed Xwayland start as FATAL (libmutter-ERROR aborts the whole
# shell; 49 merely degrades). The harness boots without --no-x11, so
# give Xwayland its socket dir instead of teaching product tools new
# flags for the guest's comfort.
mkdir -p -m 1777 /tmp/.X11-unix

# gnome-desktop on 45-47 dereferences the locale1 reply unguarded --
# feed the name (see locale1_stub.py for the gdb-caught stack).
# Era-scoped by VERSION_ID: 48+ guards the reply, and 42/43 images
# were cached before this stub existed -- they must keep working.
source /etc/os-release 2>/dev/null
if [ "${VERSION_ID:-99}" -le 41 ]; then
    python3 "$(dirname "$0")/locale1_stub.py" >/out/log-locale1-stub.txt 2>&1 &
    sleep 1
    kill -0 $! 2>/dev/null || echo "qa: WARN locale1 stub died: $(tail -1 /out/log-locale1-stub.txt)"

    # Real GNOME sessions autostart ibus-daemon, so portal.IBus activation
    # (Exec=ibus-portal, which HARD-exits rc=1 'Not connected to the ibus
    # bus' without a daemon) always succeeds there. Our containers have
    # no session manager: the activator dies, shell logs 'portal is not
    # running', and the keyboard machinery falls into the gnome-desktop
    # localed callback that upstream later guarded (gdb-verified crash
    # pc identical across payload variants; same unresolved stack as
    # gnome-shell#7262 on real Asahi hardware). Emulate the session:
    # override the service file to boot the daemon on the SAME session
    # bus right before the portal attaches. Overlay rides XDG_DATA_DIRS
    # prepended: the stage tools own XDG_DATA_HOME (/d profile seeds),
    # whose dbus-1/services scan would otherwise shadow a HOME drop --
    # and a nonexistent /d/dbus-1/services falls through to this one.
    # System dirs spelled out explicitly: once XDG_DATA_DIRS is set at
    # all, this glib stops offering /usr/share for free (measured --
    # a bare overlay value killed EVERY GSettings read, shell included).
    mkdir -p /opt/wg-services/dbus-1/services
    export XDG_DATA_DIRS="/opt/wg-services:/usr/local/share:/usr/share${XDG_DATA_DIRS:+:$XDG_DATA_DIRS}"
    cat > /opt/wg-services/wg-ibus-portal-wrapper.sh <<'WRAP'
#!/bin/sh
exec >>/out/log-ibus-portal.txt 2>&1
[ -x /usr/bin/ibus-daemon ] || exit 1
ibus-daemon --daemonize --panel=disable
sleep 1
exec /usr/libexec/ibus-portal
WRAP
    chmod +x /opt/wg-services/wg-ibus-portal-wrapper.sh
    cat > /opt/wg-services/dbus-1/services/org.freedesktop.portal.IBus.service <<'SVC'
[D-Bus Service]
Name=org.freedesktop.portal.IBus
Exec=/opt/wg-services/wg-ibus-portal-wrapper.sh
SVC

    # Fedora-patched shells 45-47 boot their keyboard manager via
    # gnome_get_default_input_sources -> the localed-proxy callback that
    # segfaults wherever the codegen property cache can't be trusted
    # (verified pc +0x8f4 = locale_data[0] indexing a NULL get_locale
    # reply; immune to every stub payload tried: full LOCALE as-array,
    # X11 quartet, faithful introspection XML, portal.IBus resurrection
    # -- the same unresolved crash as gnome-shell#7262 on REAL Asahi
    # hardware). The helper is only consulted when resolved
    # input-sources is EMPTY: seed a plain xkb layout into the
    # nested-shell profiles and the crash path is never entered. Both
    # section spellings below -- glib 2.80 reads dotted, 2.82+
    # path-style, and each era silently ignores the other's dialect.
    sed -i 's|^enabled-extensions=.*|&\n[org.gnome.desktop.input-sources]\nsources=[("xkb","us")]\n[org/gnome/desktop/input-sources]\nsources=[("xkb","us")]|' tools/shell-golden.sh
    grep -q 'org/gnome/desktop/input-sources' tools/shell-golden.sh || { echo 'qa: input-sources seeding (golden) failed'; exit 1; }
    # dconf-on-disposable-HOME is too polite for these shells: 45/47
    # SEGFAULT after INITIALIZING the zip's extension (EMPTY
    # input-sources walks into the Fedora gnome-desktop3 localed
    # callback -- crash witness in the seed comment above) and 46 parks
    # everything in INITIALIZED forever. Swap zipcheck's boot to the
    # keyfile recipe -- the one shell-golden has proven green on all
    # three eras -- carrying fixtures AND the input-sources seed; it
    # supersedes any gsettings-side seeding on this path.
    python3 "$(dirname "$0")/keyfile_zipcheck.py" \
        && bash -n tools/zipcheck.sh \
        || { echo 'qa: era zipcheck-keyfile rewrite failed'; exit 1; }
    # zipcheck pins XDG_DATA_DIRS=/usr/share, which would erase the
    # overlay carrying the portal.IBus resurrection from its nested
    # session bus. Spell it the rig way before any tool re-exports it.
    sed -i 's|XDG_DATA_DIRS=/usr/share|XDG_DATA_DIRS=/opt/wg-services:/usr/local/share:/usr/share|' tools/zipcheck.sh
fi

# The guest is GPU-less software rasterization always. Since 45-era
# mutter, booting Xwayland WITHOUT --no-x11 segfaults the compositor
# outright (glamor has no GBM interface to grab and the sw fallback
# arrives too late); 48+ merely limp. Strip the legacy launch's
# exposure to Xwayland in both tool copies, guest-side only: the host
# boots with a real GPU and its nested shells want the untouched flags.
sed -i 's|gnome-shell --headless|gnome-shell --headless --no-x11|; s|gnome-shell --wayland --headless|gnome-shell --wayland --headless --no-x11|' tools/shell-golden.sh
grep -q 'headless --no-x11' tools/shell-golden.sh || { echo 'qa: x11-stripping failed'; exit 1; }

# Chicken-and-egg of certification: the graded zip declares only the
# majors certified SO FAR, and 45-47-era extensionUtils gate loading on
# a LITERAL shell-major match (verified: ["*"] is rejected, ["47"] is
# welcomed to ACTIVE; --unsafe-mode parses but demonstrably ignores the
# staleness gate). Relax the DECLARATION toward the guest's own era --
# guest copy only, packaging metadata never product code -- so the era
# can prove its code works; the uploaded zip keeps declaring only
# certified majors, and the stamp records the mutation so no one
# mistakes the rehearsal paper for the deed. See unrestrict_zip.py.
if [ "${VERSION_ID:-99}" -le 41 ]; then
    SHELL_MAJOR=$((VERSION_ID + 6))   # Fedora N ships GNOME N+6
    python3 "$(dirname "$0")/unrestrict_zip.py" dist/*.zip "$SHELL_MAJOR" \
        || { echo 'qa: era zip-redeclare failed'; exit 1; }
    for meta in tools/harness/probe@vijaybala.dev/metadata.json \
                tools/menutest@vijaybala.dev/metadata.json; do
        [ -f "$meta" ] && sed -i "s|\"shell-version\": *\[[^]]*\]|\"shell-version\": [\"$SHELL_MAJOR\"]|" "$meta"
    done
    grep -q "\"shell-version\": \[\"$SHELL_MAJOR\"\]" tools/harness/probe@vijaybala.dev/metadata.json \
        || { echo 'qa: harness metadata redeclare failed'; exit 1; }
    echo "qa: era-note: guest dist zip + harness metadata re-declared shell-version [\"$SHELL_MAJOR\"]; zipcheck boot keyfile-ized (declaration/settings-only mutations, guest copy; upload keeps explicit certified majors)" >> /out/stamps.txt
fi

# NO FLATPAK SENTINEL HERE (attempted, reverted, witnessed): /.flatpak-info
# makes GLib's Glycin loader switch to SANDBOX mode, which spawns its
# loaders via flatpak-spawn -- absent in the guest. That kills not just
# screenshots but ORDINARY SVG ICON DRAWING: the panel-icon StDrawingArea
# was handed INT_MIN naturals and Stormed Clutter allocation asserts.
# The sentinel buys one silenced login-manager warning and pays with the
# The image pipeline instead stays pristine, and tier 3 whitelists the
# exact environmental lines by substring (see HOSTILE below).

SUM=/out/summary.tsv
: > "$SUM"
OVERALL=0
stage() {   # stage NAME cmd...  (last tier decides OVERALL unless INFO_)
    local name="$1" info="$2"; shift 2
    local t0=$SECONDS rc=0
    "$@" >"/out/log-$name.txt" 2>&1 || rc=$?
    printf '%s\t%s\t%s\t%ss\n' "$name" "$([ $rc -eq 0 ] && echo PASS || echo "rc=$rc")" \
        "$info" "$((SECONDS - t0))" >> "$SUM"
    [ "$info" = GRADE ] && [ $rc -ne 0 ] && OVERALL=1
    [ "$info" = GRADE ] || rc=0
    echo "==> $name: $([ $rc -eq 0 ] && echo PASS || echo "rc=$rc") ($((SECONDS - t0))s)"
}

# ---------- tier 1: shell-free property locks -----------------------------
for t in tools/syntax-check.mjs tools/imports-check.mjs tests/*.test.mjs; do
    stage "t1.$(basename "$t" .mjs)" GRADE gjs -m "$t"
done
stage t1.scenarios  GRADE gjs -m tests/scenarios.mjs
stage t1.pixels     GRADE python3 tools/certify-pixels.py
stage t1.previews   GRADE gjs -m tools/card-preview.mjs
stage t1.demo       GRADE gjs -m tools/card-demo.mjs
stage t1.coverage   GRADE gjs -m tools/card-demo.mjs --coverage
stage t1.grid       GRADE python3 tools/certify-pixels.py --grid tools/out/demo

# ---------- tier 2: probe card capture in the real foreign shell -----------
# bless INSIDE $WORK only (a throwaway copy): the host's blessed goldens
# are physically unreachable at /src (ro). Output = native-49 rendered
# truth per fixture slug.
stage t2.cards GRADE tools/shell-golden.sh card bless all

CARDS=/out/cards
mv /tmp/opencode/wg-cards/* "$CARDS"/ 2>/dev/null
if python3 - >/out/log-t2.structural.txt 2>&1 <<'PY'
import json, pathlib, sys
final = json.load(open('/tmp/opencode/wg-probe.json.final'))
want = sorted(p.stem for p in pathlib.Path('/src/tools/golden/shell').glob('*.png'))
got = sorted(final.get('cards', {}))
bad = []
if 'fatal' in final: bad.append(f"probe fatal: {final['fatal']}")
missing = set(want) - set(got)
from PIL import Image
thin = []
for c in want or got:
    p = pathlib.Path(f'/out/cards/{c}.png')
    if not p.exists(): thin.append(f'{c}: no png'); continue
    w, h = Image.open(p).size
    if w < 100 or h < 100: thin.append(f'{c}: {w}x{h}')
if missing: bad.append(f'fixture gap: {sorted(missing)}')
if thin: bad.append(f'missing/tiny: {thin}')
print(f'cards: {len(got)} rendered; registry gap: {sorted(missing) or "none"}; thin: {thin or "none"}')
print('VERDICT:', 'ok' if not bad else ' | '.join(bad))
sys.exit(0 if not bad else 1)
PY
then echo -e "t2.structural\tPASS\tGRADE\t-" >> "$SUM"
else echo -e "t2.structural\tFAIL\tGRADE\t-" >> "$SUM"; OVERALL=1; fi
echo "==> t2.structural: $(tail -1 /out/log-t2.structural.txt)"

# vs the HOST's blessed goldens: expectation is drift; report, don't grade
DIFFREP=/out/diffs.txt; : > "$DIFFREP"
for c in "$CARDS"/*.png; do
    s=$(basename "$c" .png); ref="/src/tools/golden/shell/$s.png"
    [ -f "$ref" ] || { echo "$s	no-host-golden" >> "$DIFFREP"; continue; }
    line=$(tools/shot-diff "$ref" "$c" --max-changed 100 --threshold 8 \
        --out "/out/diffs/$s.png" 2>&1 | tail -1)
    echo "$s	$line" >> "$DIFFREP"
done
# keep only a legible handful of diff sheets
(ls -S /out/diffs/*.png 2>/dev/null | tail -n +6 | xargs -r rm --)
echo "==> diffs vs host goldens (informative, worst first):"
(head -4 /out/diffs.txt || true)

# ---------- tier 3: the real EGO path --------------------------------------
# flag-drift guard: zipcheck asks for --no-x11; if this shell predates it,
# strip the flag (the flag itself, not the test, is what may not exist).
if ! gnome-shell --help 2>&1 | grep -q -- '--no-x11'; then
    sed -i 's/ --no-x11//' tools/zipcheck.sh
    echo 'zipcheck: stripped unsupported --no-x11 for this shell'
fi
if ! gnome-shell --help 2>&1 | grep -q -- '--headless'; then
    echo 'zipcheck: FAIL: guest shell understands neither --headless nor its substitute'
fi
# gate hygiene, guest-local only: insert one log-cleaning line into the
# throwaway zipcheck copy, immediately before its ERRS= computation, so
# (a) the whitelisted environmental lines cannot fabricate a verdict and
# (b) every other character of the zipcheck lock keeps voting unmodified.
HOSTILE='Could not get a proxy for user|The connection is closed'
awk '/^ERRS=/{print "grep -Ev \"" pat "\" \"$LOG\" >\"$LOG.envclean\"; mv \"$LOG.envclean\" \"$LOG\""}1' \
    pat="$HOSTILE" tools/zipcheck.sh > tools/zipcheck.sh.qa && mv tools/zipcheck.sh.qa tools/zipcheck.sh
chmod +x tools/zipcheck.sh   # the awk-rewritten copy lands 644; keep it runnable
grep -q 'LOG.envclean' tools/zipcheck.sh \
    || { echo 'qa: zipcheck gate-patch insertion failed'; exit 1; }
stage t3.zipcheck GRADE tools/zipcheck.sh
# persist the boot log whether the gate passed or not: an error-gate
# verdict names line COUNTS; adjudicating them requires the LINES, and
# the guest filesystem dies with --rm
cp /tmp/opencode/zipcheck.log /out/zipcheck-boot.log 2>/dev/null

# ---------- exception scan across every guest-shell log --------------------
# Attribute 'JS ERROR'-class lines to OUR modules only: the fake system
# bus legally floods the log with login1/portal complaints that belong
# to the environment, not to the extension. A window-grab then a token
# match: an exception counts iff its message or stack frames name one
# of our files.
OURJS='weatherglass@vijaybala|menutest@|probe@vijaybala|card-mode\.js|film-mode\.js|/menu\.js|/chart\.js|/sky\.js|/painter\.js|/moon\.js|/weather\.js|/animation\.js|/ink-policy\.js|/prefs\.js|/extension\.js'
ERRS=$(grep -A6 'JS ERROR\|TypeError\|ReferenceError\|RangeError\|Unhandled promise rejection' \
        /out/log-t2.cards.txt /out/log-t3.zipcheck.txt /tmp/opencode/wg-nested.log \
        /tmp/opencode/zipcheck.log 2>/dev/null | grep -Ec "$OURJS")
echo -e "scan.js-errors\t$([ "$ERRS" = 0 ] && echo PASS || echo "FAIL($ERRS)")\tGRADE\t-" >> "$SUM"
[ "$ERRS" = 0 ] || OVERALL=1
echo "==> JS exception count across nested-shell logs: $ERRS"

# ---------- verdict ---------------------------------------------------------
MD=/out/summary.md
{
    echo "# Weatherglass QA on $(cat "$STAMPS" | paste -sd' | ')"
    echo
    echo "| stage | result | weight | time |"
    echo '|---|---|---|---|'
    column -t -s "$(printf '\t')" "$SUM" | sed 's/^/| /; s/ *$/ |/; s/ \+/ |/g'
    echo
    echo "Pixel drift vs the host-shell blessed goldens: \`diffs.txt\`;"
    echo "native $(head -1 "$STAMPS") renders: \`cards/\`; sample diff sheets: \`diffs/\`."
} > "$MD"
echo; cat "$MD"
exit $OVERALL
