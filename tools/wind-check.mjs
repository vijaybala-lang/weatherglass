/* tools/wind-check.mjs — reproduce the dropped wind-value-label card.
 * Output: out/wind_v2.png */
import Cairo from 'gi://cairo';
import {paintChart} from '../chart.js';

const W = 300, H = 200;
const values = [5, 5, 4, 2, 2, 2, 3, 5, 7, 8, 9, 9, 8, 7, 7, 6, 6, 7,
                7, 6, 5, 4, 4, 3];
const time = i => {
    const h = (i + 1) % 24;   // card starts ~1AM like the screenshot
    return `${h % 12 || 12}${h < 12 ? 'AM' : 'PM'}`;
};
const surf = new Cairo.ImageSurface(Cairo.Format.ARGB32, W, H);
const cr = new Cairo.Context(surf);
paintChart(cr, {
    w: W, h: H, values,
    fmtValue: (i, v) => `${Math.round(v)} mph`,
    fmtHour: i => time(i),
    accent: [0.24, 0.81, 0.56],
    nowFrac: 0.62,
    dark: false,
    ink: [0.13, 0.15, 0.2],
    fontSize: 8,
    scenes: Array.from({length: 24}, (_, i) =>
        (i > 6 && i < 16) ? 'clear' : 'cloud'),
    nights: Array.from({length: 24}, (_, i) => i < 6 || i > 18),
    stripBottom: true,
});
surf.writeToPNG('out/wind_v2.png');
log('wrote wind_v2.png');
