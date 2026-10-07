/* tools/card-preview.mjs — renders the new menu visuals (sky backdrop +
 * hourly chart) to PNG outside the shell, proving chart.js/sky.js before
 * any St widget is touched. From the project root:
 *     gjs -m tools/card-preview.mjs
 * Output: tools/out/cards/*.png  (one composited card per scene/metric)
 */

import Cairo from 'gi://cairo';
import GLib from 'gi://GLib';
import {paintSky, paintPlain, createSky, sampleSky} from '../sky.js';
import {paintChart} from '../chart.js';
import {sceneFor} from '../weather.js';

/* mirrors menu.js contrast math so the preview proves the "now" label color */
const _lumOf = c => {
    const f = v => v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
    return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]);
};
const _ratio = (a, b) => {
    const la = _lumOf(a), lb = _lumOf(b);
    return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
};
function contrastSafe(accent, bg) {
    if (_ratio(accent, bg) >= 3.1)
        return accent;
    const darkT = [0.09, 0.11, 0.15], lightT = [1, 1, 1];
    const target = _ratio(darkT, bg) >= _ratio(lightT, bg) ? darkT : lightT;
    let best = accent;
    for (let t = 0.1; t <= 1.001; t += 0.1) {
        best = accent.map((v, i) => v + (target[i] - v) * t);
        if (_ratio(best, bg) >= 3.1)
            return best;
    }
    return best;
}

/* same naive local-hour fallback the menu uses when the provider omits is_day */
const isDayHour = t => {
    const h = Number((t || '').slice(11, 13)) || 0;
    return h >= 6 && h < 21;
};

const fmtTemp = c => `${Math.round(c * 9 / 5 + 32)}°`;
const fmtHour = iso => {
    const h = Number(iso.slice(11, 13));
    return `${h % 12 || 12}${h < 12 ? 'AM' : 'PM'}`;
};

const CARD = {w: 330, h: 430}, CHART = {y: 107, h: 165};

/* real San Jose hourly data (Sep 25–28 2026 snapshot), inlined so the
 * tool stays self-contained after the mockups/ dir retired */
