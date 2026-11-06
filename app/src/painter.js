/* == SYNCHED DESIGN BRAIN (byte-identity enforced by scripts/check-design-parity.py) == */
/* painter.js -- pure Cairo weather scene painter. */

import Cairo from 'gi://cairo';
import { paintMoon, moonPhase, illumOf } from './moon.js';

export const GRID = 24;

const TWO_PI = Math.PI * 2;

function rand(min, max) {
    return min + Math.random() * (max - min);
}

/* Per-icon animation state. Rain/snow/grains are pure functions of
 * the clock (fixed-lane phase math), so the only simulated bodies
 * left are the bouncing hailstones; stars are the moon scene's fixed
 * twinkle field. lastTime feeds the hail integrator. */
export function createParticles() {
    const hail = [];
    for (let i = 0; i < 10; i++) {
        // scatter initial heights so the first cycle doesn't fall in unison
        hail.push(Object.assign(newHailStone(), { y: rand(14, FLOOR), vy: rand(2, 9) }));
    }
    const stars = [
        { x: 19.5, y: 4.5, phase: 0.0 }, { x: 21.5, y: 9, phase: 1.7 },
        { x: 17.5, y: 8, phase: 3.1 }, { x: 20.5, y: 13.5, phase: 4.4 },
    ];
    return { hail, stars, lastTime: null };
}

const FLOOR = 21.8;   // where hailstones bounce

function newHailStone() {
    return {
        x: rand(3, 21), y: rand(13.5, 15.5),
        vx: rand(-1, 1.5), vy: rand(6, 10),
        radius: rand(0.7, 1.25), bounces: 0,
    };
}

function circle(cr, x, y, radius) {
    cr.newSubPath();
    cr.arc(x, y, radius, 0, TWO_PI);
}

function line(cr, x1, y1, x2, y2) {
    cr.moveTo(x1, y1);
    cr.lineTo(x2, y2);
}

/** Teardrop droplet: round bottom, pointed tip, always upright.
 *  (x, y) is the centre of the round bottom; s the drop scale.
 *  Bulb radius 1.45, tip 3.15 above
 *  the bulb centre (2.9 wide x 4.6 tall at s=1). */
function teardrop(cr, x, y, s) {
    cr.moveTo(x, y - 3.15 * s);
    cr.curveTo(x + 0.95 * s, y - 1.75 * s, x + 1.45 * s, y - 0.80 * s,
        x + 1.45 * s, y);
    cr.arc(x, y, 1.45 * s, 0, Math.PI);
    cr.curveTo(x - 1.45 * s, y - 0.80 * s, x - 0.95 * s, y - 1.75 * s,
        x, y - 3.15 * s);
    cr.closePath();
}

/** Staggered zigzag for static precip poses: marks alternate between
 *  the band's two edges along an evenly spaced chain, so they step
 *  past each other like falling precip instead of standing in one
 *  ruler row -- while a hard minimum centre distance (minDist, the
 *  marks' diameter) guarantees no two ever overlap: the chain step
 *  is derived from it. Seeded jitter (zero-sum in x) keeps the
 *  constellation's centroid exactly on cx, the cloud's centre, and
 *  paints identically across repaints while neighbouring icons
 *  differ. Two-mark poses stagger only gently (a diagonal pair of
 *  drops would read as a slope, not weather). */
function staggeredSpots(count, seed, cx, halfSpan, y0, y1, minDist) {
    if (count <= 0)
        return [];
    const golden = 0.6180339887;
    let u = (seed % 977) * golden;
    const jit = () => { u += golden; return (u % 1) - 0.5; };
    if (count === 1)
        return [[cx, (y0 + y1) / 2]];
    const gapScale = count <= 2 ? 0.35 : count === 3 ? 0.7 : 1.0;
    const rowGap = (y1 - y0) * gapScale;
    const midY = (y0 + y1) / 2;
    const stepPref = count <= 2 ? 5.4 : count === 3 ? 4.4 : count === 4 ? 3.6 : 3.0;
    const stepNeed = Math.sqrt(Math.max(0, minDist * minDist - rowGap * rowGap)) + 0.25;
    const step = Math.min(Math.max(stepPref, stepNeed),
        (2 * halfSpan) / (count - 1));
    // x jitter capped so neighbours keep minDist even at extremes
    const slack = Math.sqrt(step * step + rowGap * rowGap) - minDist;
    const xAmp = Math.max(0, Math.min(0.25, slack / 2));
    const jits = Array.from({ length: count }, () => jit());
    const jMean = jits.reduce((s, j) => s + j, 0) / count;
    return Array.from({ length: count }, (_, i) => {
        const yBase = midY + (i % 2 ? rowGap / 2 : -rowGap / 2);
        return [
            cx + (i - (count - 1) / 2) * step + (jits[i] - jMean) * 2 * xAmp,
            Math.min(y1, Math.max(y0, yBase + jit() * 0.36)),
        ];
    });
}

/** Cloud silhouette (2026 icon set): the shared cloud
 *  as its three elliptical arcs — right bump, wide flat top, left bump
 *  wider than the base line — mapped from a 24-box path
 *  (bbox x 3.9..21.4, y 7.0..19) into this contract: base at
 *  centerY + 2.4, crown at centerY - 6.1, 12.4 wide. The arc joins are
 *  the shoulders; smoothing them (first attempt) read as a semicircle.
 *  squash < 1 flattens vertically about the base (overcast back bank). */
