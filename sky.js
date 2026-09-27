/* sky.js — pure cairo animated sky backdrop (port of the mockup's engine).
 *
 * paintSky(cr, opts) fills the whole allocation with a scene gradient plus
 * celestial bodies, drifting clouds, and particles (rain/snow/hail/stars/
 * fog/wind/storm-flash). Particle state lives in a pool from createSky();
 * time-based dt keeps physics framerate-independent.
 *
 * opts = {w, h, time, scene, night, sky}; draw in logical px (scale for
 * HiDPI first, like chart.js).
 */

import Cairo from 'gi://cairo';
import {paintMoon, moonPhase, illumOf} from './moon.js';

const TAU = Math.PI * 2;
const rand = (a, b) => a + Math.random() * (b - a);

/* [top, bottom] sky gradients per scene/day-night (mockup PAL) */
const PAL = {
    clear:  {d: [[0.18, 0.43, 0.70], [0.75, 0.88, 0.97]], n: [[0.04, 0.06, 0.15], [0.15, 0.20, 0.36]]},
    partly: {d: [[0.23, 0.43, 0.66], [0.66, 0.79, 0.89]], n: [[0.05, 0.07, 0.19], [0.16, 0.21, 0.38]]},
    sun:    {d: [[0.18, 0.43, 0.70], [0.75, 0.88, 0.97]], n: [[0.04, 0.06, 0.15], [0.15, 0.20, 0.36]]},
    moon:   {d: [[0.18, 0.43, 0.70], [0.75, 0.88, 0.97]], n: [[0.04, 0.06, 0.15], [0.15, 0.20, 0.36]]},
    cloud:  {d: [[0.36, 0.44, 0.54], [0.71, 0.76, 0.81]], n: [[0.08, 0.09, 0.14], [0.17, 0.20, 0.26]]},
    fog:    {d: [[0.47, 0.50, 0.55], [0.72, 0.74, 0.77]], n: [[0.11, 0.13, 0.17], [0.20, 0.23, 0.27]]},
    rain:   {d: [[0.22, 0.27, 0.36], [0.44, 0.50, 0.58]], n: [[0.05, 0.07, 0.13], [0.14, 0.17, 0.24]]},
    sleet:  {d: [[0.28, 0.35, 0.44], [0.55, 0.60, 0.66]], n: [[0.07, 0.09, 0.15], [0.16, 0.19, 0.29]]},
    snow:   {d: [[0.41, 0.47, 0.55], [0.72, 0.78, 0.83]], n: [[0.09, 0.11, 0.17], [0.19, 0.23, 0.32]]},
    hail:   {d: [[0.14, 0.17, 0.24], [0.30, 0.35, 0.43]], n: [[0.04, 0.05, 0.09], [0.11, 0.14, 0.20]]},
    storm:  {d: [[0.11, 0.13, 0.19], [0.24, 0.28, 0.36]], n: [[0.03, 0.04, 0.07], [0.08, 0.11, 0.17]]},
    wind:   {d: [[0.30, 0.43, 0.57], [0.66, 0.75, 0.83]], n: [[0.06, 0.09, 0.16], [0.15, 0.20, 0.29]]},
    error:  {d: [[0.45, 0.30, 0.30], [0.70, 0.55, 0.55]], n: [[0.15, 0.09, 0.09], [0.25, 0.17, 0.17]]},
    loading:{d: [[0.30, 0.33, 0.38], [0.55, 0.58, 0.63]], n: [[0.09, 0.10, 0.12], [0.20, 0.22, 0.25]]},
};

/* scene → sky features. clouds: count, drops/flakes/hail/streaks: density.
 * No ambient streaks on calm skies — moving lines are reserved for the
 * dedicated windy scene (real wind signal), not daily decoration. */
const FEATURES = {
    clear:  {clouds: 1, sun: 1},
    sun:    {clouds: 1, sun: 1},
    partly: {clouds: 3, sun: 1, moon: 1},  // night: moon behind the clouds
    moon:   {clouds: 1, stars: 1, moon: 1},
    cloud:  {clouds: 5},
    fog:    {clouds: 2, fog: 1},
    rain:   {clouds: 6, drops: 90},
    sleet:  {clouds: 6, drops: 45, flakes: 30},
    snow:   {clouds: 6, flakes: 70},
    hail:   {clouds: 6, drops: 40, hail: 26},
    storm:  {clouds: 6, drops: 120, bolt: 1},
    wind:   {streaks: 22},
};

