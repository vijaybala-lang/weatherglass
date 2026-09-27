/* painter.js — pure Cairo weather scene painter.
 *
 * Every scene is designed on a 24x24 unit grid. The caller scales the cairo
 * context so (0,0)-(24,24) covers the whole surface, then calls paintWeather()
 * once per frame. Particle positions live in a caller-owned `particles` object
 * so the painter stays stateless and testable outside the shell (see
 * tools/preview.mjs, which renders the exact same frames to PNG).
 */

import Cairo from 'gi://cairo';
import {paintMoon, moonPhase, illumOf} from './moon.js';

export const GRID = 24;

const TAU = Math.PI * 2;

/* ── particle pools ─────────────────────────────────────────────────────── */

function rand(min, max) {
    return min + Math.random() * (max - min);
}

export function createParticles() {
    const drops = [];
    for (let i = 0; i < 16; i++)
        drops.push({x: rand(3, 21), y: rand(9, 24), len: rand(1.6, 3.2), sp: rand(11, 18)});
    const flakes = [];
    for (let i = 0; i < 12; i++)
        flakes.push({x: rand(3, 21), y: rand(9, 24), r: rand(0.8, 1.4),
                     sp: rand(2.5, 4.5), ph: rand(0, TAU)});
    const hail = [];
    for (let i = 0; i < 10; i++) {
        // scatter initial heights so the first cycle doesn't fall in unison
        hail.push(Object.assign(newHailStone(), {y: rand(9, FLOOR), vy: rand(2, 9)}));
    }
    const stars = [
        {x: 19.5, y: 4.5, ph: 0.0}, {x: 21.5, y: 9, ph: 1.7},
        {x: 17.5, y: 8, ph: 3.1}, {x: 20.5, y: 13.5, ph: 4.4},
    ];
    return {drops, flakes, hail, stars, lastT: null};
}

const FLOOR = 21.8;   // where hailstones bounce

function newHailStone() {
    return {
        x: rand(3, 21), y: rand(8.5, 11),
        vx: rand(-1, 1.5), vy: rand(6, 10),
        r: rand(0.7, 1.25), bounces: 0,
    };
}

/* ── small drawing helpers ──────────────────────────────────────────────── */

function circle(cr, x, y, r) {
    cr.newSubPath();
    cr.arc(x, y, r, 0, TAU);
}

function line(cr, x1, y1, x2, y2) {
    cr.moveTo(x1, y1);
    cr.lineTo(x2, y2);
}

/** Puffy cloud made of three bumps over a flat base, one gradient fill. */
function cloud(cr, cx, cy, s, top, bot, alpha = 1) {
    const g = new Cairo.LinearGradient(0, cy - 5 * s, 0, cy + 2.4 * s);
    g.addColorStopRGBA(0, top[0], top[1], top[2], alpha);
    g.addColorStopRGBA(1, bot[0], bot[1], bot[2], alpha);
    cr.setSource(g);
    circle(cr, cx - 3.2 * s, cy - 0.3 * s, 2.4 * s);
    circle(cr, cx + 3.1 * s, cy - 0.1 * s, 2.6 * s);
    circle(cr, cx,          cy - 1.8 * s, 3.2 * s);
    cr.rectangle(cx - 5.6 * s, cy - 0.5 * s, 11.2 * s, 2.9 * s);
    cr.fill();
}

const CLOUD_LIGHT = [[0.76, 0.82, 0.87], [0.60, 0.68, 0.75]];
const CLOUD_RAIN  = [[0.56, 0.64, 0.71], [0.38, 0.47, 0.55]];
const CLOUD_DARK  = [[0.42, 0.48, 0.56], [0.25, 0.30, 0.38]];

/* Light-card palette: the dark-panel designs lean on pale ink (moon,
 * flakes, fog banks, water glints) which vanishes on a white card — e.g.
 * the chart strip in 'accent' light mode. paintWeather sets _light once
 * per frame (single-threaded, synchronous) and the pale elements below
 * swap to their darker twins. Scenes/callers stay theme-agnostic. */