function cloud(cr, centerX, centerY, scale, topColor, bottomColor, alpha = 1, squash = 1, rim = groundLight()) {
    const gradient = new Cairo.LinearGradient(
        0, centerY + (2.4 - 8.52 * squash) * scale, 0, centerY + 2.4 * scale);
    gradient.addColorStopRGBA(0, topColor[0], topColor[1], topColor[2], alpha);
    gradient.addColorStopRGBA(1, bottomColor[0], bottomColor[1], bottomColor[2], alpha);
    cr.setSource(gradient);
    cr.save();
    cr.translate(centerX, centerY + 2.4 * scale);
    cr.scale(scale, scale * squash);
    cr.translate(0, -2.4);
    const earc = (cx, cy, rx, ry, a1, a2) => {
        cr.save();
        cr.translate(cx, cy);
        cr.scale(1, ry / rx);
        cr.arcNegative(0, 0, rx, a1, a2);
        cr.restore();
    };
    cr.newPath();
    cr.moveTo(-4.01, 2.4);
    cr.lineTo(3.24, 2.4);
    earc(3.14, -0.20, 3.06, 2.60, 1.539, -1.351);
    earc(-0.67, -2.28, 4.51, 3.83, -0.119, -3.261);
    earc(-3.36, 0.05, 2.84, 2.42, -2.252, -4.481);
    cr.closePath();
    if (rim) {
        cr.fillPreserve();
        const rimG = new Cairo.LinearGradient(0, -6.2, 0, 2.4);
        rimG.addColorStopRGBA(0.0, 0.92, 0.96, 1.0, 0.34 * alpha);
        rimG.addColorStopRGBA(0.48, 0.78, 0.84, 0.92, 0.10 * alpha);
        rimG.addColorStopRGBA(1.0, 0.20, 0.25, 0.34, 0.0);
        cr.setSource(rimG);
        cr.fillPreserve();
        cr.setSourceRGBA(0.94, 0.97, 1.0, 0.42 * alpha);
        cr.setLineWidth(0.42);
        cr.stroke();
        cr.restore();
    } else {
        cr.restore();
        cr.fill();
    }
}

const CLOUD_LIGHT = [[0.76, 0.82, 0.87], [0.60, 0.68, 0.75]];
const CLOUD_RAIN = [[0.58, 0.60, 0.64], [0.40, 0.43, 0.48]];
/* grounds at or above the 0.30 tile bar (WCAG luminance -- an overcast
   card foot at plain 0.66 / WCAG 0.39): the 0.58 rain-cloud top measured
   only 0.07 of separation there, so grounds this pale earn the deepest
   cloud ink. Unsampled surfaces never tier: _groundLum stays -1 */
const CLOUD_DEEP = [[0.51, 0.56, 0.63], [0.33, 0.37, 0.45]];
/* overcast on bright grounds: pale enough to stay 'plain cloud' but
   deep enough for tile-size legs against a milky sky -- the 0.66 top
   vanished on the card's own background tone */
const CLOUD_OVERCAST = [[0.58, 0.60, 0.65], [0.42, 0.45, 0.50]];
const CLOUD_DARK = [[0.48, 0.52, 0.59], [0.32, 0.36, 0.43]];
/* the precipitation clouds follow the referee too: rain keeps its deep
 * gray while the glyph stands on bright ground, and joins the glow
 * family over dark ones (night tiles, hover/selected slabs) instead of
 * sinking into them -- it was the last hardcoded pale-blind cloud */
const precipCloud = () => groundLight() ? (paleGround() ? CLOUD_DEEP : CLOUD_RAIN) : CLOUD_LIGHT;
const stormCloud = () => groundLight() ? CLOUD_DARK : CLOUD_LIGHT;
/* the overcast/cloud body shared by the cloud, partly and fog poses */
const overcastBody = () =>
    !groundLight() ? CLOUD_LIGHT : paleGround() ? CLOUD_DEEP : CLOUD_OVERCAST;

/* Palette variants for light and dark backgrounds */
let _light = false;
/* luminance of the composited ground under the glyph (-1 = unknown),
 * handed in by the strip referee and the tile icons */
let _groundLum = -1;
let _night = false;
let _pale = false;
/* palette referee: the icon's OWN day/night flag decides whenever the
 * surface is sampled (any surface that passes groundLum also passes the
 * per-hour night flag it paints under). Pixel forensics over three
 * full days proved luminance sampling useless here: the ground under
 * a glyph is sky + glass + blur + chart fill composited, and no gate
 * survived contact with it -- rain passed while clouds failed on the
 * SAME pixels at [0.23,0.25), storm day at [0.248] flipped one gate
 * per scene drift. What never lies is time of day: every day icon
 * measured a 0.40-0.90 mid-bright ground (even the storm card), so
 * day earns ink; night keeps the pale glow. One exception measured from
 * the shipped cards: a bright-enough ground cannot hold off the glow
 * family no matter what the clock says -- the milky foot of a clear-sky
 * card (WCAG ~0.66) put the pale strip moon at ~1.0 contrast (invisible
 * to its own user). Pixel grading then proved the night bar sits HIGHER
 * than the day one: mid-blue card gradients at WCAG 0.30-0.45 defeat
 * BOTH families' cores, so night keeps its glow veto until
 * NIGHT_GLOW_MAX and only unambiguous milk earns the ink twins. The
 * forensics mid-tones ([0.23,0.30)) and the unsampled surfaces (panel,
 * accent style, preview) keep the old chain: night's veto and the
 * caller's light/dark flag respectively.
 * `pale: true` is the caller's hand on the palette: the day-tile
 * selection scrim is a deliberate dark slab no sky model sees, so the
 * selected tile claims the night glow for its glyph (same for solid-
 * style dark cards). */
const NIGHT_GLOW_MAX = 0.45;
const groundLight = () =>
    _pale ? false
        : _groundLum >= (_night ? NIGHT_GLOW_MAX : GLYPH_INK_BAR) ? true
        : _groundLum >= 0 ? !_night : _light;
/* same bar as the day-tile glyph legibility rule, mirrored: WCAG-space
 * grounds below it push the glyph to the pale glow (menu's setPale),
 * grounds at or above it can afford the deepest ink. lumOf is
 * gamma-corrected, so "0.30" here means an ordinary daylight ground.
 * Exported (chart.js re-exports as GLYPH_BAR) so the tile verdict, the
 * strip gate, this tier and the certification matrix share one number */
export const GLYPH_INK_BAR = 0.30;
const paleGround = () => _groundLum >= GLYPH_INK_BAR;
// water rides the SAME referee as the glyph palette (painter's dark
// flag, chosen from the live ground under the icon): over bright sky a
// deep navy that holds contrast against luminance ~0.55, over night a
// light aqua that glows off the dark
/* water keeps deep navy down through mid-tone skies -- pale aqua on a
 * 0.5-luminance overcast card is invisible, and such grounds are too
 * bright for the glow-at-night palette to earn its keep */