/** Approximate the composited sky RGB at height fraction f (0 top .. 1
 *  bottom) — lets the menu run real contrast math for accent-colored
 *  text instead of guessing from the theme flag. Scrim not included:
 *  callers blend that themselves (menu THEME table). */
export function sampleSky(scene, night, f = 0.62) {
    const [top, bot] = hexPal(scene, night);
    return top.map((v, i) => v + (bot[i] - v) * f);
}

/* The bright body paintSky will draw, as {x, y, r, col, soft} in px —
 * the menu's ink referee samples the gradient and MUST also see this:
 * white city text over a full moon (or the sun's core) is unreadable,
 * and a gradient-only sampler can't know. col approximates the disc's
 * look: moon.js pale sphere by night, the sun gradient's warm core by
 * day (kept small + translucent: the rays wash gently, the disc is
 * the disc). */
export function bodyOf(scene, night, w, h) {
    const f = FEATURES[scene] ?? {};
    const R = 64 * h / 420;
    if ((f.sun || f.moon) && !night)
        return {x: w * 0.82, y: h * 0.16, r: R * 0.45, soft: 10,
                col: [1, 0.8, 0.4], max: 0.75};
    if (f.moon && night) {
        const ph = moonPhase().phase;
        if (illumOf(ph) < 0.12)
            return null;            // thin crescent: barely a light
        return {x: w * 0.82, y: h * 0.16, r: R * 0.85, soft: 14,
                col: [0.93, 0.94, 0.96], max: 1};
    }
    return null;
}

function hexPal(scene, night) {
    const pal = (PAL[scene] ?? PAL.cloud)[night ? 'n' : 'd'];
    return pal;
}

/** Soft blobby cloud sprite, pre-rendered once (white, alpha-blurred).
 *  Lobes stay fully inside the surface and fade to 0 before their arc ends,
 *  otherwise the surface bounds show as hard straight edges when painted. */
function makeCloudSprite() {
    const W = 400, H = 200;
    const surf = new Cairo.ImageSurface(Cairo.Format.ARGB32, W, H);
    const cr = new Cairo.Context(surf);
    cr.setOperator(Cairo.Operator.CLEAR);
    cr.paint();
    cr.setOperator(Cairo.Operator.OVER);
    for (const [lx, ly, lr] of [[0.32, 0.55, 0.27], [0.47, 0.44, 0.23],
                                [0.62, 0.54, 0.21], [0.40, 0.63, 0.26],
                                [0.56, 0.64, 0.23]]) {
        const r = lr * H, x = lx * W, y = ly * H;
        const g = new Cairo.RadialGradient(x, y, r * 0.05, x, y, r);
        g.addColorStopRGBA(0, 1, 1, 1, 0.5);
        g.addColorStopRGBA(0.55, 1, 1, 1, 0.22);
        g.addColorStopRGBA(1, 1, 1, 1, 0);
        cr.setSource(g);
        cr.arc(x, y, r, 0, TAU);
        cr.fill();
    }
    cr.$dispose();
    surf.flush();
    return surf;
}

export function createSky() {
    return {sprite: null, w: 0, h: 0, scene: '', night: null, lastT: null,
            drops: [], flakes: [], hail: [], clouds: [], stars: [],
            streaks: [], fog: []};
}

function rebuild(sky, w, h, scene) {
    const f = FEATURES[scene] ?? {};
    const s = Math.max(0.5, Math.min(1.5, (w * h) / (1050 * 420)));
    const mk = (n, fn) => Array.from({length: Math.round(n * s)}, fn);
    sky.drops = mk(f.drops ?? 0, () => ({x: rand(-60, w + 60), y: rand(-h, h),
                                         l: rand(12, 34), sp: rand(260, 480)}));
    sky.flakes = mk(f.flakes ?? 0, () => ({x: rand(0, w), y: rand(-h, h),
                                           r: rand(1.8, 3.6), sp: rand(28, 60),
                                           ph: rand(0, TAU)}));
    sky.hail = mk(f.hail ?? 0, () => ({x: rand(0, w), y: rand(-h, h),
                                       vx: rand(-40, 40), vy: rand(180, 320),
                                       r: rand(2.4, 4.4), b: 0}));
    sky.streaks = mk(f.streaks ?? 0, () => ({x: rand(-w, w), y: rand(0, h),
                                             l: rand(40, 170), sp: rand(120, 320),
                                             w: rand(0.8, 2.2), o: rand(0.12, 0.4)}));
    sky.fog = mk(f.fog ? 8 : 0, () => ({x: rand(-w, w), y: rand(0.25 * h, 0.85 * h),
                                        len: rand(0.35, 0.9) * w, sp: rand(12, 40),
                                        ht: rand(26, 90), o: rand(0.05, 0.16)}));
    sky.stars = mk(f.stars ? 70 : 0, () => {
        const tw = rand(0, 1) < 0.22;           // some grow 4-point flares
        return {x: rand(0, w), y: rand(0, 0.6 * h),
                r: tw ? rand(3.0, 5.6) : rand(0.8, 2.0), ph: rand(0, TAU),
                tw, cool: rand(0, 1) < 0.45};
    });
    sky.clouds = mk((f.clouds ?? 0), () => ({x: rand(0, w), y: rand(0.02 * h, 0.42 * h),
                                             s: rand(1.0, 2.6), sp: rand(6, 26)}));
    sky.w = w; sky.h = h; sky.scene = scene; sky.lastT = null;
}