let _light = false;
const INK_WATER  = () => _light ? [0.16, 0.52, 0.82] : [0.31, 0.76, 0.96];
const INK_FLAKE  = () => _light ? [0.45, 0.56, 0.72] : [0.92, 0.96, 1.00];
const INK_STONE  = () => _light ? [0.55, 0.64, 0.76] : [0.91, 0.94, 0.97];
const INK_STREAK = () => _light ? [0.24, 0.50, 0.78] : [0.50, 0.83, 1.00];
const INK_FOG    = () => _light ? [0.44, 0.52, 0.62] : [0.72, 0.76, 0.80];
const INK_STAR   = () => _light ? [0.55, 0.62, 0.74] : [0.95, 0.97, 1.00];
const INK_SPIN   = () => _light ? [0.28, 0.33, 0.40] : [0.85, 0.88, 0.92];
const INK_MOON_EDGE = () => _light ? [0.24, 0.30, 0.40, 0.85] : null;

/** Flowing dash "wind streak" across the full width of the scene. */
function streak(cr, y, lw, alpha, dashOn, dashOff, offset, color = null) {
    const c = color ?? INK_STREAK();
    cr.save();
    cr.setSourceRGBA(c[0], c[1], c[2], alpha);
    cr.setLineWidth(lw);
    cr.setLineCap(Cairo.LineCap.ROUND);
    cr.setDash([dashOn, dashOff], offset);
    cr.moveTo(-2, y);
    cr.curveTo(6, y - 1.1, 14, y + 1.1, 26, y);
    cr.stroke();
    cr.restore();
}

/** A few wind streaks, used for the windy scene and as an overlay. */
function windStreaks(cr, t, alphaScale, count = 3) {
    for (let i = 0; i < count; i++) {
        const y = 5.5 + i * (13 / Math.max(count - 1, 1));
        const sp = 3.2 + i * 0.9;
        streak(cr, y + Math.sin(t * 0.8 + i * 2.1) * 0.5,
               0.9 + (i % 2) * 0.35,
               (0.45 + 0.25 * ((i + 1) % 3)) * alphaScale,
               5 + i, 4.5 + i * 0.7,
               -(t * sp) % 9.5);
    }
}

/** Raindrops, advanced with the shared particle clock. */
function rainDrops(cr, p, t, count, slant, alpha) {
    const dt = p.lastT === null ? 0 : Math.min(0.06, t - p.lastT);
    cr.setLineCap(Cairo.LineCap.ROUND);
    cr.setLineWidth(1.0);
    const c = INK_WATER();
    cr.setSourceRGBA(c[0], c[1], c[2], alpha);
    for (let i = 0; i < count; i++) {
        const d = p.drops[i];
        d.y += d.sp * dt;
        if (d.y > 23.5) {
            d.y = rand(9.3, 11);
            d.x = rand(2.5, 21.5);
        }
        line(cr, d.x, d.y, d.x - slant * d.len, d.y + d.len);
    }
    cr.stroke();
}

/** Snowflakes (six spokes), drifting side to side. */
function snowFlakes(cr, p, t, count) {
    const dt = p.lastT === null ? 0 : Math.min(0.06, t - p.lastT);
    cr.setLineCap(Cairo.LineCap.ROUND);
    cr.setLineWidth(0.55);
    for (let i = 0; i < count; i++) {
        const f = p.flakes[i];
        f.y += f.sp * dt;
        if (f.y > 23.5) {
            f.y = rand(9.3, 11);
            f.x = rand(3, 21);
        }
        const x = f.x + Math.sin(t * 1.4 + f.ph) * 1.1;
        const rot = t * 1.2 + f.ph;
        cr.save();
        cr.translate(x, f.y);
        cr.rotate(rot);
        const c = INK_FLAKE();
        cr.setSourceRGBA(c[0], c[1], c[2], 0.95);
        for (let k = 0; k < 6; k++) {
            const a = (k / 6) * TAU;
            line(cr, 0, 0, Math.cos(a) * f.r, Math.sin(a) * f.r);
        }
        cr.stroke();
        cr.restore();
    }
}