const INK_WATER = () => groundLight()
    ? (paleGround() ? [0.10, 0.46, 0.94] : [0.06, 0.36, 0.76])
    : [0.38, 0.82, 1.00];
const INK_FLAKE = () => groundLight() ? [0.45, 0.56, 0.72] : [0.92, 0.96, 1.00];
const INK_STONE = () => groundLight() ? [0.55, 0.64, 0.76] : [0.91, 0.94, 0.97];
const INK_STREAK = () => groundLight()
    ? (paleGround() ? [0.24, 0.50, 0.85] : [0.24, 0.50, 0.78])
    : [0.50, 0.83, 1.00];
const INK_FOG = () => groundLight() ? [0.36, 0.44, 0.54] : [0.72, 0.76, 0.80];
const INK_STAR = () => groundLight() ? [0.55, 0.62, 0.74] : [0.95, 0.97, 1.00];
const INK_SPIN = () => _light ? [0.28, 0.33, 0.40] : [0.85, 0.88, 0.92];
/* the porcelain face is the only moon tier that needs a drawn edge;
 * the bright-ground ink tier separates by depth, the glow tier by halo */
const INK_MOON_EDGE = () =>
    groundLight() && !paleGround() ? [0.24, 0.30, 0.40, 0.85] : null;

/** Flowing dash "wind streak" across the full width of the scene. */
function streak(cr, y, lineWidth, alpha, dashOn, dashOff, offset, color = null) {
    const chosenColor = color ?? INK_STREAK();
    cr.save();
    cr.setSourceRGBA(chosenColor[0], chosenColor[1], chosenColor[2], alpha);
    cr.setLineWidth(lineWidth);
    cr.setLineCap(Cairo.LineCap.ROUND);
    cr.setDash([dashOn, dashOff], offset);
    cr.moveTo(-2, y);
    cr.curveTo(6, y - 1.1, 14, y + 1.1, 26, y);
    cr.stroke();
    cr.restore();
}

/** A few wind streaks, used for the windy scene and as an overlay. */
function windStreaks(cr, time, alphaScale, count = 3) {
    for (let i = 0; i < count; i++) {
        const y = 5.5 + i * (13 / Math.max(count - 1, 1));
        const speed = 3.2 + i * 0.9;
        streak(cr, y + Math.sin(time * 0.8 + i * 2.1) * 0.5,
            0.9 + (i % 2) * 0.35,
            (0.45 + 0.25 * ((i + 1) % 3)) * alphaScale,
            5 + i, 4.5 + i * 0.7,
            -(time * speed) % 9.5);
    }
}

/* Raindrops: teardrops whose COUNT carries the intensity tier.
 * Static poses stagger in the zigzag constellation; animated falls
 * keep each drop in its FIXED static anchor lane,
 * looping a 1.15s fall around it with
 * its own delay -- falls -2.4 -> +3.1, drifts +0.45 -> -0.55 (further
 * left as slant grows), fades in by 16% and out from 78%. Fixed lanes
 * keep every lane raining all the time; reseeding lanes per cycle
 * with near-equal periods instead bunched falls into waves that
 * marched from side to side across the icon. */
function rainDrops(cr, particles, time, count, slant, alpha, band = [18.4, 20.0], dropScale = 1, xBand = [5.8, 18.2]) {
    const waterColor = INK_WATER();
    const hasRim = groundLight();
    const total = count;
    // bulb diameter 2.9 at full scale: the zigzag keeps every pair
    // of bulbs at least 2.75 apart (they step past each other
    // diagonally like falling rain, never into each other)
    const spots = staggeredSpots(total, particles.seed ?? 7,
        (xBand[0] + xBand[1]) / 2, (xBand[1] - xBand[0]) / 2 - 0.4,
        band[0], band[1], 2.75 * dropScale);
    if (!particles.static) {
        const drift = 1.0 + slant * 1.8;
        for (let i = 0; i < total; i++) {
            // golden-order delays: lane phases never march in sequence
            const p = (time / 1.15 + i * 0.618) % 1;
            const fade = Math.min(p / 0.16, 1, Math.max(0, (1 - p) / 0.22));
            if (fade <= 0)
                continue;
            const [ax, ay] = spots[i];
            const s = (hasRim ? (i % 2 ? 0.96 : 1.06) : (i % 2 ? 0.88 : 0.98)) * dropScale;
            const x = ax - slant * (ay - 10) * 0.18 + 0.45 - p * drift;
            const y = ay - 2.4 + p * 5.5;
            cr.newPath();
            teardrop(cr, x, y, s);
            if (hasRim) {
                cr.setSourceRGBA(0.94, 0.98, 1.0, 0.72 * alpha * fade);
                cr.setLineWidth(0.65);
                cr.strokePreserve();
            }
            cr.setSourceRGBA(waterColor[0], waterColor[1], waterColor[2], (hasRim ? Math.min(1, alpha * 1.08) : alpha) * fade);
            cr.fill();
            cr.setSourceRGBA(1, 1, 1, (hasRim ? 0.88 : 0.80) * alpha * fade);
            circle(cr, x - 0.44 * s, y - 0.30 * s, (hasRim ? 0.37 : 0.34) * s);
            cr.fill();
        }
        return;
    }
    const marks = [];
    for (let i = 0; i < total; i++) {
        const [x, y] = spots[i];
        const s = (hasRim ? (i % 2 ? 0.96 : 1.06) : (i % 2 ? 0.88 : 0.98)) * dropScale;
        const drawX = x - slant * (y - 10) * 0.18;
        marks.push([drawX, y, s]);
        cr.newPath();
        teardrop(cr, drawX, y, s);
        if (hasRim) {
            cr.setSourceRGBA(0.94, 0.98, 1.0, 0.72 * alpha);
            cr.setLineWidth(0.65);
            cr.strokePreserve();
        }
        cr.setSourceRGBA(waterColor[0], waterColor[1], waterColor[2], hasRim ? Math.min(1, alpha * 1.08) : alpha);
        cr.fill();
    }
    // white catch-light, upper-left of the bulb
    cr.setSourceRGBA(1, 1, 1, (hasRim ? 0.88 : 0.80) * alpha);
    for (const [x, y, s] of marks)
        circle(cr, x - 0.44 * s, y - 0.30 * s, (hasRim ? 0.37 : 0.34) * s);
    cr.fill();
}

