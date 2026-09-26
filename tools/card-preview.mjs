/* tools/card-preview.mjs — renders the new menu visuals (sky backdrop +
 * hourly chart) to PNG outside the shell, proving chart.js/sky.js before
 * any St widget is touched. From the project root:
 *     gjs -m tools/card-preview.mjs
 * Output: tools/out/cards/*.png  (one composited card per scene/metric)
 */

import Cairo from 'gi://cairo';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import {paintSky, paintPlain, createSky} from '../sky.js';
import {paintChart} from '../chart.js';
import {sceneFor} from '../weather.js';

/* same naive local-hour fallback the menu uses when the provider omits is_day */
const isDayHour = t => {
    const h = Number((t || '').slice(11, 13)) || 0;
    return h >= 6 && h < 21;
};

const CARD = {w: 330, h: 430}, CHART = {y: 107, h: 165};

/* real San Jose hourly temps from the mockup snapshot */
const [, raw] = Gio.File.new_for_path('mockups/data.js').load_contents(null);
const dataText = new TextDecoder().decode(raw.get_data ? raw.get_data() : raw);
const DATA = JSON.parse(dataText
    .replace('window.WEATHER_DATA =', '')
    .replace(/window\.WEATHER_CITY[^;]*;?/, '')
    .replace(/;\s*$/, ''));

const fmtTemp = c => `${Math.round(c * 9 / 5 + 32)}°`;
const fmtHour = iso => {
    const h = +iso.slice(11, 13);
    return `${h % 12 === 0 ? 12 : h % 12}${h >= 12 ? 'PM' : 'AM'}`;
};

const CASES = [
    {scene: 'fog',   night: false, values: DATA.hourly.temperature_2m.slice(16, 40), accent: [0.96, 0.65, 0.14], nowFrac: 2 / 23, strip: 'pills'},
    {scene: 'clear', night: false, values: DATA.hourly.wind_speed_10m.slice(16, 40), accent: [0.24, 0.81, 0.56]},
    {scene: 'storm', night: true,  values: DATA.hourly.precipitation_probability.slice(16, 40).map((v, i) => v + i * 2), accent: [0.30, 0.64, 1.0]},
    {scene: 'rain',  night: false, values: DATA.hourly.temperature_2m.slice(40, 64), accent: [0.96, 0.65, 0.14]},
    {scene: 'snow',  night: false, values: DATA.hourly.temperature_2m.slice(64, 88), accent: [0.96, 0.65, 0.14]},
    {scene: 'moon',  night: true,  values: DATA.hourly.wind_speed_10m.slice(64, 88), accent: [0.24, 0.81, 0.56], nowFrac: 2 / 23, strip: 'icons'},
    {scene: 'partly', night: true, values: DATA.hourly.wind_speed_10m.slice(40, 64), accent: [0.24, 0.81, 0.56], nowFrac: 2 / 23},
    // menu-style demos: 'accent' mode = theme popup bg (grey stand-in)
    // with the charts unified in the OS accent colour
    {scene: 'accent', night: true, plain: true, bgAccent: [0.19, 0.19, 0.19], accent: [0.21, 0.52, 0.89], values: DATA.hourly.temperature_2m.slice(16, 40)},
    {scene: 'accent-light', night: false, plain: true, bgAccent: [0.98, 0.98, 0.98], accent: [0.835, 0.38, 0.60], values: DATA.hourly.temperature_2m.slice(16, 40), strip: 'icons'},
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
                      night: c.night, sky: pool, radius: 18});

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
        fmtValue: (idx, v) => c.accent === CASES[1].accent ? `${Math.round(v)} km/h` : fmtTemp(v),
        fmtHour: idx => fmtHour(DATA.hourly.time[16 + idx] ?? 'T00'),
        accent: c.accent, nowFrac: c.nowFrac ?? null,
        scenes, nights,
        pills: c.strip === 'pills',
        dark: c.plain ? false : true,   // plain cards sit on a light backdrop
        // real menu passes its theme ink; plain light card needs dark ink too
        ink: c.plain && !c.night ? [0.10, 0.13, 0.19] : undefined,
        fontSize: 8,
    });
    cr.restore();

    surf.flush();
    surf.writeToPNG(GLib.build_filenamev([outDir, `card_${i}-${c.scene}${c.night ? '-night' : ''}.png`]));
}
print(`cards -> ${outDir}`);
