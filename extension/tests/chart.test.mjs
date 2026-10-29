/* tests/chart.test.mjs -- chart geometry locks, driven through the real
 * paintChart via the slotsProbe observer. The plateau case is the exact
 * Kilimanjaro Friday incident: a flat 100% precip series whose wide
 * labels made the old widest-envelope collision drop the 4 AM and 10 PM
 * columns on a 400 px card.
 */
import Cairo from 'gi://cairo';
import { paintChart, ease, lerp, morphPair } from '../chart.js';
import { file, test, ok, near, eq, report } from './harness.mjs';

file('chart');

const fmtHour = i => {
    const h = i % 24, am = h < 12, hh = h % 12 === 0 ? 12 : h % 12;
    return `${hh}${am ? 'AM' : 'PM'}`;
};

// Real Open-Meteo Friday 2026-10-09, Mount Kilimanjaro, hourly precip %
const KILI = [76, 75, 77, 75, 65, 51, 39, 26, 14, 14, 38, 74,
    100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 99, 97];

function runSlots(values, fmt, unit, { w, fontSize, textScale, stripBottom = true, fmtHourFn = fmtHour }) {
    const kept = [], dropped = [];
    const surf = new Cairo.ImageSurface(Cairo.Format.ARGB32, w, 150);
    const cr = new Cairo.Context(surf);
    paintChart(cr, {
        w, h: 150, values,
        fmtValue: (i, v) => fmt(v),
        fmtValueUnit: unit ? () => unit : null,
        fmtHour: fmtHourFn,
        valueSamples: [...new Set(values.map(v => fmt(v) + (unit || '')))],
        accent: [0.13, 0.59, 0.95], ink: [1, 1, 1], nowFrac: null,
        scenes: Array(values.length).fill('rain'),
        nights: Array(values.length).fill(false),
        pills: false, dark: true, stripBottom,
        bgFn: () => [0.5, 0.5, 0.55],
        fontSize, textScale, textBold: false,
        slotsProbe: s => (s.keep ? kept : dropped).push(s.i),
    });
    cr.$dispose();
    return { kept, dropped };
}

test('the Kilimanjaro plateau keeps every hour column (the incident)', () => {
    // operator geometry: 400 px card, 8 pt text at 1.3 scale -- the old
    // guard failed 4 AM by 1.1 px here
    const { kept, dropped } = runSlots(KILI, v => `${v}%`, null,
        { w: 400, fontSize: 8, textScale: 1.3 });
    ok(kept.length > 0, 'no icon slots planned at all');
    ok(dropped.length === 0, `dropped hours: ${JSON.stringify(dropped)}`);
    ok(kept.includes(4), '4 AM slot vanished (plateau regression)');
    ok(kept.includes(22), '10 PM slot vanished (plateau regression)');
});

test('rolling 26-point day at menu width keeps the 1 PM column', () => {
    // operator screenshot 2026-10-25, Mount Kilimanjaro precip tab:
    // 330 px card, 8 pt at scale 1, rolling window from 3 AM -- 1 PM
    // (i=10, value 100%) vanished whole (glyph, hour and number) while
    // its ink still stood ~4 px clear of 10 AM's: the keep rule charged
    // each column's +3 padding AND a further +6 between padded edges,
    // a budget stricter than the stride stage that chose 3 h spacing
    const rolling = [4, 3, 5, 2, 1, 3, 12, 40, 75, 96, 100, 100, 100, 99,
        97, 92, 87, 80, 70, 61, 55, 47, 43, 40, 38, 36];
    const from3am = i => {
        const h = (i + 3) % 24, am = h < 12, hh = h % 12 === 0 ? 12 : h % 12;
        return `${hh}${am ? 'AM' : 'PM'}`;
    };
    const { kept, dropped } = runSlots(rolling, v => `${v}%`, null,
        { w: 330, fontSize: 8, textScale: 1, fmtHourFn: from3am, stripBottom: false });
    ok(dropped.length === 0, `dropped hours: ${JSON.stringify(dropped)}`);
    ok(kept.includes(10), '1 PM slot vanished (rolling-window regression)');
});

test('giant labels thin by stride and never overlap', () => {
    // The chart's anti-collision budget is spent in two stages: the
    // label stride widens first (3->6->12 h), slots are only dropped as
    // the last resort. Either way the invariant a reviewer sees is:
    // no two kept columns' ink may overlap -- probe enforces it here.
    const windy = [3, 5, 8, 12, 18, 25, 31, 44, 38, 30, 22, 16,
        12, 9, 15, 27, 33, 41, 36, 25, 14, 8, 6, 4];
    for (const [w, fs, ts] of [[360, 13, 1.5], [400, 11, 1.3], [566, 8, 1]]) {
        const kept = [];
        const droppedSeen = { n: 0 };
        const surf = new Cairo.ImageSurface(Cairo.Format.ARGB32, w, 150);
        const cr = new Cairo.Context(surf);
        paintChart(cr, {
            w, h: 150, values: windy,
            fmtValue: (i, v) => `${v}`, fmtValueUnit: () => 'mph',
            fmtHour,
            valueSamples: [...new Set(windy.map(v => `${v}mph`))],
            accent: [0.13, 0.59, 0.95], ink: [1, 1, 1], nowFrac: null,
            scenes: Array(24).fill('clear'), nights: Array(24).fill(false),
            pills: false, dark: true, stripBottom: true,
            bgFn: () => [0.5, 0.5, 0.55],
            fontSize: fs, textScale: ts, textBold: false,
            slotsProbe: s => {
                if (s.keep) kept.push(s);
                else droppedSeen.n++;
            },
        });
        cr.$dispose();
        for (const s of kept)
            ok(s.left > s.lastSlotRight,
                `overlap kept at i=${s.i} (left ${s.left.toFixed(1)} <= ${s.lastSlotRight.toFixed ? s.lastSlotRight.toFixed(1) : s.lastSlotRight})`);
    }
});

