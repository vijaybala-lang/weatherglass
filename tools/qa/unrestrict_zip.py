#!/usr/bin/python3
"""tools/qa/unrestrict_zip.py -- broaden metadata.json shell-version to
["*"] inside a GUEST-COPY of the dist zip (run.sh era block, Fedora <=41).

WHY: 45-47-era extensionUtils gate extension loading on a literal
shell-version match and offer no developer override -- --unsafe-mode
(which those builds happily parse and silently ignore for this
purpose) changes nothing, verified: identical 'in state OUT_OF_DATE'
lines with and without it. Loading an uncertified-era zip to PROVE
compatibility therefore requires relaxing the DECLARATION, which is
packaging metadata, not product code: the graded JS/cairo/pango path
stays byte-for-byte the bytes we will upload, and the uploaded zip
keeps declaring only the majors that actually certified. This script
mutates nothing else: entries, order, compression preserved.
"""

import io
import json
import re
import sys
import zipfile

path = sys.argv[1]
decl = sys.argv[2] if len(sys.argv) > 2 else '*'
with zipfile.ZipFile(path) as zf:
    items = [(i, zf.read(i.filename)) for i in zf.infolist()]

seen = False
rebuilt = []
for info, data in items:
    if info.filename.endswith('metadata.json'):
        try:
            meta = json.loads(data.decode('utf-8'))
        except UnicodeDecodeError:
            rebuilt.append((info, data))
            continue
        if isinstance(meta, dict) and 'shell-version' in meta:
            old = meta['shell-version']
            if decl in old:
                print(f'already-declared: {info.filename} {old} contains "{decl}" -- bytes untouched')
                seen = True
                rebuilt.append((info, data))
                continue
            meta['shell-version'] = [decl]
            # Preserve authoring formatting apart from the one value.
            new_text = re.sub(r'"shell-version"\s*:\s*\[[^\]]*\]',
                              f'"shell-version": ["{decl}"]',
                              data.decode('utf-8'), count=1)
            data = new_text.encode('utf-8')
            print(f'unrestricted: {info.filename} {old} -> ["{decl}"]')
            seen = True
    rebuilt.append((info, data))

if not seen:
    sys.exit(f'{path}: no shell-version found -- refusing to pretend')

buf = io.BytesIO()
with zipfile.ZipFile(buf, 'w') as zo:
    for info, data in rebuilt:
        zi = zipfile.ZipInfo(info.filename, date_time=info.date_time)
        zi.compress_type = info.compress_type
        zi.external_attr = info.external_attr
        zo.writestr(zi, data)
with open(path, 'wb') as fh:
    fh.write(buf.getvalue())
print(f'repacked in place: {path}')
