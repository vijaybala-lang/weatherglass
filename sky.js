/* sky.js -- animated sky backdrop */

import Cairo from 'gi://cairo';
import { paintMoon, moonPhase, illumOf } from './moon.js';

const TWO_PI = Math.PI * 2;
const rand = (min, max) => min + Math.random() * (max - min);

/* [top, bottom] sky gradients per scene/day-night (mockup PAL) */
const SKY_PALETTES = {
    clear: { d: [[0.18, 0.43, 0.70], [0.75, 0.88, 0.97]], n: [[0.04, 0.06, 0.15], [0.15, 0.20, 0.36]] },
    partly: { d: [[0.23, 0.43, 0.66], [0.66, 0.79, 0.89]], n: [[0.05, 0.07, 0.19], [0.16, 0.21, 0.38]] },
    sun: { d: [[0.18, 0.43, 0.70], [0.75, 0.88, 0.97]], n: [[0.04, 0.06, 0.15], [0.15, 0.20, 0.36]] },
    moon: { d: [[0.18, 0.43, 0.70], [0.75, 0.88, 0.97]], n: [[0.04, 0.06, 0.15], [0.15, 0.20, 0.36]] },
    cloud: { d: [[0.36, 0.44, 0.54], [0.71, 0.76, 0.81]], n: [[0.08, 0.09, 0.14], [0.17, 0.20, 0.26]] },
    fog: { d: [[0.47, 0.50, 0.55], [0.72, 0.74, 0.77]], n: [[0.11, 0.13, 0.17], [0.20, 0.23, 0.27]] },
    rain: { d: [[0.22, 0.27, 0.36], [0.44, 0.50, 0.58]], n: [[0.05, 0.07, 0.13], [0.14, 0.17, 0.24]] },
    sleet: { d: [[0.28, 0.35, 0.44], [0.55, 0.60, 0.66]], n: [[0.07, 0.09, 0.15], [0.16, 0.19, 0.29]] },
    snow: { d: [[0.41, 0.47, 0.55], [0.72, 0.78, 0.83]], n: [[0.09, 0.11, 0.17], [0.19, 0.23, 0.32]] },
    hail: { d: [[0.14, 0.17, 0.24], [0.30, 0.35, 0.43]], n: [[0.04, 0.05, 0.09], [0.11, 0.14, 0.20]] },
    storm: { d: [[0.11, 0.13, 0.19], [0.24, 0.28, 0.36]], n: [[0.03, 0.04, 0.07], [0.08, 0.11, 0.17]] },
    wind: { d: [[0.30, 0.43, 0.57], [0.66, 0.75, 0.83]], n: [[0.06, 0.09, 0.16], [0.15, 0.20, 0.29]] },
    error: { d: [[0.45, 0.30, 0.30], [0.70, 0.55, 0.55]], n: [[0.15, 0.09, 0.09], [0.25, 0.17, 0.17]] },
    loading: { d: [[0.30, 0.33, 0.38], [0.55, 0.58, 0.63]], n: [[0.09, 0.10, 0.12], [0.20, 0.22, 0.25]] },
};

const SCENE_FEATURES = {
    clear: { sun: 1 },
    sun: { sun: 1 },
    partly: { clouds: 3, sun: 1, moon: 1 },  // night: moon behind the clouds
    moon: { stars: 1, moon: 1 },
    cloud: { clouds: 5 },
    fog: { clouds: 2, fog: 1 },
    rain: { clouds: 6, drops: 90 },
    sleet: { clouds: 6, drops: 45, flakes: 30 },
    snow: { clouds: 6, flakes: 70 },
    hail: { clouds: 6, drops: 40, hail: 26 },
    storm: { clouds: 6, drops: 120, bolt: 1 },
    wind: { streaks: 22 },
};

/* Twilight tints, [zenith, mid, low, horizon]: golden hour while the sun
 * is still up, a violet-to-ember afterglow (or pre-dawn) once it is down. */
const TWILIGHT_PALETTES = {
    d: [[0.33, 0.36, 0.64], [0.80, 0.56, 0.62], [0.99, 0.66, 0.46], [1.00, 0.76, 0.44]],
    n: [[0.09, 0.10, 0.26], [0.30, 0.23, 0.45], [0.74, 0.39, 0.42], [0.96, 0.56, 0.34]],
};
const TWILIGHT_STOPS = [0, 0.45, 0.8, 1];
/* per-stop [strength, easing exponent]: the horizon warms first and the
 * zenith follows, so mid-twilight never passes through a muddy grey */
const TWILIGHT_EASE = [[0.75, 1.6], [0.88, 1.1], [0.88, 0.7], [0.9, 0.55]];

/* how much twilight colour shows through each scene's cloud deck */
const TWILIGHT_CLARITY = {
    clear: 1, sun: 1, moon: 1, partly: 0.9, wind: 0.8, cloud: 0.5, fog: 0.4,
    rain: 0.3, sleet: 0.3, snow: 0.35, hail: 0.15, storm: 0.15,
};

