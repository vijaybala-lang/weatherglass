/* tools/preview-gif.mjs — renders a 12-scene animated contact sheet and
 * (with ffmpeg) turns it into a looping GIF. From the project root:
 *     gjs -m tools/preview-gif.mjs
 *     ffmpeg -framerate 20 -i tools/out/grid/grid_%03d.png \
 *            -vf "fps=20,split[a][b];[a]palettegen[p];[b][p]paletteuse" \
 *            tools/out/weatherglass.gif
 */

import Cairo from 'gi://cairo';
import GLib from 'gi://GLib';
import {paintWeather, createParticles, GRID} from '../painter.js';

const TILE = 96, FPS = 20, FRAMES = 56;
const scenes = ['sun', 'partly', 'cloud', 'moon',
                'rain', 'sleet', 'snow', 'hail',
                'storm', 'fog', 'wind', 'loading'];

const outDir = GLib.build_filenamev([GLib.get_current_dir(), 'tools', 'out', 'grid']);
GLib.mkdir_with_parents(outDir, 0o755);

// one particle pool per scene for the whole animation
const pools = Object.fromEntries(scenes.map(s => [s, createParticles()]));

function backdrop(cr, x, y, s) {
    const r = s * 0.18;
    const bg = new Cairo.LinearGradient(0, y, 0, y + s);
    bg.addColorStopRGB(0, 0.14, 0.15, 0.17);
    bg.addColorStopRGB(1, 0.07, 0.08, 0.09);
    cr.setSource(bg);
    cr.newPath();
    cr.arc(x + s - r, y + r, r, Math.PI * 1.5, Math.PI * 2);
    cr.arc(x + r, y + r, r, 0, Math.PI * 0.5);
    cr.arc(x + r, y + s - r, r, Math.PI * 0.5, Math.PI);
    cr.arc(x + s - r, y + s - r, r, Math.PI, Math.PI * 1.5);
    cr.closePath();
    cr.fill();
}

const cols = 4, rows = 3;
const W = TILE * cols, H = TILE * rows;

for (let f = 0; f < FRAMES; f++) {
    const t = f / FPS;
    const surf = new Cairo.ImageSurface(Cairo.Format.ARGB32, W, H);
    const cr = new Cairo.Context(surf);
    cr.setSourceRGB(0.05, 0.05, 0.06);
    cr.paint();
    scenes.forEach((scene, i) => {
        const x = (i % cols) * TILE + 6;
        const y = Math.floor(i / cols) * TILE + 6;
        const inner = TILE - 12;
        backdrop(cr, x, y, inner);
        cr.save();
        cr.translate(x, y);
        cr.scale(inner / GRID, inner / GRID);
        paintWeather(cr, {
            scene, time: t, particles: pools[scene],
            windy: scene === 'sun' || scene === 'wind',
            night: false,
            intensity: 6, windKmh: 32,
        });
        cr.restore();
    });
    surf.flush();
    surf.writeToPNG(GLib.build_filenamev(
        [outDir, `grid_${String(f).padStart(3, '0')}.png`]));
}
print(`frames -> ${outDir}`);