test('calm days lose nothing at any normal geometry', () => {
    const calm = [62, 61, 59, 57, 56, 55, 54, 55, 58, 61, 64, 66,
        68, 69, 70, 70, 69, 67, 65, 63, 61, 60, 59, 58];
    for (const w of [400, 480, 566]) {
        const { dropped } = runSlots(calm, v => `${v}\u00b0`, null,
            { w, fontSize: 8, textScale: 1 });
        ok(dropped.length === 0, `calm day @${w} dropped ${JSON.stringify(dropped)}`);
    }
});

test('ease and lerp pin the animation ends', () => {
    near(ease(0), 0, 0.001);
    near(ease(1), 1, 0.001);
    const mid = lerp([0.2, 0.4], [0.6, 0.8], 0.5);
    near(mid[0], 0.4, 1e-9); near(mid[1], 0.6, 1e-9);
    eq(lerp(null, [0.7, 0.1], 0.3).join(), [0.7, 0.1].join(), 'cold start snaps to target');
});

test('Today\'s rolling window morphs into a calendar day (length-mismatched pair)', () => {
    // the reported incident: today is the 2 h-backfilled rolling window
    // (26 points), every other day the exact calendar slice (24) -- the
    // old equal-length guard in menu._morphTo snapped instead of morphing
    const today = Array.from({ length: 26 }, (_, i) => 60 + Math.sin(i / 3) * 5);
    const day = Array.from({ length: 24 }, (_, i) => 55 + i * 0.5);
    const pair = morphPair(today, day);
    ok(pair, 'length-mismatched pair must still morph');
    const [fromAligned, to] = pair;
    eq(fromAligned.length, 24, 'from resampled onto the target grid');
    eq(to.join(), day.join(), 'target passes through untouched');
    near(fromAligned[0], today[0], 1e-9, 'window start pinned');
    near(fromAligned[23], today[25], 1e-9, 'window end pinned');
    const lo = Math.min(today[11], today[12]), hi = Math.max(today[11], today[12]);
    ok(fromAligned[11] >= lo - 1e-9 && fromAligned[11] <= hi + 1e-9,
        'interior samples interpolate between neighbours');
    eq(lerp(fromAligned, to, 1).join(), day.join(), 'morph lands exactly on target');
    eq(morphPair(day, day)[0], day, 'equal-length pair passes through');
    eq(morphPair([], day), null, 'empty source snaps');
    eq(morphPair([5], day), null, 'single-point source snaps');
    eq(morphPair(today, []), null, 'empty target snaps');
});

test('RTL chart keeps the same hour columns as LTR (right-to-left progression)', () => {
    const calm = [62, 61, 59, 57, 56, 55, 54, 55, 58, 61, 64, 66,
        68, 69, 70, 70, 69, 67, 65, 63, 61, 60, 59, 58];
    const keptLtr = [], keptRtl = [], droppedRtl = [];
    for (const [rtl, kept, dropped] of [[false, keptLtr, []], [true, keptRtl, droppedRtl]]) {
        const surf = new Cairo.ImageSurface(Cairo.Format.ARGB32, 330, 150);
        const cr = new Cairo.Context(surf);
        paintChart(cr, {
            w: 330, h: 150, values: calm,
            fmtValue: (i, v) => `${v}\u00b0`,
            fmtHour,
            valueSamples: [...new Set(calm.map(v => `${v}\u00b0`))],
            accent: [0.96, 0.65, 0.14], ink: [1, 1, 1], nowFrac: 0.02,
            scenes: Array(24).fill('sun'), nights: Array(24).fill(false),
            pills: false, dark: true, rtl, stripBottom: true,
            bgFn: () => [0.5, 0.5, 0.55],
            fontSize: 8, textScale: 1, textBold: false,
            slotsProbe: s => (s.keep ? kept : dropped).push(s.i),
        });
        cr.$dispose();
    }
    eq(droppedRtl.length, 0, `RTL dropped hours: ${JSON.stringify(droppedRtl)}`);
    eq(keptRtl.join(','), keptLtr.join(','), 'RTL must keep the exact same hour indices as LTR');
});

report('chart');