const mix = (a, b, t) => a.map((channelVal, idx) => channelVal + (b[idx] - channelVal) * t);

/* High-sun tints on the same stops, [colour, strength]: a deep zenith blue
 * over a pale, hazy horizon -- the look of a clear sky near solar noon. */
const NOON_PALETTE = [
    [[0.09, 0.32, 0.66], 0.6], [[0.32, 0.58, 0.86], 0.4],
    [[0.70, 0.84, 0.96], 0.3], [[0.88, 0.93, 0.97], 0.5],
];

/* noon blue needs open sky: overcast and precipitation keep their grey */
const NOON_CLARITY = { clear: 1, sun: 1, moon: 1, partly: 0.8, wind: 0.7 };

const clamp01 = v => Math.max(0, Math.min(1, v || 0));

function twilightOf(scene, glow) {
    return clamp01(glow) * (TWILIGHT_CLARITY[scene] ?? 0);
}

/* solar: 0..1 sun height through the day (1 at solar noon), null if unknown */
function noonOf(scene, night, solar) {
    if (night || !Number.isFinite(solar))
        return 0;
    return clamp01(solar) ** 2 * (NOON_CLARITY[scene] ?? 0);
}

/* Sun's spot on the card: the disc RISES with the real sun -- it peeks up
 * from the card's foot at sunrise, settles back there at dusk, and only
 * reaches its corner perch at solar noon (solar: 0..1 climb). */
function sunSpot(width, height, night, solar) {
    const y = !night && Number.isFinite(solar)
        ? height * (0.80 - 0.64 * clamp01(solar)) : height * 0.16;
    return [width * 0.82, y];
}

/* [offset, rgb] gradient stops; with no twilight or noon the inner stops
 * sit on the plain top->bottom line, so the gradient is unchanged. */
function skyStops(scene, night, glow, solar) {
    const [top, bottom] = paletteFor(scene, night);
    const twilight = twilightOf(scene, glow);
    const noon = noonOf(scene, night, solar);
    const tints = TWILIGHT_PALETTES[night ? 'n' : 'd'];
    return TWILIGHT_STOPS.map((offset, idx) => {
        const [strength, easing] = TWILIGHT_EASE[idx];
        const [noonRgb, noonStrength] = NOON_PALETTE[idx];
        const base = mix(mix(top, bottom, offset), noonRgb, noonStrength * noon);
        return [offset, mix(base, tints[idx], strength * twilight ** easing)];
    });
}

/** Approximate the composited sky RGB at height fraction f (0 top .. 1 bottom). */
export function sampleSky(scene, night, heightFraction = 0.62, glow = 0, solar = null) {
    const stops = skyStops(scene, night, glow, solar);
    const f = Math.max(0, Math.min(1, heightFraction));
    for (let i = 1; i < stops.length; i++) {
        const [offset, rgb] = stops[i], [prevOffset, prevRgb] = stops[i - 1];
        if (f <= offset)
            return mix(prevRgb, rgb, (f - prevOffset) / (offset - prevOffset));
    }
    return stops[stops.length - 1][1];
}

const MOON_COVER = 0.5;

export function bodyOf(scene, night, width, height, glow = 0, solar = null) {
    const features = SCENE_FEATURES[scene] ?? {};
    const baseRadius = 64 * height / 420;
    const [sunX, sunY] = sunSpot(width, height, night, solar);
    if ((features.sun || features.moon) && !night)
        return {
            x: sunX, y: sunY, r: baseRadius * 0.45, soft: 10,
            col: mix([1, 0.8, 0.4], SUNSET_CORE, twilightOf(scene, glow)), max: 0.75
        };
    if (features.moon && night) {
        const currentPhase = moonPhase().phase;
        if (illumOf(currentPhase) < 0.12)
            return {
                x: width * 0.82, y: height * 0.16, r: baseRadius * 0.85, soft: 14,
                col: [0.93, 0.94, 0.96], max: MOON_COVER
            };
    }
    return null;
}

function paletteFor(scene, night) {
    return (SKY_PALETTES[scene] ?? SKY_PALETTES.cloud)[night ? 'n' : 'd'];
}

