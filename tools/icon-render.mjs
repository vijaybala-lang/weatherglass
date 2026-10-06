/* tools/icon-render.mjs -- renders the store/branding icon: a glass weather
 * orb (the "weatherglass") holding a sun and cloud, set on a rounded card
 * whose sky runs from deep day blue down to a sunset horizon -- the same
 * day-to-dusk light the menu backdrop paints. Pure vector Cairo, so every
 * size is drawn crisp rather than scaled. From the project root:
 *     gjs -m tools/icon-render.mjs [outDir]
 * Output: <outDir or assets>/weatherglass-icon-512.png and -128.png
 */

import Cairo from 'gi://cairo';
import GLib from 'gi://GLib';

const TWO_PI = Math.PI * 2;

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

/* card sky: deep zenith blue -> daylight -> rose -> ember horizon */
function paintCard(cr, s) {
    roundRect(cr, s, s * 0.225);
    const sky = new Cairo.LinearGradient(0, 0, 0, s);
    sky.addColorStopRGB(0, 0.09, 0.22, 0.50);
    sky.addColorStopRGB(0.45, 0.24, 0.47, 0.80);
    sky.addColorStopRGB(0.78, 0.82, 0.55, 0.62);
    sky.addColorStopRGB(1, 1.00, 0.68, 0.40);
    cr.setSource(sky);
    cr.fillPreserve();

    /* hairline rim keeps the card readable on light page backgrounds */
    cr.setSourceRGBA(1, 1, 1, 0.20);
    cr.setLineWidth(s * 0.008);
    cr.stroke();
}

/* soft round shadow: a radial falloff past the edge (Cairo has no blur) */
function softShadow(cr, x, y, r, alpha, spread) {
    const shadow = new Cairo.RadialGradient(x, y, r * 0.85, x, y, r + spread);
    shadow.addColorStopRGBA(0, 0.04, 0.07, 0.20, alpha);
    shadow.addColorStopRGBA(0.5, 0.04, 0.07, 0.20, alpha * 0.45);
    shadow.addColorStopRGBA(1, 0.04, 0.07, 0.20, 0);
    cr.setSource(shadow);
    cr.newPath();
    cr.arc(x, y, r + spread, 0, TWO_PI);
    cr.fill();
}

function cloudPath(cr, cx, cy, u) {
    cr.newPath();
    cr.arc(cx - 0.105 * u, cy + 0.010 * u, 0.072 * u, 0, TWO_PI);
    cr.newSubPath();
    cr.arc(cx - 0.005 * u, cy - 0.040 * u, 0.102 * u, 0, TWO_PI);
    cr.newSubPath();
    cr.arc(cx + 0.100 * u, cy + 0.008 * u, 0.078 * u, 0, TWO_PI);
    cr.newSubPath();
    /* rounded base slab under the puffs */
    const left = cx - 0.175 * u, right = cx + 0.178 * u;
    const top = cy - 0.005 * u, bottom = cy + 0.082 * u, rad = 0.0435 * u;
    cr.moveTo(left + rad, top);
    cr.lineTo(right - rad, top);
    cr.arc(right - rad, top + rad, rad, -Math.PI / 2, 0);
    cr.arc(right - rad, bottom - rad, rad, 0, Math.PI / 2);
    cr.arc(left + rad, bottom - rad, rad, Math.PI / 2, Math.PI);
    cr.arc(left + rad, top + rad, rad, Math.PI, Math.PI * 1.5);
    cr.closePath();
    cr.setFillRule(Cairo.FillRule.WINDING);
}