/** Snowflakes (six spokes). Static poses stagger; animated falls
 *  around each flake's FIXED static anchor:
 *  a 2.7s soft float -- slow descent (-2.1 -> +2.9), a gentle sway
 *  (-0.5 -> +0.55 -> -0.4), a lazy tumble (-24deg -> +18deg -> +52deg,
 *  never a continuous spin), fading in by 16% and out from 84%, with
 *  golden-order delays per lane. */
function snowFlakes(cr, particles, time, count, flakeBand = [17.8, 20.2], xBand = [6.6, 17.2]) {
    cr.setLineCap(Cairo.LineCap.ROUND);
    cr.setLineWidth(0.75);
    const total = count;
    const flakeSpots = staggeredSpots(total, (particles.seed ?? 7) + 37,
        (xBand[0] + xBand[1]) / 2, (xBand[1] - xBand[0]) / 2 - 0.4,
        flakeBand[0], flakeBand[1], 3.5);
    for (let i = 0; i < total; i++) {
        let x, y, rot, radius, flakeAlpha = 0.95;
        if (particles.static) {
            [x, y] = flakeSpots[i];
            radius = 1.7;
            rot = i * 1.1;
        } else {
            const p = (time / 2.7 + i * 0.618) % 1;
            const fade = Math.min(p / 0.16, 1, Math.max(0, (1 - p) / 0.16));
            if (fade <= 0)
                continue;
            flakeAlpha = 0.95 * fade;
            const [ax, ay] = flakeSpots[i];
            x = ax + (p < 0.5
                ? -0.5 + (p / 0.5) * 1.05
                : 0.55 - ((p - 0.5) / 0.5) * 0.95);
            y = ay - 2.1 + p * 5.0;
            rot = p < 0.5
                ? -0.42 + (p / 0.5) * 0.73
                : 0.31 + ((p - 0.5) / 0.5) * 0.60;
            radius = 1.7;
        }
        cr.save();
        cr.translate(x, y);
        cr.rotate(rot);
        const flakeColor = INK_FLAKE();
        cr.setSourceRGBA(flakeColor[0], flakeColor[1], flakeColor[2], flakeAlpha);
        for (let k = 0; k < 6; k++) {
            const angle = (k / 6) * TWO_PI;
            line(cr, 0, 0, Math.cos(angle) * radius, Math.sin(angle) * radius);
        }
        cr.stroke();
        cr.restore();
    }
}

/** Hailstones: fall under gravity, bounce & scatter on the floor, respawn. */
function hailStones(cr, particles, time, count, xBand = [6.6, 17.2], yBand = [17.4, 19.8], stoneScale = 1) {
    const dt = particles.lastTime === null ? 0 : Math.min(0.06, time - particles.lastTime);
    // static poses get a fixed pellet row (seeded, highlights and
    // all) instead of wherever the bounce physics froze mid-flight
    const spots = particles.static
        ? staggeredSpots(count, (particles.seed ?? 7) + 71,
            (xBand[0] + xBand[1]) / 2, (xBand[1] - xBand[0]) / 2 - 0.4,
            yBand[0], yBand[1], 3.3)
        : null;
    for (let i = 0; i < count; i++) {
        const stone = particles.hail[i];
        if (particles.static) {
            const radius = (i % 2 ? 1.35 : 1.6) * stoneScale;
            const [sx, sy] = spots[i];
            const stoneColor = INK_STONE();
            cr.setSourceRGBA(stoneColor[0], stoneColor[1], stoneColor[2], 0.95);
            circle(cr, sx, sy, radius);
            cr.fill();
            cr.setSourceRGBA(1, 1, 1, 0.55);
            circle(cr, sx - radius * 0.3, sy - radius * 0.35, radius * 0.35);
            cr.fill();
            continue;
        }
        const radius = stone.radius * 1.5;
        stone.vy += 24 * dt;
        stone.x += stone.vx * dt;
        stone.y += stone.vy * dt;
        if (stone.y >= FLOOR && stone.vy > 0) {
            stone.y = FLOOR;
            stone.vy *= -0.42;
            stone.vx = rand(-3, 3);
            stone.bounces++;
        }
        if (stone.bounces > 2 || (Math.abs(stone.vy) < 0.6 && stone.bounces > 0) ||
            stone.x < -1 || stone.x > 25)
            Object.assign(stone, newHailStone());
        const stoneColor = INK_STONE();
        cr.setSourceRGBA(stoneColor[0], stoneColor[1], stoneColor[2], 0.95);
        circle(cr, stone.x, stone.y, radius);
        cr.fill();
        cr.setSourceRGBA(1, 1, 1, 0.55);
        circle(cr, stone.x - radius * 0.3, stone.y - radius * 0.35, radius * 0.35);
        cr.fill();
    }
}

/* 2026 icon set sun: flat amber disc (vertical gradient, pale top to
 * deep base) with eight equal round rays gapped off the rim. Rotation
 * is the only motion — no glow, no ray-length pulse: the pulsing halo
 * read as a fading circle behind the glyph and fought the sky. */
function sunBody(cr, centerX, centerY, radius, time, rayLength) {
    // ray proportions: gap and stroke both 0.38 of the disc radius
    const gap = radius * 0.38;
    cr.save();
    cr.translate(centerX, centerY);
    cr.rotate(time * 0.14);
    cr.setLineCap(Cairo.LineCap.ROUND);
    cr.setSourceRGBA(0.96, 0.65, 0.14, 0.95);
    cr.setLineWidth(radius * 0.38);
    for (let i = 0; i < 8; i++) {
        const angle = (i / 8) * TWO_PI;
        const cosAngle = Math.cos(angle), sinAngle = Math.sin(angle);
        cr.newSubPath();
        cr.moveTo(cosAngle * (radius + gap), sinAngle * (radius + gap));
        cr.lineTo(cosAngle * (radius + gap + rayLength), sinAngle * (radius + gap + rayLength));
        cr.stroke();
    }
    cr.restore();

    const core = new Cairo.LinearGradient(0, centerY - radius, 0, centerY + radius);
    core.addColorStopRGB(0, 1.0, 0.91, 0.66);
    core.addColorStopRGB(1, 1.0, 0.71, 0.18);
    cr.setSource(core);
    circle(cr, centerX, centerY, radius);
    cr.fill();
}