/** Pre-rendered cloud sprite */
function makeCloudSprite() {
    const SPRITE_WIDTH = 400, SPRITE_HEIGHT = 200;
    const surface = new Cairo.ImageSurface(Cairo.Format.ARGB32, SPRITE_WIDTH, SPRITE_HEIGHT);
    const cr = new Cairo.Context(surface);
    cr.setOperator(Cairo.Operator.CLEAR);
    cr.paint();
    cr.setOperator(Cairo.Operator.OVER);
    for (const [normX, normY, normRadius] of [[0.32, 0.55, 0.27], [0.47, 0.44, 0.23],
    [0.62, 0.54, 0.21], [0.40, 0.63, 0.26],
    [0.56, 0.64, 0.23]]) {
        const radius = normRadius * SPRITE_HEIGHT, x = normX * SPRITE_WIDTH, y = normY * SPRITE_HEIGHT;
        const gradient = new Cairo.RadialGradient(x, y, radius * 0.05, x, y, radius);
        gradient.addColorStopRGBA(0, 1, 1, 1, 0.5);
        gradient.addColorStopRGBA(0.55, 1, 1, 1, 0.22);
        gradient.addColorStopRGBA(1, 1, 1, 1, 0);
        cr.setSource(gradient);
        cr.arc(x, y, radius, 0, TWO_PI);
        cr.fill();
    }
    cr.$dispose();
    surface.flush();
    return surface;
}

export function createSky() {
    return {
        sprite: null, w: 0, h: 0, scene: '', night: null,
        lastTime: null, lastT: null,
        drops: [], flakes: [], hail: [], clouds: [], stars: [],
        streaks: [], fog: []
    };
}

function rebuild(sky, width, height, scene) {
    const features = SCENE_FEATURES[scene] ?? {};
    const areaScaleFactor = Math.max(0.5, Math.min(1.5, (width * height) / (1050 * 420)));
    const createParticleList = (count, factory) => Array.from({ length: Math.round(count * areaScaleFactor) }, factory);
    sky.drops = createParticleList(features.drops ?? 0, () => ({
        x: rand(-60, width + 60), y: rand(-height, height),
        length: rand(12, 34), l: rand(12, 34),
        speed: rand(260, 480), sp: rand(260, 480)
    }));
    sky.flakes = createParticleList(features.flakes ?? 0, () => ({
        x: rand(0, width), y: rand(-height, height),
        radius: rand(1.8, 3.6), r: rand(1.8, 3.6),
        speed: rand(28, 60), sp: rand(28, 60),
        phase: rand(0, TWO_PI), ph: rand(0, TWO_PI)
    }));
    sky.hail = createParticleList(features.hail ?? 0, () => ({
        x: rand(0, width), y: rand(-height, height),
        vx: rand(-40, 40), vy: rand(180, 320),
        radius: rand(2.4, 4.4), r: rand(2.4, 4.4),
        bounces: 0, b: 0
    }));
    sky.streaks = createParticleList(features.streaks ?? 0, () => ({
        x: rand(-width, width), y: rand(0, height),
        length: rand(40, 170), l: rand(40, 170),
        speed: rand(120, 320), sp: rand(120, 320),
        width: rand(0.8, 2.2), w: rand(0.8, 2.2),
        opacity: rand(0.12, 0.4), o: rand(0.12, 0.4)
    }));
    sky.fog = createParticleList(features.fog ? 15 : 0, () => ({
        // the roll lives in the valleys and lower slopes -- crowns stay
        // clear air, so the band starts below the ridge bases
        x: rand(-width, width), y: rand(0.44 * height, 0.93 * height),
        length: rand(0.55, 1.2) * width, len: rand(0.55, 1.2) * width,
        speed: rand(12, 34), sp: rand(12, 34),
        height: rand(40, 130), ht: rand(40, 130),
        opacity: rand(0.22, 0.42), o: rand(0.22, 0.42),
        // lit mist vs shadowed mist: a single bright tone over a mist-
        // gray sky cancels out; alternating light/shadow clumps gives
        // the drift real texture the eye can actually track
        tone: rand(0, 1) < 0.5 ? 1 : 0, t: rand(0, 1) < 0.5 ? 1 : 0
    }));
    sky.stars = createParticleList(features.stars ? 70 : 0, () => {
        const isTwinkle = rand(0, 1) < 0.22;
        const radius = isTwinkle ? rand(3.0, 5.6) : rand(0.8, 2.0);
        const phase = rand(0, TWO_PI);
        const isCool = rand(0, 1) < 0.45;
        return {
            x: rand(0, width), y: rand(0, 0.6 * height),
            radius, r: radius,
            phase, ph: phase,
            isTwinkle, tw: isTwinkle,
            isCool, cool: isCool
        };
    });
    sky.clouds = createParticleList((features.clouds ?? 0), () => ({
        x: rand(0, width), y: rand(0.02 * height, 0.42 * height),
        scale: rand(1.0, 2.6), s: rand(1.0, 2.6),
        speed: rand(6, 26), sp: rand(6, 26)
    }));
    sky.w = width; sky.h = height; sky.scene = scene; sky.lastTime = null; sky.lastT = null;
}

/* 4-point star flare: slim crossed diamond + bright core -- the reference's
 * cyan-white twinkle stars. Straight edges read as rays at these sizes. */