function render(size, path) {
    const s = size;
    const surf = new Cairo.ImageSurface(Cairo.Format.ARGB32, s, s);
    const cr = new Cairo.Context(surf);

    paintCard(cr, s);

    const ox = s * 0.5, oy = s * 0.47, orbR = s * 0.33;

    /* orb: drop shadow, then the bright sky held inside the glass */
    softShadow(cr, ox, oy + s * 0.025, orbR, 0.30, s * 0.05);
    const inner = new Cairo.RadialGradient(ox - orbR * 0.3, oy - orbR * 0.35, orbR * 0.1,
        ox, oy, orbR);
    inner.addColorStopRGB(0, 0.62, 0.84, 1.00);
    inner.addColorStopRGB(0.65, 0.33, 0.62, 0.94);
    inner.addColorStopRGB(1, 0.20, 0.42, 0.80);
    cr.setSource(inner);
    cr.newPath();
    cr.arc(ox, oy, orbR, 0, TWO_PI);
    cr.fill();

    /* sun: glow + disc, clipped to the glass */
    cr.save();
    cr.newPath();
    cr.arc(ox, oy, orbR, 0, TWO_PI);
    cr.clip();
    const sx = ox - orbR * 0.20, sy = oy - orbR * 0.22, sr = orbR * 0.36;
    const glow = new Cairo.RadialGradient(sx, sy, sr * 0.6, sx, sy, sr * 2.6);
    glow.addColorStopRGBA(0, 1.0, 0.86, 0.45, 0.75);
    glow.addColorStopRGBA(0.4, 1.0, 0.76, 0.35, 0.28);
    glow.addColorStopRGBA(1, 1.0, 0.70, 0.30, 0);
    cr.setSource(glow);
    cr.paint();
    const disc = new Cairo.RadialGradient(sx - sr * 0.3, sy - sr * 0.3, sr * 0.05, sx, sy, sr);
    disc.addColorStopRGB(0, 1.0, 0.98, 0.84);
    disc.addColorStopRGB(0.55, 1.0, 0.84, 0.34);
    disc.addColorStopRGB(1, 1.0, 0.64, 0.16);
    cr.setSource(disc);
    cr.newPath();
    cr.arc(sx, sy, sr, 0, TWO_PI);
    cr.fill();

    /* inner shade along the lower rim gives the glass its depth */
    const shade = new Cairo.RadialGradient(ox, oy - orbR * 0.25, orbR * 0.75,
        ox, oy - orbR * 0.25, orbR * 1.3);
    shade.addColorStopRGBA(0, 0.05, 0.12, 0.35, 0);
    shade.addColorStopRGBA(1, 0.05, 0.12, 0.35, 0.45);
    cr.setSource(shade);
    cr.paint();
    cr.restore();

    /* cloud drifts in front, breaking out of the glass for depth */
    const cx = ox + orbR * 0.42, cy = oy + orbR * 0.50;
    for (const [dy, alpha] of [[0.022, 0.07], [0.014, 0.09], [0.007, 0.10]]) {
        cr.save();
        cr.translate(0, s * dy);
        cloudPath(cr, cx, cy, s);
        cr.setSourceRGBA(0.05, 0.10, 0.28, alpha);
        cr.fill();
        cr.restore();
    }
    cloudPath(cr, cx, cy, s);
    const puff = new Cairo.LinearGradient(0, cy - 0.15 * s, 0, cy + 0.085 * s);
    puff.addColorStopRGB(0, 1.0, 1.0, 1.0);
    puff.addColorStopRGB(0.6, 0.95, 0.96, 0.99);
    puff.addColorStopRGB(1, 0.80, 0.85, 0.93);
    cr.setSource(puff);
    cr.fill();

    /* glass: crisp rim + specular crescent at the upper left */
    cr.newPath();
    cr.arc(ox, oy, orbR, 0, TWO_PI);
    cr.setSourceRGBA(1, 1, 1, 0.55);
    cr.setLineWidth(Math.max(1.5, s * 0.012));
    cr.stroke();

    cr.save();
    cr.newPath();
    cr.arc(ox, oy, orbR * 0.92, Math.PI * 1.05, Math.PI * 1.55);
    cr.arcNegative(ox + orbR * 0.06, oy + orbR * 0.08, orbR * 0.86, Math.PI * 1.50, Math.PI * 1.10);
    cr.closePath();
    const spec = new Cairo.LinearGradient(ox - orbR, oy - orbR, ox, oy);
    spec.addColorStopRGBA(0, 1, 1, 1, 0.60);
    spec.addColorStopRGBA(1, 1, 1, 1, 0);
    cr.setSource(spec);
    cr.fill();
    cr.restore();

    surf.flush();
    surf.writeToPNG(path);
    log(`icon-render: wrote ${path}`);
}

const root = ARGV[0] ?? GLib.build_filenamev([GLib.get_current_dir(), 'assets']);
GLib.mkdir_with_parents(root, 0o755);
render(512, GLib.build_filenamev([root, 'weatherglass-icon-512.png']));
render(128, GLib.build_filenamev([root, 'weatherglass-icon-128.png']));
