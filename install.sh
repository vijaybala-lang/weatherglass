#!/usr/bin/env bash
# Install/upgrade the Animated Weather extension for the current user.
set -euo pipefail

UUID="animated-weather@vbala.dev"
SRC="$(cd "$(dirname "$0")" && pwd)"
DEST="${XDG_DATA_HOME:-$HOME/.local/share}/gnome-shell/extensions/$UUID"

command -v glib-compile-schemas >/dev/null || {
    echo "glib-compile-schemas not found (glib2-devel)"; exit 1; }

glib-compile-schemas "$SRC/schemas"

mkdir -p "$DEST"
# rsync keeps mtimes and cleans deleted files; fall back to cp if absent
if command -v rsync >/dev/null; then
    rsync -a --delete \
        --exclude 'tools/' --exclude 'install.sh' --exclude 'README.md' \
        --exclude '.git/' --exclude '*.png' \
        "$SRC/" "$DEST/"
else
    find "$DEST" -mindepth 1 -maxdepth 1 -exec rm -rf {} +
    for f in metadata.json extension.js animation.js menu.js painter.js \
             weather.js prefs.js stylesheet.css schemas; do
        cp -r "$SRC/$f" "$DEST/"
    done
fi

gnome-extensions enable "$UUID" 2>/dev/null || true
echo "Installed $UUID -> $DEST"
echo "If the panel icon does not appear, log out/in (or restart the shell session)."