/** Hailstones: fall under gravity, bounce & scatter on the floor, respawn. */
function hailStones(cr, p, t, count) {
    const dt = p.lastT === null ? 0 : Math.min(0.06, t - p.lastT);
    for (let i = 0; i < count; i++) {
        const h = p.hail[i];
        h.vy += 24 * dt;                  // gravity
        h.x += h.vx * dt;
        h.y += h.vy * dt;
        if (h.y >= FLOOR && h.vy > 0) {   // bounce with energy loss
            h.y = FLOOR;
            h.vy *= -0.42;
            h.vx = rand(-3, 3);
            h.bounces++;
        }
        if (h.bounces > 2 || Math.abs(h.vy) < 0.6 && h.bounces > 0 ||
            h.x < -1 || h.x > 25)
            Object.assign(h, newHailStone());
        const sc = INK_STONE();
        cr.setSourceRGBA(sc[0], sc[1], sc[2], 0.95);
        circle(cr, h.x, h.y, h.r);
        cr.fill();
        cr.setSourceRGBA(1, 1, 1, 0.55);  // glint
        circle(cr, h.x - h.r * 0.3, h.y - h.r * 0.35, h.r * 0.35);
        cr.fill();
    }
}

/* ── celestial bodies ───────────────────────────────────────────────────── */

function sunBody(cr, cx, cy, r, t, rayLen) {
    // soft pulsing glow
    const glow = new Cairo.RadialGradient(cx, cy, r * 0.5, cx, cy, r * 2.15);
    glow.addColorStopRGBA(0, 1, 0.78, 0.15, 0.5);
    glow.addColorStopRGBA(1, 1, 0.62, 0.0, 0);
    cr.setSource(glow);
    cr.paintWithAlpha(0.75 + 0.25 * Math.sin(t * 1.7));

    // slowly rotating rays
    cr.save();
    cr.translate(cx, cy);
    cr.rotate(t * 0.45);
    cr.setLineCap(Cairo.LineCap.ROUND);
    cr.setLineWidth(1.5);
    cr.setSourceRGBA(1.0, 0.72, 0.10, 0.95);
    const len = rayLen * (1 + 0.12 * Math.sin(t * 2.3));
    for (let i = 0; i < 8; i++) {
        const a = (i / 8) * TAU;
        const c = Math.cos(a), s = Math.sin(a);
        cr.newSubPath();
        cr.moveTo(c * (r + 1.1), s * (r + 1.1));
        cr.lineTo(c * (r + 1.1 + len), s * (r + 1.1 + len));
    }
    cr.stroke();
    cr.restore();

    // core
    const core = new Cairo.RadialGradient(cx - r * 0.35, cy - r * 0.35, r * 0.2,
                                          cx, cy, r);
    core.addColorStopRGB(0, 1.0, 0.93, 0.55);
    core.addColorStopRGB(1, 1.0, 0.71, 0.10);
    cr.setSource(core);
    circle(cr, cx, cy, r);
    cr.fill();
}

