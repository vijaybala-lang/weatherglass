/* painter.js -- pure Cairo weather scene painter. */

import Cairo from 'gi://cairo';
import { paintMoon, moonPhase, illumOf } from './moon.js';

export const GRID = 24;

const TWO_PI = Math.PI * 2;

function rand(min, max) {
    return min + Math.random() * (max - min);
}

export function createParticles() {
    const drops = [];
    for (let i = 0; i < 16; i++)
        drops.push({ x: rand(3, 21), y: rand(9, 24), length: rand(1.6, 3.2), speed: rand(11, 18) });
    const flakes = [];
    for (let i = 0; i < 12; i++)
        flakes.push({
            x: rand(3, 21), y: rand(9, 24), radius: rand(0.8, 1.4),
            speed: rand(2.5, 4.5), phase: rand(0, TWO_PI)
        });
    const hail = [];
    for (let i = 0; i < 10; i++) {
        // scatter initial heights so the first cycle doesn't fall in unison
        hail.push(Object.assign(newHailStone(), { y: rand(9, FLOOR), vy: rand(2, 9) }));
    }
    const stars = [
        { x: 19.5, y: 4.5, phase: 0.0 }, { x: 21.5, y: 9, phase: 1.7 },
        { x: 17.5, y: 8, phase: 3.1 }, { x: 20.5, y: 13.5, phase: 4.4 },
    ];
    return { drops, flakes, hail, stars, lastTime: null, lastT: null };
}

const FLOOR = 21.8;   // where hailstones bounce

