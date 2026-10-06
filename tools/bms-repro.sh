#!/usr/bin/env bash
# Reproduce the "blur-my-shell makes menus square" report in a nested Shell.
# WEATHERGLASS=0 boots BMS + probe only (stock date menu); default also
# enables Weatherglass. Screenshot + scene-graph log land in /tmp/opencode.
set -u
PROJ="$(cd "$(dirname "$0")/.." && pwd)"
H=/tmp/opencode/bms-home
LOG=/tmp/opencode/bms-repro.log
PNG=/tmp/opencode/bms-repro.png
WEATHERGLASS="${WEATHERGLASS:-1}"

rm -rf "$H" /tmp/opencode/bms-dconf; mkdir -p "$H/.local/share/gnome-shell/extensions"
cp ~/.local/share/gnome-shell/extensions/blur-my-shell@aunetx \
   "$H/.local/share/gnome-shell/extensions/" -r
cp -r "$PROJ/tools/bmsprobe@vijaybala.dev" "$H/.local/share/gnome-shell/extensions/"
ENABLED='"blur-my-shell@aunetx", "bmsprobe@vijaybala.dev"'
if [ "$WEATHERGLASS" = "1" ]; then
  mkdir -p "$H/.local/share/gnome-shell/extensions"
  ln -s ~/.local/share/gnome-shell/extensions/weatherglass@vijaybala.dev \
        "$H/.local/share/gnome-shell/extensions/weatherglass@vijaybala.dev"
  mkdir -p "$H/.local/share/glib-2.0/schemas"
  cp "$PROJ/schemas/"*.xml "$H/.local/share/glib-2.0/schemas/"
  glib-compile-schemas "$H/.local/share/glib-2.0/schemas"
  ENABLED="$ENABLED, \"weatherglass@vijaybala.dev\""
fi
# carry the live dconf db so BMS runs with the user's real popup settings
mkdir -p "$H/.config/dconf"; cp ~/.config/dconf/user "$H/.config/dconf/user"

export HOME="$H" XDG_DATA_DIRS=/usr/share
unset WAYLAND_DISPLAY DISPLAY
export G_MESSAGES_DEBUG=all

timeout 150 dbus-run-session -- bash -c "
  gsettings set org.gnome.shell enabled-extensions '[$ENABLED]'
  gnome-shell --headless --virtual-monitor 1280x800 --no-x11 &
  GPID=\$!
  for i in \$(seq 1 40); do
    sleep 2
    busctl --user --no-pager tree org.gnome.Shell >/dev/null 2>&1 || { kill -0 \$GPID || exit 1; continue; }
    sleep 24
    busctl --user call org.gnome.Shell.Screenshot /org/gnome/Shell/Screenshot org.gnome.Shell.Screenshot Screenshot bbss false false '$PNG' ''
    sleep 2
    kill \$GPID; exit 0
  done
  kill \$GPID
" >"$LOG" 2>&1
echo "exit: $?"
grep "bmsprobe" "$LOG" | head -40
grep -ciE "blur.*(fail|error)|pipeline.*(fail|error)" "$LOG" || true