function moonBody(cr, cx, cy, r, t, p, phase) {
    const ph = Number.isFinite(phase) ? phase : moonPhase().phase;
    if (!_light) {
        // halo is a night-sky trick: on bright day skies it's exactly the
        // "blown-out highlight" — suppressed there, porcelain does the job
        const glow = new Cairo.RadialGradient(cx, cy, r * 0.5, cx, cy, r * 2.2);
        glow.addColorStopRGBA(0, 0.86, 0.87, 0.97, 0.30 * (0.25 + 0.75 * illumOf(ph)));
        glow.addColorStopRGBA(1, 0.86, 0.87, 0.97, 0);
        cr.setSource(glow);
        cr.paint();
    }

    // tonight's REAL phase (moon.js) — flat lit shape, transparent shadow:
    // the one rendering that reads at 16px on the panel; on light cards a
    // dimmed porcelain face + thin edge replace white+glow, which blows out
    paintMoon(cr, cx, cy, r, ph, 'icon',
              {outline: INK_MOON_EDGE(),
               face: _light ? [0.84, 0.86, 0.90] : null});

    // twinkling stars
    const sc = INK_STAR();
    for (const s of p.stars) {
        const a = 0.35 + 0.6 * Math.abs(Math.sin(t * 1.3 + s.ph));
        cr.setSourceRGBA(sc[0], sc[1], sc[2], a);
        circle(cr, s.x, s.y, 0.55);
        cr.fill();
    }
}

/* ── scenes (all draw inside the 24x24 grid) ────────────────────────────── */

function sceneSun(cr, ctx) {
    const {t, windy} = ctx;
    sunBody(cr, 12, 12, 4.6, t, 3.6);
    if (windy)
        windStreaks(cr, t, 0.45, 2);
}

function sceneMoon(cr, ctx) {
    const {t, p, windy} = ctx;
    moonBody(cr, 12, 12, 4.8, t, p, ctx.phase);
    if (windy)
        windStreaks(cr, t, 0.45, 2);
}

function scenePartly(cr, ctx) {
    const {t, windy, night} = ctx;
    if (night)
        moonBody(cr, 8.5, 8, 3.6, t, ctx.p, ctx.phase);
    else
        sunBody(cr, 8.5, 8, 3.6, t, 2.6);
    const dx = Math.sin(t * 0.7) * 0.7;
    cloud(cr, 13.5 + dx, 15, 0.85, CLOUD_LIGHT[0], CLOUD_LIGHT[1]);
    if (windy)
        windStreaks(cr, t, 0.4, 2);
}

function sceneCloud(cr, ctx) {
    const {t, windy} = ctx;
    cloud(cr, 9.5 - Math.sin(t * 0.5) * 0.8, 8.5, 0.62, CLOUD_LIGHT[0], CLOUD_LIGHT[1], 0.65);
    cloud(cr, 13 + Math.sin(t * 0.6) * 0.7, 14, 0.95, CLOUD_LIGHT[0], CLOUD_LIGHT[1]);
    if (windy)
        windStreaks(cr, t, 0.4, 2);
}

function sceneFog(cr, ctx) {
    const {t} = ctx;
    cloud(cr, 12 + Math.sin(t * 0.5) * 0.5, 8, 0.7, CLOUD_LIGHT[0], CLOUD_LIGHT[1], 0.8);
    for (let i = 0; i < 3; i++) {
        const fc = INK_FOG();
        streak(cr, 14.5 + i * 3.2, 1.7, 0.40 - i * 0.06, 7, 3.5,
               -(t * (2.4 + i)) % 10.5, fc);
    }
}

function sceneRain(cr, ctx) {
    const {t, p, intensity, windKmh, windy} = ctx;
    cloud(cr, 12 + Math.sin(t * 0.5) * 0.5, 7.5, 0.95, CLOUD_RAIN[0], CLOUD_RAIN[1]);
    const count = 7 + Math.min(9, Math.round(intensity * 2.2));
    const slant = Math.min(0.9, windKmh / 45);
    rainDrops(cr, p, t, count, slant, 0.9);
    if (windy)
        windStreaks(cr, t, 0.35, 2);
}

function sceneSnow(cr, ctx) {
    const {t, p, intensity, windy} = ctx;
    cloud(cr, 12 + Math.sin(t * 0.5) * 0.5, 7.5, 0.92, CLOUD_RAIN[0], CLOUD_RAIN[1]);
    const count = 6 + Math.min(6, Math.round(intensity * 1.8));
    snowFlakes(cr, p, t, count);
    if (windy)
        windStreaks(cr, t, 0.35, 2);
}