/* 4-point star flare: slim crossed diamond + bright core — the reference's
 * cyan-white twinkle stars. Straight edges read as rays at these sizes. */
function sparkle(cr, x, y, s, a, cool) {
    const r = cool ? 0.55 : 1, g = cool ? 0.83 : 1, b = 1;
    const k = s * 0.15;                        // waist thickness
    cr.save();
    cr.translate(x, y);
    cr.setSourceRGBA(r, g, b, a * 0.85);
    cr.newPath();
    cr.moveTo(0, -s);
    cr.lineTo(k, -k);
    cr.lineTo(s, 0);
    cr.lineTo(k, k);
    cr.lineTo(0, s);
    cr.lineTo(-k, k);
    cr.lineTo(-s, 0);
    cr.lineTo(-k, -k);
    cr.closePath();
    cr.fill();
    cr.newPath();
    cr.arc(0, 0, Math.max(0.6, s * 0.16), 0, TAU);
    cr.setSourceRGBA(r, g, b, Math.min(1, a * 1.5));
    cr.fill();
    cr.restore();
}

/* Rounded (or square) clip path so a full-bleed background never squares
 * off the popup's corners. Caller saves/restores. */
function roundClip(cr, w, h, radius) {
    if (radius > 0) {
        const r = Math.min(radius, w / 2, h / 2), k = 0.5523 * r;
        cr.moveTo(r, 0);
        cr.lineTo(w - r, 0);
        cr.curveTo(w - r + k, 0, w, r - k, w, r);
        cr.lineTo(w, h - r);
        cr.curveTo(w, h - r + k, w - r + k, h, w - r, h);
        cr.lineTo(r, h);
        cr.curveTo(r - k, h, 0, h - r + k, 0, h - r);
        cr.lineTo(0, r);
        cr.curveTo(0, r - k, r - k, 0, r, 0);
        cr.closePath();
    } else {
        cr.rectangle(0, 0, w, h);
    }
}

/**
 * paintPlain(cr, {w, h, accent, dark, radius}) — offscreen preview stand-in
 * for the 'accent' menu style. That style paints nothing in the live shell
 * (the shell theme's own popup background shows through the transparent
 * surface), so this just renders a supplied theme-colour stand-in with a
 * whisper of vertical gradient for the card previews. `accent` here is that
 * background colour (a mid grey for dark themes, near-white for light).
 */
export function paintPlain(cr, {w, h, accent = [0.19, 0.19, 0.19],
                                dark = true, radius = 0}) {
    const shade = (f) => [...accent.map(c => Math.min(1, Math.max(0, c * f))), 1];
    cr.save();
    roundClip(cr, w, h, radius);
    cr.clip();
    const g = new Cairo.LinearGradient(0, 0, 0, h);
    g.addColorStopRGBA(0, ...shade(1.08));
    g.addColorStopRGBA(1, ...shade(0.9));
    cr.setSource(g);
    cr.paint();
    cr.restore();
}