function newHailStone() {
    return {
        x: rand(3, 21), y: rand(8.5, 11),
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
 *  (x, y) is the centre of the round bottom; s the drop scale. */
function teardrop(cr, x, y, s) {
    cr.moveTo(x, y - 2.35 * s);
    cr.curveTo(x + 0.62 * s, y - 1.35 * s, x + 0.95 * s, y - 0.72 * s,
        x + 0.95 * s, y - 0.05 * s);
    cr.arc(x, y - 0.05 * s, 0.95 * s, 0, Math.PI);
    cr.curveTo(x - 0.95 * s, y - 0.72 * s, x - 0.62 * s, y - 1.35 * s,
        x, y - 2.35 * s);
    cr.closePath();
}

/** Even staggered grid (cols per row, column pitch dx) under the cloud --
 *  the layout for static poses, whose random pools used to reshuffle on
 *  every repaint and made the strip/tile glyphs shimmer between columns. */
function staticSpot(i, cols, dx, y0, dy) {
    const col = i % cols, row = Math.floor(i / cols);
    return [4.3 + col * dx + (row % 2) * dx * 0.47, y0 + row * dy];
}

/** Puffy cloud made of three bumps over a flat base, one gradient fill. */
function cloud(cr, centerX, centerY, scale, topColor, bottomColor, alpha = 1) {
    const gradient = new Cairo.LinearGradient(0, centerY - 5 * scale, 0, centerY + 2.4 * scale);
    gradient.addColorStopRGBA(0, topColor[0], topColor[1], topColor[2], alpha);
    gradient.addColorStopRGBA(1, bottomColor[0], bottomColor[1], bottomColor[2], alpha);
    cr.setSource(gradient);
    circle(cr, centerX - 3.2 * scale, centerY - 0.3 * scale, 2.4 * scale);
    circle(cr, centerX + 3.1 * scale, centerY - 0.1 * scale, 2.6 * scale);
    circle(cr, centerX, centerY - 1.8 * scale, 3.2 * scale);
    cr.rectangle(centerX - 5.6 * scale, centerY - 0.5 * scale, 11.2 * scale, 2.9 * scale);
    cr.fill();
}

const CLOUD_LIGHT = [[0.76, 0.82, 0.87], [0.60, 0.68, 0.75]];
const CLOUD_RAIN = [[0.52, 0.54, 0.58], [0.31, 0.34, 0.40]];
const CLOUD_DARK = [[0.42, 0.48, 0.56], [0.25, 0.30, 0.38]];

/* Palette variants for light and dark backgrounds */
let _light = false;
// water rides the SAME referee as the glyph palette (painter's dark
// flag, chosen from the live ground under the icon): over bright sky a
// deep navy that holds contrast against luminance ~0.55, over night a
// light aqua that glows off the dark
const INK_WATER = () => _light ? [0.05, 0.33, 0.68] : [0.38, 0.82, 1.00];
const INK_FLAKE = () => _light ? [0.45, 0.56, 0.72] : [0.92, 0.96, 1.00];
const INK_STONE = () => _light ? [0.55, 0.64, 0.76] : [0.91, 0.94, 0.97];
const INK_STREAK = () => _light ? [0.24, 0.50, 0.78] : [0.50, 0.83, 1.00];
const INK_FOG = () => _light ? [0.44, 0.52, 0.62] : [0.72, 0.76, 0.80];
const INK_STAR = () => _light ? [0.55, 0.62, 0.74] : [0.95, 0.97, 1.00];
const INK_SPIN = () => _light ? [0.28, 0.33, 0.40] : [0.85, 0.88, 0.92];
const INK_MOON_EDGE = () => _light ? [0.24, 0.30, 0.40, 0.85] : null;

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

/** Raindrops. Animated falls ride the shared particle clock; static poses
 *  (strip glyphs, day tiles) sit in an even staggered grid. Either way the
 *  shape is a teardrop, and intensity decides the COUNT -- heavier rain,
 *  more drops. */
function rainDrops(cr, particles, time, count, slant, alpha) {
    const lastTime = particles.lastTime ?? particles.lastT;
    const dt = lastTime === null ? 0 : Math.min(0.06, time - lastTime);
    const waterColor = INK_WATER();
    cr.setSourceRGBA(waterColor[0], waterColor[1], waterColor[2], alpha);
    const total = Math.min(count, particles.drops.length);
    for (let i = 0; i < total; i++) {
        let x, y, s;
        if (particles.static) {
            [x, y] = staticSpot(i, 3, 5.2, 12.2, 3.7);
            s = i % 2 ? 1.05 : 1.25;
        } else {
            const drop = particles.drops[i];
            drop.y += (drop.speed ?? drop.sp) * dt;
            if (drop.y > 23.5) {
                drop.y = rand(9.3, 11);
                drop.x = rand(2.5, 21.5);
            }
            x = drop.x;
            y = drop.y;
            s = Math.min(1.4, 0.75 + (drop.length ?? drop.len) * 0.22);
        }
        teardrop(cr, x - slant * (y - 10) * 0.18, y, s);
    }
    cr.fill();
}

/** Snowflakes (six spokes), drifting side to side. */
function snowFlakes(cr, particles, time, count) {
    const lastTime = particles.lastTime ?? particles.lastT;
    const dt = lastTime === null ? 0 : Math.min(0.06, time - lastTime);
    cr.setLineCap(Cairo.LineCap.ROUND);
    cr.setLineWidth(0.55);
    const total = Math.min(count, particles.flakes.length);
    for (let i = 0; i < total; i++) {
        let x, y, rot, radius;
        if (particles.static) {
            [x, y] = staticSpot(i, 3, 4.7, 11.4, 3.4);
            radius = 1.05;
            rot = i * 1.1;
        } else {
            const flake = particles.flakes[i];
            const phase = flake.phase ?? flake.ph;
            flake.y += (flake.speed ?? flake.sp) * dt;
            if (flake.y > 23.5) {
                flake.y = rand(9.3, 11);
                flake.x = rand(3, 21);
            }
            x = flake.x + Math.sin(time * 1.4 + phase) * 1.1;
            y = flake.y;
            rot = time * 1.2 + phase;
            radius = flake.radius ?? flake.r;
        }
        cr.save();
        cr.translate(x, y);
        cr.rotate(rot);
        const flakeColor = INK_FLAKE();
        cr.setSourceRGBA(flakeColor[0], flakeColor[1], flakeColor[2], 0.95);
        for (let k = 0; k < 6; k++) {
            const angle = (k / 6) * TWO_PI;
            line(cr, 0, 0, Math.cos(angle) * radius, Math.sin(angle) * radius);
        }
        cr.stroke();
        cr.restore();
    }
}

/** Hailstones: fall under gravity, bounce & scatter on the floor, respawn. */
function hailStones(cr, particles, time, count) {
    const lastTime = particles.lastTime ?? particles.lastT;
    const dt = lastTime === null ? 0 : Math.min(0.06, time - lastTime);
    for (let i = 0; i < count; i++) {
        const stone = particles.hail[i];
        const radius = stone.radius ?? stone.r;
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

function sunBody(cr, centerX, centerY, radius, time, rayLength) {
    const outerGlowRadius = radius * 2.35;
    const outerGlow = new Cairo.RadialGradient(centerX, centerY, radius * 0.4, centerX, centerY, outerGlowRadius);
    const outerAlpha = _light ? 0.28 : 0.40;
    outerGlow.addColorStopRGBA(0, 1.0, 0.76, 0.16, outerAlpha);
    outerGlow.addColorStopRGBA(0.55, 1.0, 0.60, 0.08, outerAlpha * 0.45);
    outerGlow.addColorStopRGBA(1, 1.0, 0.50, 0.0, 0);
    cr.setSource(outerGlow);
    cr.paintWithAlpha(0.70 + 0.30 * Math.sin(time * 1.3));

    const innerGlowRadius = radius * 1.55;
    const innerGlow = new Cairo.RadialGradient(centerX, centerY, radius * 0.5, centerX, centerY, innerGlowRadius);
    const innerAlpha = _light ? 0.32 : 0.45;
    innerGlow.addColorStopRGBA(0, 1.0, 0.92, 0.45, innerAlpha);
    innerGlow.addColorStopRGBA(1, 1.0, 0.75, 0.15, 0);
    cr.setSource(innerGlow);
    cr.paintWithAlpha(0.75 + 0.25 * Math.sin(time * 2.1));

    cr.save();
    cr.translate(centerX, centerY);
    cr.rotate(time * 0.14);
    cr.setLineCap(Cairo.LineCap.ROUND);

    for (let i = 0; i < 8; i++) {
        const isCardinal = (i % 2 === 0);
        const angle = (i / 8) * TWO_PI;
        const cosAngle = Math.cos(angle), sinAngle = Math.sin(angle);

        let dynamicLength, alpha, lineWidth;
        if (isCardinal) {
            const wave = Math.sin(time * 1.9 + i * 0.35);
            dynamicLength = rayLength * (1.04 + 0.14 * wave);
            alpha = 0.92 + 0.08 * wave;
            lineWidth = 1.55;
            cr.setSourceRGBA(1.0, 0.76, 0.12, alpha);
        } else {
            const wave = Math.sin(time * 1.9 + Math.PI * 0.6 + i * 0.35);
            dynamicLength = rayLength * (0.76 + 0.12 * wave);
            alpha = 0.78 + 0.12 * wave;
            lineWidth = 1.35;
            cr.setSourceRGBA(1.0, 0.68, 0.08, alpha);
        }

        cr.setLineWidth(lineWidth);
        cr.newSubPath();
        cr.moveTo(cosAngle * (radius + 1.1), sinAngle * (radius + 1.1));
        cr.lineTo(cosAngle * (radius + 1.1 + dynamicLength), sinAngle * (radius + 1.1 + dynamicLength));
        cr.stroke();
    }
    cr.restore();

    const core = new Cairo.RadialGradient(
        centerX - radius * 0.35, centerY - radius * 0.35, radius * 0.15,
        centerX, centerY, radius
    );
    core.addColorStopRGB(0, 1.0, 0.97, 0.68);
    core.addColorStopRGB(0.5, 1.0, 0.83, 0.18);
    core.addColorStopRGB(1, 0.98, 0.58, 0.08);
    cr.setSource(core);
    circle(cr, centerX, centerY, radius);
    cr.fill();
}

function moonBody(cr, centerX, centerY, radius, time, particles, phase) {
    const lunarPhase = Number.isFinite(phase) ? phase : moonPhase().phase;
    if (!_light) {
        const glow = new Cairo.RadialGradient(centerX, centerY, radius * 0.5, centerX, centerY, radius * 2.2);
        glow.addColorStopRGBA(0, 0.86, 0.87, 0.97, 0.30 * (0.25 + 0.75 * illumOf(lunarPhase)));
        glow.addColorStopRGBA(1, 0.86, 0.87, 0.97, 0);
        cr.setSource(glow);
        cr.paint();
    }

    paintMoon(cr, centerX, centerY, radius, lunarPhase, 'icon',
        {
            outline: INK_MOON_EDGE(),
            face: _light ? [0.84, 0.86, 0.90] : null
        });

    const starColor = INK_STAR();
    // stars orbiting the drawn disc would dot the moon itself (worst on
    // the dark side); those inside disc + star size stay hidden
    const keepOut = radius + 1.4;
    for (const star of particles.stars) {
        if (Math.hypot(star.x - centerX, star.y - centerY) < keepOut)
            continue;
        const starPhase = star.phase ?? star.ph;
        const alpha = 0.35 + 0.6 * Math.abs(Math.sin(time * 1.3 + starPhase));
        cr.setSourceRGBA(starColor[0], starColor[1], starColor[2], alpha);
        circle(cr, star.x, star.y, 0.55);
        cr.fill();
    }
}

function sceneSun(cr, ctx) {
    const { time, windy } = ctx;
    sunBody(cr, 12, 12, 4.6, time, 3.6);
    if (windy)
        windStreaks(cr, time, 0.45, 2);
}

function sceneMoon(cr, ctx) {
    const { time, particles, windy, phase } = ctx;
    moonBody(cr, 12, 12, 4.8, time, particles, phase);
    if (windy)
        windStreaks(cr, time, 0.45, 2);
}

function scenePartly(cr, ctx) {
    const { time, windy, night, particles, phase } = ctx;
    if (night)
        moonBody(cr, 8.5, 8, 3.6, time, particles, phase);
    else
        sunBody(cr, 8.5, 8, 3.6, time, 2.6);
    const dx = Math.sin(time * 0.7) * 0.7;
    cloud(cr, 13.5 + dx, 15, 0.85, CLOUD_LIGHT[0], CLOUD_LIGHT[1]);
    if (windy)
        windStreaks(cr, time, 0.4, 2);
}

function sceneCloud(cr, ctx) {
    const { time, windy } = ctx;
    cloud(cr, 9.5 - Math.sin(time * 0.5) * 0.8, 8.5, 0.62, CLOUD_LIGHT[0], CLOUD_LIGHT[1], 0.65);
    cloud(cr, 13 + Math.sin(time * 0.6) * 0.7, 14, 0.95, CLOUD_LIGHT[0], CLOUD_LIGHT[1]);
    if (windy)
        windStreaks(cr, time, 0.4, 2);
}

function sceneFog(cr, ctx) {
    const { time } = ctx;
    cloud(cr, 12 + Math.sin(time * 0.5) * 0.5, 8, 0.7, CLOUD_LIGHT[0], CLOUD_LIGHT[1], 0.8);
    for (let i = 0; i < 3; i++) {
        const fogColor = INK_FOG();
        streak(cr, 14.5 + i * 3.2, 1.7, 0.40 - i * 0.06, 7, 3.5,
            -(time * (2.4 + i)) % 10.5, fogColor);
    }
}

function sceneRain(cr, ctx) {
    const { time, particles, intensity, windKmh, windy } = ctx;
    cloud(cr, 12 + Math.sin(time * 0.5) * 0.5, 7.5, 0.95, CLOUD_RAIN[0], CLOUD_RAIN[1]);
    const dropCount = Math.max(2, Math.ceil((4 + Math.min(12, intensity * 2.4)) / 3));
    const slant = Math.min(0.9, windKmh / 45);
    rainDrops(cr, particles, time, dropCount, slant, 0.9);
    if (windy)
        windStreaks(cr, time, 0.35, 2);
}

function sceneSnow(cr, ctx) {
    const { time, particles, intensity, windy } = ctx;
    cloud(cr, 12 + Math.sin(time * 0.5) * 0.5, 7.5, 0.92, CLOUD_RAIN[0], CLOUD_RAIN[1]);
    const flakeCount = 6 + Math.min(6, Math.round(intensity * 1.8));
    snowFlakes(cr, particles, time, flakeCount);
    if (windy)
        windStreaks(cr, time, 0.35, 2);
}

/** Sleet / freezing rain: half drops, half flakes, extra slant. */
function sceneSleet(cr, ctx) {
    const { time, particles, intensity, windKmh, windy } = ctx;
    cloud(cr, 12 + Math.sin(time * 0.5) * 0.5, 7.5, 0.92, CLOUD_RAIN[0], CLOUD_RAIN[1]);
    const count = Math.max(2, Math.ceil((5 + Math.min(5, intensity * 1.4)) / 3));
    rainDrops(cr, particles, time, count, Math.min(1.1, windKmh / 36 + 0.25), 0.8);
    snowFlakes(cr, particles, time, Math.max(3, count));
    if (windy)
        windStreaks(cr, time, 0.35, 2);
}

/** Hail: dark storm cloud, a few hard rain streaks, bouncing ice stones. */
function sceneHail(cr, ctx) {
    const { time, particles, windKmh, windy } = ctx;
    cloud(cr, 12 + Math.sin(time * 0.45) * 0.5, 7.2, 0.98, CLOUD_DARK[0], CLOUD_DARK[1]);
    rainDrops(cr, particles, time, 2, Math.min(0.9, windKmh / 45), 0.5);
    hailStones(cr, particles, time, particles.hail.length);
    if (windy)
        windStreaks(cr, time, 0.35, 2);
}

const BOLTS = [
    [[13, 10.8], [10.8, 14.6], [12.7, 14.6], [10.2, 19.6]],
    [[10.6, 10.4], [13.2, 14.0], [11.4, 14.2], [13.8, 19.8]],
];

function sceneStorm(cr, ctx) {
    const { time, particles, intensity, windKmh, windy } = ctx;
    cloud(cr, 12 + Math.sin(time * 0.4) * 0.5, 7.2, 1.0, CLOUD_DARK[0], CLOUD_DARK[1]);
    rainDrops(cr, particles, time, Math.max(2, Math.ceil((3 + Math.min(9, intensity * 1.6)) / 3)), Math.min(0.9, windKmh / 45), 0.85);

    // double-flick lightning every ~2.8 s, alternating bolt shape;
    // static poses (tiles, strip glyphs) can't wait for the flicker
    // window -- the bolt IS the scene, so it burns at full brightness
    const cycle = Math.floor(time / 2.8);
    const cycleFraction = time % 2.8;
    let flash = 0;
    if (particles.static) flash = 1;
    else if (cycleFraction < 0.07) flash = cycleFraction / 0.07;
    else if (cycleFraction < 0.14) flash = 1 - (cycleFraction - 0.07) / 0.07;
    else if (cycleFraction < 0.20) flash = 0.6 * (cycleFraction - 0.14) / 0.06;
    else if (cycleFraction < 0.28) flash = 0.6 * (1 - (cycleFraction - 0.20) / 0.08);
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
        const bolt = BOLTS[particles.static ? 0 : cycle % BOLTS.length];
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
        windStreaks(cr, time, 0.3, 2);
}

/** Curling gust that travels across the scene (wind-scene garnish). */
function gustCurl(cr, x, y, scale, alpha) {
    cr.save();
    cr.translate(x, y);
    cr.setSourceRGBA(0.55, 0.85, 1.0, alpha);
    cr.setLineCap(Cairo.LineCap.ROUND);
    cr.setLineWidth(0.8);
    cr.newPath();
    cr.arc(0, 0, scale, Math.PI * 0.9, Math.PI * 2.2);
    cr.stroke();
    cr.newPath();
    cr.arc(scale * 0.5, scale * 0.4, scale * 0.45, Math.PI * 1.1, Math.PI * 2.5);
    cr.stroke();
    cr.restore();
}

function sceneWind(cr, ctx) {
    const { time } = ctx;
    windStreaks(cr, time, 1.0, 4);
    // one longer high streak for depth
    streak(cr, 3.2 + Math.sin(time) * 0.4, 0.7, 0.35, 3.5, 6, -(time * 5) % 9.5);
    // two curling gusts sweeping left->right at different depths
    gustCurl(cr, (time * 4.4) % 28 - 2, 8.5 + Math.sin(time * 1.6) * 0.8, 1.5, 0.6);
    gustCurl(cr, ((time * 3.1) % 28) - 2 + 9, 16 + Math.cos(time * 1.2) * 0.8, 1.1, 0.4);
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
 *   time       seconds since the icon appeared (animation clock)
 *   particles  pool from createParticles()
 *   windy      bool -- add wind streaks to the scene
 *   night      bool -- render night variant (partly)
 *   intensity  0..10 precipitation mm, drives drop/flake count
 *   windKmh    wind speed in km/h, drives rain slant
 */
let staticPool = null;   // one seeded pool for every static painter

export function paintWeather(cr, opts) {
    let particles;
    if (opts.staticPose) {
        if (!staticPool)
            staticPool = Object.assign(createParticles(), { static: true });
        particles = staticPool;
    } else
        particles = opts.particles || createParticles();
    _light = opts.dark === false;
    const currentTime = opts.time || 0;
    const ctx = {
        time: currentTime,
        t: currentTime,
        particles,
        p: particles,
        windy: !!opts.windy,
        night: !!opts.night,
        intensity: opts.intensity || 0,
        windKmh: opts.windKmh || 0,
        phase: Number.isFinite(opts.phase) ? opts.phase : moonPhase().phase,
    };
    cr.save();
    // fade rain/storm drops out from under the cloud
    const sceneRenderer = SCENES[opts.scene] || sceneError;
    sceneRenderer(cr, ctx);
    cr.restore();
    particles.lastTime = currentTime;
    particles.lastT = currentTime;
}