/** Sleet / freezing rain: half drops, half flakes, extra slant. */
function sceneSleet(cr, ctx) {
    const {t, p, intensity, windKmh, windy} = ctx;
    cloud(cr, 12 + Math.sin(t * 0.5) * 0.5, 7.5, 0.92, CLOUD_RAIN[0], CLOUD_RAIN[1]);
    const n = 5 + Math.min(5, Math.round(intensity * 1.4));
    rainDrops(cr, p, t, n, Math.min(1.1, windKmh / 36 + 0.25), 0.8);
    snowFlakes(cr, p, t, Math.max(4, n - 2));
    if (windy)
        windStreaks(cr, t, 0.35, 2);
}

/** Hail: dark storm cloud, a few hard rain streaks, bouncing ice stones. */
function sceneHail(cr, ctx) {
    const {t, p, windKmh, windy} = ctx;
    cloud(cr, 12 + Math.sin(t * 0.45) * 0.5, 7.2, 0.98, CLOUD_DARK[0], CLOUD_DARK[1]);
    rainDrops(cr, p, t, 5, Math.min(0.9, windKmh / 45), 0.5);
    hailStones(cr, p, t, p.hail.length);
    if (windy)
        windStreaks(cr, t, 0.35, 2);
}

const BOLTS = [
    [[13, 10.8], [10.8, 14.6], [12.7, 14.6], [10.2, 19.6]],
    [[10.6, 10.4], [13.2, 14.0], [11.4, 14.2], [13.8, 19.8]],
];

function sceneStorm(cr, ctx) {
    const {t, p, intensity, windKmh, windy} = ctx;
    cloud(cr, 12 + Math.sin(t * 0.4) * 0.5, 7.2, 1.0, CLOUD_DARK[0], CLOUD_DARK[1]);
    rainDrops(cr, p, t, 8 + Math.min(8, Math.round(intensity * 2)), Math.min(0.9, windKmh / 45), 0.85);

    // double-flick lightning every ~2.8 s, alternating bolt shape
    const cycle = Math.floor(t / 2.8);
    const c = t % 2.8;
    let flash = 0;
    if (c < 0.07)       flash = c / 0.07;
    else if (c < 0.14)  flash = 1 - (c - 0.07) / 0.07;
    else if (c < 0.20)  flash = 0.6 * (c - 0.14) / 0.06;
    else if (c < 0.28)  flash = 0.6 * (1 - (c - 0.20) / 0.08);
    if (flash > 0) {
        // soft sky glow behind the bolt
        const glow = new Cairo.RadialGradient(12, 12, 2, 12, 12, 15);
        glow.addColorStopRGBA(0, 1, 1, 0.94, 0.22 * flash);
        glow.addColorStopRGBA(1, 1, 1, 0.94, 0);
        cr.setSource(glow);
        cr.paint();

        cr.save();
        cr.setLineJoin(Cairo.LineJoin.ROUND);
        cr.setLineCap(Cairo.LineCap.ROUND);
        const bolt = BOLTS[cycle % BOLTS.length];
        cr.setSourceRGBA(1, 0.92, 0.23, flash);
        cr.setLineWidth(2.4);
        cr.moveTo(bolt[0][0], bolt[0][1]);
        for (let i = 1; i < bolt.length; i++)
            cr.lineTo(bolt[i][0], bolt[i][1]);
        cr.stroke();
        cr.setSourceRGBA(1, 1, 1, flash);
        cr.setLineWidth(0.9);
        cr.stroke();
        cr.restore();
    }
    if (windy)
        windStreaks(cr, t, 0.3, 2);
}

