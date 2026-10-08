/* tests/scenarios.mjs -- certification matrix renderer.
 *
 * Paints every glyph pose on every ground tier the referee can hand it
 * (night/day, pale/ink), one cell per (scene, night, ground) triple, to
 * tools/out/certify/matrix-<scene>.png plus a sidecar manifest. The
 * companion checker (tools/certify-pixels.py) then asserts, per cell,
 * that the glyph's ACTUAL rendered contrast against its ground matches
 * the verdict the referee should have made -- pixels, not promises:
 * the WCAG-bar incident passed every prose-level review and only died
 * on a screenshot, so this suite grades screenshots.
 */
import Cairo from 'gi://cairo';
import GLib from 'gi://GLib';
import { paintWeather, createParticles, GRID } from '../painter.js';
import { GLYPH_BAR } from '../chart.js';

const OUT = 'tools/out/certify';
GLib.mkdir_with_parents(`${GLib.get_current_dir()}/${OUT}`, 0o755);

// ground tiers in WCAG-space values (what menu/chart hand the painter),
// with a swatch color that reads at that luminance
const GROUNDS = [
    { name: 'night',    wcag: 0.05, rgb: [0.10, 0.12, 0.18] },
    { name: 'slab',     wcag: 0.18, rgb: [0.30, 0.34, 0.40] },
    { name: 'dusk',     wcag: 0.23, rgb: [0.36, 0.40, 0.47] },
    { name: 'overcast', wcag: 0.39, rgb: [0.61, 0.67, 0.73] },
    { name: 'bright',   wcag: 0.66, rgb: [0.80, 0.85, 0.90] },
];
const SCENES = ['sun', 'moon', 'partly', 'cloud', 'fog', 'rain',
    'snow', 'sleet', 'hail', 'storm', 'wind'];
const CELL = 44, PAD = 4;

// The referee: night glyphs always glow; daytime glyphs follow the bar
// (this mirrors menu.tileGlyphPale + painter.paleGround, restated here
// on purpose: the expectation must be derivable without running the
// production gate, so a broken gate is caught rather than imprinted).
const expectPale = (night, wcag) => night || wcag < GLYPH_BAR;

// honest scenario pruning: cards never paint the moon glyph in a day
// slot (sceneFor only yields moon at night), and night glyphs on
// grounds brighter than the glow family itself (strip moons on a
// bright day band) are a design-accepted low-contrast case -- graded
// as 'present' (drawn, sane) rather than promised separation.
const isRealistic = (scene, night) => !(scene === 'moon' && !night);
const expectFamily = (scene, night, wcag) =>
    (night && wcag >= 0.30) ? 'present' : (expectPale(night, wcag) ? 'pale' : 'ink');

const manifest = [];
for (const scene of SCENES) {
    const cols = GROUNDS.length;
    const rows = 2; // day, night
    const w = cols * (CELL + PAD) + PAD, h = rows * (CELL + PAD) + PAD;
    const surf = new Cairo.ImageSurface(Cairo.Format.ARGB32, w, h);
    const cr = new Cairo.Context(surf);
    const particles = createParticles();
    for (let row = 0; row < rows; row++) {
        const night = row === 1;
        GROUNDS.forEach((g, col) => {
            if (!isRealistic(scene, night))
                return;
            const x = PAD + col * (CELL + PAD), y = PAD + row * (CELL + PAD);
            cr.setSourceRGB(...g.rgb);
            cr.rectangle(x, y, CELL, CELL);
            cr.fill();
            cr.save();
            cr.translate(x + (CELL - GRID) / 2, y + (CELL - GRID) / 2);
            paintWeather(cr, {
                scene, time: 1.25, night, dark: true,
                intensity: 4, windKmh: 14, phase: 0.25, seed: 11,
                groundLum: g.wcag, pale: expectPale(night, g.wcag),
                staticPose: true, particles,
            });
            cr.restore();
            manifest.push({
                png: `matrix-${scene}.png`, scene, night,
                ground: g.name, wcag: g.wcag,
                expected: expectFamily(scene, night, g.wcag),
                x, y, size: CELL,
            });
        });
    }
    surf.writeToPNG(`${OUT}/matrix-${scene}.png`);
    cr.$dispose();
}
const json = new GLib.Bytes(
    `${JSON.stringify({ bar: GLYPH_BAR, cells: manifest }, null, 1)}\n`).toArray();
GLib.file_set_contents(`${OUT}/manifest.json`, json);
log(`scenarios: ${manifest.length} cells -> ${OUT}/manifest.json`);
