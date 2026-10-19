#!/usr/bin/python3
"""tools/qa/keyfile_zipcheck.py -- teach tools/zipcheck.sh the settings
dialect the oldest nested shells speak (run.sh era block, Fedora <=41).

Observed, not theorized: with the dconf-profile recipe, GNOME 45/47
guests SEGFAULT moments after INITIALIZING the zip-installed extension
(the Fedora gnome-desktop3 localed callback, reachable only while
input-sources is EMPTY) and GNOME 46 activates NOTHING -- both land in
state INITIALIZED and stay there until the timeout, though the same
profile shape enables happily when the shell-golden keyfile recipe
drinks from it. Keyfile-backed profiles are the era's native tongue
(shell-golden proof, green on all three legs); dconf-on-disposable-HOME
is modern-era etiquette the old daemons politely ignore -- or die on.

This rewriter trades the recipe on the guest /work copy only:
  * XDG_CONFIG_HOME pins the profile to the zipcheck HOME (never the
    container's real config), and GSETTINGS_BACKEND=keyfile routes every
    gsettings read/write through it;
  * the enabled-extensions line grows a keyfile trailer seeding the SAME
    values zipcheck previously layered via gsettings (Seattle fixture,
    imperial units) plus the non-empty input-sources that keeps the
    crashing gnome-desktop path out of the program -- exactly the seed
    proven on the golden side, and belt-and-braces written twice because
    the gsettings-write may rewrite the same key;
  * the SCHEMA-valued gsettings lines lose their tails (values now come
    from the keyfile) after the literal is captured, so no product
    setting is lost in the translation.
bash -n guards the result. Host runs (>41) never see this file.
"""

import re
import sys

TARGET = 'tools/zipcheck.sh'
text = open(TARGET, encoding='utf-8').read()

anchor = "gsettings set org.gnome.shell enabled-extensions '[\\\"$UUID\\\", \\\"menutest@vijaybala.dev\\\"]'"
if anchor not in text:
    sys.exit(f'{TARGET}: enabled-extensions anchor drifted -- refusing to guess')
m = re.search(r"gsettings set (\$SCHEMA) units '([^']*)'", text)
if not m:
    sys.exit(f'{TARGET}: units fixture drifted -- refusing to guess')
schema, units = m.group(1), m.group(2)
lat = re.search(r'location-latitude (-?[\d.]+)', text).group(1)
lon = re.search(r'location-longitude (-?[\d.]+)', text).group(1)
name = re.search(r"location-name '([^']*)'", text).group(1)

def esc(value):
    """Value destined for inside the target's printf '...' literal."""
    return value.replace("'", "'\\''")


seed = (
    anchor
    + "\n  printf '\\n[org.gnome.desktop.input-sources]\\nsources=[(%s)]"
      "\\n[%s]\\nunits=%s\\nauto-location=false\\nlocation-latitude=%s"
      "\\nlocation-longitude=%s\\nlocation-name=%s\\n[org/gnome/desktop/input-sources]\\nsources=[(%s)]\\n'"
      " >> \"$XDG_CONFIG_HOME/glib-2.0/settings/keyfile\""
) % (
    esc("'xkb', 'us'"), schema, esc(repr(units)), lat, lon, esc(repr(name)),
    esc("'xkb', 'us'"),
)

text = text.replace(anchor, seed, 1)
new_export = ('export HOME="$H" XDG_CONFIG_HOME="$H" '
              'GSETTINGS_BACKEND=keyfile XDG_DATA_DIRS=/usr/share')
old_export = 'export HOME="$H" XDG_DATA_DIRS=/usr/share'
if old_export not in text:
    sys.exit(f'{TARGET}: export line drifted -- refusing a half-rewrite')
text = text.replace(old_export, new_export, 1)
before = len(text)
text = re.sub(r'[ \t]*gsettings set \$SCHEMA [^\n]*\n', '', text)
if len(text) >= before:
    sys.exit(f'{TARGET}: schema-line trim no-opped')

open(TARGET, 'w', encoding='utf-8').write(text)
print(f'keyfile-ized {TARGET}: {units}/{name} ({lat},{lon}) + input-sources seed migrated')