function sparkle(cr, x, y, scale, alpha, isCool) {
    const r = isCool ? 0.55 : 1, g = isCool ? 0.83 : 1, b = 1;
    const waistThickness = scale * 0.15;
    cr.save();
    cr.translate(x, y);
    cr.setSourceRGBA(r, g, b, alpha * 0.85);
    cr.newPath();
    cr.moveTo(0, -scale);
    cr.lineTo(waistThickness, -waistThickness);
    cr.lineTo(scale, 0);
    cr.lineTo(waistThickness, waistThickness);
    cr.lineTo(0, scale);
    cr.lineTo(-waistThickness, waistThickness);
    cr.lineTo(-scale, 0);
    cr.lineTo(-waistThickness, -waistThickness);
    cr.closePath();
    cr.fill();
    cr.newPath();
    cr.arc(0, 0, Math.max(0.6, scale * 0.16), 0, TWO_PI);
    cr.setSourceRGBA(r, g, b, Math.min(1, alpha * 1.5));
    cr.fill();
    cr.restore();
}

/* Rounded (or square) clip path so a full-bleed background never squares
 * off the popup's corners. Caller saves/restores. */
function roundClip(cr, width, height, radius) {
    if (radius > 0) {
        const r = Math.min(radius, width / 2, height / 2), k = 0.5523 * r;
        cr.moveTo(r, 0);
        cr.lineTo(width - r, 0);
        cr.curveTo(width - r + k, 0, width, r - k, width, r);
        cr.lineTo(width, height - r);
        cr.curveTo(width, height - r + k, width - r + k, height, width - r, height);
        cr.lineTo(r, height);
        cr.curveTo(r - k, height, 0, height - r + k, 0, height - r);
        cr.lineTo(0, r);
        cr.curveTo(0, r - k, r - k, 0, r, 0);
        cr.closePath();
    } else {
        cr.rectangle(0, 0, width, height);
    }
}


function drawBackdrop(cr, height, stops) {
    const gradient = new Cairo.LinearGradient(0, 0, 0, height);
    for (const [offset, rgb] of stops)
        gradient.addColorStopRGB(offset, ...rgb);
    cr.setSource(gradient);
    cr.paint();
}

/* Low-sun haze along the horizon: a wide ember ellipse under the sun's
 * side of the card, breathing slowly. Night side it is the afterglow. */
function drawHorizonGlow(cr, width, height, twilight, night, time) {
    if (twilight <= 0.01)
        return;
    const breath = 1 + 0.06 * Math.sin(time * 0.4);
    const alpha = twilight * (night ? 0.42 : 0.34) * breath;
    const [r, g, b] = night ? [1.0, 0.45, 0.28] : [1.0, 0.62, 0.30];
    cr.save();
    cr.translate(width * 0.7, height * 1.04);
    cr.scale(width * 0.95, height * 0.42);
    const haze = new Cairo.RadialGradient(0, 0, 0, 0, 0, 1);
    haze.addColorStopRGBA(0, r, g, b, alpha);
    haze.addColorStopRGBA(0.45, r, g * 0.92, b * 1.1, alpha * 0.45);
    haze.addColorStopRGBA(1, r, g, b, 0);
    cr.setSource(haze);
    cr.arc(0, 0, 1, 0, TWO_PI);
    cr.fill();
    cr.restore();
}

/* sun colours at full twilight: the disc deepens to a molten orange */
const SUNSET_CORE = [1.0, 0.56, 0.26];
const SUNSET_RAY = [1.0, 0.52, 0.30];

