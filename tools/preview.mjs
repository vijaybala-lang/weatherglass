/* tools/preview.mjs — renders every scene to PNGs so the painter can be
 * checked without a running shell. Run from the project root:
 *   gjs -m tools/preview.mjs
 * Writes PNGs to tools/out/.
 */

import Cairo from 'gi://cairo';
import GLib from 'gi://GLib';
import {paintWeather, createParticles, GRID} from '../painter.js';

const PX = 96;                      // render size in px
const scenes = ['sun', 'moon', 'partly', 'cloud', 'fog', 'rain', 'snow', 'sleet', 'hail',
                'storm', 'wind', 'error', 'loading'];
const outDir = GLib.build_filenamev([GLib.get_current_dir(), 'tools', 'out']);
GLib.mkdir_with_parents(outDir, 0o755);

// dark rounded backdrop like the panel
function backdrop(cr) {
    const bg = new Cairo.LinearGradient(0, 0, 0, PX);
    bg.addColorStopRGB(0, 0.13, 0.14, 0.16);
    bg.addColorStopRGB(1, 0.07, 0.08, 0.09);
    cr.setSource(bg);
    const r = 18, x = 0, y = 0, w = PX, h = PX;
    cr.newPath();
    cr.arc(x + w - r, y + r, r, Math.PI * 1.5, Math.PI * 2);
    cr.arc(x + r, y + r, r, 0, Math.PI * 0.5);
    cr.arc(x + r, y + h - r, r, Math.PI * 0.5, Math.PI);
    cr.arc(x + w - r, y + h - r, r, Math.PI, Math.PI * 1.5);
    cr.closePath();
    cr.fill();
}

for (const scene of scenes) {
    // render an animated gif-ish: 3 key frames each (skip static ones)
    const p = createParticles();
    const times = scene === 'error' ? [0] : [0.15, 1.0, 2.1];
    times.forEach((t, i) => {
        const surf = new Cairo.ImageSurface(Cairo.Format.ARGB32, PX, PX);
        const cr = new Cairo.Context(surf);
        backdrop(cr);
        cr.scale(PX / GRID, PX / GRID);
        paintWeather(cr, {
            scene, time: t, particles: p,
            windy: scene === 'sun' || scene === 'wind',
            night: false,
            intensity: 6, windKmh: 32,
        });
        // step particle clock between frames
        p.lastT = t - 1 / 30;
        surf.flush();
        const name = `${scene}-${i}.png`;
        surf.writeToPNG(GLib.build_filenamev([outDir, name]));
    });
    print(`rendered ${scene}`);
}

// contact sheet: all first frames in one row
const cols = scenes.length;
const sheet = new Cairo.ImageSurface(Cairo.Format.ARGB32, PX * cols, PX * 3);
const scr = new Cairo.Context(sheet);
scr.setSourceRGB(0.05, 0.05, 0.06);
scr.paint();
scenes.forEach((scene, c) => {
    const p = createParticles();
    for (let row = 0; row < 3; row++) {
        const t = [0.15, 1.0, 2.1][row] || 0;
        scr.save();
        scr.translate(c * PX, row * PX);
        const sub = new Cairo.ImageSurface(Cairo.Format.ARGB32, PX, PX);
        const cr = new Cairo.Context(sub);
        backdrop(cr);
        cr.scale(PX / GRID, PX / GRID);
        paintWeather(cr, {scene, time: t, particles: p,
                          windy: scene === 'sun' || scene === 'wind',
                          night: scene === 'partly' && row === 2,
                          intensity: 6, windKmh: 32});
        sub.flush();
        scr.setSourceSurface(sub, 0, 0);
        scr.paint();
        scr.restore();
        p.lastT = t - 1 / 30;
    }
});
sheet.writeToPNG(GLib.build_filenamev([outDir, 'sheet.png']));
print(`contact sheet: ${outDir}/sheet.png`);
