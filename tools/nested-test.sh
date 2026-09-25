#!/usr/bin/env bash
# Boot a nested headless gnome-shell with only our extension enabled.
# Exercises: imperial units + manual city (cold start), a rapid city change
# while a fetch may be in flight, and opening the prefs window.
set -u
PROJ="$(cd "$(dirname "$0")/.." && pwd)"   # run from tools/../ -> project root
H=/tmp/opencode/nested-home
LOG=/tmp/opencode/nested.log
SCHEMA=org.gnome.shell.extensions.animated-weather

rm -rf "$H"; mkdir -p "$H/.local/share/gnome-shell"
ln -s ~/.local/share/gnome-shell/extensions "$H/.local/share/gnome-shell/extensions"
mkdir -p "$H/.local/share/glib-2.0/schemas"
cp "$PROJ/schemas/"*.xml "$H/.local/share/glib-2.0/schemas/"
glib-compile-schemas "$H/.local/share/glib-2.0/schemas"

export HOME="$H" XDG_DATA_DIRS=/usr/share
unset WAYLAND_DISPLAY DISPLAY
export G_MESSAGES_DEBUG=all

timeout 120 dbus-run-session -- bash -c "
  gsettings set org.gnome.shell enabled-extensions '[\"animated-weather@vbala.dev\"]'
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
    sleep 8
    echo '=== scenario 2: rapid city change ==='
    gsettings set $SCHEMA location-latitude 37.7749
    gsettings set $SCHEMA location-longitude -122.4194
    gsettings set $SCHEMA location-name 'San Francisco'
    sleep 10
    echo '=== scenario 3: prefs ==='
    busctl --user call org.gnome.Shell.Extensions /org/gnome/Shell/Extensions org.gnome.Shell.Extensions OpenExtensionPrefs ssa{sv} animated-weather@vbala.dev '' 0
    sleep 6
    kill \$GPID; exit 0
  done
  kill \$GPID
" >"$LOG" 2>&1
echo "exit: $?"
