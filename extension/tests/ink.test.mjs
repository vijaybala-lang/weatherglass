/* tests/ink.test.mjs -- the color-space locks. Every glyph/palette gate
 * in this extension compares against WCAG (gamma-corrected) luminance;
 * the v6 incident shipped plain-mean thresholds into that space, which
 * silently turned every daytime card into a "night" card. These tests
 * pin the space itself and the verdicts it drives.
 */
import Cairo from 'gi://cairo';
import GdkPixbuf from 'gi://GdkPixbuf';
import { lumOf, pickInk, INK_DARK, tileGlyphPale, GLYPH_BAR } from '../chart.js';
import { bodyOf, createSky, paintSky } from '../sky.js';
import { chromeVerdicts, compositeGround } from '../ink-policy.js';
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

test('the judge-visible sun disc matches the painted core', () => {
    // the Tokyo incident: white city text sat ON the drawn disc because
    // bodyOf modelled a small blob (0.45r) the judge sampled around.
    // The ink judge must be shown the SAME core radius drawCelestial
    // paints: 64 * scale at the sunSpot position.
    const body = bodyOf('sun', false, 330, 430, 0, 0.95);
    near(body.r, 64 * 430 / 420, 0.01);
    ok(body.max >= 0.85, 'the opaque core must read as near-total coverage');
    near(body.x, 0.82 * 330, 0.01);
    near(body.y, (0.21 - 0.09 * 0.95) * 430, 0.01);
});

test('chrome grouping: one verdict per judged group', () => {
    // synthetic card: dark sky left, sun-disc bright right
    const W = 330, H = 443;
    const bgPoint = fx => (fx > 0.5 ? [0.98, 0.93, 0.8] : [0.12, 0.25, 0.45]);
    const v = chromeVerdicts({
        headerLeft: [[14, 14, 90, 40], [14, 60, 80, 12]],
        headerRight: [[220, 16, 96, 16], [248, 36, 68, 12]],
        tabActive: [14, 84, 110, 21],
        tabsIdle: [[132, 84, 108, 21], [248, 84, 68, 21]],
    }, W, H, bgPoint, bg => bg.map(c => c * 0.4));
    ok(v.headerRight.ink === INK_DARK, 'disc behind city+clock inks BOTH');
    ok(v.headerLeft.ink !== INK_DARK, 'the left pair on dark sky stays glow');
    // the active tab sits over the SAME bright ground as headerRight,
    // but judged through its glass (here 0.4x) it must stay glow --
    // proof the compGlass pass is actually applied to that group
    ok(v.tabActive.ink !== INK_DARK, 'glass-deepened ground keeps the glow seat');
    ok(v.tabsIdle.ink === INK_DARK, 'a disc under ANY idle tab inks the row');
});

// -- the composited ground (issue #89, solid style) ------------------
// paintSky paints the disc FIRST and the solid scrim OVER it; the ink
// sampler once composited in the opposite order (scrim, then the full
// undimmed disc), so on a solid-dark card the judge believed the
// top-right sat on a bright sun and inked city+clock black over a
// ground that is actually dim. compositeGround is the one shared
// composition -- disc over sky, scrim over both -- for menu and demo.

const solidDarkScrim = [0.03, 0.045, 0.08, 0.78];
const solidLightScrim = [0.97, 0.975, 0.995, 0.80];
const daySkyTop = [0.35, 0.55, 0.85];
const sunBody = bodyOf('sun', false, 330, 430, 0, 0.95);

test('solid-dark: the scrim dims the disc before the judge sees it (#89)', () => {
    const onDisc = compositeGround(daySkyTop, solidDarkScrim, sunBody, 0);
    ok(pickInk(onDisc) !== INK_DARK,
        'top-right on a scrim-dimmed sun must stay white, not ink black');
});

test('animated: the bare disc still inks the header (Tokyo stays fixed)', () => {
    const onDisc = compositeGround(daySkyTop, null, sunBody, 0);
    ok(pickInk(onDisc) === INK_DARK,
        'no scrim: text on the painted sun core still goes ink');
});

test('solid-light: the bright wash keeps ink on the disc', () => {
    const onDisc = compositeGround(daySkyTop, solidLightScrim, sunBody, 0);
    ok(pickInk(onDisc) === INK_DARK, 'light wash ground must wear ink');
});

test('off-disc grounds are plain scrimmed sky', () => {
    const far = compositeGround(daySkyTop, solidDarkScrim, sunBody, 10000);
    const noBody = compositeGround(daySkyTop, solidDarkScrim, null, 0);
    far.forEach((c, i) => near(c, noBody[i], 1e-9));
    near(noBody[0], daySkyTop[0] * 0.22 + 0.03 * 0.78, 1e-9);
});

// -- windy clear night / golden hour (woodland + zenith stars + 45% moon) --

