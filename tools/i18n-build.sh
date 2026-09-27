#!/usr/bin/env bash
# i18n pipeline: extract msgids from code -> merge into po/*.po ->
# compile locale/<lang>/LC_MESSAGES/<uuid>.mo. Run after touching any
# user-visible string; commit both the .po changes and the rebuilt .mo
# files (gnome-extensions.org ships compiled catalogs).
#
# Add a language: echo xx >> po/LINGUAS && touch po/xx.po (msgmerge
# starts it) and fill the msgstrs — untranslated entries fall back to
# English at runtime, never crash.
set -euo pipefail
cd "$(dirname "$0")/.."
export LC_ALL=C.UTF-8   # msgmerge chokes on UTF-8 msgids under a C locale

POT=po/weatherglass@vbala.dev.pot

xgettext -f po/POTFILES -F --language=JavaScript --from-code=UTF-8 \
    -k_ -kN_:1 --no-wrap \
    --package-name="Weatherglass" --package-version="5.6" \
    -o "$POT"

while read -r lang; do
    [ -n "$lang" ] || continue
    [ -f "po/$lang.po" ] || : > "po/$lang.po"
    msgmerge --quiet --update --backup=none "po/$lang.po" "$POT"
    mkdir -p "locale/$lang/LC_MESSAGES"
    msgfmt --check-format -o "locale/$lang/LC_MESSAGES/weatherglass@vbala.dev.mo" "po/$lang.po"
    printf '%s: ' "$lang"
    msgfmt --statistics -o /dev/null "po/$lang.po" 2>&1 || true
done < po/LINGUAS

echo "i18n: catalogs rebuilt under locale/"
