/* tools/icon-render.mjs -- renders the store/branding icon straight from
 * the extension's own painter, so the logo is literally a frame of the
 * product. Rounded card on the 'partly' day-sky palette with the sun-and-
 * cloud glyph centred. From the project root:
 *     gjs -m tools/icon-render.mjs
 * Output: assets/weatherglass-icon-512.png and -128.png
 */

import Cairo from 'gi://cairo';
import GLib from 'gi://GLib';
import {paintWeather, createParticles, GRID} from '../painter.js';

/* the extension's own partly-cloudy day gradient (sky.js PAL.partly.d) */
const SKY_TOP = [0.23, 0.43, 0.66];
const SKY_BOT = [0.66, 0.79, 0.89];

function roundRect(cr, s, r) {
    cr.newPath();
    cr.moveTo(r, 0);
    cr.lineTo(s - r, 0);
    cr.arc(s - r, r, r, -Math.PI / 2, 0);
    cr.lineTo(s, s - r);
    cr.arc(s - r, s - r, r, 0, Math.PI / 2);
    cr.lineTo(r, s);
    cr.arc(r, s - r, r, Math.PI / 2, Math.PI);
    cr.lineTo(0, r);
    cr.arc(r, r, r, Math.PI, Math.PI * 1.5);
    cr.closePath();
}

function render(size, path) {
    const surf = new Cairo.ImageSurface(Cairo.Format.ARGB32, size, size);
    const cr = new Cairo.Context(surf);

    roundRect(cr, size, size * 0.22);
    const bg = new Cairo.LinearGradient(0, 0, 0, size);
    bg.addColorStopRGB(0, ...SKY_TOP);
    bg.addColorStopRGB(1, ...SKY_BOT);
    cr.setSource(bg);
    cr.fillPreserve();

    /* faint light from the top-left corner, the way the card skies glow */
    const gl = new Cairo.RadialGradient(size * 0.30, size * 0.22, 0,
                                        size * 0.30, size * 0.22, size * 0.8);
    gl.addColorStopRGBA(0, 1, 1, 1, 0.18);
    gl.addColorStopRGBA(1, 1, 1, 1, 0);
    cr.setSource(gl);
    cr.fillPreserve();

    /* hairline rim keeps the card readable on light page backgrounds */
    cr.setSourceRGBA(1, 1, 1, 0.22);
    cr.setLineWidth(size * 0.008);
    cr.stroke();

    /* glyph: the same partly scene the panel icon paints, centred */
    const pad = size * 0.16, inner = size - 2 * pad;
    cr.save();
    cr.translate(size / 2 - inner / 2, size / 2 - inner / 2);
    cr.scale(inner / GRID, inner / GRID);
    const pp = createParticles();
    for (let i = 0; i < 6; i++)          // settle the drifting cloud a beat
        paintWeather(cr, {scene: 'partly', time: 0.25 * (i + 1),
                          particles: pp, night: false});
    cr.restore();

    surf.flush();
    surf.writeToPNG(path);
    log(`icon-render: wrote ${path}`);
}

const root = GLib.build_filenamev([GLib.get_current_dir(), 'assets']);
GLib.mkdir_with_parents(root, 0o755);
render(512, GLib.build_filenamev([root, 'weatherglass-icon-512.png']));
render(128, GLib.build_filenamev([root, 'weatherglass-icon-128.png']));