/* the moon's three grounds: over dark sky it glows (halo, bare disc);
 * over an unsampled light surface it wears porcelain + a drawn edge;
 * over a BRIGHT sampled ground the porcelain is the ground -- an
 * [0.84,0.86,0.90] face on the card's [0.80,0.85,0.90] milky foot is
 * 1.0 contrast, and the night strip moons vanished there. Same
 * silhouette, slate twin deep enough for a dark core on any ground
 * the ink referee accepts. */
const MOON_PORCELAIN = [0.84, 0.86, 0.90];
const MOON_INK = [0.38, 0.44, 0.55];
/* new moon over a bright ground: the lit slice is gone entirely
 * (moon.js early-returns below 1.2% illum), so the earthshine ghost is
 * the whole glyph -- and the pale 0.16-alpha ghost tuned for night sky
 * evaporates on milk. Hand the ghost the ink twin instead: a subtle
 * slate disc that reads as exactly what it is, a dark moon.
 * The ghost follows the DAY bar (0.30), not the night bar: it is a
 * FULL DISC, so it carries mass a thin crescent lacks -- alpha-blend
 * math puts 0.85-ink above the 0.10 separation floor across the whole
 * 0.30-0.45 mid band, where the 0.16 pale whisper never exceeds 0.03.
 * At 0.62 the disc was still 'hard to see' at strip scale; 0.85 is a
 * dark moon, not a smudge. */
const MOON_GHOST_INK = [0.38, 0.44, 0.55, 0.85];

function moonBody(cr, centerX, centerY, radius, time, particles, phase) {
    const lunarPhase = Number.isFinite(phase) ? phase : moonPhase().phase;
    const brightHere = groundLight();
    if (!brightHere) {
        const glow = new Cairo.RadialGradient(centerX, centerY, radius * 0.5, centerX, centerY, radius * 2.2);
        glow.addColorStopRGBA(0, 0.86, 0.87, 0.97, 0.30 * (0.25 + 0.75 * illumOf(lunarPhase)));
        glow.addColorStopRGBA(1, 0.86, 0.87, 0.97, 0);
        cr.setSource(glow);
        cr.paint();
    }

    paintMoon(cr, centerX, centerY, radius, lunarPhase, 'icon',
        {
            outline: INK_MOON_EDGE(),
            face: brightHere ? (paleGround() ? MOON_INK : MOON_PORCELAIN) : null,
            // the ghost's ink twin follows the DAY bar: on any ground
            // the ink verdict claims (and on unsampled light cards),
            // the unlit disc reads deeper than the face; deliberate
            // dark slabs (pale:true) keep the pale whisper
            ghost: !_pale && (_groundLum >= GLYPH_INK_BAR ||
                (_groundLum < 0 && _light)) ? MOON_GHOST_INK : null
        });

    const starColor = INK_STAR();
    // stars orbiting the drawn disc would dot the moon itself (worst on
    // the dark side); those inside disc + star size stay hidden
    const keepOut = radius + 2.2;
    for (const star of particles.stars) {
        if (Math.hypot(star.x - centerX, star.y - centerY) < keepOut)
            continue;
        const alpha = 0.35 + 0.6 * Math.abs(Math.sin(time * 1.3 + star.phase));
        cr.setSourceRGBA(starColor[0], starColor[1], starColor[2], alpha);
        circle(cr, star.x, star.y, 0.55);
        cr.fill();
    }
}

// mainly-clear (code 1): shrunk sun/moon up-left and
// rests one small cloud low-right -- clear, but not cloudless
function mainlyCloud(cr, time) {
    const body = overcastBody();
    cloud(cr, 16.1 + Math.sin(time * 0.6) * 0.5, 18.6, 0.73, body[0], body[1]);
}

function sceneSun(cr, ctx) {
    const { time, windy, variant } = ctx;
    if (variant === 'mainly') {
        sunBody(cr, 9.5, 9.5, 3.4, time, 1.7);
        mainlyCloud(cr, time);
    } else {
        sunBody(cr, 12, 12, 4.7, time, 2.3);
    }
    if (windy)
        windStreaks(cr, time, 0.45, 2);
}

function sceneMoon(cr, ctx) {
    const { time, particles, windy, phase, variant } = ctx;
    if (variant === 'mainly') {
        moonBody(cr, 9.5, 9.5, 4.6, time, particles, phase);
        mainlyCloud(cr, time);
    } else {
        moonBody(cr, 12, 12, 6.6, time, particles, phase);
    }
    if (windy)
        windStreaks(cr, time, 0.45, 2);
}

function scenePartly(cr, ctx) {
    const { time, windy, night, particles, phase } = ctx;
    if (night)
        moonBody(cr, 8.5, 8, 3.4, time, particles, phase);
    else
        sunBody(cr, 8.5, 8, 2.9, time, 1.4);
    const dx = Math.sin(time * 0.7) * 0.7;
    // the partly-cloudy cloud follows the same ground rule: it was the
    // one cloud body still hardcoded to the always-pale palette
    const body = overcastBody();
    cloud(cr, 13.2 + dx, 16.0, 1.19, body[0], body[1]);
    if (windy)
        windStreaks(cr, time, 0.4, 2);
}