export function paintSky(cr, {w, h, time, scene, night, sky, scrim = null,
                              radius = 0, phase = null}) {
    if (sky.scene !== scene || sky.w !== Math.round(w) || sky.h !== Math.round(h))
        rebuild(sky, Math.round(w), Math.round(h), scene);

    const dt = sky.lastT === null ? 0 : Math.min(0.1, time - sky.lastT);
    sky.lastT = time;
    const f = FEATURES[scene] ?? {};
    const [top, bottom] = hexPal(scene, night);
    const s = h / 420;                      // size scale vs mockup

    cr.save();
    roundClip(cr, w, h, radius);
    cr.clip();

    // ── gradient backdrop ───────────────────────────────────────────────
    const g = new Cairo.LinearGradient(0, 0, 0, h);
    g.addColorStopRGB(0, ...top);
    g.addColorStopRGB(1, ...bottom);
    cr.setSource(g);
    cr.paint();

    // ── celestial ────────────────────────────────────────────────────────
    const sx = w * 0.82, sy = h * 0.16, R = 64 * s;
    if ((f.sun || f.moon) && !night) {
        cr.save();
        cr.translate(sx, sy);
        cr.rotate(time * 0.05);
        for (let k = 0; k < 12; k++) {
            cr.rotate(TAU / 24);
            const rr = R * (2.0 + Math.sin(time * 0.9 + k) * 0.12);
            cr.setSourceRGBA(1, 0.82, 0.40, 0.14);
            cr.moveTo(-4 * s, 0);
            cr.lineTo(0, -rr);
            cr.lineTo(4 * s, 0);
            cr.closePath();
            cr.fill();
        }
        cr.restore();
        const sg = new Cairo.RadialGradient(sx, sy, 0, sx, sy, R * 2.6);
        sg.addColorStopRGBA(0, 1, 0.75, 0.24, 0.95);
        sg.addColorStopRGBA(0.4, 1, 0.67, 0.16, 0.25);
        sg.addColorStopRGBA(1, 1, 0.67, 0.16, 0);
        cr.setSource(sg);
        cr.arc(sx, sy, R * 2.6, 0, TAU);
        cr.fill();
    } else if (f.stars || f.moon) {
        for (const st of sky.stars) {
            const w01 = Math.abs(Math.sin(time * 1.3 + st.ph));
            const a = 0.25 + 0.5 * w01;
            if (st.tw) {
                sparkle(cr, st.x, st.y, st.r * (0.7 + 0.5 * w01), a, st.cool);
                continue;
            }
            if (st.cool)
                cr.setSourceRGBA(0.72, 0.86, 1.0, a);
            else
                cr.setSourceRGBA(1, 1, 1, a);
            cr.newPath();
            cr.arc(st.x, st.y, st.r, 0, TAU);
            cr.fill();
        }
        if (f.moon) {
            // warm halo scaled by the actual illuminated fraction
            const ph = Number.isFinite(phase) ? phase : moonPhase().phase;
            // wide soft halo: cool blue-white bloom fading deep into the sky
            const A = 0.08 + 0.22 * illumOf(ph);
            const mg = new Cairo.RadialGradient(sx, sy, R * 0.6, sx, sy, R * 3.4);
            mg.addColorStopRGBA(0, 0.80, 0.87, 0.99, A);
            mg.addColorStopRGBA(0.45, 0.70, 0.80, 0.96, A * 0.38);
            mg.addColorStopRGBA(1, 0.70, 0.80, 0.96, 0);
            cr.setSource(mg);
            cr.arc(sx, sy, R * 3.4, 0, TAU);
            cr.fill();
            // tonight's real phase, cratered, off-white (moon.js)
            paintMoon(cr, sx, sy, R * 0.85, ph, 'sky');
        }
    }

    // ── drifting clouds ──────────────────────────────────────────────────
    if (sky.clouds.length) {
        if (!sky.sprite)
            sky.sprite = makeCloudSprite();
        const tint = night ? 0.45 : 1;
        for (const c of sky.clouds) {
            c.x += c.sp * dt;
            if (c.x > w + 200)
                c.x = -260;
            const cw = 400 * c.s * 0.24, ch = 200 * c.s * 0.24;
            cr.save();
            cr.translate(c.x, c.y + Math.sin(time * 0.3 + c.y) * 4 * s);
            cr.scale(cw / 400, ch / 200);
            cr.setSourceSurface(sky.sprite, 0, 0);
            cr.paintWithAlpha((scene === 'clear' || scene === 'sun' ? 0.45 : 0.8) * tint);
            cr.restore();
        }
    }

    // ── fog bands ────────────────────────────────────────────────────────
    for (const fg of sky.fog) {
        fg.x += fg.sp * dt;
        if (fg.x > w + fg.len)
            fg.x = -fg.len;
        const grad2 = new Cairo.LinearGradient(0, fg.y - fg.ht, 0, fg.y + fg.ht);
        grad2.addColorStopRGBA(0, 0.90, 0.92, 0.93, 0);
        grad2.addColorStopRGBA(0.5, 0.90, 0.92, 0.93, fg.o);
        grad2.addColorStopRGBA(1, 0.90, 0.92, 0.93, 0);
        cr.setSource(grad2);
        cr.rectangle(fg.x, fg.y - fg.ht, fg.len, fg.ht * 2);
        cr.fill();
    }

    // ── rain ─────────────────────────────────────────────────────────────
    const rainCol = scene === 'sleet' ? [0.63, 0.80, 0.93] : [0.73, 0.84, 0.94];
    cr.setLineCap(Cairo.LineCap.ROUND);
    cr.setLineWidth(1.4 * s);
    for (const d of sky.drops) {
        d.y += d.sp * dt;
        d.x -= d.sp * 0.28 * dt;
        if (d.y > h + 20) {
            d.y = -20;
            d.x = rand(0, w + 60);
        }
        cr.setSourceRGBA(...rainCol, 0.45);
        cr.moveTo(d.x, d.y);
        cr.lineTo(d.x - d.l * 0.3, d.y + d.l);
        cr.stroke();
    }

    // ── snow ─────────────────────────────────────────────────────────────
    for (const fl of sky.flakes) {
        fl.y += fl.sp * dt;
        if (fl.y > h + 10) {
            fl.y = -10;
            fl.x = rand(0, w);
        }
        cr.setSourceRGBA(1, 1, 1, 0.85);
        cr.arc(fl.x + Math.sin(time * 1.2 + fl.ph) * 18 * s, fl.y, fl.r, 0, TAU);
        cr.fill();
    }

    // ── hail (gravity + floor bounce, like the icon painter) ────────────
    for (const hl of sky.hail) {
        hl.vy += 900 * dt;
        hl.x += hl.vx * dt;
        hl.y += hl.vy * dt;
        if (hl.y > h - 6 - hl.r && hl.vy > 0) {
            hl.y = h - 6 - hl.r;
            hl.vy *= -0.42;
            hl.vx = rand(-160, 160);
            hl.b++;
        }
        if (hl.b > 2 || hl.x < -10 || hl.x > w + 10)
            Object.assign(hl, {x: rand(0, w), y: -10, vx: rand(-40, 40),
                               vy: rand(180, 320), r: rand(2.4, 4.4), b: 0});
        cr.setSourceRGBA(0.94, 0.96, 0.99, 0.92);
        cr.arc(hl.x, hl.y, hl.r, 0, TAU);
        cr.fill();
    }

    // ── wind streaks ─────────────────────────────────────────────────────
    for (const st of sky.streaks) {
        st.x += st.sp * dt;
        if (st.x > w + st.l) {
            st.x = -st.l;
            st.y = rand(0, h);
        }
        cr.setSourceRGBA(0.86, 0.93, 0.98, st.o);
        cr.setLineWidth(st.w);
        cr.moveTo(st.x, st.y);
        cr.lineTo(st.x + st.l, st.y);
        cr.stroke();
    }

    // ── storm flash + bolt ───────────────────────────────────────────────
    if (f.bolt) {
        const c = time % 3.1;
        let fl = 0;
        if (c < 0.08)      fl = c / 0.08;
        else if (c < 0.18) fl = 1 - (c - 0.08) / 0.1;
        else if (c < 0.26) fl = 0.5 * (c - 0.18) / 0.08;
        else if (c < 0.38) fl = 0.5 * (1 - (c - 0.26) / 0.12);
        if (fl > 0) {
            cr.setSourceRGBA(1, 0.99, 0.92, 0.10 * fl);
            cr.paint();
            cr.save();
            cr.translate(w * 0.5, h * 0.05);
            cr.setSourceRGBA(1, 0.86, 0.31, fl);
            cr.setLineWidth(3.4 * s);
            cr.setLineJoin(Cairo.LineJoin.ROUND);
            cr.setLineCap(Cairo.LineCap.ROUND);
            cr.moveTo(0, 0);
            cr.lineTo(-38 * s, 90 * s);
            cr.lineTo(14 * s, 96 * s);
            cr.lineTo(-30 * s, 210 * s);
            cr.stroke();
            cr.restore();
        }
    }

    // ── theme scrim: light-mode washes the sky so dark ink stays legible;
    //    dark mode gets a faint vignette to lift white text off bright sun
    if (scrim) {
        cr.setSourceRGBA(scrim[0], scrim[1], scrim[2], scrim[3]);
        cr.paint();
    }

    cr.restore();
}