const DATA = {
  hourly: {
    "temperature_2m": [18.8, 18.3, 17.3, 17.0, 17.2, 17.0, 15.7, 16.8, 16.2, 19.6, 23.3, 26.7, 29.2, 32.0, 32.8, 33.2, 35.3, 35.8, 31.9, 26.6, 23.2, 22.1, 21.2, 20.6, 20.0, 19.5, 19.1, 18.7, 17.1, 16.4, 15.9, 15.3, 16.3, 19.6, 23.6, 28.3, 31.5, 33.9, 34.6, 33.7, 31.9, 28.6, 26.0, 23.2, 21.2, 19.7, 18.8, 18.0, 17.4, 16.8, 16.0, 15.3, 14.6, 14.3, 14.2, 14.0, 15.0, 18.0, 21.5, 24.8, 26.5, 27.8, 28.7, 29.7, 30.3, 30.9, 30.9, 28.4, 26.9, 26.0, 25.3, 24.5, 24.0, 23.4, 22.9, 22.4, 21.9, 21.6, 21.3, 21.0, 21.5, 23.5, 25.8, 28.1, 30.3, 31.9, 32.8, 32.9],
    "precipitation_probability": [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    "wind_speed_10m": [7.2, 2.5, 5.6, 2.5, 2.0, 4.7, 1.5, 2.3, 1.8, 3.5, 3.4, 5.6, 5.0, 9.3, 10.9, 14.6, 10.8, 12.6, 9.8, 5.4, 2.7, 4.2, 5.5, 6.2, 3.8, 0.7, 1.6, 3.1, 6.0, 3.2, 0.7, 1.9, 1.8, 1.1, 2.6, 3.4, 4.7, 9.4, 14.0, 15.9, 13.8, 10.4, 6.2, 3.5, 3.8, 4.6, 3.4, 2.3, 1.0, 1.1, 1.8, 1.8, 1.8, 1.1, 0.5, 1.8, 5.1, 3.6, 4.8, 6.5, 9.1, 11.2, 12.7, 12.0, 11.6, 11.5, 11.6, 8.1, 5.0, 3.1, 2.6, 2.9, 1.8, 0.8, 1.8, 1.8, 2.2, 1.3, 1.8, 2.3, 1.5, 0.4, 3.3, 5.4, 5.8, 9.4, 12.8, 14.5],
    "weather_code": [0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    "time": ["2026-10-06T00:00", "2026-10-06T01:00", "2026-10-06T02:00", "2026-10-06T03:00", "2026-10-06T04:00", "2026-10-06T05:00", "2026-10-06T06:00", "2026-10-06T07:00", "2026-10-06T08:00", "2026-10-06T09:00", "2026-10-06T10:00", "2026-10-06T11:00", "2026-10-06T12:00", "2026-10-06T13:00", "2026-10-06T14:00", "2026-10-06T15:00", "2026-10-06T16:00", "2026-10-06T17:00", "2026-10-06T18:00", "2026-10-06T19:00", "2026-10-06T20:00", "2026-10-06T21:00", "2026-10-06T22:00", "2026-10-06T23:00", "2026-10-07T00:00", "2026-10-07T01:00", "2026-10-07T02:00", "2026-10-07T03:00", "2026-10-07T04:00", "2026-10-07T05:00", "2026-10-07T06:00", "2026-10-07T07:00", "2026-10-07T08:00", "2026-10-07T09:00", "2026-10-07T10:00", "2026-10-07T11:00", "2026-10-07T12:00", "2026-10-07T13:00", "2026-10-07T14:00", "2026-10-07T15:00", "2026-10-07T16:00", "2026-10-07T17:00", "2026-10-07T18:00", "2026-10-07T19:00", "2026-10-07T20:00", "2026-10-07T21:00", "2026-10-07T22:00", "2026-10-07T23:00", "2026-10-08T00:00", "2026-10-08T01:00", "2026-10-08T02:00", "2026-10-08T03:00", "2026-10-08T04:00", "2026-10-08T05:00", "2026-10-08T06:00", "2026-10-08T07:00", "2026-10-08T08:00", "2026-10-08T09:00", "2026-10-08T10:00", "2026-10-08T11:00", "2026-10-08T12:00", "2026-10-08T13:00", "2026-10-08T14:00", "2026-10-08T15:00", "2026-10-08T16:00", "2026-10-08T17:00", "2026-10-08T18:00", "2026-10-08T19:00", "2026-10-08T20:00", "2026-10-08T21:00", "2026-10-08T22:00", "2026-10-08T23:00", "2026-10-09T00:00", "2026-10-09T01:00", "2026-10-09T02:00", "2026-10-09T03:00", "2026-10-09T04:00", "2026-10-09T05:00", "2026-10-09T06:00", "2026-10-09T07:00", "2026-10-09T08:00", "2026-10-09T09:00", "2026-10-09T10:00", "2026-10-09T11:00", "2026-10-09T12:00", "2026-10-09T13:00", "2026-10-09T14:00", "2026-10-09T15:00"]
  },
};

const CASES = [
    {scene: 'fog',   night: false, values: DATA.hourly.temperature_2m.slice(16, 40), accent: [0.96, 0.65, 0.14], nowFrac: 2 / 23, strip: 'pills', scrim: [0.03, 0.045, 0.08, 0.78]},
    {scene: 'clear', night: false, values: DATA.hourly.wind_speed_10m.slice(16, 40), accent: [0.24, 0.81, 0.56]},
    {scene: 'storm', night: true,  values: DATA.hourly.precipitation_probability.slice(16, 40).map((v, i) => v + i * 2), accent: [0.30, 0.64, 1.0]},
    {scene: 'rain',  night: false, values: DATA.hourly.temperature_2m.slice(40, 64), accent: [0.96, 0.65, 0.14]},
    {scene: 'snow',  night: false, values: DATA.hourly.temperature_2m.slice(64, 88), accent: [0.96, 0.65, 0.14]},
    {scene: 'moon',  night: true,  values: DATA.hourly.wind_speed_10m.slice(64, 88), accent: [0.24, 0.81, 0.56], nowFrac: 2 / 23, strip: 'icons'},
    {scene: 'partly', night: true, values: DATA.hourly.wind_speed_10m.slice(40, 64), accent: [0.24, 0.81, 0.56], nowFrac: 2 / 23},
    // menu-style demos: 'accent' mode = theme popup bg (grey stand-in)
    // with the charts unified in the OS accent colour
    {scene: 'accent', night: true, plain: true, bgAccent: [0.19, 0.19, 0.19], accent: [0.21, 0.52, 0.89], values: DATA.hourly.temperature_2m.slice(16, 40)},
    {scene: 'accent-light', night: false, plain: true, bgAccent: [0.98, 0.98, 0.98], accent: [0.835, 0.38, 0.60], values: DATA.hourly.temperature_2m.slice(16, 40), strip: 'pills', stripPos: 'bottom'},
    // icons-only on a bright day sky + wide wind labels: demos the icon
    // silhouette ring AND the text-aware label staggering
    {scene: 'partly', night: false, values: DATA.hourly.wind_speed_10m.slice(16, 40), accent: [0.24, 0.81, 0.56], nowFrac: 2 / 23, strip: 'icons', wind: true},
    // bright overcast day + tiny percentages: demos the smart curve ink —
    // lineInk deepens the metric hue in place when it can't hold 3:1
    {scene: 'cloud', night: false, live: true, pct: true, values: [0, 0, 1, 2, 3, 2, 1, 0, 0, 0, 1, 0, 2, 3, 4, 3, 1, 0, 0, 1, 0, 0, 0, 0], accent: [0.30, 0.64, 1.0], nowFrac: 2 / 23, strip: 'icons', stripPos: 'bottom'},
    // amber temp line over a bright clear day: demos the VIVID deepening
    // (saturation up, warm hue toward red) vs the old muddy multiply
    {scene: 'clear', night: false, live: true, values: DATA.hourly.temperature_2m.slice(16, 40), accent: [0.96, 0.65, 0.14], nowFrac: 2 / 23, strip: 'icons', stripPos: 'bottom'},
];

const outDir = GLib.build_filenamev([GLib.get_current_dir(), 'tools', 'out', 'cards']);
GLib.mkdir_with_parents(outDir, 0o755);

let pool = createSky();
for (const [i, c] of CASES.entries()) {
    const surf = new Cairo.ImageSurface(Cairo.Format.ARGB32, CARD.w, CARD.h);
    const cr = new Cairo.Context(surf);
    if (c.plain)
        paintPlain(cr, {w: CARD.w, h: CARD.h, accent: c.bgAccent,
                        dark: c.night, radius: 18});
    else
        paintSky(cr, {w: CARD.w, h: CARD.h, time: 2.9, scene: c.scene,
                      night: c.night, sky: pool, radius: 18, scrim: c.scrim});

    // real chart over the animated backdrop (header uses St.Label in the
    // actual menu, so we don't simulate it here)
    cr.save();
    cr.translate(0, CHART.y);
    // condition strip for the demo cards (same mapping the menu uses). The
    // fixture days are clear (all WMO 0); vary the codes across the days so
    // the strip exercises mixed scenes: clear/sun, partly, rain, storm
    let scenes = null, nights = null;
    if (c.strip) {
        const times = (DATA.hourly.time ?? []).slice(16, 40);
        const demoCode = (t) => {
            const h = Number(t.slice(11, 13));
            const day = Number(t.slice(8, 10)) - 6;
            if (day === 0)
                return h >= 7 && h < 19 ? 1 : 3;
            if (day === 1)
                return h >= 6 && h < 20 ? 2 : 45;
            return h % 6 === 0 ? 61 : h % 6 === 1 ? 63 : h % 6 === 2 ? 80 : h % 6 === 3 ? 95 : h % 6 === 4 ? 71 : 3;
        };
        scenes = times.map(t => sceneFor(demoCode(t), isDayHour(t)).scene);
        nights = times.map(t => !isDayHour(t));
    }
    paintChart(cr, {
        w: CARD.w, h: CHART.h, values: c.values,
        fmtValue: (idx, v) => c.pct ? `${Math.round(v)}%`
            : (c.accent === CASES[1].accent || c.wind) ? `${Math.round(v)} km/h`
            : fmtTemp(v),
        fmtHour: idx => `${Number((DATA.hourly.time[16 + idx] ?? 'T00').slice(11, 13)) % 12 || 12}${Number((DATA.hourly.time[16 + idx] ?? 'T00').slice(11, 13)) < 12 ? 'AM' : 'PM'}`,
        accent: c.accent, nowFrac: c.nowFrac ?? null,
        scenes, nights,
        pills: c.strip === 'pills',
        stripBottom: c.stripPos === 'bottom',
        dark: c.plain ? false : true,   // plain cards sit on a light backdrop
        pillGlass: !c.plain,
        // 'live' cards mirror the menu's real geometry sampler so the
        // smart curve ink + per-position label referee behave identically
        bgFn: c.live ? yPx => sampleSky(c.scene, c.night,
            Math.min(1, Math.max(0, (CHART.y + yPx) / CARD.h))) : null,
        // real menu passes its theme ink; plain light card needs dark ink too
        ink: c.plain && !c.night ? [0.10, 0.13, 0.19] : undefined,
        // "now" label: contrast-safe variant of the accent over the actual
        // backdrop (themed card bg, or the sampled sky mid-chart + scrim)
        nowLabel: contrastSafe(c.accent, c.plain
            ? (c.night ? [0.185, 0.185, 0.19] : [0.96, 0.96, 0.97])
            : (c.scrim ? sampleSky(c.scene, c.night, 0.62)
                .map((v, i) => v * (1 - c.scrim[3]) + c.scrim[i] * c.scrim[3])
                : sampleSky(c.scene, c.night, 0.62))),
        fontSize: 8,
    });
    cr.restore();

    surf.flush();
    surf.writeToPNG(GLib.build_filenamev([outDir, `card_${i}-${c.scene}${c.night ? '-night' : ''}.png`]));
}
print(`cards -> ${outDir}`);