function sceneCloud(cr, ctx) {
    const { time, windy, variant } = ctx;
    // unlisted WMO code: the unknown pose -- one cloud, a
    // question mark standing under it where precip would hang
    if (variant === 'unknown') {
        const body = overcastBody();
        const cloudCx = 12 + Math.sin(time * 0.6) * 0.6;
        cloud(cr, cloudCx, 12.2, 1.41, body[0], body[1]);
        const ink = INK_FOG();
        cr.save();
        cr.selectFontFace('Sans', Cairo.FontSlant.NORMAL, Cairo.FontWeight.BOLD);
        cr.setFontSize(8);
        cr.setSourceRGBA(ink[0], ink[1], ink[2], 0.95);
        const ext = cr.textExtents('?');
        cr.moveTo(cloudCx - ext.xAdvance / 2 - ext.xBearing, 19.5 - ext.yBearing - ext.height / 2);
        cr.showText('?');
        cr.restore();
        return;
    }
    // overcast earns its silhouette: mid-gray over bright skies (the pale
    // cloud vanished into overcast white), pale body over night skies --
    // same light/dark referee as the INK_* family. The back bank is a
    // DARKER shade of the body (the storm-cloud tone), not the
    // same colour faded -- at 65% alpha it washed into the sky and
    // the glyph read as one plain cloud. It also stands taller
    // (squash .85: a proper cap, not a pancake) and further left, so
    // a real second bank shows above and beside the front cloud
    const overcast = overcastBody();
    const bank = overcast.map(([r, g, b]) => [r * 0.70, g * 0.70, b * 0.75]);
    cloud(cr, 7.2 - Math.sin(time * 0.5) * 0.8, 10.1, 1.04, bank[0], bank[1], 0.95, 0.85);
    cloud(cr, 13.1 + Math.sin(time * 0.6) * 0.7, 15.3, 1.24, overcast[0], overcast[1]);
    if (windy)
        windStreaks(cr, time, 0.4, 2);
}

/** Four-point frost sparkle (rime fog garnish). */
function spark(cr, x, y, s, alpha) {
    cr.save();
    cr.translate(x, y);
    cr.setSourceRGBA(1, 1, 1, alpha);
    cr.newPath();
    cr.moveTo(0, -2 * s);
    cr.curveTo(0.3 * s, -0.3 * s, 0.3 * s, -0.3 * s, 2 * s, 0);
    cr.curveTo(0.3 * s, 0.3 * s, 0.3 * s, 0.3 * s, 0, 2 * s);
    cr.curveTo(-0.3 * s, 0.3 * s, -0.3 * s, 0.3 * s, -2 * s, 0);
    cr.curveTo(-0.3 * s, -0.3 * s, -0.3 * s, -0.3 * s, 0, -2 * s);
    cr.fill();
    cr.restore();
}

function sceneFog(cr, ctx) {
    const { time, variant } = ctx;
    // the fog cloud keeps a pale body on night grounds and deepens to
    // the overcast gray on bright ones. Below it, three
    // centered tapering lines (not full-width dashes), breathing
    // sideways against each other
    const body = overcastBody();
    const cloudCx = 12.3 + Math.sin(time * 0.5) * 0.5;
    cloud(cr, cloudCx, 9.4, 1.30, body[0], body[1], 0.85);
    const fogColor = INK_FOG();
    const widths = [13, 10, 6.5];
    cr.save();
    cr.setLineCap(Cairo.LineCap.ROUND);
    cr.setLineWidth(1.7);
    for (let i = 0; i < 3; i++) {
        const y = 15.4 + i * 2.8;
        const half = widths[i] / 2;
        const slide = Math.sin(time * 0.9 + i * 2.1) * 0.6;
        cr.setSourceRGBA(fogColor[0], fogColor[1], fogColor[2],
            (groundLight() ? 0.85 : 0.75) - i * 0.15);
        cr.newPath();
        cr.moveTo(cloudCx - half + slide, y);
        cr.lineTo(cloudCx + half + slide, y);
        cr.stroke();
    }
    cr.restore();
    // depositing rime (code 48): frost sparkles on the cloud's flanks
    if (variant === 'rime') {
        const twinkle = 0.55 + 0.35 * Math.sin(time * 2.2);
        spark(cr, 19.4, 6.4, 0.8, twinkle);
        spark(cr, 4.6, 10.6, 0.6, 1.1 - twinkle);
    }
}

// precip scenes carry a SINGLE cloud (the pair belongs to
// overcast alone), drifting gently; mark counts follow the tier ladder.
// Geometry, measured: the cloud path spans 17.4 of the 24 box with
// its base at y15.1, marks in one tight row under it -- cloud() traces
// the path at 0.711, so scale 1.40 lands the same silhouette
function precipSceneCloud(cr, time, palette) {
    const cx = 12 + Math.sin(time * 0.6) * 0.6;
    cloud(cr, cx, 11.7, 1.40, palette[0], palette[1]);
    return cx;
}

// showers (codes 80-82, 85-86): a complete sun/moon
// peeking from behind the cloud's top-left -- broken sky, brief fall
function showersPeek(cr, ctx) {
    const { time, night, particles, phase } = ctx;
    if (night)
        moonBody(cr, 7.5, 6.8, 3.2, time, particles, phase);
    else
        sunBody(cr, 7, 7, 2.4, time, 1.2);
    const palette = precipCloud();
    const cx = 14.0 + Math.sin(time * 0.6) * 0.6;
    cloud(cr, cx, 13.0, 1.10, palette[0], palette[1]);
    return cx;
}

function sceneRain(cr, ctx) {
    const { time, particles, intensity, windKmh, windy, variant } = ctx;
    // marks hang centered on the CLOUD's centre (drift included),
    // never on the glyph's -- the showers cloud sits right of centre
    const cloudCx = variant === 'showers'
        ? showersPeek(cr, ctx)
        : precipSceneCloud(cr, time, precipCloud());
    const xBand = [cloudCx - 6.2, cloudCx + 6.2];
    const slant = Math.min(0.9, windKmh / 45);
    if (variant === 'drizzle') {
        // ONE droplet size across every family (a mini at 0.62 read
        // as a speck beside a shower's full drop at tile size):
        // counts alone carry intensity on a shared ladder -- drizzle
        // 1/2/3 sits one rung under rain's 2/3/4
        const dropCount = intensity <= 1 ? 1 : intensity === 2 ? 2 : 3;
        rainDrops(cr, particles, time, dropCount, slant, 0.85, [18.4, 20.0], 1, xBand);
    } else {
        const dropCount = intensity <= 1 ? 2 : intensity === 2 ? 3 : 4;
        rainDrops(cr, particles, time, dropCount, slant, 0.9, [18.4, 20.0], 1, xBand);
    }
    if (windy)
        windStreaks(cr, time, 0.35, 2);
}

/** Snow grains (code 77): opaque white pellets, not flakes -- same
 *  fixed-lane motion as the flakes, only the mark changes. */
