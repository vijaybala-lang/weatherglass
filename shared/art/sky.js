// CANONICAL WeatherGlass sky backdrop painter (pure Cairo).
// The extension owns this art; its copy lives at extension/sky.js and the
// app consumes a byte-identical clone at app/src/sky.js. The parity gate
// compares all three below the marker line. DO NOT EDIT COPIES — edit the
// extension source, sync, and let the gate verify.
/* == SYNCHED DESIGN BRAIN (byte-identity enforced by scripts/check-design-parity.py) == */
/* sky.js -- animated sky backdrop (shared across extension and app) */

import Cairo from 'gi://cairo';
import { paintMoon, moonPhase, illumOf } from './moon.js';

const TWO_PI = Math.PI * 2;
const rand = (min, max) => min + Math.random() * (max - min);

function seededRand(seed) {
    let s = seed >>> 0;
    return (min = 0, max = 1) => {
        s = (s * 1664525 + 1013904223) >>> 0;
        return min + (s / 4294967296) * (max - min);
    };
}

/* [top, bottom] sky gradients per scene/day-night */
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
    cloud: { clouds: 8 },
    fog: { fog: 1 },
    rain: { clouds: 7, drops: 95, ripples: 10 },
    sleet: { clouds: 7, drops: 48, flakes: 28, pellets: 22 },
    snow: { clouds: 7, flakes: 72 },
    hail: { clouds: 7, drops: 42, hail: 28, bolt: 1 },
    storm: { clouds: 8, drops: 120, ripples: 12, bolt: 1 },
    wind: { streaks: 18, leaves: 16, trees: 1 },
    error: {},
    loading: {},
};

/* Twilight tints, [zenith, mid, low, horizon]: golden hour while the sun
 * is still up -- violet zenith, magenta rose mid-deck, burnt amber and
 * full gold at the horizon; a violet-to-ember afterglow (or pre-dawn)
 * once it is down. */
const TWILIGHT_PALETTES = {
    d: [[0.30, 0.33, 0.66], [0.86, 0.50, 0.62], [1.00, 0.58, 0.30], [1.00, 0.72, 0.28]],
    n: [[0.08, 0.09, 0.24], [0.36, 0.22, 0.48], [0.78, 0.34, 0.30], [0.96, 0.50, 0.26]],
};
const TWILIGHT_STOPS = [0, 0.45, 0.8, 1];
const TWILIGHT_EASE = [[0.85, 1.5], [0.95, 1.0], [0.97, 0.6], [1.0, 0.45]];

const TWILIGHT_CLARITY = {
    clear: 1, sun: 1, moon: 1, partly: 0.9, wind: 0.8, cloud: 0.5, fog: 0.4,
    rain: 0.3, sleet: 0.3, snow: 0.35, hail: 0.15, storm: 0.15,
};

const mix = (a, b, t) => a.map((channelVal, idx) => channelVal + (b[idx] - channelVal) * t);

const NOON_PALETTE = [
    [[0.09, 0.32, 0.66], 0.6], [[0.32, 0.58, 0.86], 0.4],
    [[0.70, 0.84, 0.96], 0.3], [[0.88, 0.93, 0.97], 0.5],
];

const NOON_CLARITY = { clear: 1, sun: 1, moon: 1, partly: 0.8, wind: 0.7 };

const clamp01 = v => Math.max(0, Math.min(1, v || 0));

function twilightOf(scene, glow) {
    return clamp01(glow) * (TWILIGHT_CLARITY[scene] ?? 0);
}

function noonOf(scene, night, solar) {
    if (night || !Number.isFinite(solar))
        return 0;
    return clamp01(solar) ** 2 * (NOON_CLARITY[scene] ?? 0);
}

function sunSpot(width, height, night, solar) {
    const y = !night && Number.isFinite(solar) ? 0.21 - 0.09 * clamp01(solar) : 0.16;
    return [width * 0.82, height * y];
}

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

