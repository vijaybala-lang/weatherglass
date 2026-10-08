/* tests/chart.test.mjs -- chart geometry locks, driven through the real
 * paintChart via the slotsProbe observer. The plateau case is the exact
 * Kilimanjaro Friday incident: a flat 100% precip series whose wide
 * labels made the old widest-envelope collision drop the 4 AM and 10 PM
 * columns on a 400 px card.
 */
import Cairo from 'gi://cairo';
import { paintChart, ease, lerp } from '../chart.js';
import { file, test, ok, near, eq, report } from './harness.mjs';

file('chart');

const fmtHour = i => {
    const h = i % 24, am = h < 12, hh = h % 12 === 0 ? 12 : h % 12;
    return `${hh}${am ? 'AM' : 'PM'}`;
};

// Real Open-Meteo Friday 2026-10-09, Mount Kilimanjaro, hourly precip %
const KILI = [76, 75, 77, 75, 65, 51, 39, 26, 14, 14, 38, 74,
    100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 99, 97];

function runSlots(values, fmt, unit, { w, fontSize, textScale, stripBottom = true }) {
    const kept = [], dropped = [];
    const surf = new Cairo.ImageSurface(Cairo.Format.ARGB32, w, 150);
    const cr = new Cairo.Context(surf);
    paintChart(cr, {
        w, h: 150, values,
        fmtValue: (i, v) => fmt(v),
        fmtValueUnit: unit ? () => unit : null,
        fmtHour,
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

report('chart');