test('wind night: moonlit woodland separates from twilight sky, zenith stars + 45% moon only on clear sky', () => {
    ok(bodyOf('wind', true, 330, 430, 0.96, null, 0.5) === null,
        'wind 45% moon must not trigger dark headerRight ink on night sky');
    ok(bodyOf('wind', false, 330, 430, 0, 0.95) === null,
        'wind day has no sun disc');

    const W = 330, H = 430;
    const sky = createSky();
    const surf = new Cairo.ImageSurface(Cairo.Format.ARGB32, W, H);
    const cr = new Cairo.Context(surf);
    paintSky(cr, {
        w: W, h: H, time: 1.1, scene: 'wind', night: true,
        glow: 0.965, phase: 0.25, code: 0, sky, fxScale: 1,
    });
    cr.$dispose();
    ok(sky.stars.length === 35, `expected 35 wind stars on 330x430 card, got ${sky.stars.length}`);
    for (const s of sky.stars)
        ok(s.y <= 0.29 * H + 0.01, `wind star at y=${s.y} bled into woodland below 0.29*H`);
    const expectedMoonR = (64 * (H / 420) * 0.45).toFixed(1);
    ok(sky.moonSprite && sky.moonSprite.key.startsWith(`${expectedMoonR}|`),
        `expected 45% moon sprite (${expectedMoonR}), got ${sky.moonSprite ? sky.moonSprite.key : 'none'}`);

    const tmpFx = '/tmp/wg-test-wind-fx.png';
    const tmpBg = '/tmp/wg-test-wind-bg.png';
    sky.fx.writeToPNG(tmpFx);
    sky.cache.writeToPNG(tmpBg);
    const pbFx = GdkPixbuf.Pixbuf.new_from_file(tmpFx);
    const pbBg = GdkPixbuf.Pixbuf.new_from_file(tmpBg);
    const pxFx = pbFx.get_pixels(), pxBg = pbBg.get_pixels();
    const stride = pbFx.get_rowstride(), nChan = pbFx.get_n_channels();
    let separatedPx = 0;
    for (let y = 125; y <= 155; y++) {
        for (let x = 20; x < W - 20; x++) {
            const idx = y * stride + x * nChan;
            const dG = (pxFx[idx + 1] - pxBg[idx + 1]) / 255;
            const dB = (pxFx[idx + 2] - pxBg[idx + 2]) / 255;
            if (dG > 0.06 || dB > 0.06)
                separatedPx++;
        }
    }
    ok(separatedPx > 1500,
        `moonlit woodland must visibly separate from twilight backdrop (got ${separatedPx} px)`);

    const skyOvercast = createSky();
    const surf2 = new Cairo.ImageSurface(Cairo.Format.ARGB32, W, H);
    const cr2 = new Cairo.Context(surf2);
    paintSky(cr2, {
        w: W, h: H, time: 1.1, scene: 'wind', night: true,
        glow: 0.965, phase: 0.25, code: 3, sky: skyOvercast, fxScale: 1,
    });
    cr2.$dispose();
    ok(skyOvercast.moonSprite === null, 'overcast wind night must not paint moon');
});

test('narrow card height expansion (advisory expand/collapse) preserves sky clouds, scale and floor ripples', () => {
    const W = 330, H_COLLAPSED = 514, H_EXPANDED = 615;
    const sky = createSky();
    const surf1 = new Cairo.ImageSurface(Cairo.Format.ARGB32, W, H_COLLAPSED);
    const cr1 = new Cairo.Context(surf1);
    paintSky(cr1, {
        w: W, h: H_COLLAPSED, time: 1.1, scene: 'storm', night: false,
        sky, fxScale: 1,
    });
    cr1.$dispose();

    const cloudsBefore = sky.clouds.map(c => ({ x: c.x, y: c.y, scale: c.scale }));
    const ripplesBefore = sky.ripples.map(r => ({ x: r.x, y: r.y }));
    const floorBefore = sky.drops.map(d => d.floorY);
    for (const r of ripplesBefore)
        ok(r.y >= H_COLLAPSED - 0.32 * 477,
            `collapsed ripple y=${r.y} climbed above day-tile floor`);

    const surf2 = new Cairo.ImageSurface(Cairo.Format.ARGB32, W, H_EXPANDED);
    const cr2 = new Cairo.Context(surf2);
    paintSky(cr2, {
        w: W, h: H_EXPANDED, time: 1.1, scene: 'storm', night: false,
        sky, fxScale: 1,
    });
    cr2.$dispose();

    const deltaH = H_EXPANDED - H_COLLAPSED;
    ok(sky.clouds.length === cloudsBefore.length, 'cloud count must not change on height expand');
    sky.clouds.forEach((c, i) => {
        near(c.x, cloudsBefore[i].x, 1e-6);
        near(c.y, cloudsBefore[i].y, 1e-6);
        near(c.scale, cloudsBefore[i].scale, 1e-6);
    });
    sky.ripples.forEach((r, i) => {
        near(r.x, ripplesBefore[i].x, 1e-6);
        near(r.y, ripplesBefore[i].y + deltaH, 1e-6);
        ok(r.y >= H_EXPANDED - 0.32 * 477,
            `expanded ripple y=${r.y} climbed into chart above day-tile floor`);
    });
    sky.drops.forEach((d, i) => {
        near(d.floorY, floorBefore[i] + deltaH, 1e-6);
    });

    const b1 = bodyOf('sun', false, W, H_COLLAPSED, 0, 0.5);
    const b2 = bodyOf('sun', false, W, H_EXPANDED, 0, 0.5);
    near(b1.x, b2.x, 1e-6);
    near(b1.y, b2.y, 1e-6);
    near(b1.r, b2.r, 1e-6);
});

report('ink');