function drawSun(cr, sunX, sunY, radius, scale, time, twilight = 0, noon = 0) {
    // high sun bleaches toward white; low sun deepens toward molten orange
    const warm = (rgb, target) => mix(mix(rgb, [1.0, 0.97, 0.86], 0.35 * noon), target, twilight);
    const auraRadius = radius * (3.6 + 1.2 * twilight);
    const aura = new Cairo.RadialGradient(sunX, sunY, radius * 0.2, sunX, sunY, auraRadius);
    const auraBreath = (0.40 + 0.08 * Math.sin(time * 0.7)) * (1 + 0.3 * twilight);
    aura.addColorStopRGBA(0, ...warm([1.0, 0.88, 0.45], [1.0, 0.66, 0.36]), auraBreath);
    aura.addColorStopRGBA(0.35, ...warm([1.0, 0.72, 0.22], [1.0, 0.50, 0.30]), auraBreath * 0.5);
    aura.addColorStopRGBA(0.7, ...warm([1.0, 0.58, 0.12], [0.95, 0.40, 0.36]), auraBreath * 0.2);
    aura.addColorStopRGBA(1, ...warm([1.0, 0.50, 0.05], [0.90, 0.36, 0.40]), 0);
    cr.setSource(aura);
    cr.arc(sunX, sunY, auraRadius, 0, TWO_PI);
    cr.fill();

    const rayCount = 16;
    const stepAngle = TWO_PI / rayCount;
    cr.save();
    cr.translate(sunX, sunY);
    cr.rotate(time * 0.03);

    for (let k = 0; k < rayCount; k++) {
        cr.save();
        cr.rotate(k * stepAngle);

        const isPrimary = (k % 2 === 0);
        let rayRadius, baseHalfWidth, rayAlpha;
        if (isPrimary) {
            const wave = Math.sin(time * 0.85 + k * 0.7);
            rayRadius = radius * (2.1 + 0.22 * wave);
            baseHalfWidth = 4.2 * scale;
            rayAlpha = 0.20 + 0.05 * wave;
        } else {
            const wave = Math.sin(time * 0.85 + Math.PI * 0.6 + k * 0.7);
            rayRadius = radius * (1.65 + 0.16 * wave);
            baseHalfWidth = 2.8 * scale;
            rayAlpha = 0.13 + 0.04 * wave;
        }

        // low sun: rays soften as the light scatters through more air
        rayAlpha *= 1 - 0.3 * twilight;
        const beamGrad = new Cairo.LinearGradient(0, -radius * 0.6, 0, -rayRadius);
        beamGrad.addColorStopRGBA(0, ...warm([1.0, 0.90, 0.50], SUNSET_RAY), rayAlpha);
        beamGrad.addColorStopRGBA(0.5, ...warm([1.0, 0.78, 0.28], SUNSET_RAY), rayAlpha * 0.6);
        beamGrad.addColorStopRGBA(1, ...warm([1.0, 0.65, 0.15], SUNSET_RAY), 0);

        cr.setSource(beamGrad);
        cr.newPath();
        cr.moveTo(-baseHalfWidth, -radius * 0.6);
        cr.lineTo(0, -rayRadius);
        cr.lineTo(baseHalfWidth, -radius * 0.6);
        cr.closePath();
        cr.fill();

        cr.restore();
    }
    cr.restore();

    const coronaRadius = radius * 1.9;
    const corona = new Cairo.RadialGradient(sunX, sunY, radius * 0.5, sunX, sunY, coronaRadius);
    const coronaBreath = 0.65 + 0.12 * Math.sin(time * 1.5);
    corona.addColorStopRGBA(0, ...warm([1.0, 0.94, 0.60], [1.0, 0.74, 0.46]), coronaBreath);
    corona.addColorStopRGBA(0.5, ...warm([1.0, 0.78, 0.25], [1.0, 0.50, 0.28]), coronaBreath * 0.45);
    corona.addColorStopRGBA(1, ...warm([1.0, 0.65, 0.15], [0.95, 0.38, 0.30]), 0);
    cr.setSource(corona);
    cr.arc(sunX, sunY, coronaRadius, 0, TWO_PI);
    cr.fill();

    const coreRadius = radius * 0.85;
    const core = new Cairo.RadialGradient(
        sunX - radius * 0.25, sunY - radius * 0.25, radius * 0.1,
        sunX, sunY, coreRadius
    );
    core.addColorStopRGBA(0, ...warm([1.0, 0.99, 0.88], [1.0, 0.90, 0.66]), 1.0);
    core.addColorStopRGBA(0.45, ...warm([1.0, 0.88, 0.35], [1.0, 0.68, 0.32]), 0.98);
    core.addColorStopRGBA(0.85, ...warm([1.0, 0.70, 0.14], SUNSET_CORE), 0.96);
    core.addColorStopRGBA(1, ...warm([0.98, 0.55, 0.08], [0.94, 0.36, 0.16]), 0.90);
    cr.setSource(core);
    cr.arc(sunX, sunY, coreRadius, 0, TWO_PI);
    cr.fill();
}

function drawMoon(cr, moonX, moonY, radius, phase) {
    const lunarPhase = Number.isFinite(phase) ? phase : moonPhase().phase;
    const alpha = 0.08 + 0.22 * illumOf(lunarPhase);
    const moonGlow = new Cairo.RadialGradient(moonX, moonY, radius * 0.6, moonX, moonY, radius * 3.4);
    moonGlow.addColorStopRGBA(0, 0.80, 0.87, 0.99, alpha);
    moonGlow.addColorStopRGBA(0.45, 0.70, 0.80, 0.96, alpha * 0.38);
    moonGlow.addColorStopRGBA(1, 0.70, 0.80, 0.96, 0);
    cr.setSource(moonGlow);
    cr.arc(moonX, moonY, radius * 3.4, 0, TWO_PI);
    cr.fill();
    cr.pushGroup();
    paintMoon(cr, moonX, moonY, radius * 0.85, lunarPhase, 'sky');
    cr.popGroupToSource();
    cr.paintWithAlpha(MOON_COVER);
}