function paletteFor(scene, night) {
    return (SKY_PALETTES[scene] ?? SKY_PALETTES.cloud)[night ? 'n' : 'd'];
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
const SUNSET_CORE = [1.0, 0.56, 0.26];
const SUNSET_RAY = [1.0, 0.52, 0.30];

/* The disc the INK judge must believe exists: same position AND core
 * radius as drawCelestial paints (64 * scale). */
export function bodyOf(scene, night, width, height, glow = 0, solar = null, phase = null) {
    const features = SCENE_FEATURES[scene] ?? {};
    const baseRadius = 64 * height / 420;
    const [sunX, sunY] = sunSpot(width, height, night, solar);
    if ((features.sun || features.moon) && !night)
        return {
            x: sunX, y: sunY, r: baseRadius, soft: 12,
            col: mix([1, 0.8, 0.4], SUNSET_CORE, twilightOf(scene, glow)), max: 0.9,
        };
    if (features.moon && night) {
        const lunarPhase = Number.isFinite(phase) ? phase : moonPhase().phase;
        const illum = illumOf(lunarPhase);
        const max = 0.85 * illum;
        if (max > 0.02)
            return {
                x: width * 0.82, y: height * 0.16, r: baseRadius * 0.85, soft: 12,
                col: [0.93, 0.94, 0.96], max,
            };
    }
    return null;
}

const PRECIP_CLOUD_SCENES = new Set(['rain', 'sleet', 'snow', 'hail', 'storm']);

/** Pre-rendered atmospheric cloud sprite: horizontally blended, asymmetric
 *  stratocumulus vapor lobes merged with LIGHTEN on an offscreen mask and
 *  softly feathered on all sides for a natural, realistic cloud formation. */
function makeCloudSprite(variant = 0) {
    const SW = 420, SH = 180;
    const mask = new Cairo.ImageSurface(Cairo.Format.ARGB32, SW, SH);
    const mc = new Cairo.Context(mask);
    mc.setOperator(Cairo.Operator.CLEAR);
    mc.paint();
    mc.setOperator(Cairo.Operator.LIGHTEN);

    const lobes = variant === 0 ? [
        [0.24, 0.60, 0.22, 1.55, 0.72, 0.82],
        [0.44, 0.62, 0.25, 1.65, 0.70, 0.92],
        [0.64, 0.60, 0.23, 1.55, 0.72, 0.84],
        [0.35, 0.48, 0.24, 1.38, 0.80, 0.90],
        [0.53, 0.44, 0.26, 1.45, 0.78, 0.96],
        [0.72, 0.54, 0.19, 1.40, 0.74, 0.72],
    ] : [
        [0.26, 0.60, 0.21, 1.50, 0.72, 0.80],
        [0.46, 0.62, 0.25, 1.65, 0.70, 0.90],
        [0.66, 0.59, 0.22, 1.52, 0.72, 0.82],
        [0.38, 0.45, 0.26, 1.42, 0.78, 0.95],
        [0.58, 0.48, 0.24, 1.38, 0.80, 0.88],
        [0.20, 0.55, 0.18, 1.35, 0.74, 0.70],
    ];
    for (const [nx, ny, nr, sx, sy, peak] of lobes) {
        const r = nr * SH, x = nx * SW, y = ny * SH;
        mc.save();
        mc.translate(x, y);
        mc.scale(sx, sy);
        const g = new Cairo.RadialGradient(0, 0, r * 0.18, 0, 0, r);
        g.addColorStopRGBA(0, 1, 1, 1, peak);
        g.addColorStopRGBA(0.42, 1, 1, 1, peak * 0.68);
        g.addColorStopRGBA(0.75, 1, 1, 1, peak * 0.26);
        g.addColorStopRGBA(1, 1, 1, 1, 0.0);
        mc.setSource(g);
        mc.arc(0, 0, r, 0, TWO_PI);
        mc.fill();
        mc.restore();
    }
    mc.$dispose();
    mask.flush();

    const surface = new Cairo.ImageSurface(Cairo.Format.ARGB32, SW, SH);
    const cr = new Cairo.Context(surface);
    const bodyGrad = new Cairo.LinearGradient(0, SH * 0.12, 0, SH * 0.88);
    bodyGrad.addColorStopRGBA(0.0, 0.98, 0.99, 1.00, 0.44);
    bodyGrad.addColorStopRGBA(0.60, 0.91, 0.95, 0.99, 0.36);
    bodyGrad.addColorStopRGBA(1.0, 0.82, 0.88, 0.94, 0.24);
    cr.setSource(bodyGrad);
    cr.maskSurface(mask, 0, 0);
    cr.$dispose();
    surface.flush();
    return surface;
}

/** Dark heavy cumulus (nimbus) sprite for precipitation scenes:
 *  Pass 1 paints swollen, rounded cumulus domes lit from above;
 *  Pass 2 grounds them with a broad, dark condensation base. */
function makePrecipCloudSprite(variant = 0, scene = 'rain') {
    const SW = 440, SH = 220;
    const buildMask = lobes => {
        const m = new Cairo.ImageSurface(Cairo.Format.ARGB32, SW, SH);
        const mc = new Cairo.Context(m);
        mc.setOperator(Cairo.Operator.CLEAR);
        mc.paint();
        mc.setOperator(Cairo.Operator.LIGHTEN);
        for (const [nx, ny, nr, sx, sy, peak, hard] of lobes) {
            const r = nr * SH, x = nx * SW, y = ny * SH;
            mc.save();
            mc.translate(x, y);
            mc.scale(sx, sy);
            const g = new Cairo.RadialGradient(0, 0, r * hard, 0, 0, r);
            g.addColorStopRGBA(0, 1, 1, 1, peak);
            g.addColorStopRGBA(0.52, 1, 1, 1, peak * 0.82);
            g.addColorStopRGBA(0.80, 1, 1, 1, peak * 0.36);
            g.addColorStopRGBA(1, 1, 1, 1, 0.0);
            mc.setSource(g);
            mc.arc(0, 0, r, 0, TWO_PI);
            mc.fill();
            mc.restore();
        }
        mc.$dispose();
        m.flush();
        return m;
    };

    const turretLobes = variant === 0 ? [
        [0.24, 0.56, 0.24, 1.35, 0.86, 0.90, 0.32],
        [0.37, 0.44, 0.28, 1.32, 0.92, 0.96, 0.34],
        [0.53, 0.38, 0.31, 1.36, 0.95, 1.00, 0.36],
        [0.68, 0.48, 0.26, 1.32, 0.88, 0.94, 0.32],
        [0.79, 0.58, 0.21, 1.38, 0.78, 0.84, 0.28],
        [0.46, 0.58, 0.32, 1.65, 0.78, 0.98, 0.35],
    ] : [
        [0.21, 0.58, 0.21, 1.36, 0.80, 0.84, 0.28],
        [0.34, 0.46, 0.27, 1.32, 0.90, 0.95, 0.34],
        [0.49, 0.37, 0.32, 1.38, 0.96, 1.00, 0.36],
        [0.65, 0.45, 0.28, 1.34, 0.90, 0.96, 0.34],
        [0.77, 0.56, 0.23, 1.36, 0.82, 0.88, 0.30],
        [0.50, 0.58, 0.32, 1.65, 0.78, 0.98, 0.35],
    ];
    const bellyLobes = [
        [0.26, 0.70, 0.24, 1.85, 0.52, 0.92, 0.30],
        [0.50, 0.72, 0.28, 2.05, 0.50, 0.98, 0.34],
        [0.73, 0.70, 0.24, 1.80, 0.52, 0.90, 0.30],
    ];

    const turretMask = buildMask(turretLobes);
    const bellyMask = buildMask(bellyLobes);

    const surface = new Cairo.ImageSurface(Cairo.Format.ARGB32, SW, SH);
    const cr = new Cairo.Context(surface);
    const isStorm = scene === 'storm' || scene === 'hail';
    const isSnow = scene === 'snow';

    const bodyGrad = new Cairo.LinearGradient(0, SH * 0.08, 0, SH * 0.82);
    if (isStorm) {
        bodyGrad.addColorStopRGBA(0.00, 0.66, 0.72, 0.82, 0.82);
        bodyGrad.addColorStopRGBA(0.38, 0.38, 0.44, 0.54, 0.78);
        bodyGrad.addColorStopRGBA(0.75, 0.19, 0.23, 0.31, 0.76);
        bodyGrad.addColorStopRGBA(1.00, 0.12, 0.15, 0.22, 0.60);
    } else if (isSnow) {
        bodyGrad.addColorStopRGBA(0.00, 0.86, 0.90, 0.95, 0.78);
        bodyGrad.addColorStopRGBA(0.45, 0.62, 0.69, 0.78, 0.72);
        bodyGrad.addColorStopRGBA(0.80, 0.44, 0.51, 0.61, 0.68);
        bodyGrad.addColorStopRGBA(1.00, 0.36, 0.42, 0.52, 0.54);
    } else {
        bodyGrad.addColorStopRGBA(0.00, 0.74, 0.80, 0.88, 0.80);
        bodyGrad.addColorStopRGBA(0.42, 0.46, 0.53, 0.64, 0.76);
        bodyGrad.addColorStopRGBA(0.78, 0.27, 0.33, 0.43, 0.74);
        bodyGrad.addColorStopRGBA(1.00, 0.19, 0.24, 0.33, 0.58);
    }
    cr.setSource(bodyGrad);
    cr.maskSurface(turretMask, 0, 0);

    const bellyGrad = new Cairo.LinearGradient(0, SH * 0.52, 0, SH * 0.88);
    if (isStorm) {
        bellyGrad.addColorStopRGBA(0.0, 0.18, 0.21, 0.29, 0.45);
        bellyGrad.addColorStopRGBA(0.5, 0.10, 0.13, 0.20, 0.76);
        bellyGrad.addColorStopRGBA(1.0, 0.07, 0.09, 0.15, 0.55);
    } else if (isSnow) {
        bellyGrad.addColorStopRGBA(0.0, 0.46, 0.53, 0.63, 0.40);
        bellyGrad.addColorStopRGBA(0.5, 0.34, 0.41, 0.51, 0.68);
        bellyGrad.addColorStopRGBA(1.0, 0.28, 0.35, 0.45, 0.48);
    } else {
        bellyGrad.addColorStopRGBA(0.0, 0.26, 0.32, 0.42, 0.42);
        bellyGrad.addColorStopRGBA(0.5, 0.16, 0.21, 0.30, 0.72);
        bellyGrad.addColorStopRGBA(1.0, 0.12, 0.17, 0.25, 0.52);
    }
    cr.setSource(bellyGrad);
    cr.maskSurface(bellyMask, 0, 0);

    cr.$dispose();
    surface.flush();
    return surface;
}

export function createSky() {
    return {
        sprite: null, spriteAlt: null,
        precipSprite: null, precipSpriteAlt: null, precipSpriteScene: '',
        w: 0, h: 0, scene: '', night: null,
        lastTime: null, lastT: null,
        drops: [], ripples: [], flakes: [], pellets: [],
        hail: [], clouds: [], stars: [], streaks: [], leaves: [], fog: [],
        cache: null, cacheKey: '', builds: 0, blits: 0,
        fx: null, fxW: 0, fxH: 0, fxScale: null, frameMs: null, _fxFrames: 0,
        sunSprites: null, moonSprite: null, glowSprite: null, spriteBuilds: 0,
    };
}

function rebuild(sky, width, height, scene) {
    const features = SCENE_FEATURES[scene] ?? {};
    const areaScaleFactor = Math.max(0.5, Math.min(1.5, (width * height) / (1050 * 420)));
    const createList = (count, factory) =>
        Array.from({ length: Math.round(count * areaScaleFactor) }, (_, i) => factory(i));

    sky.drops = createList(features.drops ?? 0, i => {
        const layer = i % 20 < 5 ? 2 : (i % 20 < 13 ? 1 : 0);
        const length = layer === 2 ? rand(24, 38) : (layer === 1 ? rand(16, 26) : rand(10, 17));
        const speed = layer === 2 ? rand(400, 540) : (layer === 1 ? rand(300, 410) : rand(210, 290));
        return {
            x: rand(-60, width + 60), y: rand(-height, height),
            length, l: length, speed, sp: speed, layer,
        };
    });
    sky.ripples = createList(features.ripples ?? 0, () => ({
        x: rand(0.05 * width, 0.95 * width),
        y: rand(0.93 * height, 0.99 * height),
        phase: rand(0, 1),
        speed: rand(1.1, 1.8),
        maxR: rand(5, 11),
    }));
    sky.flakes = createList(features.flakes ?? 0, i => {
        // Option B Depth-Layered Hybrid: 25% foreground 6-spoke, 40% midground 6-spoke, 35% powder bokeh
        const layer = i % 20 < 5 ? 2 : (i % 20 < 13 ? 1 : 0);
        const radius = layer === 2 ? rand(3.1, 4.7) : (layer === 1 ? rand(2.0, 3.0) : rand(1.2, 2.2));
        const speed = layer === 2 ? rand(38, 62) : (layer === 1 ? rand(26, 44) : rand(16, 28));
        const phase = rand(0, TWO_PI);
        return {
            x: rand(0, width), y: rand(-height, height),
            radius, r: radius, speed, sp: speed, phase, ph: phase,
            layer, rot: rand(0, TWO_PI), rotSpeed: rand(-0.65, 0.65),
            sway: layer === 2 ? rand(14, 22) : (layer === 1 ? rand(9, 15) : rand(5, 10)),
        };
    });
    sky.pellets = createList(features.pellets ?? 0, () => ({
        x: rand(0, width + 40), y: rand(-height, height),
        radius: rand(1.5, 2.6), speed: rand(190, 310), phase: rand(0, TWO_PI),
    }));
    sky.hail = createList(features.hail ?? 0, () => ({
        x: rand(0, width), y: rand(-height, height),
        vx: rand(-40, 40), vy: rand(180, 320),
        radius: rand(2.4, 4.4), r: rand(2.4, 4.4),
        bounces: 0, b: 0,
    }));
    sky.streaks = createList(features.streaks ?? 0, () => ({
        x: rand(-width, width), y: rand(0.06 * height, 0.82 * height),
        length: rand(55, 175), l: rand(55, 175),
        speed: rand(140, 330), sp: rand(140, 330),
        width: rand(0.8, 2.0), w: rand(0.8, 2.0),
        opacity: rand(0.10, 0.28), o: rand(0.10, 0.28),
        phase: rand(0, TWO_PI),
    }));
    sky.leaves = createList(features.leaves ?? 0, i => ({
        x: rand(-width * 0.5, width), y: rand(0.12 * height, 0.86 * height),
        size: rand(5.8, 9.0), speed: rand(110, 230),
        phase: rand(0, TWO_PI), spin: rand(2.2, 4.6),
        tilt: rand(-0.5, 0.5), tone: i % 3,
    }));
    sky.fog = createList(features.fog ? 16 : 0, i => ({
        x: rand(-width, width), y: (0.16 + (i / 16) * 0.68) * height,
        length: rand(0.60, 1.25) * width, len: rand(0.60, 1.25) * width,
        speed: (i % 2 === 0 ? 1 : -0.75) * rand(10, 28), sp: rand(10, 28),
        height: rand(34, 88), ht: rand(34, 88),
        opacity: rand(0.18, 0.34), o: rand(0.18, 0.34),
        tone: i % 2, t: i % 2,
    }));
    sky.stars = createList(features.stars ? 70 : 0, () => {
        const isTwinkle = rand(0, 1) < 0.22;
        const radius = isTwinkle ? rand(3.0, 5.6) : rand(0.8, 2.0);
        const phase = rand(0, TWO_PI);
        const isCool = rand(0, 1) < 0.45;
        return {
            x: rand(0, width), y: rand(0, 0.6 * height),
            radius, r: radius, phase, ph: phase,
            isTwinkle, tw: isTwinkle, isCool, cool: isCool,
        };
    });
    const isPrecip = PRECIP_CLOUD_SCENES.has(scene);
    const rawClouds = features.clouds ?? 0;
    const cloudCount = isPrecip && rawClouds > 0
        ? Math.max(6, Math.round(rawClouds * areaScaleFactor))
        : Math.round(rawClouds * areaScaleFactor);
    const spanW = isPrecip ? width + 180 : width + 160;
    sky.clouds = Array.from({ length: cloudCount }, (_, i) => {
        const isBack = isPrecip ? i % 2 === 0 : i % 3 === 0;
        const scale = isPrecip
            ? (isBack ? rand(2.15, 2.75) : rand(1.85, 2.40))
            : (isBack ? rand(1.25, 1.85) : rand(1.35, 2.05));
        const speed = isBack ? rand(6, 13) : rand(11, 22);
        const startX = isPrecip ? -110 : -80;
        const slotX = startX + ((i + rand(0.12, 0.88)) / Math.max(1, cloudCount)) * spanW;
        const y = isPrecip
            ? (isBack ? rand(-0.03 * height, 0.08 * height) : rand(0.05 * height, 0.16 * height))
            : rand(0.01 * height, 0.20 * height);
        return {
            x: slotX, y,
            scale, s: scale, speed, sp: speed,
            variant: i % 2, isBack,
        };
    });
    sky.w = width; sky.h = height; sky.scene = scene; sky.lastTime = null; sky.lastT = null;
}

/* 4-point star flare: slim crossed diamond + bright core */
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

function roundClip(cr, width, height, radius) {
    if (radius > 0) {
        const r = Math.min(radius, width / 2, height / 2), k = 0.5523 * r;
        cr.newPath();
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

const GLOW_BREATH_MAX = 1.06;

function drawHorizonGlowRaw(cr, width, height, twilight, night, alphaScale) {
    if (twilight <= 0.01)
        return;
    const alpha = twilight * (night ? 0.42 : 0.34) * alphaScale;
    const [r, g, b] = night ? [1.0, 0.45, 0.28] : [1.0, 0.62, 0.30];
    cr.save();
    cr.translate(width * 0.7, height * 1.04);
    cr.scale(width * 0.95, height * 0.42);
    const haze = new Cairo.RadialGradient(0, 0, 0, 0, 0, 1);
    haze.addColorStopRGBA(0, r, g, b, alpha);
    haze.addColorStopRGBA(0.45, r, g * 0.92, Math.min(1, b * 1.1), alpha * 0.45);
    haze.addColorStopRGBA(1, r, g, b, 0);
    cr.setSource(haze);
    cr.arc(0, 0, 1, 0, TWO_PI);
    cr.fill();
    cr.restore();
}

function sourceSurface(cr, surf, x, y) {
    cr.setSourceSurface(surf, x, y);
    cr.getSource().setFilter(Cairo.Filter.BILINEAR);
}

function drawHorizonGlow(cr, sky, width, height, twilight, night, time) {
    if (twilight <= 0.01)
        return;
    const key = `${width}x${height}|${night ? 'n' : 'd'}|${twilight.toFixed(3)}`;
    if (!sky.glowSprite || sky.glowSprite.key !== key) {
        const surf = new Cairo.ImageSurface(
            Cairo.Format.ARGB32, Math.max(1, Math.round(width)),
            Math.max(1, Math.round(height)));
        const sc = new Cairo.Context(surf);
        drawHorizonGlowRaw(sc, width, height, twilight, night, GLOW_BREATH_MAX);
        sc.$dispose();
        surf.flush();
        sky.glowSprite = { key, surf };
        sky.spriteBuilds++;
    }
    const breath = 1 + 0.06 * Math.sin(time * 0.4);
    sourceSurface(cr, sky.glowSprite.surf, 0, 0);
    cr.paintWithAlpha(breath / GLOW_BREATH_MAX);
}

function makeCentredSprite(diameter, paint) {
    const size = Math.max(2, Math.ceil(diameter) + 2);
    const surf = new Cairo.ImageSurface(Cairo.Format.ARGB32, size, size);
    const sc = new Cairo.Context(surf);
    sc.translate(size / 2, size / 2);
    paint(sc);
    sc.$dispose();
    surf.flush();
    return { surf, half: size / 2 };
}

function blitCentred(cr, sprite, x, y, alpha = 1) {
    sourceSurface(cr, sprite.surf, x - sprite.half, y - sprite.half);
    if (alpha >= 0.999)
        cr.paint();
    else
        cr.paintWithAlpha(Math.max(0, alpha));
}

const AURA_BREATH_MAX = 0.48, CORONA_BREATH_MAX = 0.77;

function sunWarm(twilight, noon) {
    return (rgb, target) =>
        mix(mix(rgb, [1.0, 0.97, 0.86], 0.35 * noon), target, twilight);
}

function paintSunAura(cr, radius, twilight, noon) {
    const warm = sunWarm(twilight, noon);
    const auraRadius = radius * (3.6 + 1.2 * twilight);
    const aura = new Cairo.RadialGradient(0, 0, radius * 0.2, 0, 0, auraRadius);
    const auraBreath = AURA_BREATH_MAX * (1 + 0.3 * twilight);
    aura.addColorStopRGBA(0, ...warm([1.0, 0.88, 0.45], [1.0, 0.66, 0.36]), auraBreath);
    aura.addColorStopRGBA(0.35, ...warm([1.0, 0.72, 0.22], [1.0, 0.50, 0.30]), auraBreath * 0.5);
    aura.addColorStopRGBA(0.7, ...warm([1.0, 0.58, 0.12], [0.95, 0.40, 0.36]), auraBreath * 0.2);
    aura.addColorStopRGBA(1, ...warm([1.0, 0.50, 0.05], [0.90, 0.36, 0.40]), 0);
    cr.setSource(aura);
    cr.arc(0, 0, auraRadius, 0, TWO_PI);
    cr.fill();
}

function paintSunCorona(cr, radius, twilight, noon) {
    const warm = sunWarm(twilight, noon);
    const coronaRadius = radius * 1.9;
    const corona = new Cairo.RadialGradient(0, 0, radius * 0.5, 0, 0, coronaRadius);
    corona.addColorStopRGBA(0, ...warm([1.0, 0.94, 0.60], [1.0, 0.74, 0.46]), CORONA_BREATH_MAX);
    corona.addColorStopRGBA(0.5, ...warm([1.0, 0.78, 0.25], [1.0, 0.50, 0.28]), CORONA_BREATH_MAX * 0.45);
    corona.addColorStopRGBA(1, ...warm([1.0, 0.65, 0.15], [0.95, 0.38, 0.30]), 0);
    cr.setSource(corona);
    cr.arc(0, 0, coronaRadius, 0, TWO_PI);
    cr.fill();
}

function paintSunCore(cr, radius, twilight, noon) {
    const warm = sunWarm(twilight, noon);
    const coreRadius = radius * 0.85;
    const core = new Cairo.RadialGradient(
        -radius * 0.25, -radius * 0.25, radius * 0.1, 0, 0, coreRadius);
    core.addColorStopRGBA(0, ...warm([1.0, 0.99, 0.88], [1.0, 0.90, 0.66]), 1.0);
    core.addColorStopRGBA(0.45, ...warm([1.0, 0.88, 0.35], [1.0, 0.68, 0.32]), 0.98);
    core.addColorStopRGBA(0.85, ...warm([1.0, 0.70, 0.14], SUNSET_CORE), 0.96);
    core.addColorStopRGBA(1, ...warm([0.98, 0.55, 0.08], [0.94, 0.36, 0.16]), 0.90);
    cr.setSource(core);
    cr.arc(0, 0, coreRadius, 0, TWO_PI);
    cr.fill();
}

function drawSunRays(cr, sunX, sunY, radius, scale, time, twilight, noon) {
    const warm = sunWarm(twilight, noon);
    const rayCount = 16;
    const stepAngle = TWO_PI / rayCount;
    cr.save();
    cr.translate(sunX, sunY);
    cr.rotate(time * 0.03);
    for (let k = 0; k < rayCount; k++) {
        cr.save();
        cr.rotate(k * stepAngle);
        const isPrimary = k % 2 === 0;
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
}

function drawSun(cr, sky, sunX, sunY, radius, scale, time, twilight = 0, noon = 0) {
    const key = `${radius.toFixed(1)}|${twilight.toFixed(3)}|${noon.toFixed(3)}`;
    if (!sky.sunSprites || sky.sunSprites.key !== key) {
        sky.sunSprites = {
            key,
            aura: makeCentredSprite(2 * radius * (3.6 + 1.2 * twilight),
                c => paintSunAura(c, radius, twilight, noon)),
            corona: makeCentredSprite(2 * radius * 1.9,
                c => paintSunCorona(c, radius, twilight, noon)),
            core: makeCentredSprite(2 * radius * 0.85,
                c => paintSunCore(c, radius, twilight, noon)),
        };
        sky.spriteBuilds++;
    }
    const s = sky.sunSprites;
    blitCentred(cr, s.aura, sunX, sunY,
        (0.40 + 0.08 * Math.sin(time * 0.7)) / AURA_BREATH_MAX);
    drawSunRays(cr, sunX, sunY, radius, scale, time, twilight, noon);
    blitCentred(cr, s.corona, sunX, sunY,
        (0.65 + 0.12 * Math.sin(time * 1.5)) / CORONA_BREATH_MAX);
    blitCentred(cr, s.core, sunX, sunY);
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
    cr.newPath();
    paintMoon(cr, moonX, moonY, radius * 0.85, lunarPhase, 'sky');
    cr.popGroupToSource();
    cr.paintWithAlpha(MOON_COVER);
}

function drawMoonSprited(cr, sky, moonX, moonY, radius, phase) {
    const ph = Number.isFinite(phase) ? phase : moonPhase().phase;
    const key = `${radius.toFixed(1)}|${ph.toFixed(4)}`;
    if (!sky.moonSprite || sky.moonSprite.key !== key) {
        sky.moonSprite = {
            key,
            sprite: makeCentredSprite(2 * radius * 3.4,
                c => drawMoon(c, 0, 0, radius, ph)),
        };
        sky.spriteBuilds++;
    }
    blitCentred(cr, sky.moonSprite.sprite, moonX, moonY);
}

function drawStars(cr, stars, time, twilight = 0, keepOut = null) {
    const visibility = 1 - 0.85 * twilight;
    if (visibility <= 0.02)
        return;
    for (const star of stars) {
        const wave = Math.abs(Math.sin(time * 1.3 + (star.phase ?? star.ph)));
        const alpha = (0.25 + 0.5 * wave) * visibility;
        const radius = star.radius ?? star.r;
        const isTwinkle = star.isTwinkle ?? star.tw;
        const isCool = star.isCool ?? star.cool;
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

function drawBodies(cr, sky, width, height, scale, features, time, night, phase,
    twilight, solar, noon) {
    const [sunX, sunY] = sunSpot(width, height, night, solar);
    const radius = 64 * scale;
    if ((features.sun || features.moon) && !night)
        drawSun(cr, sky, sunX, sunY, radius, scale, time, twilight, noon);
    else if (features.moon)
        drawMoonSprited(cr, sky, sunX, sunY, radius, phase);
}

function drawClouds(cr, sky, width, scale, dt, time, scene, night, twilight) {
    if (!sky.clouds.length)
        return;
    const isPrecip = PRECIP_CLOUD_SCENES.has(scene);
    let sprite0, sprite1, sw, sh;
    if (isPrecip) {
        if (!sky.precipSprite || sky.precipSpriteScene !== scene) {
            sky.precipSprite = makePrecipCloudSprite(0, scene);
            sky.precipSpriteAlt = makePrecipCloudSprite(1, scene);
            sky.precipSpriteScene = scene;
        }
        sprite0 = sky.precipSprite;
        sprite1 = sky.precipSpriteAlt;
        sw = 440;
        sh = 220;
    } else {
        if (!sky.sprite)
            sky.sprite = makeCloudSprite(0);
        if (!sky.spriteAlt)
            sky.spriteAlt = makeCloudSprite(1);
        sprite0 = sky.sprite;
        sprite1 = sky.spriteAlt;
        sw = 420;
        sh = 180;
    }
    const tint = isPrecip
        ? (night ? 0.62 + 0.28 * twilight : 1)
        : (night ? 0.45 + 0.35 * twilight : 1);
    const [glowR, glowG, glowB] = night ? [1.0, 0.50, 0.46] : [1.0, 0.62, 0.48];
    const baseAlpha = isPrecip ? 0.94
        : (scene === 'clear' || scene === 'sun' ? 0.45 : (scene === 'cloud' ? 0.88 : 0.78));
    for (const cloudItem of sky.clouds) {
        const cloudSpeed = cloudItem.speed ?? cloudItem.sp;
        const cloudScale = cloudItem.scale ?? cloudItem.s;
        const cw = sw * cloudScale * 0.24 * scale;
        const ch = sh * cloudScale * 0.24 * scale;
        cloudItem.x += cloudSpeed * dt * scale;
        if (cloudItem.x > width + 40 * scale)
            cloudItem.x = -cw - 30 * scale;
        const sprite = cloudItem.variant ? sprite1 : sprite0;
        const layerFactor = cloudItem.isBack ? 0.82 : 1.0;
        cr.save();
        cr.translate(cloudItem.x, cloudItem.y + Math.sin(time * 0.3 + cloudItem.y) * 4 * scale);
        cr.scale(cw / sw, ch / sh);
        cr.setSourceSurface(sprite, 0, 0);
        cr.paintWithAlpha(baseAlpha * layerFactor * tint);
        if (twilight > 0.01) {
            cr.setSourceRGBA(glowR, glowG, glowB, (isPrecip ? 0.36 : 0.50) * twilight * layerFactor);
            cr.maskSurface(sprite, 0, 0);
        }
        cr.restore();
    }
}

/* Double-feathered horizontal fog band (no polygon edges anywhere) */
function drawSoftFogBand(cr, cx, cy, halfW, halfH, rgb, alpha) {
    if (halfW <= 1 || halfH <= 1 || alpha <= 0.005)
        return;
    cr.save();
    cr.translate(cx, cy);
    cr.scale(halfW / halfH, 1);
    const g = new Cairo.RadialGradient(0, 0, 0, 0, 0, halfH);
    g.addColorStopRGBA(0, rgb[0], rgb[1], rgb[2], alpha);
    g.addColorStopRGBA(0.45, rgb[0], rgb[1], rgb[2], alpha * 0.76);
    g.addColorStopRGBA(0.78, rgb[0], rgb[1], rgb[2], alpha * 0.28);
    g.addColorStopRGBA(1, rgb[0], rgb[1], rgb[2], 0);
    cr.setSource(g);
    cr.arc(0, 0, halfH, 0, TWO_PI);
    cr.fill();
    cr.restore();
}

/* Curved 5-tier evergreen pine silhouette for F2 fog & W1 wind */
function drawPineTree(cr, x, baseY, treeHeight, rgb, alpha, bend = 0) {
    cr.save();
    cr.setSourceRGBA(rgb[0], rgb[1], rgb[2], alpha);
    const trunkW = Math.max(1.2, treeHeight * 0.035);
    cr.newPath();
    cr.moveTo(x - trunkW, baseY);
    cr.curveTo(
        x + bend * 0.18, baseY - treeHeight * 0.30,
        x + bend * 0.45, baseY - treeHeight * 0.60,
        x + bend * 0.85, baseY - treeHeight * 0.88);
    cr.lineTo(x + bend * 0.85 + trunkW * 0.6, baseY - treeHeight * 0.88);
    cr.curveTo(
        x + bend * 0.45 + trunkW, baseY - treeHeight * 0.60,
        x + bend * 0.18 + trunkW, baseY - treeHeight * 0.30,
        x + trunkW, baseY);
    cr.closePath();
    cr.fill();

    const tiers = 5;
    for (let t = 0; t < tiers; t++) {
        const f = t / tiers;
        const hTop = 1.0 - f * 0.70;
        const hBot = 0.62 - f * 0.60;
        const topShift = bend * (hTop ** 1.35);
        const botShift = bend * (hBot ** 1.35);
        const topY = baseY - treeHeight * hTop;
        const botY = baseY - treeHeight * hBot;
        const hw = treeHeight * (0.14 + f * 0.22);
        const tiltY = (topShift - botShift) * 0.38;
        cr.newPath();
        cr.moveTo(x + topShift, topY);
        cr.curveTo(
            x + (topShift + botShift) * 0.5 - hw * 0.38, (topY + botY) * 0.5 - tiltY * 0.5,
            x + botShift - hw * 0.85, botY - tiltY - 1.5,
            x + botShift - hw, botY - tiltY);
        cr.curveTo(
            x + botShift - hw * 0.25, botY + 2.5,
            x + botShift + hw * 0.25, botY + 2.5,
            x + botShift + hw, botY + tiltY);
        cr.curveTo(
            x + botShift + hw * 0.85, botY + tiltY - 1.5,
            x + (topShift + botShift) * 0.5 + hw * 0.38, (topY + botY) * 0.5 + tiltY * 0.5,
            x + topShift, topY);
        cr.closePath();
        cr.fill();
    }
    cr.restore();
}

/* F2 Fog background: veiled sun/moon halo + two receding horizon pine
 * treelines emerging from billowing ground mist (zero star sparkles). */
function drawFogHills(cr, width, height, night) {
    const scale = height / 420;
    const sunX = width * 0.76, sunY = height * 0.16;
    const haloRadius = 125 * scale;
    const haloCol = night ? [0.74, 0.82, 0.95] : [1.0, 0.99, 0.93];
    const haloAlpha = night ? 0.26 : 0.44;
    const halo = new Cairo.RadialGradient(sunX, sunY, 2 * scale, sunX, sunY, haloRadius);
    halo.addColorStopRGBA(0, haloCol[0], haloCol[1], haloCol[2], haloAlpha);
    halo.addColorStopRGBA(0.28, haloCol[0], haloCol[1], haloCol[2], haloAlpha * 0.58);
    halo.addColorStopRGBA(0.65, haloCol[0], haloCol[1], haloCol[2], haloAlpha * 0.20);
    halo.addColorStopRGBA(1, haloCol[0], haloCol[1], haloCol[2], 0);
    cr.setSource(halo);
    cr.arc(sunX, sunY, haloRadius, 0, TWO_PI);
    cr.fill();

    const mistRgb = night ? [0.46, 0.52, 0.62] : [0.85, 0.88, 0.91];
    const treeLayers = [
        {
            baseY: 0.29 * height, skirtH: 48 * scale, offset: 0.5,
            rgb: night ? [0.10, 0.13, 0.18] : [0.38, 0.43, 0.50],
            alpha: night ? 0.56 : 0.48,
            treeScale: 1.18 * scale, seed: 31, count: 8, minH: 46, maxH: 68,
        },
        {
            baseY: 0.35 * height, skirtH: 56 * scale, offset: 0.0,
            rgb: night ? [0.06, 0.08, 0.13] : [0.27, 0.32, 0.39],
            alpha: night ? 0.74 : 0.62,
            treeScale: 1.48 * scale, seed: 73, count: 8, minH: 50, maxH: 74,
        },
    ];
    for (const layer of treeLayers) {
        const r = seededRand(layer.seed);
        const skirtBot = layer.baseY + layer.skirtH;
        const crownTop = layer.baseY - layer.maxH * layer.treeScale - 10 * scale;

        cr.pushGroup();
        cr.setSourceRGBA(layer.rgb[0], layer.rgb[1], layer.rgb[2], 1.0);
        cr.newPath();
        cr.moveTo(0, skirtBot);
        for (let x = 0; x <= width; x += 8) {
            const u = x / width;
            const y = layer.baseY - Math.sin(u * Math.PI * 2.0 + layer.seed) * 7 * scale;
            cr.lineTo(x, y);
        }
        cr.lineTo(width, skirtBot);
        cr.closePath();
        cr.fill();

        for (let i = 0; i < layer.count; i++) {
            const tx = ((i + layer.offset) / (layer.count - 1)) * width + r(-4, 4) * scale;
            const u = tx / width;
            const ridgeY = layer.baseY -
                Math.sin(u * Math.PI * 2.0 + layer.seed) * 7 * scale;
            const th = r(layer.minH, layer.maxH) * layer.treeScale;
            drawPineTree(cr, tx, ridgeY + th * 0.18, th, layer.rgb, 1.0);
        }

        cr.setOperator(Cairo.Operator.DEST_IN);
        const fade = new Cairo.LinearGradient(0, crownTop, 0, skirtBot);
        fade.addColorStopRGBA(0, 0, 0, 0, 1.0);
        fade.addColorStopRGBA(0.66, 0, 0, 0, 1.0);
        fade.addColorStopRGBA(0.84, 0, 0, 0, 0.45);
        fade.addColorStopRGBA(1.0, 0, 0, 0, 0.0);
        cr.setSource(fade);
        cr.rectangle(0, crownTop, width, skirtBot - crownTop);
        cr.fill();

        cr.popGroupToSource();
        cr.setOperator(Cairo.Operator.OVER);
        cr.paintWithAlpha(layer.alpha);

        for (let k = 0; k < 6; k++) {
            const mx = (k / 5) * width + r(-20, 20) * scale;
            const my = layer.baseY + r(-4, 10) * scale;
            drawSoftFogBand(cr, mx, my, width * 0.46, 34 * scale,
                mistRgb, night ? 0.24 : 0.34);
        }
    }
}

function drawFog(cr, sky, width, dt, time, night, scale = 1) {
    const litColor = night ? [0.55, 0.60, 0.70] : [0.94, 0.96, 0.98];
    const shadeColor = night ? [0.08, 0.10, 0.16] : [0.42, 0.47, 0.54];
    for (const fogItem of sky.fog) {
        const fogSpeed = fogItem.speed ?? fogItem.sp;
        const fogLength = fogItem.length ?? fogItem.len;
        const fogHeight = (fogItem.height ?? fogItem.ht) * scale;
        const fogOpacity = fogItem.opacity ?? fogItem.o;
        const isLit = fogItem.tone ?? fogItem.t;
        fogItem.x += fogSpeed * dt * scale;
        if (fogSpeed >= 0 && fogItem.x > width + fogLength)
            fogItem.x = -fogLength;
        else if (fogSpeed < 0 && fogItem.x < -fogLength)
            fogItem.x = width + fogLength;
        const y = fogItem.y + Math.sin(time * 0.35 + (fogItem.x + width) * 0.01) * 4 * scale;
        const tint = isLit ? litColor : shadeColor;
        drawSoftFogBand(cr, fogItem.x + fogLength / 2, y,
            fogLength / 2, fogHeight, tint, fogOpacity);
    }
}

/* Rain, Drizzle & Showers: diagonal rain curtains + 3-plane tapered streaks + splash ripples */
function drawRain(cr, sky, width, height, scale, dt, scene, code = null) {
    if (!sky.drops.length)
        return;
    const isDrizzle = code === 51 || code === 53 || code === 55;
    const speedMul = isDrizzle ? 0.68 : 1.0;
    const lenMul = isDrizzle ? 0.65 : 1.0;
    const slant = scene === 'sleet' ? 0.34 : (isDrizzle ? 0.18 : 0.28);


    const rainColor = scene === 'sleet' ? [0.66, 0.82, 0.95] : [0.74, 0.85, 0.96];
    cr.setLineCap(Cairo.LineCap.ROUND);
    for (const drop of sky.drops) {
        const speed = (drop.speed ?? drop.sp) * speedMul;
        const length = (drop.length ?? drop.l) * lenMul * scale;
        const layer = drop.layer ?? 1;
        drop.y += speed * dt * scale;
        drop.x -= speed * slant * dt * scale;
        if (drop.y > height + 24 * scale) {
            drop.y = rand(-40 * scale, -10 * scale);
            drop.x = rand(-20 * scale, width + 110 * scale);
        }
        const alpha = layer === 2 ? 0.62 : (layer === 1 ? 0.44 : 0.26);
        const lw = (layer === 2 ? 1.65 : (layer === 1 ? 1.25 : 0.90)) * scale;
        const tx = drop.x - length * slant, ty = drop.y + length;
        cr.setLineWidth(lw);
        cr.setSourceRGBA(rainColor[0], rainColor[1], rainColor[2], alpha);
        cr.moveTo(drop.x, drop.y);
        cr.lineTo(tx, ty);
        cr.stroke();
        if (layer === 2 && !isDrizzle) {
            cr.setSourceRGBA(0.92, 0.97, 1.0, alpha * 1.15);
            cr.arc(tx, ty, 1.1 * scale, 0, TWO_PI);
            cr.fill();
        }
    }

    // Subtle ground splash ripples at the bottom of the card
    for (const rp of sky.ripples) {
        rp.phase += rp.speed * dt;
        if (rp.phase >= 1) {
            rp.phase -= 1;
            rp.x = rand(0.05 * width, 0.95 * width);
            rp.y = rand(0.93 * height, 0.99 * height);
        }
        const radius = rp.maxR * rp.phase * scale;
        const alpha = (1 - rp.phase) * 0.34;
        cr.save();
        cr.translate(rp.x, rp.y);
        cr.scale(1, 0.32);
        cr.setSourceRGBA(0.84, 0.92, 0.99, alpha);
        cr.setLineWidth(1.0 * scale);
        cr.arc(0, 0, radius, 0, TWO_PI);
        cr.stroke();
        cr.restore();
    }
}

/* 6-spoke snowflake glyph matching painter.js snowFlakes() */
function drawSixSpokeFlake(cr, x, y, radius, angle, alpha, branched) {
    cr.save();
    cr.translate(x, y);
    cr.rotate(angle);
    cr.setLineCap(Cairo.LineCap.ROUND);
    cr.setLineWidth(Math.max(0.75, radius * 0.24));
    cr.setSourceRGBA(0.95, 0.98, 1.0, alpha);
    for (let k = 0; k < 6; k++) {
        const a = (k / 6) * TWO_PI;
        const ca = Math.cos(a), sa = Math.sin(a);
        cr.moveTo(0, 0);
        cr.lineTo(ca * radius, sa * radius);
        if (branched) {
            const bx = ca * radius * 0.58, by = sa * radius * 0.58;
            const bLen = radius * 0.36;
            const a1 = a + 0.58, a2 = a - 0.58;
            cr.moveTo(bx, by);
            cr.lineTo(bx + Math.cos(a1) * bLen, by + Math.sin(a1) * bLen);
            cr.moveTo(bx, by);
            cr.lineTo(bx + Math.cos(a2) * bLen, by + Math.sin(a2) * bLen);
        }
    }
    cr.stroke();
    cr.arc(0, 0, radius * 0.20, 0, TWO_PI);
    cr.fill();
    cr.restore();
}

/* Option B Depth-Layered Hybrid Snow + 1b WMO Sub-Variants (71, 73, 75/86, 77, 85) */
function drawSnow(cr, sky, width, height, scale, dt, time, code = null, variant = null) {
    if (!sky.flakes.length)
        return;
    const isLight = code === 71 || variant === 'light';
    const isHeavy = code === 75 || code === 86 || variant === 'heavy';
    const isGrains = code === 77 || variant === 'grains';
    const isShower = code === 85 || variant === 'shower';


    const speedMul = isLight ? 0.75 : (isHeavy ? 1.38 : (isGrains ? 1.55 : 1.0));
    const windShear = isHeavy ? -36 * scale : (isShower ? -14 * scale : 0);

    for (let i = 0; i < sky.flakes.length; i++) {
        if (isLight && i % 2 === 1)
            continue;
        const flake = sky.flakes[i];
        const speed = (flake.speed ?? flake.sp) * speedMul;
        const radius = (flake.radius ?? flake.r) * scale;
        const phase = flake.phase ?? flake.ph;
        const layer = flake.layer ?? 1;
        flake.y += speed * dt * scale;
        flake.x += windShear * dt;
        flake.rot = (flake.rot ?? 0) + (flake.rotSpeed ?? 0.4) * dt;
        if (flake.y > height + 14 * scale) {
            flake.y = -14 * scale;
            flake.x = rand(0, width + (isHeavy ? 60 * scale : 0));
        }
        if (flake.x < -20 * scale)
            flake.x += width + 30 * scale;

        const swayAmp = (isGrains ? 3 : (flake.sway ?? 14)) * scale;
        const drawX = flake.x + Math.sin(time * 1.2 + phase) * swayAmp;

        if (isGrains && layer !== 1) {
            cr.setSourceRGBA(0.94, 0.97, 1.0, 0.88);
            cr.arc(drawX, flake.y, Math.max(1.1 * scale, radius * 0.55), 0, TWO_PI);
            cr.fill();
            continue;
        }

        if (layer === 0) {
            // Plane 0 (35%): out-of-focus background snow powder bokeh
            const rBokeh = radius * 1.25;
            const g = new Cairo.RadialGradient(drawX, flake.y, 0, drawX, flake.y, rBokeh);
            g.addColorStopRGBA(0, 1, 1, 1, 0.55);
            g.addColorStopRGBA(0.55, 0.95, 0.98, 1, 0.25);
            g.addColorStopRGBA(1, 0.95, 0.98, 1, 0);
            cr.setSource(g);
            cr.arc(drawX, flake.y, rBokeh, 0, TWO_PI);
            cr.fill();
        } else {
            // Plane 1 (40%) & Plane 2 (25%): 6-spoke #flake icon glyphs rocking/tumbling
            const alpha = layer === 2 ? 0.92 : 0.76;
            const angle = (flake.rot ?? 0) + Math.sin(time * 1.4 + phase) * 0.35;
            drawSixSpokeFlake(cr, drawX, flake.y, radius, angle, alpha,
                layer === 2 && radius > 3.6 * scale);
        }
    }

}

/* Sleet & Freezing Rain: glinting translucent ice pellets + bottom glaze shimmer */
function drawSleetPellets(cr, sky, width, height, scale, dt) {
    if (!sky.pellets.length)
        return;
    for (const p of sky.pellets) {
        p.y += p.speed * dt * scale;
        p.x -= p.speed * 0.26 * dt * scale;
        if (p.y > height + 10 * scale) {
            p.y = -10 * scale;
            p.x = rand(0, width + 50 * scale);
        }
        const r = p.radius * scale;
        cr.setSourceRGBA(0.76, 0.88, 0.98, 0.82);
        cr.arc(p.x, p.y, r, 0, TWO_PI);
        cr.fill();
        cr.setSourceRGBA(1, 1, 1, 0.90);
        cr.arc(p.x - r * 0.28, p.y - r * 0.28, r * 0.38, 0, TWO_PI);
        cr.fill();
    }
}

/* Rimmed & glinting bouncing hailstones */
function drawHail(cr, sky, width, height, dt) {
    const gs = height / 420;
    for (const stone of sky.hail) {
        const radius = (stone.radius ?? stone.r) * gs;
        stone.vy += 900 * gs * dt;
        stone.x += stone.vx * gs * dt;
        stone.y += stone.vy * gs * dt;
        if (stone.y > height - 6 * gs - radius && stone.vy > 0) {
            stone.y = height - 6 * gs - radius;
            stone.vy *= -0.42;
            stone.vx = rand(-160, 160);
            stone.bounces = (stone.bounces ?? stone.b) + 1;
            stone.b = stone.bounces;
        }
        if ((stone.bounces ?? stone.b) > 2 || stone.x < -10 || stone.x > width + 10)
            Object.assign(stone, {
                x: rand(0, width), y: -10, vx: rand(-40, 40),
                vy: rand(180, 320), radius: rand(2.4, 4.4), r: rand(2.4, 4.4),
                bounces: 0, b: 0,
            });
        cr.setSourceRGBA(0.68, 0.80, 0.92, 0.88);
        cr.arc(stone.x, stone.y, radius * 1.12, 0, TWO_PI);
        cr.fill();
        cr.setSourceRGBA(0.95, 0.97, 1.0, 0.95);
        cr.arc(stone.x, stone.y, radius, 0, TWO_PI);
        cr.fill();
        cr.setSourceRGBA(1, 1, 1, 0.85);
        cr.arc(stone.x - radius * 0.30, stone.y - radius * 0.32, radius * 0.36, 0, TWO_PI);
        cr.fill();
    }
}

/* Smoothly-tapered cubic Bezier limb helper for organic tree trunks & boughs */
function drawSmoothLimb(cr, x0, y0, w0, cx1, cy1, cx2, cy2, x1, y1, w1) {
    const dx0 = cx1 - x0, dy0 = cy1 - y0;
    const len0 = Math.hypot(dx0, dy0) || 1;
    const nx0 = -dy0 / len0, ny0 = dx0 / len0;

    const dx1 = x1 - cx2, dy1 = y1 - cy2;
    const len1 = Math.hypot(dx1, dy1) || 1;
    const nx1 = -dy1 / len1, ny1 = dx1 / len1;

    const dxc = cx2 - x0, dyc = cy2 - y0;
    const lenc = Math.hypot(dxc, dyc) || 1;
    const nxc = -dyc / lenc, nyc = dxc / lenc;
    const wc = (w0 + w1) * 0.5;

    cr.newPath();
    cr.moveTo(x0 + nx0 * w0, y0 + ny0 * w0);
    cr.curveTo(
        cx1 + nxc * wc * 1.05, cy1 + nyc * wc * 1.05,
        cx2 + nxc * wc * 0.75, cy2 + nyc * wc * 0.75,
        x1 + nx1 * w1, y1 + ny1 * w1);
    cr.arc(x1, y1, Math.max(0.4, w1), Math.atan2(ny1, nx1), Math.atan2(-ny1, -nx1));
    cr.curveTo(
        cx2 - nxc * wc * 0.75, cy2 - nyc * wc * 0.75,
        cx1 - nxc * wc * 1.05, cy1 - nyc * wc * 1.05,
        x0 - nx0 * w0, y0 - ny0 * w0);
    cr.closePath();
}

/* Colored evergreen pine with brown bark trunk and two-tone green bough tiers */
function drawColoredPine(cr, x, baseY, treeHeight, palette, bend = 0) {
    cr.save();
    const { trunk, trunkHi, darkGreen, midGreen, lightGreen } = palette;
    const trunkW = Math.max(1.8, treeHeight * 0.048);

    drawSmoothLimb(
        cr,
        x, baseY + 3, trunkW * 0.85,
        x + bend * 0.14, baseY - treeHeight * 0.24,
        x + bend * 0.38, baseY - treeHeight * 0.52,
        x + bend * 0.72, baseY - treeHeight * 0.80, trunkW * 0.25);
    const tg = new Cairo.LinearGradient(x - trunkW, baseY, x + trunkW, baseY);
    tg.addColorStopRGBA(0, trunkHi[0], trunkHi[1], trunkHi[2], 1.0);
    tg.addColorStopRGBA(1, trunk[0], trunk[1], trunk[2], 1.0);
    cr.setSource(tg);
    cr.fill();

    const tiers = 5;
    for (let t = tiers - 1; t >= 0; t--) {
        const f = t / tiers;
        const hTop = 1.0 - f * 0.58;
        const hBot = 0.68 - f * 0.50;
        const topShift = bend * (hTop ** 1.35);
        const botShift = bend * (hBot ** 1.35);
        const topY = baseY - treeHeight * hTop;
        const botY = baseY - treeHeight * hBot;
        const hw = treeHeight * (0.14 + f * 0.22);
        const tiltY = (topShift - botShift) * 0.36;

        const g = new Cairo.LinearGradient(
            x + botShift - hw, topY, x + botShift + hw, botY + tiltY + 4);
        g.addColorStopRGBA(0, lightGreen[0], lightGreen[1], lightGreen[2], 1.0);
        g.addColorStopRGBA(0.50, midGreen[0], midGreen[1], midGreen[2], 1.0);
        g.addColorStopRGBA(1, darkGreen[0], darkGreen[1], darkGreen[2], 1.0);
        cr.setSource(g);

        cr.newPath();
        cr.moveTo(x + topShift, topY);
        cr.curveTo(
            x + (topShift + botShift) * 0.5 - hw * 0.38, (topY + botY) * 0.5 - tiltY * 0.5,
            x + botShift - hw * 0.85, botY - tiltY - 1.5,
            x + botShift - hw, botY - tiltY);
        cr.curveTo(
            x + botShift - hw * 0.25, botY + 2.5,
            x + botShift + hw * 0.25, botY + 2.5,
            x + botShift + hw, botY + tiltY);
        cr.curveTo(
            x + botShift + hw * 0.85, botY + tiltY - 1.5,
            x + (topShift + botShift) * 0.5 + hw * 0.38, (topY + botY) * 0.5 + tiltY * 0.5,
            x + topShift, topY);
        cr.closePath();
        cr.fill();
    }
    cr.restore();
}

/* Dappled oak/birch broadleaf tree with smooth curved trunk/boughs and fine micro-leaf clusters */
function drawDeciduousTree(cr, x, baseY, treeHeight, palette, bend = 0, time = 0, seed = 1) {
    cr.save();
    const { trunk, trunkHi, shadeLeaf, midLeaf, litLeaf, sunLeaf } = palette;
    const r = seededRand(seed * 131 + 7);
    const treeW = treeHeight * 0.35;
    const baseW = Math.max(2.2, treeW * 0.14);
    const forkY = baseY - treeHeight * 0.38;
    const forkX = x + bend * 0.28;

    const clusters = [
        [-treeW * 0.46, -treeHeight * 0.60, treeW * 0.36, treeHeight * 0.11, 18],
        [ treeW * 0.50, -treeHeight * 0.56, treeW * 0.38, treeHeight * 0.11, 18],
        [-treeW * 0.14, -treeHeight * 0.76, treeW * 0.46, treeHeight * 0.13, 24],
        [ treeW * 0.24, -treeHeight * 0.74, treeW * 0.44, treeHeight * 0.12, 22],
        [ treeW * 0.04, -treeHeight * 0.88, treeW * 0.38, treeHeight * 0.11, 20],
    ];

    const sScale = treeHeight / 52;
    const leafAngle = 0.18 + (bend / treeHeight) * 0.55;

    // 1. Deep shadow leaf dabs behind upper branches (batched into 1 fill)
    cr.setSourceRGBA(shadeLeaf[0], shadeLeaf[1], shadeLeaf[2], 1.0);
    cr.newPath();
    for (let cIdx = 0; cIdx < clusters.length; cIdx++) {
        const [ox, oy, rx, ry, count] = clusters[cIdx];
        const sm = (-oy / treeHeight) ** 1.25;
        const flutter = Math.sin(time * 4.6 + seed * 1.9 + cIdx * 1.4) * 1.2 * sScale;
        const cx = x + bend * sm + ox + flutter;
        const cy = baseY + oy + 2.0 * sScale;
        for (let i = 0; i < count; i++) {
            const a = r(0, TWO_PI);
            const rad = Math.sqrt(r(0, 1));
            const lx = cx + Math.cos(a) * rad * rx;
            const ly = cy + Math.sin(a) * rad * ry;
            const dabR = r(2.4, 4.0) * sScale;
            cr.save();
            cr.translate(lx, ly);
            cr.rotate(leafAngle + r(-0.18, 0.18));
            cr.scale(1.38, 0.66);
            cr.newSubPath();
            cr.arc(0, 0, dabR, 0, TWO_PI);
            cr.restore();
        }
    }
    cr.fill();

    // 2. Smooth curved trunk & graceful S-curve primary boughs
    const bg = new Cairo.LinearGradient(x - baseW * 1.5, baseY, x + baseW * 1.5, baseY);
    bg.addColorStopRGBA(0, trunkHi[0], trunkHi[1], trunkHi[2], 1.0);
    bg.addColorStopRGBA(0.7, trunk[0], trunk[1], trunk[2], 1.0);
    bg.addColorStopRGBA(1, trunk[0] * 0.82, trunk[1] * 0.82, trunk[2] * 0.82, 1.0);
    cr.setSource(bg);

    drawSmoothLimb(
        cr,
        x, baseY + 3 * sScale, baseW * 0.65,
        x + bend * 0.08, baseY - treeHeight * 0.14,
        x + bend * 0.18, baseY - treeHeight * 0.25,
        forkX, forkY, baseW * 0.45);
    cr.fill();

    const boughs = [
        [
            forkX - baseW * 0.12, forkY + 2 * sScale, baseW * 0.30,
            forkX - treeW * 0.22, forkY - treeHeight * 0.08,
            forkX - treeW * 0.38 + bend * 0.22, forkY - treeHeight * 0.16,
            x + bend * 0.56 - treeW * 0.44, baseY - treeHeight * 0.59, 0.7 * sScale,
        ],
        [
            forkX - baseW * 0.04, forkY + 1 * sScale, baseW * 0.32,
            forkX + bend * 0.12 - treeW * 0.06, forkY - treeHeight * 0.15,
            forkX + bend * 0.28 - treeW * 0.12, forkY - treeHeight * 0.27,
            x + bend * 0.74 - treeW * 0.14, baseY - treeHeight * 0.75, 0.65 * sScale,
        ],
        [
            forkX + baseW * 0.06, forkY + 1 * sScale, baseW * 0.28,
            forkX + bend * 0.16 + treeW * 0.10, forkY - treeHeight * 0.14,
            forkX + bend * 0.32 + treeW * 0.20, forkY - treeHeight * 0.25,
            x + bend * 0.78 + treeW * 0.22, baseY - treeHeight * 0.73, 0.65 * sScale,
        ],
        [
            forkX + baseW * 0.12, forkY + 2 * sScale, baseW * 0.28,
            forkX + treeW * 0.24 + bend * 0.18, forkY - treeHeight * 0.06,
            forkX + treeW * 0.44 + bend * 0.34, forkY - treeHeight * 0.14,
            x + bend * 0.80 + treeW * 0.48, baseY - treeHeight * 0.55, 0.7 * sScale,
        ],
    ];
    for (const b of boughs) {
        drawSmoothLimb(cr, b[0], b[1], b[2], b[3], b[4], b[5], b[6], b[7], b[8], b[9]);
        cr.fill();
    }

    // 3. Mid-tone & sunlit dappled micro-leaf clusters (batched into 3 fills by tone)
    const buckets = [[], [], []];
    for (let cIdx = 0; cIdx < clusters.length; cIdx++) {
        const [ox, oy, rx, ry, count] = clusters[cIdx];
        const sm = (-oy / treeHeight) ** 1.25;
        const flutter = Math.sin(time * 4.6 + seed * 1.9 + cIdx * 1.4) * 1.2 * sScale;
        const cx = x + bend * sm + ox + flutter;
        const cy = baseY + oy;
        for (let i = 0; i < count; i++) {
            const a = r(0, TWO_PI);
            const rad = Math.sqrt(r(0, 1)) * 0.90;
            const lx = cx + Math.cos(a) * rad * rx;
            const ly = cy + Math.sin(a) * rad * ry;
            const dabR = r(2.1, 3.6) * sScale;
            const rot = leafAngle + r(-0.18, 0.18);
            const isUpperLeft = Math.sin(a) < -0.15 || Math.cos(a) < -0.25;
            const isCrest = cIdx === 4 && Math.sin(a) < 0;
            const bIdx = isCrest ? 2 : (isUpperLeft ? 1 : 0);
            buckets[bIdx].push([lx, ly, dabR, rot]);
        }
    }
    const tones = [midLeaf, litLeaf, sunLeaf];
    for (let bIdx = 0; bIdx < 3; bIdx++) {
        const list = buckets[bIdx];
        if (!list.length)
            continue;
        const c = tones[bIdx];
        cr.setSourceRGBA(c[0], c[1], c[2], 1.0);
        cr.newPath();
        for (let i = 0; i < list.length; i++) {
            const [lx, ly, dabR, rot] = list[i];
            cr.save();
            cr.translate(lx, ly);
            cr.rotate(rot);
            cr.scale(1.4, 0.65);
            cr.newSubPath();
            cr.arc(0, 0, dabR, 0, TWO_PI);
            cr.restore();
        }
        cr.fill();
    }
    cr.restore();
}

/* W1 High Wind: curved slipstream currents + swaying colored evergreen/deciduous woodland + larger 3D-tumbling leaves */
function drawWindStreaks(cr, sky, width, height, dt, time, night, scale = 1) {
    // 1. Curved slipstream wisps
    for (const streakItem of sky.streaks) {
        const speed = streakItem.speed ?? streakItem.sp;
        const length = (streakItem.length ?? streakItem.l) * scale;
        const strokeWidth = (streakItem.width ?? streakItem.w) * scale;
        const opacity = streakItem.opacity ?? streakItem.o;
        const phase = streakItem.phase ?? 0;
        streakItem.x += speed * dt * scale;
        if (streakItem.x > width + length) {
            streakItem.x = -length;
            streakItem.y = rand(0.06 * height, 0.82 * height);
        }
        const wave = Math.sin(time * 2.2 + phase) * 5 * scale;
        cr.setSourceRGBA(0.86, 0.93, 0.98, opacity);
        cr.setLineWidth(strokeWidth);
        cr.setLineCap(Cairo.LineCap.ROUND);
        cr.newPath();
        cr.moveTo(streakItem.x, streakItem.y);
        cr.curveTo(
            streakItem.x + length * 0.35, streakItem.y - wave,
            streakItem.x + length * 0.70, streakItem.y + wave,
            streakItem.x + length, streakItem.y);
        cr.stroke();
    }

    // 2. Swaying mixed woodland on rolling hilly terrain (colored in day, silhouette at night)
    if (sky.leaves.length) {
        const backSil = [0.09, 0.15, 0.23];
        const frontSil = [0.05, 0.09, 0.16];
        const treeLayers = [
            {
                baseY: 0.29 * height, offset: 0.5,
                hillRgb: night ? backSil : [0.24, 0.39, 0.33],
                pinePalette: {
                    trunk: night ? backSil : [0.25, 0.18, 0.13],
                    trunkHi: night ? backSil : [0.36, 0.26, 0.19],
                    darkGreen: night ? backSil : [0.13, 0.23, 0.19],
                    midGreen: night ? backSil : [0.20, 0.32, 0.25],
                    lightGreen: night ? backSil : [0.27, 0.41, 0.31],
                },
                decidPalette: {
                    trunk: night ? backSil : [0.25, 0.18, 0.13],
                    trunkHi: night ? backSil : [0.37, 0.27, 0.19],
                    shadeLeaf: night ? backSil : [0.13, 0.23, 0.16],
                    midLeaf: night ? backSil : [0.19, 0.33, 0.22],
                    litLeaf: night ? backSil : [0.27, 0.42, 0.27],
                    sunLeaf: night ? backSil : [0.36, 0.52, 0.31],
                },
                treeScale: 1.05 * scale, seed: 37, count: 8, minH: 40, maxH: 56, bendMul: 0.80,
            },
            {
                baseY: 0.35 * height, offset: 0.0,
                hillRgb: night ? frontSil : [0.18, 0.32, 0.25],
                pinePalette: {
                    trunk: night ? frontSil : [0.20, 0.13, 0.09],
                    trunkHi: night ? frontSil : [0.31, 0.20, 0.14],
                    darkGreen: night ? frontSil : [0.09, 0.18, 0.14],
                    midGreen: night ? frontSil : [0.14, 0.27, 0.20],
                    lightGreen: night ? frontSil : [0.20, 0.35, 0.25],
                },
                decidPalette: {
                    trunk: night ? frontSil : [0.20, 0.13, 0.09],
                    trunkHi: night ? frontSil : [0.31, 0.21, 0.15],
                    shadeLeaf: night ? frontSil : [0.08, 0.17, 0.12],
                    midLeaf: night ? frontSil : [0.14, 0.27, 0.17],
                    litLeaf: night ? frontSil : [0.21, 0.38, 0.22],
                    sunLeaf: night ? frontSil : [0.31, 0.47, 0.26],
                },
                treeScale: 1.25 * scale, seed: 53, count: 8, minH: 44, maxH: 60, bendMul: 1.05,
            },
        ];
        const crownTop = 0;
        const skirtBot = 0.46 * height;
        cr.pushGroup();
        for (const layer of treeLayers) {
            const r = seededRand(layer.seed);
            const hillGrad = new Cairo.LinearGradient(0, layer.baseY - 10 * scale, 0, skirtBot);
            hillGrad.addColorStopRGBA(
                0, layer.hillRgb[0] * 1.08, layer.hillRgb[1] * 1.08, layer.hillRgb[2] * 1.08, 1.0);
            hillGrad.addColorStopRGBA(
                1, layer.hillRgb[0] * 0.88, layer.hillRgb[1] * 0.88, layer.hillRgb[2] * 0.88, 1.0);
            cr.setSource(hillGrad);
            cr.newPath();
            cr.moveTo(0, skirtBot);
            for (let x = 0; x <= width; x += 6) {
                const u = x / width;
                const y = layer.baseY - Math.sin(u * Math.PI * 1.8 + layer.seed) * 8 * scale;
                cr.lineTo(x, y);
            }
            cr.lineTo(width, skirtBot);
            cr.closePath();
            cr.fill();

            for (let i = 0; i < layer.count; i++) {
                const tx = ((i + layer.offset) / (layer.count - 1)) * width + r(-4, 4) * scale;
                const u = tx / width;
                const ridgeY = layer.baseY -
                    Math.sin(u * Math.PI * 1.8 + layer.seed) * 8 * scale;
                const th = r(layer.minH, layer.maxH) * layer.treeScale;
                const gust = 0.55 + 0.32 * Math.sin(time * 2.3 - u * 2.6 + layer.seed) +
                    0.18 * Math.sin(time * 5.1 - u * 4.2);
                const bend = (5 + gust * 8) * layer.bendMul * scale;
                const isDeciduous = (i + (layer.seed % 2)) % 3 === 1;
                if (isDeciduous) {
                    drawDeciduousTree(cr, tx, ridgeY + 3 * scale, th * 0.94,
                        layer.decidPalette, bend, time, i + layer.seed);
                } else {
                    drawColoredPine(cr, tx, ridgeY + 3 * scale, th,
                        layer.pinePalette, bend);
                }
            }
        }
        cr.setOperator(Cairo.Operator.DEST_IN);
        const fade = new Cairo.LinearGradient(0, 0.28 * height, 0, skirtBot);
        fade.addColorStopRGBA(0.0, 0, 0, 0, 1.0);
        fade.addColorStopRGBA(0.42, 0, 0, 0, 0.96);
        fade.addColorStopRGBA(0.75, 0, 0, 0, 0.32);
        fade.addColorStopRGBA(0.95, 0, 0, 0, 0.0);
        fade.addColorStopRGBA(1.0, 0, 0, 0, 0.0);
        cr.setSource(fade);
        cr.rectangle(0, crownTop, width, skirtBot - crownTop);
        cr.fill();

        cr.popGroupToSource();
        cr.setOperator(Cairo.Operator.OVER);
        cr.paintWithAlpha(night ? 0.86 : 0.94);
    }

    // 3. Larger 3D-tumbling wind-borne leaves with petiole stem + central midrib vein
    const leafPalettes = night
        ? [[0.22, 0.38, 0.26], [0.28, 0.44, 0.28], [0.38, 0.42, 0.24]]
        : [[0.28, 0.54, 0.30], [0.40, 0.64, 0.32], [0.62, 0.58, 0.24]];
    for (const leaf of sky.leaves) {
        const gust = 0.85 + 0.35 * Math.sin(time * 2.3 + leaf.phase);
        leaf.x += leaf.speed * gust * dt * scale;
        leaf.y += Math.sin(time * 3.1 + leaf.phase) * 26 * dt * scale;
        if (leaf.x > width + 24 * scale) {
            leaf.x = -24 * scale;
            leaf.y = rand(0.12 * height, 0.84 * height);
        }
        const sz = leaf.size * scale;
        const rot = leaf.tilt + Math.sin(time * 2.8 + leaf.phase) * 0.55;
        const flip = 0.28 + 0.72 * Math.abs(Math.cos(time * leaf.spin + leaf.phase));
        const col = leafPalettes[leaf.tone % 3];
        cr.save();
        cr.translate(leaf.x, leaf.y);
        cr.rotate(rot);
        cr.scale(1, flip);
        cr.setSourceRGBA(0.38, 0.28, 0.16, 0.85);
        cr.setLineWidth(0.85 * scale);
        cr.setLineCap(Cairo.LineCap.ROUND);
        cr.newPath();
        cr.moveTo(-sz * 1.35, sz * 0.08);
        cr.lineTo(-sz * 0.95, 0);
        cr.stroke();
        cr.setSourceRGBA(col[0], col[1], col[2], 0.92);
        cr.newPath();
        cr.moveTo(-sz * 1.0, 0);
        cr.curveTo(-sz * 0.35, -sz * 0.68, sz * 0.42, -sz * 0.58, sz * 1.15, 0);
        cr.curveTo(sz * 0.42, sz * 0.58, -sz * 0.35, sz * 0.68, -sz * 1.0, 0);
        cr.closePath();
        cr.fill();
        cr.setSourceRGBA(
            Math.min(1, col[0] * 1.3), Math.min(1, col[1] * 1.25),
            Math.min(1, col[2] * 1.2), 0.70);
        cr.setLineWidth(0.75 * scale);
        cr.newPath();
        cr.moveTo(-sz * 0.88, 0);
        cr.lineTo(sz * 0.88, 0);
        cr.stroke();
        cr.restore();
    }
}

/* Multi-branch forked lightning + in-cloud sheet illumination */
const BOLT_ORIGINS = [0.48, 0.28, 0.68];

function drawLightning(cr, width, height, scale, time) {
    const cycleTime = time % 3.1;
    let flashIntensity = 0;
    if (cycleTime < 0.08)
        flashIntensity = cycleTime / 0.08;
    else if (cycleTime < 0.18)
        flashIntensity = 1 - (cycleTime - 0.08) / 0.1;
    else if (cycleTime < 0.26)
        flashIntensity = 0.5 * (cycleTime - 0.18) / 0.08;
    else if (cycleTime < 0.38)
        flashIntensity = 0.5 * (1 - (cycleTime - 0.26) / 0.12);

    // Secondary in-cloud sheet lightning pulse mid-cycle (1.65s..1.95s)
    if (flashIntensity <= 0 && cycleTime > 1.65 && cycleTime < 1.95) {
        const sheet = Math.sin(((cycleTime - 1.65) / 0.30) * Math.PI);
        const sx = width * BOLT_ORIGINS[(Math.floor(time / 3.1) + 1) % 3];
        const sy = height * 0.15;
        const rad = 135 * scale;
        const g = new Cairo.RadialGradient(sx, sy, 4 * scale, sx, sy, rad);
        g.addColorStopRGBA(0, 0.92, 0.90, 1.0, 0.32 * sheet);
        g.addColorStopRGBA(0.5, 0.78, 0.76, 0.98, 0.14 * sheet);
        g.addColorStopRGBA(1, 0.70, 0.72, 0.95, 0);
        cr.setSource(g);
        cr.arc(sx, sy, rad, 0, TWO_PI);
        cr.fill();
        return;
    }
    if (flashIntensity <= 0)
        return;

    const strikeIdx = Math.floor(Math.max(0, time) / 3.1) % 3;
    const originX = width * BOLT_ORIGINS[strikeIdx];
    const originY = height * 0.05;

    // Sky-wide flash + in-cloud glow around the bolt origin
    cr.setSourceRGBA(1, 0.99, 0.92, 0.10 * flashIntensity);
    cr.paint();
    const cloudGlow = new Cairo.RadialGradient(originX, originY + 25 * scale, 4 * scale,
        originX, originY + 25 * scale, 140 * scale);
    cloudGlow.addColorStopRGBA(0, 1.0, 0.95, 0.82, 0.42 * flashIntensity);
    cloudGlow.addColorStopRGBA(0.5, 0.88, 0.82, 0.98, 0.18 * flashIntensity);
    cloudGlow.addColorStopRGBA(1, 0.80, 0.78, 0.96, 0);
    cr.setSource(cloudGlow);
    cr.arc(originX, originY + 25 * scale, 140 * scale, 0, TWO_PI);
    cr.fill();

    cr.save();
    cr.translate(originX, originY);
    cr.setLineJoin(Cairo.LineJoin.ROUND);
    cr.setLineCap(Cairo.LineCap.ROUND);

    const traceMain = () => {
        cr.newPath();
        cr.moveTo(0, 0);
        cr.lineTo(-18 * scale, 42 * scale);
        cr.lineTo(-36 * scale, 88 * scale);
        cr.lineTo(12 * scale, 96 * scale);
        cr.lineTo(-12 * scale, 152 * scale);
        cr.lineTo(-32 * scale, 218 * scale);
    };
    const traceBranches = () => {
        cr.newPath();
        cr.moveTo(-18 * scale, 42 * scale);
        cr.lineTo(16 * scale, 68 * scale);
        cr.lineTo(28 * scale, 92 * scale);
        cr.moveTo(-12 * scale, 152 * scale);
        cr.lineTo(18 * scale, 184 * scale);
        cr.lineTo(12 * scale, 208 * scale);
    };

    // Outer atmospheric glow pass
    cr.setSourceRGBA(0.88, 0.78, 1.0, 0.30 * flashIntensity);
    cr.setLineWidth(8.5 * scale);
    traceMain();
    cr.stroke();
    cr.setLineWidth(5.0 * scale);
    traceBranches();
    cr.stroke();

    // Mid golden-amber bolt pass
    cr.setSourceRGBA(1, 0.86, 0.31, flashIntensity);
    cr.setLineWidth(3.4 * scale);
    traceMain();
    cr.stroke();
    cr.setLineWidth(1.9 * scale);
    traceBranches();
    cr.stroke();

    // Hot white-gold inner core
    cr.setSourceRGBA(1, 0.98, 0.90, flashIntensity);
    cr.setLineWidth(1.4 * scale);
    traceMain();
    cr.stroke();
    cr.restore();
}

/* Paint one frame. Shares the layered wash cache, celestial sprites, and
 * adaptive FX plane across extension and app: surfaces <= 360px wide
 * (the 330px extension card) default to fxScale = 1 for crisp 1:1 pixels,
 * while larger standalone window surfaces rasterize on the downscaled FX
 * plane unless pinned with fxScale: 1. */
export function paintSky(cr, { w: width, h: height, time, scene, night, sky,
    scrim = null, radius = 0, phase = null, glow = 0, solar = null,
    code = null, variant = null, quiet = false, fxScale = null }) {
    const tStartMs = Date.now();
    const rw = Math.round(width), rh = Math.round(height);
    if (sky.scene !== scene || sky.w !== rw || sky.h !== rh)
        rebuild(sky, rw, rh, scene);

    const lastTime = sky.lastTime ?? sky.lastT;
    const dt = lastTime === null ? 0 : Math.min(0.1, time - lastTime);
    sky.lastTime = time;
    sky.lastT = time;
    const features = SCENE_FEATURES[scene] ?? {};
    const twilight = twilightOf(scene, glow);
    const noon = noonOf(scene, night, solar);
    const scale = height / 420;

    const key = `${scene}|${night ? 'n' : 'd'}|${Number(glow).toFixed(3)}`
        + `|${Number.isFinite(solar) ? solar.toFixed(3) : '-'}|`
        + `${phase === null ? '-' : Number(phase).toFixed(4)}|${rw}x${rh}`
        + `|${quiet ? 'q' : 'a'}`;
    if (!sky.cache || sky.cacheKey !== key) {
        const reuse = sky.cache
            && sky.cache.getWidth() === rw && sky.cache.getHeight() === rh;
        const surface = reuse
            ? sky.cache
            : new Cairo.ImageSurface(Cairo.Format.ARGB32, rw, rh);

        const sc = new Cairo.Context(surface);
        sc.setOperator(Cairo.Operator.CLEAR);
        sc.paint();
        sc.setOperator(Cairo.Operator.OVER);
        drawBackdrop(sc, rh, skyStops(scene, night, glow, solar));
        if (scene === 'fog')
            drawFogHills(sc, rw, rh, night);
        sc.$dispose();
        surface.flush();
        sky.cache = surface;
        sky.cacheKey = key;
        sky.builds = (sky.builds ?? 0) + 1;
    }

    cr.save();
    roundClip(cr, width, height, radius);
    cr.clip();

    const baseFx = fxScale !== null
        ? fxScale
        : (rw <= 360 || rh <= 240 ? 1 : Math.min(0.5, 900 / Math.max(1, rw)));
    if (sky.fxScale === null || sky.fxScale === undefined || fxScale !== null)
        sky.fxScale = Math.max(0.2, Math.min(1, baseFx));
    const fw = Math.max(1, Math.round(rw * sky.fxScale));
    const fh = Math.max(1, Math.round(rh * sky.fxScale));
    sky.fxW = fw; sky.fxH = fh;
    let fx = sky.fx;
    if (!fx || fx.getWidth() !== fw || fx.getHeight() !== fh)
        fx = sky.fx = new Cairo.ImageSurface(Cairo.Format.ARGB32, fw, fh);
    const fc = new Cairo.Context(fx);
    fc.scale(fw / rw, fh / rh);
    fc.setOperator(Cairo.Operator.SOURCE);
    sourceSurface(fc, sky.cache, 0, 0);
    fc.paint();
    fc.setOperator(Cairo.Operator.OVER);

    drawHorizonGlow(fc, sky, rw, rh, twilight, night, time);
    if (!quiet) {
        drawBodies(fc, sky, rw, rh, scale, features, time, night, phase,
            twilight, solar, noon);
        const hasMoon = features.moon && night;
        if (night && (features.stars || features.moon)) {
            const [sx, sy] = sunSpot(rw, rh, night, solar);
            drawStars(fc, sky.stars, time, twilight,
                hasMoon ? { x: sx, y: sy, r: 64 * scale * 0.85 } : null);
        }
        drawClouds(fc, sky, width, scale, dt, time, scene, night, twilight);
        drawFog(fc, sky, width, dt, time, night, scale);
        drawRain(fc, sky, width, height, scale, dt, scene, code);
        drawSnow(fc, sky, width, height, scale, dt, time, code, variant);
        drawSleetPellets(fc, sky, width, height, scale, dt);
        drawHail(fc, sky, width, height, dt);
        drawWindStreaks(fc, sky, width, height, dt, time, night, scale);
        if (features.bolt)
            drawLightning(fc, width, height, scale, time);
    }
    if (scrim) {
        fc.setSourceRGBA(scrim[0], scrim[1], scrim[2], scrim[3]);
        fc.paint();
    }
    fc.$dispose();
    fx.flush();

    cr.save();
    cr.scale(rw / fw, rh / fh);
    sourceSurface(cr, fx, 0, 0);
    cr.paint();
    cr.restore();
    sky.blits = (sky.blits ?? 0) + 1;
    cr.restore();

    const ms = Date.now() - tStartMs;
    sky.frameMs = sky.frameMs === null || sky.frameMs === undefined
        ? ms : sky.frameMs * 0.8 + ms * 0.2;
    if (fxScale === null && (sky._fxFrames = (sky._fxFrames ?? 0) + 1) >= 30) {
        sky._fxFrames = 0;
        if (sky.frameMs > 12 && sky.fxScale > 0.25)
            sky.fxScale = Math.max(0.25, sky.fxScale * 0.8);
        else if (sky.frameMs < 4 && sky.fxScale < baseFx)
            sky.fxScale = Math.min(baseFx, sky.fxScale * 1.25);
    }
}