function snowGrains(cr, particles, time, count, cloudCx = 12) {
    const total = count;
    const spots = staggeredSpots(total, (particles.seed ?? 7) + 37, cloudCx, 4.9,
        17.6, 20.0, 1.75);
    const grainColor = INK_FLAKE();
    for (let i = 0; i < total; i++) {
        let x, y, grainAlpha = 0.95;
        if (particles.static) {
            [x, y] = spots[i];
        } else {
            // pellets: a fast fall (0.8s loop) in fixed lanes,
            // falling faster and straighter than drops or flakes
            const p = (time / 0.8 + i * 0.618) % 1;
            const fade = Math.min(p / 0.16, 1, Math.max(0, (1 - p) / 0.22));
            if (fade <= 0)
                continue;
            grainAlpha = 0.95 * fade;
            const [ax, ay] = spots[i];
            x = ax + 0.2 - p * 0.4;
            y = ay - 2.3 + p * 5.3;
        }
        cr.setSourceRGBA(grainColor[0], grainColor[1], grainColor[2], grainAlpha);
        circle(cr, x, y, 0.8);
        cr.fill();
    }
}

function sceneSnow(cr, ctx) {
    const { time, particles, intensity, windy, variant } = ctx;
    if (variant === 'showers') {
        const cloudCx = showersPeek(cr, ctx);
        snowFlakes(cr, particles, time,
            intensity <= 1 ? 2 : intensity === 2 ? 3 : 4,
            [17.8, 20.2], [cloudCx - 5.3, cloudCx + 5.3]);
    } else if (variant === 'grains') {
        const cloudCx = precipSceneCloud(cr, time, precipCloud());
        snowGrains(cr, particles, time, 5, cloudCx);
    } else {
        const cloudCx = precipSceneCloud(cr, time, precipCloud());
        const flakeCount = intensity <= 1 ? 2 : intensity === 2 ? 3 : 4;
        snowFlakes(cr, particles, time, flakeCount,
            [17.8, 20.2], [cloudCx - 5.3, cloudCx + 5.3]);
    }
    if (windy)
        windStreaks(cr, time, 0.35, 2);
}

/** Sleet / freezing rain: half drops, half flakes, extra slant. */
function sceneSleet(cr, ctx) {
    const { time, particles, intensity, windKmh, windy, variant } = ctx;
    const cloudCx = precipSceneCloud(cr, time, precipCloud());
    const heavy = variant === 'freezingheavy';
    // one shared baseline row for the freezing marks:
    // drop(s) flank the flake, never on top of it. Marks ascend with
    // tier like every family: 2 at tier 3, 3 at tier 4 (57/67)
    rainDrops(cr, particles, time, (heavy || intensity >= 4) ? 2 : 1,
        Math.min(1.1, windKmh / 36 + 0.25), 0.8, [18.6, 19.9], 1,
        heavy ? [cloudCx - 5.6, cloudCx + 5.6] : [cloudCx - 5.2, cloudCx - 1.8]);
    snowFlakes(cr, particles, time, 1, [18.0, 19.7],
        heavy ? [cloudCx - 0.8, cloudCx + 1.2] : [cloudCx + 1.2, cloudCx + 4.8]);
    if (heavy) {
        // freezing rain lands as ice: an underline glaze
        const iceColor = INK_FLAKE();
        cr.save();
        cr.setLineCap(Cairo.LineCap.ROUND);
        cr.setLineWidth(1.3);
        cr.setSourceRGBA(iceColor[0], iceColor[1], iceColor[2], 0.9);
        cr.newPath();
        cr.moveTo(cloudCx - 6, 21.8);
        cr.lineTo(cloudCx + 6, 21.8);
        cr.stroke();
        cr.restore();
    }
    if (windy)
        windStreaks(cr, time, 0.35, 2);
}

/** Hail: dark storm cloud and bouncing ice stones. The stormhail
 *  variants (codes 96/99, CAPE-derived hail) add the bolt left of the
 *  stones. */
function sceneHail(cr, ctx) {
    const { time, particles, windy, variant } = ctx;
    const cloudCx = precipSceneCloud(cr, time, stormCloud());
    if (variant === 'stormhail' || variant === 'stormhailheavy') {
        const heavy = variant === 'stormhailheavy';
        // stills shrink the bolt left to make room for the stones:
        // translate(-2.6,.4) scale(.88), heavy (-3,.2) scale(.9)
        drawBolt(cr, time, particles, ...(heavy ? [-3, 0.2, 0.9] : [-2.6, 0.4, 0.88]));
        // heavy pellets ride higher beside the bolt's notch, scaled
        // .86, so the row clears the bolt
        hailStones(cr, particles, time,
            Math.min(heavy ? 5 : 2, particles.hail.length),
            heavy ? [8.6, 19.2] : [13.5, 18.5],
            ...(heavy ? [[15.4, 17.6], 0.86] : []));
    } else {
        hailStones(cr, particles, time, Math.min(3, particles.hail.length),
            [cloudCx - 5.3, cloudCx + 5.3]);
    }
    if (windy)
        windStreaks(cr, time, 0.35, 2);
}

/* The bolt: a filled polygon, gold gradient #ffd964 -> #f5a524
 * with a #e89b1c rim, 0.6 wide, round joins. The flash cycle keeps
 * it always present at 22% with one double burst per 3.6s
 * (52% .22 -> 58% 1 -> 63% .45 -> 68% 1 -> 100% .22);
 * static poses burn at full opacity, since
 * tiles and strip glyphs can't wait for the burst */
const BOLT_PTS = [
    [13.2, 13.4], [9.7, 19], [12.1, 19], [10.9, 22.4],
    [15.7, 16.6], [13.0, 16.6], [14.7, 13.4],
];

function flashLevel(time, particles) {
    if (particles.static)
        return 1;
    const p = (time % 3.6) / 3.6;
    if (p < 0.52) return 0.22;
    if (p < 0.58) return 0.22 + (p - 0.52) / 0.06 * 0.78;
    if (p < 0.63) return 1 - (p - 0.58) / 0.05 * 0.55;
    if (p < 0.68) return 0.45 + (p - 0.63) / 0.05 * 0.55;
    return 1 - (p - 0.68) / 0.32 * 0.78;
}