function drawStars(cr, stars, time, twilight = 0, keepOut = null) {
    // afterglow: only the brightest stars have come out yet
    const visibility = 1 - 0.85 * twilight;
    if (visibility <= 0.02)
        return;
    for (const star of stars) {
        const wave = Math.abs(Math.sin(time * 1.3 + (star.phase ?? star.ph)));
        const alpha = (0.25 + 0.5 * wave) * visibility;
        const radius = star.radius ?? star.r;
        const isTwinkle = star.isTwinkle ?? star.tw;
        const isCool = star.isCool ?? star.cool;
        // the moon is painted over the star field at partial cover, so a
        // star inside its disc ghosts through -- visible worst on the dark
        // side; stars whose reach touches the disc are not drawn at all
        if (keepOut && Math.hypot(star.x - keepOut.x, star.y - keepOut.y) <
            keepOut.r + radius * (isTwinkle ? 1.2 : 1))
            continue;
        if (isTwinkle) {
            sparkle(cr, star.x, star.y, radius * (0.7 + 0.5 * wave), alpha, isCool);
            continue;
        }
        if (isCool)
            cr.setSourceRGBA(0.72, 0.86, 1.0, alpha);
        else
            cr.setSourceRGBA(1, 1, 1, alpha);
        cr.newPath();
        cr.arc(star.x, star.y, radius, 0, TWO_PI);
        cr.fill();
    }
}

function drawCelestial(cr, width, height, scale, features, sky, time, night, phase, twilight,
    solar, noon) {
    const [sunX, sunY] = sunSpot(width, height, night, solar);
    const radius = 64 * scale;
    if ((features.sun || features.moon) && !night) {
        drawSun(cr, sunX, sunY, radius, scale, time, twilight, noon);
    } else if (features.stars || features.moon) {
        if (features.moon)
            drawStars(cr, sky.stars, time, twilight, { x: sunX, y: sunY, r: radius * 0.85 });
        else
            drawStars(cr, sky.stars, time, twilight);
        if (features.moon)
            drawMoon(cr, sunX, sunY, radius, phase);
    }
}

function drawClouds(cr, sky, width, scale, dt, time, scene, night, twilight) {
    if (!sky.clouds.length)
        return;
    if (!sky.sprite)
        sky.sprite = makeCloudSprite();
    // twilight lifts night clouds too: their bellies catch the low light
    const tint = night ? 0.45 + 0.35 * twilight : 1;
    const [glowR, glowG, glowB] = night ? [1.0, 0.50, 0.46] : [1.0, 0.62, 0.48];
    for (const cloudItem of sky.clouds) {
        const cloudSpeed = cloudItem.speed ?? cloudItem.sp;
        const cloudScale = cloudItem.scale ?? cloudItem.s;
        cloudItem.x += cloudSpeed * dt;
        if (cloudItem.x > width + 200)
            cloudItem.x = -260;
        const cloudWidth = 400 * cloudScale * 0.24, cloudHeight = 200 * cloudScale * 0.24;
        cr.save();
        cr.translate(cloudItem.x, cloudItem.y + Math.sin(time * 0.3 + cloudItem.y) * 4 * scale);
        cr.scale(cloudWidth / 400, cloudHeight / 200);
        cr.setSourceSurface(sky.sprite, 0, 0);
        cr.paintWithAlpha((scene === 'clear' || scene === 'sun' ? 0.45 : 0.8) * tint);
        if (twilight > 0.01) {
            cr.setSourceRGBA(glowR, glowG, glowB, 0.55 * twilight);
            cr.maskSurface(sky.sprite, 0, 0);
        }
        cr.restore();
    }
}

/* Card-scale fog: rolling hills standing above the valley mist with
 * their feet lost in it. Fixed sine-ridge geometry -- terrain must not
 * wander -- while the drifting puffs and the rising wash in front of
 * it keep the fog line alive. */
/* Card-scale fog: rolling hills standing above the valley mist. The
 * illusion lives at the FOG LINE -- ridge crowns must rise clear of a
 * wash that starts low and thickens fast, or the wash (tinted like the
 * sky) flattens the whole lower card and the hills vanish into it.
 * Fixed sine-ridge geometry: terrain never wanders; the drifting puffs
 * and swaying wash line in front of it carry the motion. */