/** Curling gust that travels across the scene (wind-scene garnish). */
function gustCurl(cr, x, y, s, alpha) {
    cr.save();
    cr.translate(x, y);
    cr.setSourceRGBA(0.55, 0.85, 1.0, alpha);
    cr.setLineCap(Cairo.LineCap.ROUND);
    cr.setLineWidth(0.8);
    cr.newPath();
    cr.arc(0, 0, s, Math.PI * 0.9, Math.PI * 2.2);     // open spiral
    cr.stroke();
    cr.newPath();
    cr.arc(s * 0.5, s * 0.4, s * 0.45, Math.PI * 1.1, Math.PI * 2.5);
    cr.stroke();
    cr.restore();
}

function sceneWind(cr, ctx) {
    const {t} = ctx;
    windStreaks(cr, t, 1.0, 4);
    // one longer high streak for depth
    streak(cr, 3.2 + Math.sin(t) * 0.4, 0.7, 0.35, 3.5, 6, -(t * 5) % 9.5);
    // two curling gusts sweeping left→right at different depths
    gustCurl(cr, (t * 4.4) % 28 - 2, 8.5 + Math.sin(t * 1.6) * 0.8, 1.5, 0.6);
    gustCurl(cr, ((t * 3.1) % 28) - 2 + 9, 16 + Math.cos(t * 1.2) * 0.8, 1.1, 0.4);
}

function sceneError(cr) {
    cr.setSourceRGBA(0.95, 0.45, 0.40, 0.95);
    cr.setLineWidth(1.6);
    circle(cr, 12, 12, 7.5);
    cr.stroke();
    cr.selectFontFace('Sans', Cairo.FontSlant.NORMAL, Cairo.FontWeight.BOLD);
    cr.setFontSize(11);
    cr.setSourceRGBA(0.95, 0.45, 0.40, 0.95);
    const ext = cr.textExtents('!');
    cr.moveTo(12 - ext.xAdvance / 2 - ext.xBearing, 12 - ext.yBearing - ext.height / 2);
    cr.showText('!');
}

function sceneLoading(cr, ctx) {
    const {t} = ctx;
    cr.save();
    cr.setLineCap(Cairo.LineCap.ROUND);
    cr.setLineWidth(2);
    cr.setSourceRGBA(0.40, 0.43, 0.47, 0.25);
    circle(cr, 12, 12, 6);
    cr.stroke();
    cr.newPath();
    const a = t * 4;
    cr.arc(12, 12, 6, a, a + Math.PI * 1.1);
    const c = INK_SPIN();
    cr.setSourceRGBA(c[0], c[1], c[2], 0.95);
    cr.stroke();
    cr.restore();
}

const SCENES = {
    sun: sceneSun, moon: sceneMoon, partly: scenePartly, cloud: sceneCloud,
    fog: sceneFog, rain: sceneRain, snow: sceneSnow, sleet: sceneSleet,
    hail: sceneHail, storm: sceneStorm, wind: sceneWind,
    error: sceneError, loading: sceneLoading,
};

/**
 * Paint one frame. `opts` must already be in grid space — the caller scales
 * the context. Fields:
 *   scene      one of SCENES
 *   time       seconds since the icon appeared (animation clock)
 *   particles  pool from createParticles()
 *   windy      bool — add wind streaks to the scene
 *   night      bool — render night variant (partly)
 *   intensity  0..10 precipitation mm, drives drop/flake count
 *   windKmh    wind speed in km/h, drives rain slant
 */
export function paintWeather(cr, opts) {
    const p = opts.particles || createParticles();
    _light = opts.dark === false;          // one palette decision per frame
    const ctx = {
        t: opts.time || 0,
        p,
        windy: !!opts.windy,
        night: !!opts.night,
        intensity: opts.intensity || 0,
        windKmh: opts.windKmh || 0,
        phase: Number.isFinite(opts.phase) ? opts.phase : moonPhase().phase,
    };
    cr.save();
    // fade rain/storm drops out from under the cloud
    const fn = SCENES[opts.scene] || sceneError;
    fn(cr, ctx);
    cr.restore();
    p.lastT = ctx.t;   // advance the shared particle clock for the next frame
}
