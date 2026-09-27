#!/usr/bin/env bash
# tools/package.sh — build the extensions.gnome.org upload zip.
#
#   tools/package.sh            rebuild locales, assemble dist/, run the
#                               review sanity checks, zip it
#
# Output: dist/<uuid>.zip — the file to upload. Fails loudly (exit 1) on
# anything EGO review dislikes: stale app names, absolute paths, a schema
# id that doesn't match the uuid, missing catalogs.

set -euo pipefail
cd "$(dirname "$0")/.."
ROOT=$PWD
fail() { echo "package: FAIL: $*" >&2; exit 1; }
have() { command -v "$1" >/dev/null 2>&1; }

UUID=$(python3 -c "import json;print(json.load(open('metadata.json'))['uuid'])") \
    || fail 'metadata.json unreadable'
SCHEMA=$(python3 -c "import json;print(json.load(open('metadata.json'))['settings-schema'])")
[[ "$SCHEMA" == "org.gnome.shell.extensions.${UUID%@*}" ]] \
    || fail "settings-schema '$SCHEMA' does not match uuid '$UUID' (EGO requires org.gnome.shell.extensions.<first uuid part>)"
python3 -c "import json,sys; v=json.load(open('metadata.json'))['version']; sys.exit(0 if isinstance(v,int) else 1)" \
    || fail 'metadata version must be an integer for EGO update diffing'

have zip || fail 'zip not found'

echo "==> schema"
glib-compile-schemas schemas/

echo "==> locales"
tools/i18n-build.sh >/dev/null

echo "==> assembling dist/$UUID"
rm -rf "dist/$UUID" "dist/$UUID.zip"
mkdir -p "dist/$UUID/schemas"
cp metadata.json extension.js prefs.js menu.js chart.js sky.js painter.js \
   weather.js moon.js animation.js i18n.js stylesheet.css README.md LICENSE \
   "dist/$UUID/"
cp "schemas/$SCHEMA.gschema.xml" schemas/gschemas.compiled "dist/$UUID/schemas/"
cp -r locale "dist/$UUID/"

echo "==> sanity checks"
grep -rl "animated-weather" "dist/$UUID" \
    && fail 'old app name present in dist (see list above)'
if grep -rn "/home/\|/tmp/\|/usr/share" dist/"$UUID"/*.js \
        | grep -v "gnome-shell"; then
    fail 'absolute paths found in shipped JS'
fi
need=(metadata.json extension.js prefs.js schemas/gschemas.compiled LICENSE)
for f in "${need[@]}"; do
    [[ -f "dist/$UUID/$f" ]] || fail "missing $f"
done
[[ -f "dist/$UUID/schemas/$SCHEMA.gschema.xml" ]] || fail 'schema xml name mismatch'
missing=0
while read -r lang; do
    [[ -f "dist/$UUID/locale/$lang/LC_MESSAGES/$UUID.mo" ]] \
        || { echo "  missing catalog: $lang" >&2; missing=1; }
done < po/LINGUAS
[[ $missing == 0 ]] || fail 'locale catalogs missing'

echo "==> zipping"
(cd dist && zip -qr "$UUID.zip" "$UUID")
FILES=$(unzip -l "dist/$UUID.zip" | tail -1 | awk '{print $2}')
echo "done: dist/$UUID.zip  ($(du -h "dist/$UUID.zip" | cut -f1), $FILES files)"
echo "upload this at https://extensions.gnome.org/upload/ — the site asks"
echo "for name/description/screenshots; keep metadata version bumped per upload."