function drawFogHills(cr, width, height, night) {
    const ridges = [
        // the far crown crests just above the metric tabs (~0.25 of the
        // card), the near one below the chart; both feet drown in the wash
        { base: 0.30, amp: 0.060, f1: 1.7, f2: 4.1, p1: 0.6, p2: 2.2,
            c: night ? [0.09, 0.11, 0.15] : [0.42, 0.45, 0.51] },
        { base: 0.44, amp: 0.075, f1: 2.3, f2: 5.3, p1: 2.9, p2: 0.4,
            c: night ? [0.05, 0.07, 0.10] : [0.28, 0.32, 0.39] },
    ];
    for (const r of ridges) {
        cr.setSourceRGBA(r.c[0], r.c[1], r.c[2], 1);
        cr.moveTo(0, height);
        for (let x = 0; x <= width; x += 8) {
            const u = x / width;
            const y = height * (r.base
                - r.amp * Math.sin(u * Math.PI * r.f1 + r.p1)
                - r.amp * 0.5 * Math.sin(u * Math.PI * r.f2 + r.p2));
            cr.lineTo(x, y);
        }
        cr.lineTo(width, height);
        cr.closePath();
        cr.fill();
    }
    // the fog line: negligible over the crowns, total below the feet
    const washColor = night ? [0.50, 0.55, 0.64] : [0.82, 0.85, 0.88];
    const wash = new Cairo.LinearGradient(0, 0.34 * height, 0, height);
    wash.addColorStopRGBA(0, ...washColor, 0);
    wash.addColorStopRGBA(0.30, ...washColor, night ? 0.30 : 0.45);
    wash.addColorStopRGBA(1, ...washColor, night ? 0.62 : 0.78);
    cr.setSource(wash);
    cr.rectangle(0, 0.34 * height, width, height * 0.66);
    cr.fill();
}

function drawFog(cr, sky, width, dt, time, night) {
    // light clumps glow over the mist, shadow clumps carve depth into it
    const litColor = night ? [0.55, 0.60, 0.70] : [0.93, 0.95, 0.97];
    const shadeColor = night ? [0.07, 0.09, 0.14] : [0.40, 0.44, 0.50];
    for (const fogItem of sky.fog) {
        const fogSpeed = fogItem.speed ?? fogItem.sp;
        const fogLength = fogItem.length ?? fogItem.len;
        const fogHeight = fogItem.height ?? fogItem.ht;
        const fogOpacity = fogItem.opacity ?? fogItem.o;
        const isLit = fogItem.tone ?? fogItem.t;
        fogItem.x += fogSpeed * dt;
        if (fogItem.x > width + fogLength)
            fogItem.x = -fogLength;
        const y = fogItem.y +
            Math.sin(time * 0.35 + (fogItem.x + width) * 0.01) * 4;
        const tint = isLit ? litColor : shadeColor;
        // elliptical puff: a radial fade stretched wide, so the clump has
        // no edges anywhere -- rectangles read as boxes on a soft scene
        cr.save();
        cr.translate(fogItem.x + fogLength / 2, y);
        cr.scale(fogLength / (fogHeight * 2), 1);
        const gradient = new Cairo.RadialGradient(0, 0, 0, 0, 0, fogHeight);
        gradient.addColorStopRGBA(0, ...tint, fogOpacity);
        gradient.addColorStopRGBA(0.6, ...tint, fogOpacity * 0.65);
        gradient.addColorStopRGBA(1, ...tint, 0);
        cr.setSource(gradient);
        cr.arc(0, 0, fogHeight, 0, Math.PI * 2);
        cr.fill();
        cr.restore();
    }
}

function drawRain(cr, sky, width, height, scale, dt, scene) {
    const rainColor = scene === 'sleet' ? [0.63, 0.80, 0.93] : [0.73, 0.84, 0.94];
    cr.setLineCap(Cairo.LineCap.ROUND);
    cr.setLineWidth(1.4 * scale);
    for (const drop of sky.drops) {
        const speed = drop.speed ?? drop.sp;
        const length = drop.length ?? drop.l;
        drop.y += speed * dt;
        drop.x -= speed * 0.28 * dt;
        if (drop.y > height + 20) {
            drop.y = -20;
            drop.x = rand(0, width + 60);
        }
        cr.setSourceRGBA(...rainColor, 0.45);
        cr.moveTo(drop.x, drop.y);
        cr.lineTo(drop.x - length * 0.3, drop.y + length);
        cr.stroke();
    }
}

function drawSnow(cr, sky, width, height, scale, dt, time) {
    for (const flake of sky.flakes) {
        const speed = flake.speed ?? flake.sp;
        const radius = flake.radius ?? flake.r;
        const phase = flake.phase ?? flake.ph;
        flake.y += speed * dt;
        if (flake.y > height + 10) {
            flake.y = -10;
            flake.x = rand(0, width);
        }
        cr.setSourceRGBA(1, 1, 1, 0.85);
        cr.arc(flake.x + Math.sin(time * 1.2 + phase) * 18 * scale, flake.y, radius, 0, TWO_PI);
        cr.fill();
    }
}

