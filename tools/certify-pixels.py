#!/usr/bin/env python3
"""tools/certify-pixels.py -- grades tools/out/certify/matrix-*.png.

For every cell in manifest.json it measures what the cairo painter
ACTUALLY put on the ground swatch and asserts the rendered glyph has
real separation from that ground in the family the referee promised
(pale glow vs deep ink). Contrast evidence counts luminance plus a
capped chroma credit (a saturated gold sun separates by color, not
gray-level). This is deliberately dumb arithmetic on pixels: it cannot
share a bug with the TypeScript-side referee, which is exactly how the
WCAG-bar regression slipped past every code-level review.
"""
import json
import sys
from collections import Counter
from pathlib import Path

from PIL import Image

OUT = Path(sys.argv[1]) if len(sys.argv) > 1 else Path('tools/out/certify')
MIN_SEP = 0.10          # required separation (plain-lume units + chroma)
CHROMA_CREDIT = 0.8     # chroma -> separation credit multiplier
CHROMA_CAP = 0.12       # ... capped, so a garish blob cannot fake it
MIN_GLYPH_PX = 40       # a cell with less painted than this failed to draw

def plain_lume(c):
    return (0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]) / 255.0

def grade_cell(img, cell):
    x, y, s = cell['x'], cell['y'], cell['size']
    region = img.crop((x, y, x + s, y + s)).convert('RGB')
    px = list(region.getdata())
    ground_rgb, ground_n = Counter(px).most_common(1)[0]
    if ground_n < s * s * 0.20:
        return f"no stable ground swatch ({ground_n} px of {s * s})"
    ground = plain_lume(ground_rgb)
    # glyph pixels = anything visibly deviating from the swatch
    glyph = [p for p in px
             if max(abs(p[i] - ground_rgb[i]) for i in range(3)) > 6]
    if len(glyph) < MIN_GLYPH_PX:
        return f"glyph not drawn ({len(glyph)} deviating px)"
    want = cell['expected']
    if want == 'present':
        return None          # design-accepted: drawn and deviating is enough
    side = ([p for p in glyph if plain_lume(p) < ground] if want == 'ink'
            else [p for p in glyph if plain_lume(p) > ground])
    if len(side) < MIN_GLYPH_PX // 2:
        return (f"expected {want} evidence: only {len(side)} glyph px on "
                f"the {want} side of ground {ground:.2f}")
    side.sort(key=plain_lume, reverse=want != 'ink')
    core = side[:max(3, len(side) // 8)]
    core_mean = tuple(sum(p[i] for p in core) // len(core) for i in range(3))
    lume_sep = abs(plain_lume(core_mean) - ground)
    chroma = max(abs(core_mean[i] - ground_rgb[i]) for i in range(3)) / 255.0
    sep = min(lume_sep + min(CHROMA_CAP, chroma * CHROMA_CREDIT), 1.0)
    if sep < MIN_SEP:
        return (f"expected {want}: separation {sep:.2f} "
                f"(lume {lume_sep:.2f} chroma {chroma:.2f}) < {MIN_SEP}")
    return None

def main():
    manifest = json.loads((OUT / 'manifest.json').read_text())
    images = {name: Image.open(OUT / name) for name in
              {c['png'] for c in manifest['cells']}}
    failed = 0
    for cell in manifest['cells']:
        why = grade_cell(images[cell['png']], cell)
        if why:
            failed += 1
            print(f"  FAIL {cell['scene']}/{cell['night'] and 'night' or 'day'}"
                  f"/{cell['ground']}: {why}")
    total = len(manifest['cells'])
    print(f"pixel-certify: {total - failed}/{total} cells pass "
          f"(glyph bar {manifest['bar']})")
    return 1 if failed else 0

sys.exit(main())