function drawBolt(cr, time, particles, tx = 0, ty = 0, scale = 1) {
    const flash = flashLevel(time, particles);
    cr.save();
    cr.translate(tx, ty);
    cr.scale(scale, scale);
    cr.setLineJoin(Cairo.LineJoin.ROUND);
    cr.moveTo(BOLT_PTS[0][0], BOLT_PTS[0][1]);
    for (let i = 1; i < BOLT_PTS.length; i++)
        cr.lineTo(BOLT_PTS[i][0], BOLT_PTS[i][1]);
    cr.closePath();
    const grad = new Cairo.LinearGradient(0, 13.4, 0, 22.4);
    grad.addColorStopRGBA(0, 1, 0.851, 0.392, flash);
    grad.addColorStopRGBA(1, 0.961, 0.647, 0.141, flash);
    cr.setSource(grad);
    cr.fillPreserve();
    cr.setSourceRGBA(0.910, 0.608, 0.110, flash);
    cr.setLineWidth(0.6);
    cr.stroke();
    cr.restore();
}

function sceneStorm(cr, ctx) {
    const { time, particles, windKmh, windy } = ctx;
    precipSceneCloud(cr, time, stormCloud());
    if (!particles.static) {
        /* animated storm: two drops flanking the bolt at x 6.8 / 17.4
         * (scale .85, staggered half a cycle apart); the still pose
         * carries the bolt alone, so static draws no drops */
        const slant = Math.min(0.9, windKmh / 45);
        rainDrops(cr, particles, time, 1, slant, 0.85,
            [18.4, 20.0], 0.85, [6.4, 7.2]);
        rainDrops(cr, particles, time + 0.45, 1, slant, 0.85,
            [18.4, 20.0], 0.85, [17.0, 17.8]);
    }
    drawBolt(cr, time, particles);
    if (windy)
        windStreaks(cr, time, 0.3, 2);
}


function sceneWind(cr, ctx) {
    const { time } = ctx;
    // three continuous swooshes with end curls, drifting as
    // one group; dashed streaks stay only as the windy overlay elsewhere
    const ink = INK_STREAK();
    const drift = Math.sin(time * 1.2) * 0.6;
    cr.save();
    cr.translate(drift, 0);
    cr.setLineCap(Cairo.LineCap.ROUND);
    cr.setLineWidth(1.9);
    cr.setSourceRGBA(ink[0], ink[1], ink[2], 0.95);
    cr.newPath();
    cr.moveTo(3, 8.6);
    cr.lineTo(12.2, 8.6);
    cr.arcNegative(12.2, 6.0, 2.6, Math.PI / 2, -2.87);
    cr.stroke();
    cr.newPath();
    cr.moveTo(2.6, 12.8);
    cr.lineTo(15.8, 12.8);
    cr.arc(15.8, 15.7, 2.9, -Math.PI / 2, 2.86);
    cr.stroke();
    cr.newPath();
    cr.moveTo(4.5, 17.2);
    cr.lineTo(10.5, 17.2);
    cr.stroke();
    cr.restore();
}

function sceneError(cr) {
    cr.setSourceRGBA(0.95, 0.45, 0.40, 0.95);
    cr.setLineWidth(1.6);
    circle(cr, 12, 12, 7.5);
    cr.stroke();
    cr.selectFontFace('Sans', Cairo.FontSlant.NORMAL, Cairo.FontWeight.BOLD);
    cr.setFontSize(11);
    cr.setSourceRGBA(0.95, 0.45, 0.40, 0.95);
    const extents = cr.textExtents('!');
    cr.moveTo(12 - extents.xAdvance / 2 - extents.xBearing, 12 - extents.yBearing - extents.height / 2);
    cr.showText('!');
}

function sceneLoading(cr, ctx) {
    const { time } = ctx;
    cr.save();
    cr.setLineCap(Cairo.LineCap.ROUND);
    cr.setLineWidth(2);
    cr.setSourceRGBA(0.40, 0.43, 0.47, 0.25);
    circle(cr, 12, 12, 6);
    cr.stroke();
    cr.newPath();
    const angle = time * 4;
    cr.arc(12, 12, 6, angle, angle + Math.PI * 1.1);
    const spinColor = INK_SPIN();
    cr.setSourceRGBA(spinColor[0], spinColor[1], spinColor[2], 0.95);
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
 * Paint one frame. `opts` must already be in grid space -- the caller scales
 * the context. Fields:
 *   scene      one of SCENES
 *   time       seconds on the caller's animation clock
 *   particles  pool from createParticles() (animated poses; a throwaway
 *              pool is made when omitted, fine for one-shot previews)
 *   staticPose bool -- canonical still pose (tiles, strip glyphs)
 *   seed       per-glyph layout variety for static poses
 *   windy      bool -- add wind streaks to the scene
 *   night      bool -- render night variant
 *   dark       bool -- the ground is dark (false picks light-ground inks)
 *   groundLum  measured ground luminance for the ink referee (-1: none)
 *   pale       bool -- force the pale glow-family glyph
 *   intensity  precipitation severity tier; drives the mark-count ladder
 *   variant    per-code glyph family (weather.js variantForCode) or null
 *   windKmh    wind speed in km/h, drives rain slant
 *   phase      lunar phase 0..1 (non-finite: tonight's real moon)
 */
let staticPool = null;   // one seeded pool for every static painter

export function paintWeather(cr, opts) {
    let particles;
    if (opts.staticPose) {
        if (!staticPool)
            staticPool = Object.assign(createParticles(), { static: true });
        particles = staticPool;
        particles.seed = opts.seed ?? 7;   // per-glyph layout variety
    } else
        particles = opts.particles || createParticles();
    _light = opts.dark === false;
    _groundLum = opts.groundLum ?? -1;
    _night = !!opts.night;
    _pale = !!opts.pale;
    const currentTime = opts.time || 0;
    const ctx = {
        time: currentTime,
        particles,
        windy: !!opts.windy,
        night: !!opts.night,
        intensity: opts.intensity || 0,
        variant: opts.variant ?? null,
        windKmh: opts.windKmh || 0,
        phase: Number.isFinite(opts.phase) ? opts.phase : moonPhase().phase,
    };
    cr.save();
    // fade rain/storm drops out from under the cloud
    const sceneRenderer = SCENES[opts.scene] || sceneError;
    sceneRenderer(cr, ctx);
    cr.restore();
    particles.lastTime = currentTime;
}
