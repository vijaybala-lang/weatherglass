#!/usr/bin/env python3
"""tools/certify-pixels.py -- grades tools/out/certify/matrix-*.png.

  certify-pixels.py                 matrix mode (synthetic ground swatches)
  certify-pixels.py --grid [dir]    grid mode: full cards from
      tools/card-preview.mjs --coverage; ground is MEASURED from a ring
      around each strip glyph, and the pale/ink expectation is re-derived
      from the WCAG contrast formula -- pickInk's verdict must be visible
      in pixels, not just in code.


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

GRID = '--grid' in sys.argv
_args = [a for a in sys.argv[1:] if a != '--grid']
OUT = Path(_args[0]) if _args else Path('tools/out/grid' if GRID else 'tools/out/certify')
MIN_SEP = 0.10          # required separation (plain-lume units + chroma)
DARK_CORE = 0.045      # plain-lume delta that counts as a true ink/glow core
                        # (real tiers overshoot: CLOUD_RAIN mid -0.055,
                        #  INK_FOG -0.06..-0.10, FLAKE -0.16, azure -0.20;
                        #  a bleached palette BRIGHTENS past the ground)
                        # (a real deep stop overshoots this: INK_FLAKE -0.16,
                        #  INK_FOG -0.10, azure -0.20; a bleached palette
                        # tops out near the ground -> caught)
MIN_CORE_PX = 8          # ... and how many such px the glyph must own
                        # (the margin, not the count, carries the verdict)
MIN_SEP_SMALL = 0.075   # ... eroded for sub-16px glyphs: cairo AA on a
                        # 14px strip glyph blends the core toward the ground
                        # (the matrix cell constant was tuned at 44px,
                        # where cores are full-tone)
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
    return grade_against_ground(img.crop((x, y, x + s, y + s)), cell, ground_rgb)


def grade_against_ground(region, cell, ground_rgb):
    px = list(region.getdata())
    s = cell['size']
    ground = plain_lume(ground_rgb)
    # glyph pixels = anything visibly deviating from the swatch
    glyph = [p for p in px
             if max(abs(p[i] - ground_rgb[i]) for i in range(3)) > 6]
    if len(glyph) < MIN_GLYPH_PX:
        return f"glyph not drawn ({len(glyph)} deviating px)"
    want = cell['expected']
    if want == 'present':
        return None          # design-accepted: drawn and deviating is enough
    # Family evidence via the DARK/BRIGHT CORE INVARIANT: an ink glyph
    # must put pixels CLEARLY DARKER than the ground on screen (its deep
    # stop), a glow glyph pixels CLEARLY BRIGHTER. The invariant is AA-
    # proof for the wrong family: a wrongly-pale glyph blends white ->
    # ground, and every blend lands ON THE GROUND OR BRIGHTER -- it can
    # never manufacture the dark core, no matter how anti-aliased. Same
    # in reverse for a wrongly-ink glyph in a glow cell. Small glyphs
    # erode the CORE MAGNITUDE (CLOUD_DEEP's dark stop survives, its mean
    # lightens), so the magnitude test scales with cell size below.
    # Scene exemption: the sun/moon gold disc is the ink family's one
    # bright-by-design member on daylight grounds (golden-hour hue carries
    # the time; it separates warm-vs-cool, never dark) -- graded on
    # separation magnitude only.
    # 'partly' is sun-dominated too: a big gold disc + a small deep cloud
    # shadow, so its ink evidence is the shadow's few px -- grade by
    # magnitude, like the sun itself
    gold_disc = cell.get('scene') in ('sun', 'clear', 'partly', 'moon')
    sign = -1 if want == 'ink' else 1

    def deviation(p):
        return sign * (plain_lume(p) - ground)   # >0 = expected family side

    def sep_of(p):
        chroma = max(abs(p[i] - ground_rgb[i]) for i in range(3)) / 255.0
        credit = min(CHROMA_CAP, chroma * CHROMA_CREDIT)
        return ((abs(plain_lume(p) - ground) if gold_disc else deviation(p))
                + credit, p)

    scored = sorted((sep_of(p) for p in glyph), reverse=True)
    side = [(v, p) for v, p in scored if v > 0.02]
    # core existence: enough pixels CLEARLY on the expected side
    core_n = sum(1 for v, p in side
                 if gold_disc or deviation(p) >= DARK_CORE)
    # the core-count floor erodes with size like MIN_SEP_SMALL does; it is
    # NOT a detection knob -- the wrong family manufactures ZERO core px
    # (blends only approach the ground), so a low floor cannot hide an
    # inverted gate, it only tolerates thin AA strokes (1px fog lines)
    core_floor = 0.05 if s < 20 else 0.08
    if not gold_disc and core_n < max(MIN_CORE_PX, int(len(glyph) * core_floor)):
        return (f"expected {want} core: {core_n} clearly-{want} px of "
                f"{len(glyph)} (ground {ground:.2f})")
    core = [p for _, p in side[:max(3, len(side) // 8)]]
    core_mean = tuple(sum(p[i] for p in core) // len(core) for i in range(3))
    lume_sep = abs(plain_lume(core_mean) - ground)
    chroma = max(abs(core_mean[i] - ground_rgb[i]) for i in range(3)) / 255.0
    # magnitude threshold erodes with glyph size: a 44px matrix cell shows
    # full-tone cores; at 14px cairo AA blends the mean toward the ground.
    min_sep = MIN_SEP if s >= 20 else MIN_SEP_SMALL
    sep = min(lume_sep + min(CHROMA_CAP, chroma * CHROMA_CREDIT), 1.0)
    if sep < min_sep:
        return (f"expected {want}: separation {sep:.2f} "
                f"(lume {lume_sep:.2f} chroma {chroma:.2f}) < {min_sep}")
    return None


def wcag_lum(c):
    """WCAG relative luminance -- implemented here from the spec formula,
    NOT mirrored from chart.js, so the grader can catch a broken gate."""
    f = lambda v: v / 12.92 if v <= 0.03928 else ((v + 0.055) / 1.055) ** 2.4
    r, g, b = (v / 255.0 for v in c)
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)


def contrast(a, b):
    la, lb = wcag_lum(a), wcag_lum(b)
    return (max(la, lb) + 0.05) / (min(la, lb) + 0.05)


INK_DARK = (16, 24, 35)   # chart.js INK_DARK [0.063, 0.094, 0.137]


def grid_ground(img, cell):
    """(median color, luminance spread) of the sky ring hugging the glyph
    box. A wide spread means the box sits on a non-flat ground -- the sun
    disc's perch -- where the flat-ground evidence model is invalid and
    cells must grade 'present' rather than pretend."""
    x, y, s = (int(round(cell[k])) for k in ('x', 'y', 'size'))
    dil = 8
    ring = []
    w, h = img.size
    for py in range(max(y - dil, 0), min(y + s + dil, h)):
        for px_ in range(max(x - dil, 0), min(x + s + dil, w)):
            if x <= px_ < x + s and y <= py < y + s:
                continue   # inside the glyph box: not ground
            ring.append(img.getpixel((px_, py))[:3])
    ring.sort(key=lambda c: plain_lume(c))
    med = ring[len(ring) // 2]
    spread = plain_lume(ring[int(len(ring) * 0.95)]) - plain_lume(ring[len(ring) // 20])
    return med, spread


def grade_grid(img, cell):
    # the sampled ground the card's own geometry sampler saw (manifest
    # input, like the matrix's synthetic swatches); the ring measurement
    # stays as a sanity witness -- sun glow and curve ink corrupt rings
    # near bright discs, where the sampler is the honest ground
    # Expectation and evidence need DIFFERENT grounds: the sampled sky is
    # a model color that runs ~0.06 lighter than the painted one (gradient
    # + scene clouds in the render), so raw sky px would masquerade as
    # dark-core evidence if measured against it. Expectation (which family
    # SHOULD appear) derives from the sampler -- same input the referee
    # had, stable next to disc glow; evidence (what DID appear) measures
    # against the ring pixels -- the true local ground.
    # now-marker column: the time-fade veil edge and the marker line live
    # INSIDE the evidence model -- no flat ground exists there by design
    # (the guard spans the RING's reach too: the veil column corrupts the
    # ring median of a box that merely sits next to the marker)
    if 'markerX' in cell and cell['x'] - 10 <= cell['markerX'] <= cell['x'] + cell['size'] + 10:
        x, y, s = (int(round(cell[k])) for k in ('x', 'y', 'size'))
        return grade_against_ground(
            img.crop((x, y, x + s, y + s)).convert('RGB'),
            dict(cell, expected='present'), grid_ground(img, cell)[0])
    sampled = cell.get('ground')
    ground_rgb, spread = grid_ground(img, cell)
    sampled_rgb = (tuple(int(round(c * 255)) for c in sampled)
                   if sampled else ground_rgb)
    # re-derive the strip referee from WCAG formulas (not from chart.js):
    # DAY glyphs follow the ink/glow contrast verdict -- ink text wins
    # where its contrast beats the glow family's by the 1.35 hysteresis.
    # NIGHT glyphs always wear the painter's night palette (glow family):
    # groundLight() bows to the night flag, so on grounds the glow cannot
    # hold off (>= 0.30) they are design-accepted 'present', same rule as
    # the matrix.
    lum = wcag_lum(sampled_rgb)
    if spread > 0.07:
        # disc-glow / mixed ground: separation depends on WHERE in the box
        # you stand; only "drawn and deviating" is defensible there
        cell = dict(cell, expected='present')
        x, y, s = (int(round(cell[k])) for k in ('x', 'y', 'size'))
        return grade_against_ground(
            img.crop((x, y, x + s, y + s)).convert('RGB'), cell, ground_rgb)
    if cell['night']:
        # card-scale glow strokes are thinner than the matrix's 44px tiles,
        # so the design-acceptance floor erodes slightly at this scale
        exp = 'present' if lum >= 0.25 else 'pale'
    else:
        ink = contrast(INK_DARK, sampled_rgb) >= contrast((255, 255, 255), sampled_rgb) * 1.35
        exp = 'ink' if ink else 'pale'
    cell = dict(cell, expected=exp)
    x, y, s = (int(round(cell[k])) for k in ('x', 'y', 'size'))
    region = img.crop((x, y, x + s, y + s)).convert('RGB')
    return grade_against_ground(region, cell, ground_rgb)


def main():
    manifest = json.loads((OUT / 'manifest.json').read_text())
    images = {name: Image.open(OUT / name) for name in
              {c['png'] for c in manifest['cells']}}
    failed = 0
    if GRID:
        for cell in manifest['cells']:
            why = grade_grid(images[cell['png']], cell)
            if why:
                failed += 1
                card = cell['png'].removesuffix('.png').removeprefix('card_grid-')
                print(f"  FAIL {card} @x{cell['x']:.0f}: {why}")
        total = len(manifest['cells'])
        print(f"grid-certify: {total - failed}/{total} strip glyphs pass "
              f"({len({c['png'] for c in manifest['cells']})} cards)")
        return 1 if failed else 0
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
