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

const CARD = {w: 330, h: 430}, CHART = {y: 107, h: 165};

/* real San Jose hourly data (Sep 25–28 2026 snapshot), inlined so the
 * tool stays self-contained after the mockups/ dir retired */
const DATA = {hourly: {"temperature_2m":[24.6,22.6,20.6,18.3,17.0,16.3,15.9,15.1,14.4,13.8,13.2,12.8,12.3,11.7,11.2,10.7,12.2,15.2,17.6,20.1,22.3,24.2,25.3,24.4,23.5,21.6,19.7,17.5,15.7,14.8,14.0,13.5,13.2,13.0,12.7,12.1,11.4,10.9,10.6,10.6,12.0,14.7,17.4,20.2,22.3,23.6,24.7,24.7,23.4,21.7,20.1,18.2,16.8,15.6,14.8,14.3,13.9,13.4,13.0,12.6,12.2,11.6,11.3,11.2,12.3,15.2,18.2,20.3,21.7,23.4,25.5,26.3],"wind_speed_10m":[15.3,18.8,17.7,14.8,12.2,11.3,7.7,2.2,4.1,5.4,2.9,5.1,3.6,2.8,2.1,2.7,2.7,0.8,2.5,3.2,5.1,7.6,11.3,17.3,18.2,18.9,16.2,13.7,11.4,4.3,4.9,5.6,3.6,4.1,3.7,4.0,3.2,5.1,6.4,7.8,8.2,6.6,4.1,2.5,5.9,10.4,13.8,18.6,19.6,17.8,14.1,11.2,10.9,9.2,6.4,5.3,4.6,2.5,3.1,4.7,7.1,7.9,8.6,8.4,7.0,5.2,2.4,5.2,8.2,11.0,13.2,16.2],"precipitation_probability":[0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1,1,1,1,1,1,1,1,0,0,0,0,0,0,2,2,2,2,2,2,1,1,1,1,1,1,0,0,0,0,0,0,0,0,0,0],"time":["2026-09-25T16:00","2026-09-25T17:00","2026-09-25T18:00","2026-09-25T19:00","2026-09-25T20:00","2026-09-25T21:00","2026-09-25T22:00","2026-09-25T23:00","2026-09-26T00:00","2026-09-26T01:00","2026-09-26T02:00","2026-09-26T03:00","2026-09-26T04:00","2026-09-26T05:00","2026-09-26T06:00","2026-09-26T07:00","2026-09-26T08:00","2026-09-26T09:00","2026-09-26T10:00","2026-09-26T11:00","2026-09-26T12:00","2026-09-26T13:00","2026-09-26T14:00","2026-09-26T15:00"],"weather_code":[3,3,3,3,3,3,3,3,3,3,0,0,0,0,0,0,0,0,0,0,0,0,0,0]}};

const fmtTemp = c => `${Math.round(c * 9 / 5 + 32)}°`;
const fmtHour = iso => {
    const h = +iso.slice(11, 13);
    return `${h % 12 === 0 ? 12 : h % 12}${h >= 12 ? 'PM' : 'AM'}`;
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
    {scene: 'partly', night: false, values: DATA.hourly.wind_speed_10m.slice(16, 40), accent: [0.24, 0.81, 0.56], nowFrac: 2 / 23, strip: 'icons', wind: true, iconOutline: true},
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
    // condition strip for the demo cards (same mapping the menu uses)
    let scenes = null, nights = null;
    if (c.strip) {
        const codes = (DATA.hourly.weather_code ?? []).slice(16, 40);
        const times = (DATA.hourly.time ?? []).slice(16, 40);
        scenes = codes.map((code, k) =>
            sceneFor(code, isDayHour(times[k])).scene);
        nights = times.map(t => !isDayHour(t));
    }
    paintChart(cr, {
        w: CARD.w, h: CHART.h, values: c.values,
        fmtValue: (idx, v) => c.pct ? `${Math.round(v)}%`
            : (c.accent === CASES[1].accent || c.wind) ? `${Math.round(v)} km/h`
            : fmtTemp(v),
        fmtHour: idx => fmtHour(DATA.hourly.time[16 + idx] ?? 'T00'),
        accent: c.accent, nowFrac: c.nowFrac ?? null,
        scenes, nights,
        pills: c.strip === 'pills',
        stripBottom: c.stripPos === 'bottom',
        dark: c.plain ? false : true,   // plain cards sit on a light backdrop
        pillGlass: !c.plain,
        iconOutline: c.iconOutline ? [0.04, 0.05, 0.09, 0.62] : null,
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
