#!/usr/bin/env bash
# tools/hover-check.sh — dump the RESOLVED hover styling of the card's
# custom controls (tabs, day tiles, ghost buttons) inside a headless
# Shell 50 session, using the working-tree sources.
#
# Prints each control's effective style classes and its background-color
# before/after set_hover(true) — the ground truth for "is the hover state
# visible in theme (accent) style?". Run: tools/hover-check.sh
# Full journal: /tmp/opencode/hover.log

set -u
PROJ="$(cd "$(dirname "$0")/.." && pwd)"
UUID=$(python3 -c "import json;print(json.load(open('$PROJ/metadata.json'))['uuid'])")
H=/tmp/opencode/hover-home
LOG=/tmp/opencode/hover.log
SCHEMA=org.gnome.shell.extensions.weatherglass
PROBE_SRC="${1:-$PROJ/tools/hoverprobe@vijaybala.dev}"

rm -rf "$H"; mkdir -p "$H/.local/share/gnome-shell/extensions" \
    "$H/.local/share/glib-2.0/schemas"
cp "$PROJ/schemas/"*.xml "$H/.local/share/glib-2.0/schemas/"
glib-compile-schemas "$H/.local/share/glib-2.0/schemas"
DEST="$H/.local/share/gnome-shell/extensions/$UUID"
mkdir -p "$DEST"
rsync -a --exclude .git --exclude out --exclude po --exclude tools \
      --exclude mockups --exclude dist --exclude .gitignore \
      "$PROJ/" "$DEST/"
cp -r "$PROBE_SRC" "$H/.local/share/gnome-shell/extensions/"

export HOME="$H" XDG_DATA_DIRS=/usr/share
unset WAYLAND_DISPLAY DISPLAY
export G_MESSAGES_DEBUG=all

timeout 120 dbus-run-session -- bash -c "
  gsettings set org.gnome.shell enabled-extensions '[\"$UUID\", \"hoverprobe@vijaybala.dev\"]'
  gsettings set org.gnome.desktop.interface color-scheme 'prefer-light'
  gsettings set $SCHEMA units 'imperial'
  gsettings set $SCHEMA auto-location false
  gsettings set $SCHEMA location-latitude 47.6062
  gsettings set $SCHEMA location-longitude -122.3321
  gsettings set $SCHEMA location-name 'Seattle'
  gsettings set $SCHEMA menu-style '${AW_STYLE:-animated}'
  gnome-shell --headless --virtual-monitor 1280x800 --no-x11 &
  GPID=\$!
  for i in \$(seq 1 45); do
    sleep 2
    grep -q 'hoverprobe: DONE' '$LOG' 2>/dev/null && { kill \$GPID; exit 0; }
    busctl --user --no-pager tree org.gnome.Shell >/dev/null 2>&1 || \
        { kill -0 \$GPID || exit 1; continue; }
  done
  kill \$GPID; exit 1
" >"$LOG" 2>&1
RC=$?
grep -aE "hoverprobe:|stylesheet|Stylesheet|parse" "$LOG" | tail -25
echo "--- errors ---"
grep -acE "JS ERROR|logError" "$LOG" || true
exit $RC
