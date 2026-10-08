/* tests/ink.test.mjs -- the color-space locks. Every glyph/palette gate
 * in this extension compares against WCAG (gamma-corrected) luminance;
 * the v6 incident shipped plain-mean thresholds into that space, which
 * silently turned every daytime card into a "night" card. These tests
 * pin the space itself and the verdicts it drives.
 */
import { lumOf, pickInk, INK_DARK, tileGlyphPale, GLYPH_BAR } from '../chart.js';
import { file, test, ok, near, report, lumOfPlain } from './harness.mjs';

file('ink');

// -- the space itself ------------------------------------------------

test('white and black anchor the scale', () => {
    near(lumOf([1, 1, 1]), 1, 0.001);
    near(lumOf([0, 0, 0]), 0, 0.001);
});

test('WCAG, not a plain mean (mid gray)', () => {
    // 0.5 gray is ~0.21 in WCAG -- plain mean would say 0.50
    near(lumOf([0.5, 0.5, 0.5]), 0.214, 0.01);
});

test('the incident pixel reads 0.39 WCAG / 0.66 plain', () => {
    // Metuchen's overcast card foot rgb(155,170,186): the exact numbers
    // behind "deep ink never fired live" -- any drift here means someone
    // changed the referee space
    const px = [155 / 255, 170 / 255, 186 / 255];
    near(lumOf(px), 0.393, 0.01);
    ok(lumOfPlain(px) > 0.63, 'plain mean must stay high (the trap)');
});

test('no daylight ground reaches a plain-space bar like 0.55', () => {
    // the second misread gate: _iconDark used lumOf < 0.55 for "dark"
    const clearDayFoot = [0.78, 0.84, 0.90];
    ok(lumOf(clearDayFoot) < 0.75, 'even the brightest sky foot reads modest WCAG lume');
    ok(lumOf([0.5, 0.6, 0.7]) < 0.45, 'typical overcast reads below 0.45');
});

// -- the shared bar --------------------------------------------------

test('the bar lives between the measured pale and ink camps', () => {
    // approved pale grounds (hover slabs ~0.18, dusk ~0.23) vs daytime
    // overcast (0.39) -- the bar must separate them with margin
    ok(GLYPH_BAR > 0.24 && GLYPH_BAR < 0.35, `bar ${GLYPH_BAR} outside sane window`);
});

// -- the day-tile verdict --------------------------------------------

const hoverSlab = [0.43, 0.47, 0.52];     // ~0.18 WCAG: glow camp (approved)
const dusk = [0.5, 0.52, 0.58];           // ~0.23: glow camp (Kilimanjaro)
const overcast = [155 / 255, 170 / 255, 186 / 255];  // ~0.39: ink camp
const brightDay = [0.78, 0.84, 0.90];     // ~0.66: ink camp

test('overcast and bright-day tiles wear ink (the regression)', () => {
    ok(!tileGlyphPale(overcast), 'overcast foot must NOT be pale');
    ok(!tileGlyphPale(brightDay), 'clear-day foot must NOT be pale');
});

test('hover slabs and dusk keep the glow (the approval)', () => {
    ok(tileGlyphPale(hoverSlab), 'hover slab glyph must be pale');
    ok(tileGlyphPale(dusk), 'dusk tile glyph must be pale');
});

test('selected/solid-dark hands stay on the glow family', () => {
    ok(tileGlyphPale(brightDay, { selected: true }), 'selected tile glows on any ground');
    ok(tileGlyphPale(brightDay, { solidDark: true }), 'solid-dark card glows');
});

test('labels and glyph agree on the bright side', () => {
    // where the label goes ink, only the soft-glyph bar may override --
    // over a ground with dark labels the glyph must not be pale
    ok(pickInk(overcast) === INK_DARK);
    ok(!tileGlyphPale(overcast));
});

report('ink');