function drawHail(cr, sky, width, height, dt) {
    for (const stone of sky.hail) {
        const radius = stone.radius ?? stone.r;
        stone.vy += 900 * dt;
        stone.x += stone.vx * dt;
        stone.y += stone.vy * dt;
        if (stone.y > height - 6 - radius && stone.vy > 0) {
            stone.y = height - 6 - radius;
            stone.vy *= -0.42;
            stone.vx = rand(-160, 160);
            stone.bounces = (stone.bounces ?? stone.b) + 1;
            stone.b = stone.bounces;
        }
        if ((stone.bounces ?? stone.b) > 2 || stone.x < -10 || stone.x > width + 10)
            Object.assign(stone, {
                x: rand(0, width), y: -10, vx: rand(-40, 40),
                vy: rand(180, 320), radius: rand(2.4, 4.4), r: rand(2.4, 4.4),
                bounces: 0, b: 0
            });
        cr.setSourceRGBA(0.94, 0.96, 0.99, 0.92);
        cr.arc(stone.x, stone.y, radius, 0, TWO_PI);
        cr.fill();
    }
}

function drawWindStreaks(cr, sky, width, height, dt) {
    for (const streakItem of sky.streaks) {
        const speed = streakItem.speed ?? streakItem.sp;
        const length = streakItem.length ?? streakItem.l;
        const strokeWidth = streakItem.width ?? streakItem.w;
        const opacity = streakItem.opacity ?? streakItem.o;
        streakItem.x += speed * dt;
        if (streakItem.x > width + length) {
            streakItem.x = -length;
            streakItem.y = rand(0, height);
        }
        cr.setSourceRGBA(0.86, 0.93, 0.98, opacity);
        cr.setLineWidth(strokeWidth);
        cr.moveTo(streakItem.x, streakItem.y);
        cr.lineTo(streakItem.x + length, streakItem.y);
        cr.stroke();
    }
}

function drawLightning(cr, width, height, scale, time) {
    const cycleTime = time % 3.1;
    let flashIntensity = 0;
    if (cycleTime < 0.08) flashIntensity = cycleTime / 0.08;
    else if (cycleTime < 0.18) flashIntensity = 1 - (cycleTime - 0.08) / 0.1;
    else if (cycleTime < 0.26) flashIntensity = 0.5 * (cycleTime - 0.18) / 0.08;
    else if (cycleTime < 0.38) flashIntensity = 0.5 * (1 - (cycleTime - 0.26) / 0.12);
    if (flashIntensity <= 0)
        return;
    cr.setSourceRGBA(1, 0.99, 0.92, 0.10 * flashIntensity);
    cr.paint();
    cr.save();
    cr.translate(width * 0.5, height * 0.05);
    cr.setSourceRGBA(1, 0.86, 0.31, flashIntensity);
    cr.setLineWidth(3.4 * scale);
    cr.setLineJoin(Cairo.LineJoin.ROUND);
    cr.setLineCap(Cairo.LineCap.ROUND);
    cr.moveTo(0, 0);
    cr.lineTo(-38 * scale, 90 * scale);
    cr.lineTo(14 * scale, 96 * scale);
    cr.lineTo(-30 * scale, 210 * scale);
    cr.stroke();
    cr.restore();
}

/* glow: 0..1 twilight strength (1 at sunrise/sunset); solar: 0..1 sun
 * height through the day (1 at solar noon, null if unknown). Both come
 * from the menu's city clock. */
export function paintSky(cr, { w: width, h: height, time, scene, night, sky, scrim = null,
    radius = 0, phase = null, glow = 0, solar = null }) {
    const roundedWidth = Math.round(width);
    const roundedHeight = Math.round(height);
    if (sky.scene !== scene || sky.w !== roundedWidth || sky.h !== roundedHeight)
        rebuild(sky, roundedWidth, roundedHeight, scene);

    const lastTime = sky.lastTime ?? sky.lastT;
    const dt = lastTime === null ? 0 : Math.min(0.1, time - lastTime);
    sky.lastTime = time;
    sky.lastT = time;
    const features = SCENE_FEATURES[scene] ?? {};
    const twilight = twilightOf(scene, glow);
    const noon = noonOf(scene, night, solar);
    const scale = height / 420;

    cr.save();
    roundClip(cr, width, height, radius);
    cr.clip();

    drawBackdrop(cr, height, skyStops(scene, night, glow, solar));
    drawHorizonGlow(cr, width, height, twilight, night, time);
    drawCelestial(cr, width, height, scale, features, sky, time, night, phase, twilight,
        solar, noon);
    drawClouds(cr, sky, width, scale, dt, time, scene, night, twilight);
    if (scene === 'fog')
        drawFogHills(cr, width, height, night);
    drawFog(cr, sky, width, dt, time, night);
    drawRain(cr, sky, width, height, scale, dt, scene);
    drawSnow(cr, sky, width, height, scale, dt, time);
    drawHail(cr, sky, width, height, dt);
    drawWindStreaks(cr, sky, width, height, dt);
    if (features.bolt)
        drawLightning(cr, width, height, scale, time);
    if (scrim) {
        cr.setSourceRGBA(scrim[0], scrim[1], scrim[2], scrim[3]);
        cr.paint();
    }

    cr.restore();
}
