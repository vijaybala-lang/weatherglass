#!/usr/bin/env bash
# tools/zipcheck.sh — end-to-end proof that the built zip installs and runs.
#
# Installs dist/<uuid>.zip via `gnome-extensions install` (the same path
# the Extensions app / EGO take, and which validates the zip layout: one
# top-level dir named after the uuid, valid metadata), boots a headless
# nested gnome-shell with only that extension + the menu-painting probe,
# opens/closes the popup, and greps the journal for trouble.
#
# Run after tools/package.sh. Exit 0 = the zip is good to upload.

set -u
PROJ="$(cd "$(dirname "$0")/.." && pwd)"
UUID=$(python3 -c "import json;print(json.load(open('$PROJ/metadata.json'))['uuid'])")
ZIP="$PROJ/dist/$UUID.zip"
H=/tmp/opencode/zipcheck-home
LOG=/tmp/opencode/zipcheck.log
SCHEMA=org.gnome.shell.extensions.weatherglass

[[ -f "$ZIP" ]] || { echo "zipcheck: run tools/package.sh first" >&2; exit 1; }

rm -rf "$H"; mkdir -p "$H/.local/share/gnome-shell/extensions"
# schemas for the gsettings CLI only — the shell loads the compiled ones
# inside the extension itself, exactly like a real install
mkdir -p "$H/.local/share/glib-2.0/schemas"
cp "$PROJ/schemas/"*.xml "$H/.local/share/glib-2.0/schemas/"
glib-compile-schemas "$H/.local/share/glib-2.0/schemas"
cp -r "$PROJ/tools/menutest@vijaybala.dev" "$H/.local/share/gnome-shell/extensions/"

export HOME="$H" XDG_DATA_DIRS=/usr/share
unset WAYLAND_DISPLAY DISPLAY
export G_MESSAGES_DEBUG=all

timeout 180 dbus-run-session -- bash -c "
  echo '=== install from zip (validates layout + metadata) ==='
  gnome-extensions install '$ZIP' || { echo 'FAIL: zip rejected on install'; exit 1; }
  [[ -f \"\$HOME/.local/share/gnome-shell/extensions/$UUID/extension.js\" ]] \
      || { echo 'FAIL: not extracted under the uuid dir'; exit 1; }
  gsettings set org.gnome.shell enabled-extensions '[\"$UUID\", \"menutest@vijaybala.dev\"]'
  gsettings set $SCHEMA units 'imperial'
  gsettings set $SCHEMA auto-location false
  gsettings set $SCHEMA location-latitude 47.6062
  gsettings set $SCHEMA location-longitude -122.3321
  gsettings set $SCHEMA location-name 'Seattle'
  gnome-shell --headless --virtual-monitor 1280x800 --no-x11 &
  GPID=\$!
  for i in \$(seq 1 40); do
    sleep 2
    busctl --user --no-pager tree org.gnome.Shell >/dev/null 2>&1 || { kill -0 \$GPID || exit 1; continue; }
    sleep 10
    kill -0 \$GPID 2>/dev/null || { echo 'FAIL: shell died with the zip-installed extension'; exit 1; }
    kill \$GPID; exit 0
  done
  kill \$GPID; exit 1
" >"$LOG" 2>&1
RC=$?

echo "--- verdict ---"
ERRS=$(grep -cE "JS ERROR|logError|CRITICAL|assertion" "$LOG")
RUNS=$(grep -c "Weatherglass v" "$LOG")
PAINT=$(grep -c "menutest: DONE" "$LOG")
STATE=$(grep -c "\"state\": 1" "$LOG" || true)
[[ $RC == 0 ]] || { echo "zipcheck: FAIL (boot run rc=$RC, see $LOG)"; exit 1; }
[[ $RUNS -ge 1 ]] || echo "zipcheck: note: 'Weatherglass v…' banner missing"
[[ $PAINT -ge 1 ]] || { echo "zipcheck: FAIL: popup never painted"; exit 1; }
[[ $ERRS == 0 ]] || { echo "zipcheck: FAIL: $ERRS error-gate lines in $LOG"; exit 1; }
echo "zipcheck: PASS — $ZIP installs, boots, paints ($RUNS banner, $PAINT paint sets, $ERRS errors)"
