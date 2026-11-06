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
    rain: { clouds: 7, drops: 95, ripples: 28 },
    sleet: { clouds: 7, drops: 48, flakes: 28, pellets: 22, ripples: 20 },
    snow: { clouds: 7, flakes: 72 },
    hail: { clouds: 7, drops: 42, hail: 28, bolt: 1 },
    storm: { clouds: 8, drops: 120, ripples: 34, bolt: 1 },
    wind: { streaks: 18, leaves: 16, trees: 1, stars: 1, moon: 0.45 },
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

const CARD_SCENE_H = 477;
const sceneHeight = (width, height) =>
    width <= 360 ? Math.min(height, CARD_SCENE_H) : height;

function sunSpot(width, height, night, solar) {
    const sh = sceneHeight(width, height);
    const y = !night && Number.isFinite(solar) ? 0.21 - 0.09 * clamp01(solar) : 0.16;
    return [width * 0.82, sh * y];
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
    const sh = sceneHeight(width, height);
    const features = SCENE_FEATURES[scene] ?? {};
    const baseRadius = 64 * sh / 420;
    const [sunX, sunY] = sunSpot(width, height, night, solar);
    if ((features.sun || features.moon === 1) && !night)
        return {
            x: sunX, y: sunY, r: baseRadius, soft: 12,
            col: mix([1, 0.8, 0.4], SUNSET_CORE, twilightOf(scene, glow)), max: 0.9,
        };
    if (features.moon === 1 && night) {
        const lunarPhase = Number.isFinite(phase) ? phase : moonPhase().phase;
        const illum = illumOf(lunarPhase);
        const max = 0.85 * illum;
        if (max > 0.02)
            return {
                x: width * 0.82, y: sh * 0.16, r: baseRadius * 0.85, soft: 12,
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
        drops: [], ripples: [], koi: [], pads: [], flakes: [], pellets: [],
        hail: [], clouds: [], stars: [], streaks: [], leaves: [], fog: [],
        cache: null, cacheKey: '', builds: 0, blits: 0,
        fx: null, fxW: 0, fxH: 0, fxScale: null, frameMs: null, _fxFrames: 0,
        sunSprites: null, moonSprite: null, glowSprite: null, spriteBuilds: 0,
    };
}

function rebuild(sky, width, height, scene) {
    const sh = sceneHeight(width, height);
    const groundOffset = height - sh;
    const features = SCENE_FEATURES[scene] ?? {};
    const areaScaleFactor = Math.max(0.5, Math.min(1.5, (width * sh) / (1050 * 420)));
    const createList = (count, factory) =>
        Array.from({ length: Math.round(count * areaScaleFactor) }, (_, i) => factory(i));

    sky.drops = createList(features.drops ?? 0, i => {
        const layer = i % 20 < 5 ? 2 : (i % 20 < 13 ? 1 : 0);
        const length = layer === 2 ? rand(24, 38) : (layer === 1 ? rand(16, 26) : rand(10, 17));
        const speed = layer === 2 ? rand(400, 540) : (layer === 1 ? rand(300, 410) : rand(210, 290));
        const floorY = groundOffset + (layer === 0
            ? rand(0.685 * sh, 0.80 * sh)
            : (layer === 1 ? rand(0.80 * sh, 0.915 * sh) : rand(0.915 * sh, 0.992 * sh)));
        return {
            x: rand(-60, width + 60), y: rand(-height, floorY),
            length, l: length, speed, sp: speed, layer, floorY,
        };
    });
    const rippleCount = features.ripples
        ? Math.max(18, Math.round(features.ripples * areaScaleFactor))
        : 0;
    sky.ripples = Array.from({ length: rippleCount }, (_, i) => {
        const band = i % 3; // 0: distant (day-tiles top), 1: mid (day-tiles mid), 2: foreground floor
        const yMin = band === 0 ? 0.685 : (band === 1 ? 0.795 : 0.905);
        const yMax = band === 0 ? 0.795 : (band === 1 ? 0.905 : 0.990);
        return {
            x: ((i + rand(0.15, 0.85)) / Math.max(1, rippleCount)) * (width * 0.90) + width * 0.05,
            y: groundOffset + rand(yMin * sh, yMax * sh),
            band,
            phase: ((i * 0.618034) + rand(0, 0.08)) % 1,
            speed: rand(1.10, 1.70),
            maxR: rand(10, 16),
        };
    });
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
    const hailTotal = Math.round((features.hail ?? 0) * areaScaleFactor);
    sky.hail = createList(features.hail ?? 0, i => {
        const band = i % 3;
        const yMin = band === 0 ? 0.70 : (band === 1 ? 0.81 : 0.91);
        const yMax = band === 0 ? 0.81 : (band === 1 ? 0.91 : 0.99);
        const floorY = groundOffset + rand(yMin * sh, yMax * sh);
        const depth = Math.max(0, Math.min(1, (floorY - (groundOffset + 0.68 * sh)) / (0.31 * sh)));
        const radius = rand(2.5, 4.2) * (0.62 + 0.42 * depth);
        const slotX = ((i + rand(0.18, 0.82)) / Math.max(1, hailTotal)) * (width * 0.88) + width * 0.06;
        if (i % 2 === 0) {
            const bounceIdx = Math.floor(i / 2);
            const bounceAge = 0.04 + ((bounceIdx * 0.618034) % 1) * 0.16;
            const impactX = slotX;
            const dScale = 0.62 + 0.42 * depth;
            const vx = (bounceIdx % 2 === 0 ? 1 : -1) * rand(70, 110) * dScale;
            const vy0 = -rand(140, 180) * dScale;
            const gs = sh / 420;
            return {
                x: impactX + vx * bounceAge * gs,
                y: Math.min(floorY - radius * gs,
                    floorY + (vy0 * bounceAge + 0.5 * 780 * dScale * bounceAge * bounceAge) * gs),
                vx, vy: vy0 + 780 * dScale * bounceAge,
                radius, r: radius,
                bounces: 1, b: 1,
                floorY, band, impactX, bounceAge,
            };
        }
        return {
            x: slotX, y: rand(-height * 0.6, floorY * 0.85),
            vx: rand(-38, 38), vy: rand(220, 340),
            radius, r: radius,
            bounces: 0, b: 0,
            floorY, band, impactX: 0, bounceAge: 0,
        };
    });
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
    const starMaxY = scene === 'wind' ? 0.29 * sh : 0.6 * sh;
    sky.stars = createList(features.stars ? 70 : 0, () => {
        const isTwinkle = rand(0, 1) < 0.22;
        const radius = isTwinkle ? rand(3.0, 5.6) : rand(0.8, 2.0);
        const phase = rand(0, TWO_PI);
        const isCool = rand(0, 1) < 0.45;
        return {
            x: rand(0, width), y: rand(0, starMaxY),
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
            ? (isBack ? rand(-0.03 * sh, 0.08 * sh) : rand(0.05 * sh, 0.16 * sh))
            : rand(0.01 * sh, 0.20 * sh);
        return {
            x: slotX, y,
            scale, s: scale, speed, sp: speed,
            variant: i % 2, isBack,
        };
    });
    const gs = sh / 420;
    if (scene === 'rain') {
        sky.koi = [
            {
                variant: 'kohaku',
                angle: -0.14, turnBend: 0.16,
                length: 54, maxWidth: 7.0,
                baseDepth: 0.28, headZ: 0.05, tailZ: 0.45,
                swimPhase: 1.0, speed: 22, kissClock: 1.2, patrolPhase: 0.4,
                pathSpine: buildInitialKoiSpine(
                    width * 0.55, height - 83 * gs, -0.14, 0.16, 54 * gs, 0.05, 0.45),
            },
            {
                variant: 'sanke',
                angle: Math.PI + 0.12, turnBend: -0.12,
                length: 42, maxWidth: 5.6,
                baseDepth: 0.62, headZ: 0.60, tailZ: 0.70,
                swimPhase: 2.1, speed: 18, kissClock: 4.5, patrolPhase: 2.6,
                pathSpine: buildInitialKoiSpine(
                    width * 0.675, height - 45 * gs, Math.PI + 0.12, -0.12, 42 * gs, 0.60, 0.70),
            },
        ];
        sky.pads = [
            { x: width * 0.273, y: height - 48 * gs, r: 25.5, notch: 0.42, hasFlower: true, hasBud: true, companionLeaf: true },
            { x: width * 0.733, y: height - 87 * gs, r: 18.5, notch: 2.35, hasFlower: false },
        ];
    } else {
        sky.koi = [];
        sky.pads = [];
    }
    sky.w = width; sky.h = height; sky.scene = scene; sky.lastTime = null; sky.lastT = null;
}

function adjustSkyHeight(sky, width, height) {
    const oldH = sky.h;
    const deltaH = height - oldH;
    if (deltaH === 0)
        return;
    const sh = sceneHeight(width, height);
    const gs = sh / 420;
    const anchorY = 0.25 * sh;
    for (const drop of sky.drops) {
        const oldFloorY = drop.floorY ?? (oldH + 24 * gs);
        drop.floorY = oldFloorY + deltaH;
        if (drop.y > anchorY && oldFloorY > anchorY)
            drop.y = anchorY + ((drop.y - anchorY) / (oldFloorY - anchorY)) * (drop.floorY - anchorY);
    }
    for (const rp of sky.ripples)
        rp.y += deltaH;
    for (const koi of sky.koi ?? []) {
        for (const pt of koi.pathSpine)
            pt.y += deltaH;
    }
    for (const pad of sky.pads ?? [])
        pad.y += deltaH;
    for (const stone of sky.hail) {
        const oldFloorY = stone.floorY ?? (oldH - 14 * gs);
        stone.floorY = oldFloorY + deltaH;
        if ((stone.bounces ?? stone.b) >= 1)
            stone.y += deltaH;
        else if (stone.y > anchorY && oldFloorY > anchorY)
            stone.y = anchorY + ((stone.y - anchorY) / (oldFloorY - anchorY)) * (stone.floorY - anchorY);
    }
    const stretch = list => {
        if (oldH <= anchorY)
            return;
        const ratio = (height - anchorY) / (oldH - anchorY);
        for (const item of list) {
            if (item.y > anchorY)
                item.y = anchorY + (item.y - anchorY) * ratio;
        }
    };
    stretch(sky.flakes);
    stretch(sky.pellets);
    stretch(sky.fog);
    stretch(sky.streaks);
    stretch(sky.leaves);
    sky.h = height;
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

function drawStars(cr, stars, time, twilight = 0, keepOut = null, zenithHeight = 0) {
    for (const star of stars) {
        const yFrac = zenithHeight > 0 ? Math.max(0, Math.min(1, star.y / zenithHeight)) : 1;
        const visibility = zenithHeight > 0
            ? 1 - (0.25 + 0.45 * yFrac) * twilight
            : 1 - 0.85 * twilight;
        if (visibility <= 0.02)
            continue;
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
    twilight, solar, noon, scene = '', clearSky = true) {
    const sh = sceneHeight(width, height);
    const [sunX, sunY] = sunSpot(width, height, night, solar);
    const radius = 64 * scale;
    if ((features.sun || features.moon === 1) && !night) {
        drawSun(cr, sky, sunX, sunY, radius, scale, time, twilight, noon);
    } else if (features.moon && night && clearSky) {
        const moonScale = features.moon ?? 1;
        const [mx, my] = scene === 'wind'
            ? [width * 0.80, sh * 0.125]
            : [sunX, sunY];
        drawMoonSprited(cr, sky, mx, my, radius * moonScale, phase);
    }
}

function drawClouds(cr, sky, width, height, scale, dt, time, scene, night, twilight, hasBolt = false) {
    if (!sky.clouds.length) {
        if (hasBolt)
            drawLightning(cr, width, height, scale, time);
        return;
    }
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
        cloudItem.x += cloudSpeed * dt * scale;
        if (cloudItem.x > width + 40 * scale)
            cloudItem.x = -cw - 30 * scale;
    }
    const paintPass = wantBack => {
        for (const cloudItem of sky.clouds) {
            if (Boolean(cloudItem.isBack) !== wantBack)
                continue;
            const cloudScale = cloudItem.scale ?? cloudItem.s;
            const cw = sw * cloudScale * 0.24 * scale;
            const ch = sh * cloudScale * 0.24 * scale;
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
    };
    paintPass(true);
    if (hasBolt)
        drawLightning(cr, width, height, scale, time);
    paintPass(false);
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
    const sh = sceneHeight(width, height);
    const scale = sh / 420;
    const sunX = width * 0.76, sunY = sh * 0.16;
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
            baseY: 0.29 * sh, skirtH: 48 * scale, offset: 0.5,
            rgb: night ? [0.10, 0.13, 0.18] : [0.38, 0.43, 0.50],
            alpha: night ? 0.56 : 0.48,
            treeScale: 1.18 * scale, seed: 31, count: 8, minH: 46, maxH: 68,
        },
        {
            baseY: 0.35 * sh, skirtH: 56 * scale, offset: 0.0,
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

const KOI_SPINE_COUNT = 16;
const KOI_BODY_END_IDX = 12;
const KOI_BODY_PROFILE = [
    0.38, 0.64, 0.84, 0.97, 1.00, 0.93, 0.82, 0.68,
    0.53, 0.39, 0.26, 0.17, 0.11, 0.07, 0.04, 0.02,
];

function buildInitialKoiSpine(headX, headY, baseAngle, turnBend, length, headZ, tailZ) {
    const segLen = length / (KOI_SPINE_COUNT - 1);
    const pathSpine = [{ x: headX, y: headY, z: headZ }];
    for (let i = 1; i < KOI_SPINE_COUNT; i++) {
        const s = i / (KOI_SPINE_COUNT - 1);
        const a = baseAngle + turnBend * (s ** 1.15) * 0.32;
        const prev = pathSpine[i - 1];
        pathSpine.push({
            x: prev.x - Math.cos(a) * segLen,
            y: prev.y - Math.sin(a) * segLen,
            z: headZ + (tailZ - headZ) * s,
        });
    }
    return pathSpine;
}

function stepKoi(koi, dt, width, height, pondTopY, scale) {
    if (dt <= 0)
        return;
    koi.swimPhase += dt * 2.65;
    koi.patrolPhase += dt * 0.22;
    koi.kissClock += dt;

    const cycle = koi.kissClock % 9.0;
    const kissLift = koi.baseDepth < 0.40 && cycle < 2.4
        ? Math.sin((cycle / 2.4) * Math.PI) ** 1.3
        : 0;
    koi.headZ = koi.baseDepth - kissLift * (koi.baseDepth - 0.04);
    koi.tailZ = koi.baseDepth + 0.10 + kissLift * 0.07;

    const head = koi.pathSpine[0];
    const cx = width * 0.50 + Math.cos(koi.patrolPhase) * (width * 0.28);
    const laneY = height - (koi.baseDepth < 0.40 ? 82 : 48) * scale;
    const cy = laneY + Math.sin(koi.patrolPhase * 2) * (10 * scale);
    const desired = Math.atan2(cy - head.y, cx - head.x);
    let diff = desired - koi.angle;
    while (diff > Math.PI)
        diff -= TWO_PI;
    while (diff < -Math.PI)
        diff += TWO_PI;
    const maxTurn = 0.85 * dt;
    koi.angle += Math.max(-maxTurn, Math.min(maxTurn, diff * 1.8 * dt));
    koi.turnBend = koi.turnBend * Math.max(0, 1 - dt * 3)
        + (diff * 0.35) * Math.min(1, dt * 3);

    const stepDist = koi.speed * scale * dt;
    head.x = Math.max(width * 0.08, Math.min(width * 0.92,
        head.x + Math.cos(koi.angle) * stepDist));
    head.y = Math.max(pondTopY + 14 * scale, Math.min(height - 36 * scale,
        head.y + Math.sin(koi.angle) * stepDist));
    head.z = koi.headZ;

    const segLen = (koi.length * scale) / (KOI_SPINE_COUNT - 1);
    let prevAngle = koi.angle;
    for (let i = 1; i < KOI_SPINE_COUNT; i++) {
        const prev = koi.pathSpine[i - 1];
        const cur = koi.pathSpine[i];
        let segAngle = Math.atan2(prev.y - cur.y, prev.x - cur.x);
        let bDiff = segAngle - prevAngle;
        while (bDiff > Math.PI)
            bDiff -= TWO_PI;
        while (bDiff < -Math.PI)
            bDiff += TWO_PI;
        if (Math.abs(bDiff) > 0.14)
            segAngle = prevAngle + Math.sign(bDiff) * 0.14;
        cur.x = prev.x - Math.cos(segAngle) * segLen;
        cur.y = prev.y - Math.sin(segAngle) * segLen;
        cur.z = koi.headZ + (koi.tailZ - koi.headZ) * (i / (KOI_SPINE_COUNT - 1));
        prevAngle = segAngle;
    }
}

function drawSubmergedKoi(cr, koi, scale, waterRgb, turbidity) {
    const maxWidth = koi.maxWidth * scale;
    const pathSpine = koi.pathSpine;
    const sp = [];
    for (let i = 0; i < KOI_SPINE_COUNT; i++) {
        const s = i / (KOI_SPINE_COUNT - 1);
        const prev = pathSpine[Math.max(0, i - 1)];
        const next = pathSpine[Math.min(KOI_SPINE_COUNT - 1, i + 1)];
        const tx = prev.x - next.x;
        const ty = prev.y - next.y;
        const len = Math.hypot(tx, ty) || 1;
        const nx = -ty / len;
        const ny = tx / len;
        const env = s < 0.22 ? 0 : ((s - 0.22) / 0.78) ** 1.9;
        const waveOffset = Math.sin(koi.swimPhase - s * 4.0) * (maxWidth * 0.17) * env;
        sp.push({
            x: pathSpine[i].x + nx * waveOffset,
            y: pathSpine[i].y + ny * waveOffset,
            z: pathSpine[i].z,
        });
    }

    const leftPts = [], rightPts = [], angles = [];
    for (let i = 0; i < KOI_SPINE_COUNT; i++) {
        const pPrev = sp[Math.max(0, i - 1)];
        const pNext = sp[Math.min(KOI_SPINE_COUNT - 1, i + 1)];
        let tx = pPrev.x - pNext.x, ty = pPrev.y - pNext.y;
        const len = Math.hypot(tx, ty) || 1;
        tx /= len; ty /= len;
        const nx = -ty, ny = tx;
        angles.push(Math.atan2(ty, tx));
        const zScale = 1.06 - sp[i].z * 0.18;
        const hw = KOI_BODY_PROFILE[i] * maxWidth * zScale;
        leftPts.push({ x: sp[i].x + nx * hw, y: sp[i].y + ny * hw, nx, ny, hw, z: sp[i].z });
        rightPts.push({ x: sp[i].x - nx * hw, y: sp[i].y - ny * hw, nx: -nx, ny: -ny, hw, z: sp[i].z });
    }

    const headZ = sp[0].z, midZ = sp[5].z, tailZ = sp[KOI_SPINE_COUNT - 1].z;
    const subRgb = (rgb, z) => mix(rgb, waterRgb, Math.min(0.92, z * turbidity * 0.92 + 0.22));
    const subAlpha = (a, z) => a * Math.max(0.22, 0.90 - z * turbidity * 0.58);

    const traceFusiformBody = () => {
        const noseExtend = maxWidth * 0.36;
        const noseTipX = sp[0].x + Math.cos(angles[0]) * noseExtend;
        const noseTipY = sp[0].y + Math.sin(angles[0]) * noseExtend;
        const noseLeftX = noseTipX + leftPts[0].nx * leftPts[0].hw * 0.68;
        const noseLeftY = noseTipY + leftPts[0].ny * leftPts[0].hw * 0.68;
        const noseRightX = noseTipX + rightPts[0].nx * rightPts[0].hw * 0.68;
        const noseRightY = noseTipY + rightPts[0].ny * rightPts[0].hw * 0.68;

        cr.newPath();
        cr.moveTo(noseTipX, noseTipY);
        cr.curveTo(noseLeftX, noseLeftY, leftPts[0].x, leftPts[0].y, leftPts[0].x, leftPts[0].y);
        for (let i = 1; i <= KOI_BODY_END_IDX; i++)
            cr.lineTo(leftPts[i].x, leftPts[i].y);
        cr.lineTo(sp[KOI_BODY_END_IDX].x, sp[KOI_BODY_END_IDX].y);
        for (let i = KOI_BODY_END_IDX; i >= 0; i--)
            cr.lineTo(rightPts[i].x, rightPts[i].y);
        cr.curveTo(rightPts[0].x, rightPts[0].y, noseRightX, noseRightY, noseTipX, noseTipY);
        cr.closePath();
    };

    // 1. Detached pond-bed shadow
    const heightAboveBed = Math.max(0.08, 1.0 - midZ);
    const shOffX = (4 + heightAboveBed * 8) * scale;
    const shOffY = (7 + heightAboveBed * 13) * scale;
    const shAlpha = 0.32 - heightAboveBed * 0.15;
    if (shAlpha > 0.03) {
        cr.save();
        cr.translate(shOffX, shOffY);
        cr.setSourceRGBA(0.01, 0.03, 0.07, shAlpha);
        traceFusiformBody();
        cr.fill();
        cr.restore();
    }

    // 2. Swept-back teardrop pectoral fins (Munabire) with leading Oyabone ray + pelvic fins
    const fBase = [0.90, 0.91, 0.90];
    const jt3 = sp[3], ang3 = angles[3], z3 = jt3.z;
    const fCol = subRgb(fBase, z3);
    const leadCol = subRgb([0.93, 0.94, 0.93], z3);
    const fA = subAlpha(0.56, z3);
    const finSpan = maxWidth * 1.42;
    const finSweep = maxWidth * 1.25;
    for (const side of [-1, 1]) {
        const anchor = side > 0 ? leftPts[2] : rightPts[2];
        cr.save();
        cr.translate(anchor.x * 0.78 + jt3.x * 0.22, anchor.y * 0.78 + jt3.y * 0.22);
        cr.rotate(ang3);
        const fg = new Cairo.RadialGradient(0, 0, 1, -finSweep * 0.4, side * finSpan * 0.45, finSpan * 1.15);
        fg.addColorStopRGBA(0, fCol[0], fCol[1], fCol[2], fA);
        fg.addColorStopRGBA(0.65, fCol[0], fCol[1], fCol[2], fA * 0.58);
        fg.addColorStopRGBA(1, fCol[0], fCol[1], fCol[2], fA * 0.06);
        cr.setSource(fg);
        cr.newPath();
        cr.moveTo(0, 0);
        cr.curveTo(-finSweep * 0.05, side * finSpan * 0.55,
            -finSweep * 0.48, side * finSpan * 0.98, -finSweep * 0.88, side * finSpan * 0.78);
        cr.curveTo(-finSweep * 1.15, side * finSpan * 0.48,
            -finSweep * 0.95, side * finSpan * 0.14, -finSweep * 0.65, 0);
        cr.closePath();
        cr.fill();

        cr.setSourceRGBA(leadCol[0], leadCol[1], leadCol[2], fA * 0.92);
        cr.setLineWidth(Math.max(0.85, 1.15 * scale));
        cr.setLineCap(Cairo.LineCap.ROUND);
        cr.newPath();
        cr.moveTo(0, 0);
        cr.curveTo(-finSweep * 0.08, side * finSpan * 0.42,
            -finSweep * 0.35, side * finSpan * 0.72, -finSweep * 0.72, side * finSpan * 0.82);
        cr.stroke();
        cr.restore();
    }

    const jt7 = sp[7], ang7 = angles[7], z7 = jt7.z;
    const pCol = subRgb(fBase, z7);
    const pA = subAlpha(0.38, z7);
    const pSpan = maxWidth * 0.72, pSweep = maxWidth * 0.68;
    for (const side of [-1, 1]) {
        const anchor = side > 0 ? leftPts[7] : rightPts[7];
        cr.save();
        cr.translate(anchor.x * 0.80 + jt7.x * 0.20, anchor.y * 0.80 + jt7.y * 0.20);
        cr.rotate(ang7);
        cr.setSourceRGBA(pCol[0], pCol[1], pCol[2], pA);
        cr.newPath();
        cr.moveTo(0, 0);
        cr.curveTo(-pSweep * 0.1, side * pSpan * 0.5,
            -pSweep * 0.4, side * pSpan * 0.75, -pSweep * 0.75, side * pSpan * 0.65);
        cr.curveTo(-pSweep * 0.95, side * pSpan * 0.35,
            -pSweep * 0.75, side * pSpan * 0.15, -pSweep * 0.55, 0);
        cr.closePath();
        cr.fill();
        cr.restore();
    }

    // 3. Vertical-plane caudal fin (Obire) — slender silk brush along joints 11..15
    const tCol = subRgb(fBase, tailZ);
    const p11 = sp[11], p13 = sp[13], p15 = sp[15];
    const n13x = leftPts[13].nx, n13y = leftPts[13].ny;
    const n15x = leftPts[15].nx, n15y = leftPts[15].ny;
    const tailAng = angles[14];
    const backX = -Math.cos(tailAng), backY = -Math.sin(tailAng);
    const flareMid = maxWidth * 0.34, flareTip = maxWidth * 0.42, brushExt = maxWidth * 0.36;
    const tg = new Cairo.LinearGradient(
        p11.x, p11.y, p15.x + backX * brushExt, p15.y + backY * brushExt);
    tg.addColorStopRGBA(0, tCol[0], tCol[1], tCol[2], subAlpha(0.72, tailZ));
    tg.addColorStopRGBA(0.55, tCol[0], tCol[1], tCol[2], subAlpha(0.42, tailZ));
    tg.addColorStopRGBA(1, tCol[0], tCol[1], tCol[2], subAlpha(0.04, tailZ));
    cr.setSource(tg);
    cr.newPath();
    cr.moveTo(leftPts[11].x, leftPts[11].y);
    cr.curveTo(
        p13.x + n13x * flareMid, p13.y + n13y * flareMid,
        p15.x + n15x * flareTip, p15.y + n15y * flareTip,
        p15.x + backX * brushExt + n15x * flareTip, p15.y + backY * brushExt + n15y * flareTip);
    cr.lineTo(p15.x - backX * brushExt * 0.1, p15.y - backY * brushExt * 0.1);
    cr.lineTo(
        p15.x + backX * brushExt * 0.85 - n15x * flareTip * 0.88,
        p15.y + backY * brushExt * 0.85 - n15y * flareTip * 0.88);
    cr.curveTo(
        p15.x - n15x * flareTip * 0.8, p15.y - n15y * flareTip * 0.8,
        p13.x - n13x * flareMid * 0.9, p13.y - n13y * flareMid * 0.9,
        rightPts[11].x, rightPts[11].y);
    cr.closePath();
    cr.fill();

    // 4. Main fusiform body + organic rounded saddle islands over porcelain-white Shiroji skin
    cr.save();
    traceFusiformBody();
    const hCol = subRgb(fBase, headZ);
    const mCol = subRgb(fBase, midZ);
    const bg = new Cairo.LinearGradient(sp[0].x, sp[0].y, sp[KOI_BODY_END_IDX].x, sp[KOI_BODY_END_IDX].y);
    bg.addColorStopRGBA(0, hCol[0], hCol[1], hCol[2], subAlpha(0.95, headZ));
    bg.addColorStopRGBA(0.65, mCol[0], mCol[1], mCol[2], subAlpha(0.90, midZ));
    bg.addColorStopRGBA(1, tCol[0], tCol[1], tCol[2], subAlpha(0.78, tailZ));
    cr.setSource(bg);
    cr.fillPreserve();
    cr.clip();

    const markings = koi.variant === 'kohaku' ? [
        { s: 0.09, off: 0.0, rx: 0.62, ry: 0.52, col: [0.88, 0.19, 0.09] },
        { s: 0.34, off: 0.12, rx: 0.92, ry: 0.78, col: [0.88, 0.19, 0.09] },
        { s: 0.60, off: -0.10, rx: 0.72, ry: 0.64, col: [0.88, 0.19, 0.09] },
    ] : [
        { s: 0.11, off: 0.0, rx: 0.58, ry: 0.48, col: [0.87, 0.18, 0.09] },
        { s: 0.40, off: -0.14, rx: 0.88, ry: 0.72, col: [0.87, 0.18, 0.09] },
        { s: 0.25, off: 0.30, rx: 0.46, ry: 0.38, col: [0.07, 0.09, 0.12] },
        { s: 0.56, off: 0.22, rx: 0.52, ry: 0.42, col: [0.07, 0.09, 0.12] },
        { s: 0.70, off: -0.16, rx: 0.40, ry: 0.34, col: [0.07, 0.09, 0.12] },
    ];
    for (const mk of markings) {
        const fIdx = mk.s * (KOI_SPINE_COUNT - 1);
        const i0 = Math.min(KOI_BODY_END_IDX - 1, Math.floor(fIdx));
        const frac = fIdx - i0;
        const cx = sp[i0].x + (sp[i0 + 1].x - sp[i0].x) * frac;
        const cy = sp[i0].y + (sp[i0 + 1].y - sp[i0].y) * frac;
        const jz = sp[i0].z + (sp[i0 + 1].z - sp[i0].z) * frac;
        const nx = leftPts[i0].nx, ny = leftPts[i0].ny;
        const sCol = subRgb(mk.col, jz);
        const sA = subAlpha(0.92, jz);
        cr.save();
        cr.translate(cx + nx * mk.off * maxWidth, cy + ny * mk.off * maxWidth);
        cr.rotate(angles[i0]);
        cr.scale(mk.rx * maxWidth, mk.ry * maxWidth);
        cr.setSourceRGBA(sCol[0], sCol[1], sCol[2], sA);
        cr.arc(0, 0, 1, 0, TWO_PI);
        cr.fill();
        cr.restore();
    }

    const flCol = subRgb([0.03, 0.09, 0.14], midZ);
    cr.setSourceRGBA(flCol[0], flCol[1], flCol[2], subAlpha(0.30, midZ));
    cr.setLineWidth(maxWidth * 0.30);
    traceFusiformBody();
    cr.stroke();

    const dCol = subRgb([1, 1, 1], midZ);
    cr.setSourceRGBA(dCol[0], dCol[1], dCol[2], subAlpha(0.09, midZ));
    cr.setLineWidth(maxWidth * 0.60);
    cr.setLineCap(Cairo.LineCap.ROUND);
    cr.newPath();
    for (let i = 1; i <= 8; i++) {
        if (i === 1)
            cr.moveTo(sp[i].x, sp[i].y);
        else
            cr.lineTo(sp[i].x, sp[i].y);
    }
    cr.stroke();

    const vg = new Cairo.LinearGradient(sp[0].x, sp[0].y, sp[KOI_BODY_END_IDX].x, sp[KOI_BODY_END_IDX].y);
    vg.addColorStopRGBA(0, waterRgb[0], waterRgb[1], waterRgb[2], Math.max(0.14, headZ * turbidity * 0.48));
    vg.addColorStopRGBA(1, waterRgb[0], waterRgb[1], waterRgb[2], Math.max(0.28, tailZ * turbidity * 0.76));
    cr.setSource(vg);
    cr.paint();
    cr.restore();

    // 5. Delicate dorsal fin membrane (joints 5..9)
    const dfCol = subRgb([0.92, 0.93, 0.92], midZ);
    cr.setSourceRGBA(dfCol[0], dfCol[1], dfCol[2], subAlpha(0.32, midZ));
    cr.setLineWidth(Math.max(0.85, maxWidth * 0.12));
    cr.newPath();
    for (let i = 5; i <= 9; i++) {
        const sway = Math.sin(koi.swimPhase - i * 0.35) * 0.55 * scale;
        const dx = sp[i].x + leftPts[i].nx * sway;
        const dy = sp[i].y + leftPts[i].ny * sway;
        if (i === 5)
            cr.moveTo(dx, dy);
        else
            cr.lineTo(dx, dy);
    }
    cr.stroke();

    // 6. Inset lateral eyes & sensory barbels (hige)
    if (headZ < 0.72) {
        const eyeA = subAlpha(0.72, headZ);
        const p1 = sp[1];
        const nx = leftPts[1].nx, ny = leftPts[1].ny;
        const hw = leftPts[1].hw * 0.82;
        const mouthX = sp[0].x + Math.cos(angles[0]) * maxWidth * 0.30;
        const mouthY = sp[0].y + Math.sin(angles[0]) * maxWidth * 0.30;
        const bCol = subRgb([0.86, 0.70, 0.62], headZ);
        cr.setSourceRGBA(bCol[0], bCol[1], bCol[2], subAlpha(0.52, headZ));
        cr.setLineWidth(Math.max(0.65, 0.85 * scale));
        for (const side of [-1, 1]) {
            const bx0 = mouthX + nx * side * leftPts[0].hw * 0.55;
            const by0 = mouthY + ny * side * leftPts[0].hw * 0.55;
            const bAng = angles[0] + side * 0.75;
            cr.newPath();
            cr.moveTo(bx0, by0);
            cr.lineTo(bx0 + Math.cos(bAng) * 3.8 * scale, by0 + Math.sin(bAng) * 3.8 * scale);
            cr.stroke();
        }
        cr.setSourceRGBA(0.06, 0.08, 0.11, eyeA);
        for (const side of [-1, 1]) {
            cr.arc(p1.x + nx * hw * side, p1.y + ny * hw * side,
                Math.max(0.85, maxWidth * 0.12), 0, TWO_PI);
            cr.fill();
        }
    }

    // 7. Surface-kiss meniscus & concentric rings when headZ < 0.12
    if (headZ < 0.12) {
        const kissT = 1 - headZ / 0.12;
        const noseX = sp[0].x + Math.cos(angles[0]) * maxWidth * 0.38;
        const noseY = sp[0].y + Math.sin(angles[0]) * maxWidth * 0.38;
        cr.save();
        cr.translate(noseX, noseY);
        cr.scale(1, 0.38);
        cr.setSourceRGBA(0.95, 0.88, 0.68, 0.62 * kissT);
        cr.setLineWidth(1.4 * scale);
        cr.arc(0, 0, 6.5 * scale, 0, TWO_PI);
        cr.stroke();
        cr.setSourceRGBA(0.84, 0.92, 0.98, 0.42 * kissT);
        cr.setLineWidth(1.0 * scale);
        cr.arc(0, 0, 15.5 * scale, 0, TWO_PI);
        cr.stroke();
        cr.setSourceRGBA(0.80, 0.90, 0.98, 0.24 * kissT);
        cr.setLineWidth(0.85 * scale);
        cr.arc(0, 0, 26.5 * scale, 0, TWO_PI);
        cr.stroke();
        cr.restore();
    }
}

/* Layered Submersion + Surface Kiss Koi Pond Floor (0.685h .. 1.0h) */
function drawKoiPond(cr, sky, width, height, scale, dt, time, night) {
    if (!sky.koi || !sky.koi.length)
        return;
    const sh = sceneHeight(width, height);
    const groundOffset = height - sh;
    const pondTopY = groundOffset + 0.685 * sh;
    const pondH = height - pondTopY;
    if (pondH <= 4)
        return;
    const waterRgb = night ? [0.03, 0.10, 0.15] : [0.07, 0.22, 0.28];
    const turbidity = night ? 0.58 : 0.64;

    // Pass 1: Feathered pond-water depth wash (0 alpha at pondTopY so no horizon seam)
    const bedGrad = new Cairo.LinearGradient(0, pondTopY - 12 * scale, 0, height);
    bedGrad.addColorStopRGBA(0, waterRgb[0], waterRgb[1], waterRgb[2], 0);
    bedGrad.addColorStopRGBA(0.32, waterRgb[0], waterRgb[1], waterRgb[2], night ? 0.18 : 0.22);
    bedGrad.addColorStopRGBA(1, waterRgb[0] * 0.7, waterRgb[1] * 0.8, waterRgb[2] * 0.85,
        night ? 0.30 : 0.36);
    cr.setSource(bedGrad);
    cr.rectangle(0, pondTopY - 12 * scale, width, pondH + 12 * scale);
    cr.fill();

    // Pass 2: Step & render submerged Nishikigoi sorted back-to-front by midZ
    for (const koi of sky.koi)
        stepKoi(koi, dt, width, height, pondTopY, scale);
    const orderedKoi = sky.koi.slice().sort((a, b) => b.pathSpine[5].z - a.pathSpine[5].z);
    for (const koi of orderedKoi)
        drawSubmergedKoi(cr, koi, scale, waterRgb, turbidity);

    // Pass 3: Underwater shadows cast by floating lotus pads onto the water & koi below
    const pads = sky.pads ?? [];
    for (const pad of pads) {
        if (pad.companionLeaf) {
            const cr2 = 15.5 * scale;
            cr.save();
            cr.translate(pad.x - (26 - 3.5) * scale, pad.y + (18 + 6.0) * scale);
            cr.scale(1, 0.56);
            traceKoiLotusPad(cr, cr2 * 1.02, 3.6);
            cr.setSourceRGBA(0.01, 0.04, 0.07, 0.36);
            cr.fill();
            cr.restore();
        }
        const pr = pad.r * scale;
        cr.save();
        cr.translate(pad.x + 3.5 * scale, pad.y + 6.0 * scale);
        cr.scale(1, 0.56);
        traceKoiLotusPad(cr, pr * 1.02, pad.notch ?? 0.42);
        cr.setSourceRGBA(0.01, 0.04, 0.07, 0.38);
        cr.fill();
        cr.restore();
    }

    // Pass 4: Feathered underwater caustic light web + surface reflection veil + sky glare
    cr.save();
    cr.rectangle(0, pondTopY, width, pondH);
    cr.clip();
    cr.setLineWidth(1.6 * scale);
    for (let r = 0; r < 5; r++) {
        const by = pondTopY + (22 + r * 19) * scale;
        const vFade = Math.sin(((r + 0.5) / 5) * Math.PI);
        cr.setSourceRGBA(0.85, 0.97, 1.0, (night ? 0.04 : 0.06) * vFade);
        cr.newPath();
        for (let dx = 0; dx <= width; dx += 10) {
            const py = by
                + Math.sin(dx * 0.045 + time * 1.1 + r * 1.2) * 4.2 * scale
                + Math.cos(dx * 0.028 - time * 0.8 - r * 1.8) * 2.8 * scale;
            if (dx === 0)
                cr.moveTo(dx, py);
            else
                cr.lineTo(dx, py);
        }
        cr.stroke();
    }
    const veilGrad = new Cairo.LinearGradient(0, pondTopY, 0, height);
    veilGrad.addColorStopRGBA(0, waterRgb[0], waterRgb[1], waterRgb[2], 0);
    veilGrad.addColorStopRGBA(0.38, waterRgb[0], waterRgb[1], waterRgb[2], turbidity * 0.26);
    veilGrad.addColorStopRGBA(1, waterRgb[0], waterRgb[1], waterRgb[2], turbidity * 0.42);
    cr.setSource(veilGrad);
    cr.rectangle(0, pondTopY, width, pondH);
    cr.fill();
    cr.restore();

    // Pass 5: Floating foreshortened botanical lotus pads, bud & 3D Sacred Lotus blossom
    const lum = night ? 0.54 : 0.72;
    for (const pad of pads) {
        if (pad.companionLeaf) {
            drawKoiLotusPadLeaf(
                cr,
                pad.x - 26 * scale,
                pad.y + 18 * scale,
                15.5 * scale,
                3.6,
                scale,
                lum
            );
        }
        const pr = pad.r * scale;
        drawKoiLotusPadLeaf(cr, pad.x, pad.y, pr, pad.notch ?? 0.42, scale, lum);

        if (pad.hasBud) {
            drawKoiLotusBud(
                cr,
                pad.x + 18 * scale,
                pad.y - 6 * scale,
                scale,
                0.22,
                lum
            );
        }
        if (pad.hasFlower) {
            drawKoiLotusBlossom(
                cr,
                pad.x - pr * 0.06,
                pad.y - pr * 0.14,
                scale * 1.32,
                lum
            );
        }
    }
}

/* Trace a wavy/crenate botanical peltate lotus pad perimeter with a radial V-sinus notch */
function traceKoiLotusPad(cr, pr, notchAngle, gap = 0.21) {
    const a0 = notchAngle + gap;
    const a1 = notchAngle + TWO_PI - gap;
    const steps = 44;
    const hubX = Math.cos(notchAngle) * pr * 0.11;
    const hubY = Math.sin(notchAngle) * pr * 0.11;
    cr.newPath();
    cr.moveTo(hubX, hubY);
    for (let i = 0; i <= steps; i++) {
        const u = i / steps;
        const a = a0 + u * (a1 - a0);
        const edgeFade = Math.sin(u * Math.PI);
        const r = pr * (1 + 0.040 * edgeFade * Math.sin(u * 11 * TWO_PI));
        cr.lineTo(Math.cos(a) * r, Math.sin(a) * r);
    }
    cr.closePath();
}

/* Draw a single floating peltate lotus leaf with meniscus ripple, upturned rim & 11 dichotomous veins */
function drawKoiLotusPadLeaf(cr, x, y, pr, notch, scale, lum, gap = 0.21) {
    const sy = 0.56;

    // Subtle concentric water-meniscus ripple ring
    cr.save();
    cr.translate(x, y + 1.0 * scale);
    cr.scale(1, sy);
    cr.setSourceRGBA(0.66, 0.82, 0.92, 0.18 * lum);
    cr.setLineWidth(Math.max(0.6, 0.75 * scale));
    cr.newPath();
    cr.arc(0, 0, pr * 1.15, 0, TWO_PI);
    cr.stroke();
    cr.setSourceRGBA(0.66, 0.82, 0.92, 0.10 * lum);
    cr.setLineWidth(Math.max(0.5, 0.52 * scale));
    cr.newPath();
    cr.arc(0, 0, pr * 1.30, 0, TWO_PI);
    cr.stroke();
    cr.restore();

    // Upturned lower leaf rim / dark emerald underside thickness
    cr.save();
    cr.translate(x, y + 1.7 * scale);
    cr.scale(1, sy);
    traceKoiLotusPad(cr, pr, notch, gap);
    cr.setSourceRGBA(0.07 * lum, 0.20 * lum, 0.14 * lum, 0.88);
    cr.fill();
    cr.restore();

    // Main peltate leaf blade with radial botanical gradient & radiating dichotomous veins
    cr.save();
    cr.translate(x, y);
    cr.scale(1, sy);
    traceKoiLotusPad(cr, pr, notch, gap);

    const ux = Math.cos(notch) * pr * 0.08;
    const uy = Math.sin(notch) * pr * 0.08;
    const lg = new Cairo.RadialGradient(ux - pr * 0.12, uy - pr * 0.12, pr * 0.06, 0, 0, pr * 1.04);
    lg.addColorStopRGBA(0.00, 0.38 * lum, 0.64 * lum, 0.38 * lum, 0.90);
    lg.addColorStopRGBA(0.52, 0.22 * lum, 0.48 * lum, 0.30 * lum, 0.90);
    lg.addColorStopRGBA(0.86, 0.14 * lum, 0.35 * lum, 0.22 * lum, 0.90);
    lg.addColorStopRGBA(1.00, 0.19 * lum, 0.42 * lum, 0.27 * lum, 0.90);
    cr.setSource(lg);
    cr.fillPreserve();

    cr.setSourceRGBA(0.44 * lum, 0.70 * lum, 0.46 * lum, 0.44);
    cr.setLineWidth(Math.max(0.65, 0.85 * scale));
    cr.stroke();

    const numVeins = 11;
    const vGap = gap + 0.07;
    const span = TWO_PI - vGap * 2;
    cr.setLineCap(Cairo.LineCap.ROUND);
    for (let i = 0; i < numVeins; i++) {
        const va = notch + vGap + (i + 0.5) * (span / numVeins);
        const vx1 = ux + Math.cos(va) * pr * 0.62;
        const vy1 = uy + Math.sin(va) * pr * 0.62;
        const vx2 = ux + Math.cos(va) * pr * 0.88;
        const vy2 = uy + Math.sin(va) * pr * 0.88;

        cr.setSourceRGBA(0.56 * lum, 0.82 * lum, 0.54 * lum, 0.40);
        cr.setLineWidth(Math.max(0.5, 0.72 * scale));
        cr.newPath();
        cr.moveTo(ux, uy);
        cr.lineTo(vx2, vy2);
        cr.stroke();

        cr.setSourceRGBA(0.56 * lum, 0.82 * lum, 0.54 * lum, 0.26);
        cr.setLineWidth(Math.max(0.4, 0.48 * scale));
        for (const da of [-0.14, 0.14]) {
            const fx = ux + Math.cos(va + da) * pr * 0.92;
            const fy = uy + Math.sin(va + da) * pr * 0.92;
            cr.newPath();
            cr.moveTo(vx1, vy1);
            cr.lineTo(fx, fy);
            cr.stroke();
        }
    }

    cr.setSourceRGBA(0.70 * lum, 0.88 * lum, 0.58 * lum, 0.80);
    cr.newPath();
    cr.arc(ux, uy, 1.45 * scale, 0, TWO_PI);
    cr.fill();
    cr.restore();
}

/* Draw an unopened sculpted pink Sacred Lotus bud on a short curving stem */
function drawKoiLotusBud(cr, x, y, sc, tilt, lum) {
    cr.save();
    cr.translate(x, y);
    cr.scale(sc, sc);

    cr.setSourceRGBA(0.18 * lum, 0.40 * lum, 0.25 * lum, 0.88);
    cr.setLineWidth(1.4);
    cr.newPath();
    cr.moveTo(0, 5.0);
    cr.curveTo(tilt * 4.5, 1.8, tilt * 6.5, -1.5, tilt * 5.5, -4.6);
    cr.stroke();

    cr.translate(tilt * 5.5, -4.6);
    cr.rotate(tilt * 0.6);

    const bg = new Cairo.LinearGradient(0, 1.6, 0, -9.2);
    bg.addColorStopRGBA(0.0, 0.26 * lum, 0.48 * lum, 0.30 * lum, 0.90);
    bg.addColorStopRGBA(0.30, 0.66 * lum, 0.22 * lum, 0.40 * lum, 0.92);
    bg.addColorStopRGBA(0.72, 0.92 * lum, 0.52 * lum, 0.68 * lum, 0.92);
    bg.addColorStopRGBA(1.0, 1.00 * lum, 0.86 * lum, 0.92 * lum, 0.94);
    cr.setSource(bg);
    cr.newPath();
    cr.moveTo(0, 1.4);
    cr.curveTo(-3.9, -0.8, -3.5, -5.8, 0, -9.2);
    cr.curveTo(3.5, -5.8, 3.9, -0.8, 0, 1.4);
    cr.closePath();
    cr.fillPreserve();
    cr.setSourceRGBA(0.50 * lum, 0.16 * lum, 0.30 * lum, 0.36);
    cr.setLineWidth(0.45);
    cr.stroke();

    cr.setSourceRGBA(1.0 * lum, 0.82 * lum, 0.88 * lum, 0.40);
    cr.setLineWidth(0.42);
    cr.newPath();
    cr.moveTo(-0.4, 0.6);
    cr.curveTo(-1.3, -2.6, -0.9, -6.0, 0, -8.6);
    cr.stroke();
    cr.restore();
}

/* Draw a 3D cupped Sacred Lotus blossom (Nelumbo nucifera) in 3/4 pond perspective */
function drawKoiLotusBlossom(cr, x, y, sc, lum) {
    cr.save();
    cr.translate(x, y);
    cr.scale(sc, sc);

    // Soft ambient occlusion shadow on the lotus pad beneath the blossom
    const sg = new Cairo.RadialGradient(0, 2.2, 1.2, 0, 2.2, 15.5);
    sg.addColorStopRGBA(0, 0.02, 0.08, 0.05, 0.50);
    sg.addColorStopRGBA(0.6, 0.03, 0.10, 0.07, 0.24);
    sg.addColorStopRGBA(1, 0.03, 0.10, 0.07, 0.0);
    cr.setSource(sg);
    cr.save();
    cr.scale(1.0, 0.62);
    cr.newPath();
    cr.arc(0, 3.0, 15.5, 0, TWO_PI);
    cr.fill();
    cr.restore();

    const drawCuppedPetal = (dx, dy, rot, len, wid, baseCol, midCol, tipCol, alpha = 0.90) => {
        cr.save();
        cr.translate(dx, dy);
        cr.rotate(rot);

        const pg = new Cairo.LinearGradient(0, 0, 0, -len);
        pg.addColorStopRGBA(0.00, baseCol[0] * lum, baseCol[1] * lum, baseCol[2] * lum, alpha);
        pg.addColorStopRGBA(0.52, midCol[0] * lum, midCol[1] * lum, midCol[2] * lum, alpha);
        pg.addColorStopRGBA(1.00, tipCol[0] * lum, tipCol[1] * lum, tipCol[2] * lum, alpha);
        cr.setSource(pg);

        cr.newPath();
        cr.moveTo(0, 0);
        cr.curveTo(-wid * 1.12, -len * 0.30, -wid * 0.78, -len * 0.78, 0, -len);
        cr.curveTo(wid * 0.78, -len * 0.78, wid * 1.12, -len * 0.30, 0, 0);
        cr.closePath();
        cr.fillPreserve();

        cr.setSourceRGBA(0.50 * lum, 0.16 * lum, 0.30 * lum, 0.32);
        cr.setLineWidth(0.42);
        cr.stroke();

        cr.setSourceRGBA(1.0 * lum, 0.90 * lum, 0.94 * lum, 0.28);
        cr.setLineWidth(0.36);
        cr.newPath();
        cr.moveTo(0, -len * 0.16);
        cr.lineTo(0, -len * 0.86);
        cr.stroke();
        cr.restore();
    };

    // Basal green-blush calyx sepals
    drawCuppedPetal(-2.5, 1.0, -1.32, 11.2, 3.0, [0.22, 0.44, 0.28], [0.48, 0.56, 0.42], [0.78, 0.60, 0.66], 0.84);
    drawCuppedPetal(2.5, 1.0, 1.32, 11.2, 3.0, [0.22, 0.44, 0.28], [0.48, 0.56, 0.42], [0.78, 0.60, 0.66], 0.84);

    // Outer spreading whorl
    const outerBack = [
        [-2.2, -0.4, -1.12, 12.2, 3.5],
        [2.2, -0.4, 1.12, 12.2, 3.5],
        [-1.5, -1.0, -0.74, 12.6, 3.6],
        [1.5, -1.0, 0.74, 12.6, 3.6],
        [-0.7, -1.4, -0.36, 13.0, 3.7],
        [0.7, -1.4, 0.36, 13.0, 3.7],
        [0.0, -1.6, 0.00, 13.4, 3.8],
    ];
    for (const [dx, dy, rot, len, wid] of outerBack) {
        drawCuppedPetal(
            dx, dy, rot, len, wid,
            [0.60, 0.18, 0.36],
            [0.85, 0.44, 0.60],
            [0.98, 0.80, 0.88],
            0.89
        );
    }

    // Middle cupped whorl
    const midCup = [
        [-1.8, -0.2, -0.92, 10.8, 3.3],
        [1.8, -0.2, 0.92, 10.8, 3.3],
        [-1.1, -0.8, -0.54, 11.4, 3.4],
        [1.1, -0.8, 0.54, 11.4, 3.4],
        [-0.4, -1.1, -0.18, 11.8, 3.5],
        [0.4, -1.1, 0.18, 11.8, 3.5],
    ];
    for (const [dx, dy, rot, len, wid] of midCup) {
        drawCuppedPetal(
            dx, dy, rot, len, wid,
            [0.68, 0.22, 0.40],
            [0.92, 0.56, 0.70],
            [1.00, 0.90, 0.94],
            0.91
        );
    }

    // Inner upright cradle petals behind the golden receptacle
    const innerBack = [
        [-1.2, -0.4, -0.66, 9.2, 2.9],
        [1.2, -0.4, 0.66, 9.2, 2.9],
        [-0.6, -0.7, -0.28, 9.6, 3.0],
        [0.6, -0.7, 0.28, 9.6, 3.0],
        [0.0, -0.9, 0.00, 9.8, 3.1],
    ];
    for (const [dx, dy, rot, len, wid] of innerBack) {
        drawCuppedPetal(
            dx, dy, rot, len, wid,
            [0.76, 0.28, 0.46],
            [0.96, 0.66, 0.78],
            [1.00, 0.95, 0.97],
            0.92
        );
    }

    // Golden stamen crown & flat-topped Sacred Lotus seed-pod receptacle
    cr.save();
    cr.translate(0, -1.6);
    const numStamens = 18;
    for (let i = 0; i < numStamens; i++) {
        const sa = (i / numStamens) * TWO_PI;
        const sx0 = Math.cos(sa) * 2.4;
        const sy0 = Math.sin(sa) * 1.5;
        const sx1 = Math.cos(sa) * 4.8;
        const sy1 = Math.sin(sa) * 3.0 - 0.7;
        cr.setSourceRGBA(0.95 * lum, 0.74 * lum, 0.18 * lum, 0.88);
        cr.setLineWidth(0.56);
        cr.newPath();
        cr.moveTo(sx0, sy0);
        cr.lineTo(sx1, sy1);
        cr.stroke();

        cr.setSourceRGBA(1.0 * lum, 0.92 * lum, 0.54 * lum, 0.90);
        cr.newPath();
        cr.arc(sx1, sy1, 0.50, 0, TWO_PI);
        cr.fill();
    }

    const rg = new Cairo.RadialGradient(-0.7, -0.6, 0.3, 0, 0, 3.2);
    rg.addColorStopRGBA(0, 0.98 * lum, 0.88 * lum, 0.34 * lum, 0.92);
    rg.addColorStopRGBA(0.7, 0.86 * lum, 0.68 * lum, 0.16 * lum, 0.92);
    rg.addColorStopRGBA(1, 0.62 * lum, 0.46 * lum, 0.10 * lum, 0.92);
    cr.setSource(rg);
    cr.save();
    cr.scale(1.0, 0.66);
    cr.newPath();
    cr.arc(0, 0, 3.1, 0, TWO_PI);
    cr.fill();
    cr.setSourceRGBA(0.46 * lum, 0.32 * lum, 0.06 * lum, 0.72);
    for (const [dx, dy] of [[0, 0], [-1.3, -0.6], [1.3, -0.6], [-0.9, 1.0], [0.9, 1.0], [0, -1.3]]) {
        cr.newPath();
        cr.arc(dx, dy, 0.35, 0, TWO_PI);
        cr.fill();
    }
    cr.restore();
    cr.restore();

    // Foreshortened front spreading & cupped petals
    const frontOuter = [
        [-2.0, 0.8, -1.88, 9.6, 3.5],
        [2.0, 0.8, 1.88, 9.6, 3.5],
        [-1.1, 1.2, -2.42, 8.2, 3.6],
        [1.1, 1.2, 2.42, 8.2, 3.6],
        [0.0, 1.4, Math.PI, 7.6, 3.8],
    ];
    for (const [dx, dy, rot, len, wid] of frontOuter) {
        drawCuppedPetal(
            dx, dy, rot, len, wid,
            [0.64, 0.20, 0.38],
            [0.88, 0.50, 0.66],
            [0.99, 0.86, 0.92],
            0.89
        );
    }

    const frontInner = [
        [-1.3, 0.5, -2.12, 6.4, 3.0],
        [1.3, 0.5, 2.12, 6.4, 3.0],
        [0.0, 0.8, Math.PI, 5.6, 3.2],
    ];
    for (const [dx, dy, rot, len, wid] of frontInner) {
        drawCuppedPetal(
            dx, dy, rot, len, wid,
            [0.72, 0.26, 0.44],
            [0.94, 0.62, 0.74],
            [1.00, 0.93, 0.96],
            0.90
        );
    }

    cr.restore();
}

/* Exclusion zone around floating koi-pond lotus pads & blossoms so raindrops & splash droplets never paint over them */
function isKoiPadZone(x, y, sky, scale) {
    for (const pad of sky.pads ?? []) {
        const pr = pad.r * scale;
        const dx = (x - pad.x) / (pr * 1.25);
        const dy = (y - (pad.y - (pad.hasFlower ? 4 * scale : 0))) / (pr * (pad.hasFlower ? 0.95 : 0.72));
        if (dx * dx + dy * dy < 1)
            return true;
        if (pad.companionLeaf) {
            const cx = pad.x - 26 * scale;
            const cy = pad.y + 18 * scale;
            const cr2 = 15.5 * scale;
            const cdx = (x - cx) / (cr2 * 1.20);
            const cdy = (y - cy) / (cr2 * 0.72);
            if (cdx * cdx + cdy * cdy < 1)
                return true;
        }
    }
    return false;
}

/* Exclusion zone around T3 storm foreground elements (sparrow sheltering under lotus flower on pad & lotus clusters) so raindrops & splash droplets never paint over them */
function isStormForegroundZone(x, y, width, height, scale) {
    if (Math.abs(x - width * 0.258) < 38 * scale && y > height - 102 * scale && y < height - 12 * scale)
        return true;
    if (Math.abs(x - width * 0.500) < 26 * scale && Math.abs(y - (height - 89 * scale)) < 18 * scale)
        return true;
    if (Math.abs(x - width * 0.733) < 23 * scale && Math.abs(y - (height - 95 * scale)) < 16 * scale)
        return true;
    if (x > width * 0.733 - 46 * scale && x < width * 0.733 + 34 * scale &&
        y > height - 70 * scale && y < height - 12 * scale)
        return true;
    return false;
}

/* Rain, Drizzle & Showers: 3-tier WMO intensity + connected raindrop-to-ripple impacts + koi pond */
function drawRain(cr, sky, width, height, scale, dt, scene, code = null, time = 0, night = false) {
    if (!sky.drops.length)
        return;
    if (scene === 'rain')
        drawKoiPond(cr, sky, width, height, scale, dt, time, night);

    const isLightRain = code === 51 || code === 56 || code === 61 || code === 80;
    const isModRain = code === 53 || code === 63 || code === 66 || code === 81;
    const isHeavyRain = code === 55 || code === 57 || code === 65 || code === 67
        || code === 82 || (code !== null && code >= 95);
    const isDrizzle = code === 51 || code === 53 || code === 55;
    const activeFrac = isLightRain ? 0.32 : (isModRain ? 0.64 : 1.0);
    const speedMul = isDrizzle ? 0.68 : (isLightRain ? 0.74 : (isHeavyRain ? 1.26 : 1.0));
    const lenMul = isDrizzle ? 0.65 : (isLightRain ? 0.72 : (isHeavyRain ? 1.18 : 1.0));
    const slant = scene === 'sleet'
        ? 0.34
        : (isDrizzle || isLightRain ? 0.17 : (isHeavyRain ? 0.32 : (code === null ? 0.28 : 0.25)));
    const isSlotActive = i => i === 0 || Math.floor((i + 1) * activeFrac) > Math.floor(i * activeFrac);

    for (let i = 0; i < sky.ripples.length; i++) {
        if (!isSlotActive(i))
            continue;
        sky.ripples[i].phase += sky.ripples[i].speed * dt;
    }

    const spawnImpactRipple = (impactX, impactY, layer) => {
        let bestRp = null;
        let bestPhase = 0.45;
        for (let i = 0; i < sky.ripples.length; i++) {
            if (!isSlotActive(i))
                continue;
            const rp = sky.ripples[i];
            if (rp.phase > bestPhase) {
                bestPhase = rp.phase;
                bestRp = rp;
            }
        }
        if (bestRp) {
            bestRp.x = Math.max(0.05 * width, Math.min(0.95 * width, impactX));
            bestRp.y = impactY;
            bestRp.band = layer;
            bestRp.phase = 0.02;
        }
    };

    const rainColor = scene === 'sleet' ? [0.66, 0.82, 0.95] : [0.74, 0.85, 0.96];
    cr.setLineCap(Cairo.LineCap.ROUND);
    for (let i = 0; i < sky.drops.length; i++) {
        if (!isSlotActive(i))
            continue;
        const drop = sky.drops[i];
        const speed = (drop.speed ?? drop.sp) * speedMul;
        const length = (drop.length ?? drop.l) * lenMul * scale;
        const layer = drop.layer ?? 1;
        const maxFloorY = drop.floorY ?? (height + 24 * scale);
        drop.y += speed * dt * scale;
        drop.x -= speed * slant * dt * scale;
        if (drop.y + length > maxFloorY) {
            if (dt > 0) {
                const impactX = drop.x - Math.max(0, maxFloorY - drop.y) * slant;
                spawnImpactRipple(impactX, maxFloorY, layer);
            }
            drop.y = rand(-45 * scale, -10 * scale);
            drop.x = rand(-20 * scale, width + 110 * scale);
        }
        const alpha = layer === 2 ? 0.62 : (layer === 1 ? 0.44 : 0.28);
        const lw = (layer === 2 ? 1.65 : (layer === 1 ? 1.25 : 0.92)) * scale;
        const tx = drop.x - length * slant, ty = drop.y + length;
        if (scene === 'storm' && (
            isStormForegroundZone(tx, ty, width, height, scale) ||
            isStormForegroundZone((drop.x + tx) * 0.5, (drop.y + ty) * 0.5, width, height, scale) ||
            isStormForegroundZone(drop.x, drop.y, width, height, scale)
        ))
            continue;
        if (scene === 'rain' && (
            isKoiPadZone(tx, ty, sky, scale) ||
            isKoiPadZone((drop.x + tx) * 0.5, (drop.y + ty) * 0.5, sky, scale)
        ))
            continue;
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

    // Perspective-graded ground splashes & ripples from day-tiles top (0.685h) to card floor (0.99h)
    const sh = sceneHeight(width, height);
    const groundOffset = height - sh;
    for (let i = 0; i < sky.ripples.length; i++) {
        if (!isSlotActive(i))
            continue;
        const rp = sky.ripples[i];
        if (rp.phase >= 1)
            continue;
        if (scene === 'storm' && isStormForegroundZone(rp.x, rp.y, width, height, scale))
            continue;
        if (scene === 'rain' && isKoiPadZone(rp.x, rp.y, sky, scale))
            continue;
        const depth = Math.max(0, Math.min(1, (rp.y - (groundOffset + 0.68 * sh)) / (0.31 * sh)));
        const pScale = (0.52 + 0.54 * depth) * scale;
        const pAlpha = 0.52 + 0.38 * depth;
        const squash = 0.28 + 0.10 * depth;
        const radius = (1.5 + rp.maxR * rp.phase) * pScale;
        const alpha = (1 - rp.phase) * pAlpha;

        cr.save();
        cr.translate(rp.x, rp.y);
        cr.scale(1, squash);
        cr.setSourceRGBA(0.86, 0.94, 1.0, alpha);
        cr.setLineWidth(Math.max(0.85, 1.35 * pScale));
        cr.newPath();
        cr.arc(0, 0, radius, 0, TWO_PI);
        cr.stroke();
        if (rp.phase > 0.12) {
            cr.setSourceRGBA(0.90, 0.96, 1.0, alpha * 0.68);
            cr.setLineWidth(Math.max(0.70, 1.05 * pScale));
            cr.newPath();
            cr.arc(0, 0, radius * 0.50, 0, TWO_PI);
            cr.stroke();
        }
        cr.restore();

        if (rp.phase < 0.40) {
            const pSplash = rp.phase / 0.40;
            const arcLift = Math.sin(pSplash * Math.PI);
            const sAlpha = (1 - pSplash * 0.52) * Math.min(0.95, pAlpha * 1.12);
            const spread = (2.2 + 5.2 * pSplash) * pScale;
            const lift = (2.2 + 5.4 * arcLift) * pScale;

            cr.save();
            cr.setLineCap(Cairo.LineCap.ROUND);
            cr.setLineWidth(Math.max(0.85, 1.25 * pScale));
            cr.setSourceRGBA(0.90, 0.96, 1.0, sAlpha * 0.88);
            cr.newPath();
            cr.moveTo(rp.x - spread * 0.45, rp.y - lift * 0.28);
            cr.lineTo(rp.x - spread, rp.y - lift);
            cr.moveTo(rp.x + spread * 0.45, rp.y - lift * 0.28);
            cr.lineTo(rp.x + spread, rp.y - lift);
            cr.stroke();

            const beadR = Math.max(0.75, 1.15 * pScale);
            cr.setSourceRGBA(0.95, 0.99, 1.0, sAlpha);
            cr.newPath();
            cr.arc(rp.x - spread * 1.08, rp.y - lift * 1.06, beadR, 0, TWO_PI);
            cr.newSubPath();
            cr.arc(rp.x + spread * 1.08, rp.y - lift * 1.06, beadR, 0, TWO_PI);
            cr.newSubPath();
            cr.arc(rp.x, rp.y - lift * 1.26, beadR * 0.90, 0, TWO_PI);
            cr.fill();
            cr.restore();
        }
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

/* Rimmed & glinting bouncing hailstones with floor impact rings and ice-chip bursts */
function drawHail(cr, sky, width, height, dt) {
    const sh = sceneHeight(width, height);
    const groundOffset = height - sh;
    const gs = sh / 420;
    for (const stone of sky.hail) {
        const radius = (stone.radius ?? stone.r) * gs;
        const floorY = stone.floorY ?? (height - 14 * gs);
        const depth = Math.max(0, Math.min(1, (floorY - (groundOffset + 0.68 * sh)) / (0.31 * sh)));
        const dScale = (0.62 + 0.42 * depth) * gs;
        const dAlpha = 0.60 + 0.38 * depth;
        stone.vy += 780 * (0.62 + 0.42 * depth) * gs * dt;
        stone.x += stone.vx * gs * dt;
        stone.y += stone.vy * gs * dt;
        if ((stone.bounces ?? stone.b) >= 1)
            stone.bounceAge = (stone.bounceAge ?? 0) + dt;

        if (stone.y > floorY - radius && stone.vy > 0) {
            stone.y = floorY - radius;
            const prevBounces = stone.bounces ?? stone.b;
            const bounceMul = 0.62 + 0.42 * depth;
            stone.vy = prevBounces === 0
                ? -Math.max(145 * bounceMul, Math.abs(stone.vy) * 0.52)
                : -Math.max(90 * bounceMul, Math.abs(stone.vy) * 0.38);
            stone.vx = (stone.vx >= 0 ? 1 : -1) * rand(70, 110) * bounceMul;
            stone.bounces = prevBounces + 1;
            stone.b = stone.bounces;
            stone.impactX = stone.x;
            stone.bounceAge = 0.01;
        }
        if ((stone.bounces ?? stone.b) > 2 || stone.x < -10 || stone.x > width + 10) {
            const band = stone.band ?? 2;
            const yMin = band === 0 ? 0.70 : (band === 1 ? 0.81 : 0.91);
            const yMax = band === 0 ? 0.81 : (band === 1 ? 0.91 : 0.99);
            const nextFloor = groundOffset + rand(yMin * sh, yMax * sh);
            const nextDepth = Math.max(0, Math.min(1, (nextFloor - (groundOffset + 0.68 * sh)) / (0.31 * sh)));
            const nextRad = rand(2.5, 4.2) * (0.62 + 0.42 * nextDepth);
            Object.assign(stone, {
                x: rand(0.06 * width, 0.94 * width), y: -10, vx: rand(-38, 38),
                vy: rand(220, 340), radius: nextRad, r: nextRad,
                bounces: 0, b: 0, floorY: nextFloor, impactX: 0, bounceAge: 0,
            });
        }

        const bCount = stone.bounces ?? stone.b;
        const bAge = stone.bounceAge ?? 0;
        if (bCount >= 1 && bAge > 0 && bAge < 0.32) {
            const ix = stone.impactX || stone.x;
            const pRing = Math.min(1, bAge / 0.32);
            const rAlpha = (1 - pRing) * 0.86 * dAlpha;
            cr.save();
            cr.translate(ix, floorY);
            cr.scale(1, 0.28 + 0.10 * depth);
            cr.setSourceRGBA(0.90, 0.96, 1.0, rAlpha);
            cr.setLineWidth(Math.max(0.85, 1.4 * dScale));
            cr.newPath();
            cr.arc(0, 0, (3.5 + 12.5 * pRing) * dScale, 0, TWO_PI);
            cr.stroke();
            if (pRing > 0.15) {
                cr.setSourceRGBA(0.90, 0.96, 1.0, rAlpha * 0.58);
                cr.setLineWidth(Math.max(0.70, 1.0 * dScale));
                cr.newPath();
                cr.arc(0, 0, (1.8 + 6.0 * pRing) * dScale, 0, TWO_PI);
                cr.stroke();
            }
            cr.restore();

            if (bAge < 0.22) {
                const pChip = bAge / 0.22;
                const cAlpha = (1 - pChip) * 0.92 * dAlpha;
                const spread = (2.8 + 6.5 * pChip) * dScale;
                const lift = (2.0 + 4.8 * Math.sin(pChip * Math.PI)) * dScale;
                cr.save();
                cr.setLineCap(Cairo.LineCap.ROUND);
                cr.setLineWidth(Math.max(0.8, 1.2 * dScale));
                cr.setSourceRGBA(0.92, 0.97, 1.0, cAlpha * 0.82);
                cr.newPath();
                cr.moveTo(ix - spread * 0.45, floorY - lift * 0.30);
                cr.lineTo(ix - spread, floorY - lift);
                cr.moveTo(ix + spread * 0.45, floorY - lift * 0.30);
                cr.lineTo(ix + spread, floorY - lift);
                cr.stroke();

                cr.setSourceRGBA(0.96, 0.99, 1.0, cAlpha);
                cr.newPath();
                cr.arc(ix - spread * 1.12, floorY - lift * 1.08, Math.max(0.75, 1.2 * dScale), 0, TWO_PI);
                cr.newSubPath();
                cr.arc(ix + spread * 1.12, floorY - lift * 1.08, Math.max(0.75, 1.2 * dScale), 0, TWO_PI);
                cr.fill();
                cr.restore();
            }

            // Detached airborne motion wake behind the rebounding stone
            const dx = stone.x - ix;
            const dy = stone.y - floorY;
            if (Math.hypot(dx, dy) > radius * 2.0) {
                const startX = ix + dx * 0.32;
                const startY = floorY + dy * 0.45;
                const endX = ix + dx * 0.82;
                const endY = floorY + dy * 0.86;
                const ctrlX = ix + dx * 0.52;
                const ctrlY = Math.min(startY, endY) - 2.5 * dScale;
                cr.save();
                cr.setLineCap(Cairo.LineCap.ROUND);
                cr.setSourceRGBA(0.90, 0.96, 1.0, 0.52 * (1 - pRing * 0.8) * dAlpha);
                cr.setLineWidth(Math.max(0.8, 1.25 * dScale));
                cr.newPath();
                cr.moveTo(startX, startY);
                cr.curveTo(ctrlX, ctrlY, ctrlX, ctrlY, endX, endY);
                cr.stroke();
                cr.restore();
            }
        }

        cr.setSourceRGBA(0.68, 0.80, 0.92, 0.88 * dAlpha);
        cr.newPath();
        cr.arc(stone.x, stone.y, radius * 1.12, 0, TWO_PI);
        cr.fill();
        cr.setSourceRGBA(0.95, 0.97, 1.0, 0.95 * dAlpha);
        cr.newPath();
        cr.arc(stone.x, stone.y, radius, 0, TWO_PI);
        cr.fill();
        cr.setSourceRGBA(1, 1, 1, 0.85 * dAlpha);
        cr.newPath();
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

    // 2. Swaying mixed woodland on rolling hilly terrain (colored in day, moonlit at night)
    if (sky.leaves.length) {
        const sh = sceneHeight(width, height);
        const treeLayers = [
            {
                baseY: 0.29 * sh, offset: 0.5,
                hillRgb: night ? [0.16, 0.25, 0.34] : [0.24, 0.39, 0.33],
                pinePalette: {
                    trunk: night ? [0.16, 0.14, 0.16] : [0.25, 0.18, 0.13],
                    trunkHi: night ? [0.24, 0.20, 0.22] : [0.36, 0.26, 0.19],
                    darkGreen: night ? [0.11, 0.19, 0.25] : [0.13, 0.23, 0.19],
                    midGreen: night ? [0.16, 0.27, 0.32] : [0.20, 0.32, 0.25],
                    lightGreen: night ? [0.22, 0.35, 0.39] : [0.27, 0.41, 0.31],
                },
                decidPalette: {
                    trunk: night ? [0.16, 0.14, 0.16] : [0.25, 0.18, 0.13],
                    trunkHi: night ? [0.24, 0.20, 0.22] : [0.37, 0.27, 0.19],
                    shadeLeaf: night ? [0.11, 0.19, 0.24] : [0.13, 0.23, 0.16],
                    midLeaf: night ? [0.16, 0.27, 0.30] : [0.19, 0.33, 0.22],
                    litLeaf: night ? [0.22, 0.35, 0.37] : [0.27, 0.42, 0.27],
                    sunLeaf: night ? [0.29, 0.43, 0.44] : [0.36, 0.52, 0.31],
                },
                treeScale: 1.05 * scale, seed: 37, count: 8, minH: 40, maxH: 56, bendMul: 0.80,
            },
            {
                baseY: 0.35 * sh, offset: 0.0,
                hillRgb: night ? [0.12, 0.20, 0.27] : [0.18, 0.32, 0.25],
                pinePalette: {
                    trunk: night ? [0.13, 0.11, 0.12] : [0.20, 0.13, 0.09],
                    trunkHi: night ? [0.20, 0.16, 0.17] : [0.31, 0.20, 0.14],
                    darkGreen: night ? [0.08, 0.15, 0.20] : [0.09, 0.18, 0.14],
                    midGreen: night ? [0.13, 0.23, 0.27] : [0.14, 0.27, 0.20],
                    lightGreen: night ? [0.19, 0.31, 0.34] : [0.20, 0.35, 0.25],
                },
                decidPalette: {
                    trunk: night ? [0.13, 0.11, 0.12] : [0.20, 0.13, 0.09],
                    trunkHi: night ? [0.20, 0.16, 0.17] : [0.31, 0.21, 0.15],
                    shadeLeaf: night ? [0.08, 0.15, 0.19] : [0.08, 0.17, 0.12],
                    midLeaf: night ? [0.13, 0.23, 0.25] : [0.14, 0.27, 0.17],
                    litLeaf: night ? [0.19, 0.31, 0.32] : [0.21, 0.38, 0.22],
                    sunLeaf: night ? [0.26, 0.39, 0.38] : [0.31, 0.47, 0.26],
                },
                treeScale: 1.25 * scale, seed: 53, count: 8, minH: 44, maxH: 60, bendMul: 1.05,
            },
        ];
        const crownTop = 0;
        const skirtBot = 0.46 * sh;
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
        const fade = new Cairo.LinearGradient(0, 0.28 * sh, 0, skirtBot);
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
        cr.paintWithAlpha(night ? 0.92 : 0.94);
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

/* Multi-branch forked lightning emerging from the dark cloud underbelly */
const BOLT_ORIGINS = [0.46, 0.56, 0.64];

/* Resolve bottom floor scene ('S1', 'S2', 'T3', 'C1', 'C2', or null) from scene, night, and Celsius temp */
export function resolveFloorScene(scene, night, temp = null) {
    const hasTemp = temp !== null && temp !== undefined && Number.isFinite(temp);
    const tempF = hasTemp ? temp * 9 / 5 + 32 : null;
    if (scene === 'storm')
        return 'T3';
    if (scene === 'snow')
        return tempF !== null && tempF < 0 ? 'S1' : 'S2';
    if ((scene === 'clear' || scene === 'sun') && !night) {
        if (tempF !== null && tempF < 0)
            return 'S1';
        if (tempF !== null && tempF <= 32)
            return 'S2';
        if (tempF !== null && tempF >= 76)
            return 'C2';
        return 'C1';
    }
    if ((scene === 'cloud' || scene === 'partly') && !night)
        return 'C1';
    return null;
}

/* Snow-laden 5-tier evergreen pine for S1 and S2 winter floors */
function drawSnowPine(cr, x, baseY, treeH, snowCap = true, bend = 0, alpha = 1.0, night = false) {
    cr.save();
    const trunkW = Math.max(1.5, treeH * 0.055);
    drawSmoothLimb(
        cr, x, baseY + 2, trunkW,
        x + bend * 0.2, baseY - treeH * 0.3,
        x + bend * 0.5, baseY - treeH * 0.6,
        x + bend * 0.8, baseY - treeH * 0.85, trunkW * 0.25);
    cr.setSourceRGBA(0.28, 0.19, 0.13, 0.95 * alpha);
    cr.fill();

    const tiers = 5;
    for (let t = tiers - 1; t >= 0; t--) {
        const f = t / tiers;
        const hTop = 1.0 - f * 0.58;
        const hBot = 0.66 - f * 0.50;
        const topShift = bend * (hTop ** 1.3);
        const botShift = bend * (hBot ** 1.3);
        const topY = baseY - treeH * hTop;
        const botY = baseY - treeH * hBot;
        const hw = treeH * (0.15 + f * 0.23);

        const g = new Cairo.LinearGradient(x - hw, topY, x + hw, botY + 3);
        if (night) {
            g.addColorStopRGBA(0, 0.14, 0.28, 0.24, 0.94 * alpha);
            g.addColorStopRGBA(0.55, 0.09, 0.20, 0.18, 0.94 * alpha);
            g.addColorStopRGBA(1, 0.05, 0.13, 0.12, 0.96 * alpha);
        } else {
            g.addColorStopRGBA(0, 0.22, 0.42, 0.33, 0.94 * alpha);
            g.addColorStopRGBA(0.55, 0.15, 0.32, 0.26, 0.94 * alpha);
            g.addColorStopRGBA(1, 0.09, 0.22, 0.18, 0.96 * alpha);
        }
        cr.setSource(g);

        cr.newPath();
        cr.moveTo(x + topShift, topY);
        cr.curveTo(
            x + botShift - hw * 0.42, (topY + botY) * 0.5,
            x + botShift - hw * 0.88, botY - 1.5,
            x + botShift - hw, botY);
        cr.curveTo(
            x + botShift - hw * 0.28, botY + 2.8,
            x + botShift + hw * 0.28, botY + 2.8,
            x + botShift + hw, botY);
        cr.curveTo(
            x + botShift + hw * 0.88, botY - 1.5,
            x + botShift + hw * 0.42, (topY + botY) * 0.5,
            x + topShift, topY);
        cr.closePath();
        cr.fill();

        if (snowCap) {
            const sg = new Cairo.LinearGradient(x - hw * 0.7, topY, x + hw * 0.7, botY);
            sg.addColorStopRGBA(0, 0.94, 0.98, 1.0, 0.90 * alpha);
            sg.addColorStopRGBA(1, 0.70, 0.82, 0.94, 0.82 * alpha);
            cr.setSource(sg);
            cr.newPath();
            cr.moveTo(x + topShift, topY);
            cr.curveTo(
                x + botShift - hw * 0.36, (topY + botY) * 0.5,
                x + botShift - hw * 0.76, botY - 2.0,
                x + botShift - hw * 0.80, botY - 1.2);
            cr.curveTo(
                x + botShift - hw * 0.20, botY + 0.6,
                x + botShift + hw * 0.20, botY + 0.6,
                x + botShift + hw * 0.80, botY - 1.2);
            cr.curveTo(
                x + botShift + hw * 0.76, botY - 2.0,
                x + botShift + hw * 0.36, (topY + botY) * 0.5,
                x + topShift, topY);
            cr.closePath();
            cr.fill();
        }
    }
    cr.restore();
}

/* Articulated 2-jointed Siberian Husky with X-back harness and 4-beat gallop kinematics */
function drawHusky(cr, x, y, scale, stridePhase, coat = 'agouti') {
    cr.save();
    cr.translate(x, y);
    cr.scale(scale, scale);

    const palettes = {
        agouti: {
            dark: [0.16, 0.22, 0.30], mid: [0.34, 0.42, 0.52],
            belly: [0.90, 0.95, 0.99], harness: [0.84, 0.24, 0.22],
        },
        white: {
            dark: [0.60, 0.70, 0.82], mid: [0.82, 0.89, 0.96],
            belly: [0.97, 0.99, 1.00], harness: [0.18, 0.56, 0.76],
        },
        black: {
            dark: [0.10, 0.14, 0.20], mid: [0.22, 0.28, 0.36],
            belly: [0.88, 0.93, 0.98], harness: [0.88, 0.56, 0.18],
        },
    };
    const pal = palettes[coat] ?? palettes.agouti;

    const s1 = Math.sin(stridePhase);
    const bodyBob = Math.abs(s1) * 0.8;
    const pitch = s1 * 0.05;

    cr.translate(0, -bodyBob);
    cr.rotate(pitch);

    const drawLeg = (hipX, hipY, ph, isHind, isFar) => {
        const sw = Math.sin(ph);
        const lift = Math.max(0, -Math.cos(ph));
        const thighLen = isHind ? 3.2 : 2.9;
        const shinLen = isHind ? 3.0 : 2.8;
        const a1 = (isHind ? 0.30 : -0.15) + sw * 0.46;
        const a2 = a1 + (isHind ? -0.40 - lift * 0.50 : 0.32 + lift * 0.55);

        const kx = hipX + Math.sin(a1) * thighLen;
        const ky = hipY + Math.cos(a1) * thighLen;
        const px = kx + Math.sin(a2) * shinLen;
        const py = ky + Math.cos(a2) * shinLen;

        cr.setLineCap(Cairo.LineCap.ROUND);
        cr.setLineJoin(Cairo.LineJoin.ROUND);
        const col = isFar ? pal.dark : pal.belly;
        cr.setSourceRGBA(col[0], col[1], col[2], isFar ? 0.85 : 0.96);
        cr.setLineWidth(isHind ? 1.5 : 1.35);
        cr.newPath();
        cr.moveTo(hipX, hipY);
        cr.lineTo(kx, ky);
        cr.lineTo(px, py);
        cr.stroke();
    };

    drawLeg(-4.2, -3.6, stridePhase + 0.55, true, true);
    drawLeg(3.4, -3.8, stridePhase + Math.PI + 0.55, false, true);

    // Plumed sickle tail
    cr.setSourceRGBA(pal.mid[0], pal.mid[1], pal.mid[2], 0.94);
    cr.setLineWidth(2.0);
    cr.setLineCap(Cairo.LineCap.ROUND);
    cr.newPath();
    cr.moveTo(-4.8, -5.0);
    cr.curveTo(-7.2, -6.2, -8.5, -8.4, -6.8, -9.6);
    cr.stroke();

    // Ribcage & tucked loin torso
    const tg = new Cairo.LinearGradient(0, -6.8, 0, -2.0);
    tg.addColorStopRGBA(0, pal.dark[0], pal.dark[1], pal.dark[2], 0.98);
    tg.addColorStopRGBA(0.58, pal.mid[0], pal.mid[1], pal.mid[2], 0.98);
    tg.addColorStopRGBA(1, pal.belly[0], pal.belly[1], pal.belly[2], 0.98);
    cr.setSource(tg);
    cr.newPath();
    cr.moveTo(-5.2, -5.4);
    cr.curveTo(-2.5, -6.4, 2.2, -6.6, 4.8, -6.2);
    cr.curveTo(6.2, -5.2, 5.8, -2.5, 3.6, -2.4);
    cr.curveTo(1.2, -2.4, -1.8, -3.6, -4.6, -3.4);
    cr.closePath();
    cr.fill();

    // X-back racing harness
    cr.setSourceRGBA(pal.harness[0], pal.harness[1], pal.harness[2], 0.95);
    cr.setLineWidth(0.95);
    cr.newPath();
    cr.moveTo(4.2, -6.0);
    cr.lineTo(2.8, -2.8);
    cr.moveTo(4.0, -5.6);
    cr.lineTo(-4.0, -5.0);
    cr.stroke();

    drawLeg(-4.0, -3.5, stridePhase, true, false);
    drawLeg(3.6, -3.8, stridePhase + Math.PI * 1.1, false, false);

    // Wolf-like head, white mask & erect ears
    cr.setSourceRGBA(pal.dark[0], pal.dark[1], pal.dark[2], 0.98);
    cr.newPath();
    cr.moveTo(3.6, -5.8);
    cr.lineTo(5.4, -8.4);
    cr.lineTo(7.4, -8.0);
    cr.lineTo(9.2, -7.0);
    cr.lineTo(8.8, -6.0);
    cr.lineTo(6.6, -6.0);
    cr.lineTo(4.8, -3.8);
    cr.closePath();
    cr.fill();

    cr.setSourceRGBA(pal.belly[0], pal.belly[1], pal.belly[2], 0.96);
    cr.newPath();
    cr.moveTo(6.6, -7.6);
    cr.lineTo(9.0, -7.0);
    cr.lineTo(8.7, -6.0);
    cr.lineTo(6.2, -5.8);
    cr.closePath();
    cr.fill();

    cr.setSourceRGBA(pal.dark[0], pal.dark[1], pal.dark[2], 0.98);
    cr.newPath();
    cr.moveTo(5.0, -8.0);
    cr.lineTo(5.5, -10.6);
    cr.lineTo(6.6, -8.1);
    cr.moveTo(6.0, -8.0);
    cr.lineTo(6.7, -10.4);
    cr.lineTo(7.4, -7.9);
    cr.closePath();
    cr.fill();

    cr.restore();
}

/* 7-segment S-flexing Arctic Char (Salvelinus alpinus) with forked tail & white-edged crimson fins */
function drawArcticChar(cr, x, y, scale, baseAngle, time) {
    cr.save();
    cr.translate(x, y);
    cr.scale(scale, scale);
    cr.rotate(baseAngle);

    const N = 7;
    const len = 17.5;
    const halfW = [0.65, 2.2, 3.1, 2.9, 2.2, 1.3, 0.75];
    const spine = [];
    for (let i = 0; i < N; i++) {
        const u = i / (N - 1);
        const sx = (0.48 - u) * len;
        const env = (u ** 1.1) * 2.6;
        const sy = Math.sin(time * 14 - u * 4.6) * env;
        spine.push({ x: sx, y: sy, r: halfW[i] });
    }

    const leftPts = [], rightPts = [];
    for (let i = 0; i < N; i++) {
        const p0 = spine[Math.max(0, i - 1)];
        const p1 = spine[Math.min(N - 1, i + 1)];
        const dx = p1.x - p0.x, dy = p1.y - p0.y;
        const l = Math.hypot(dx, dy) || 1;
        const nx = -dy / l, ny = dx / l;
        leftPts.push({ x: spine[i].x + nx * spine[i].r, y: spine[i].y + ny * spine[i].r });
        rightPts.push({ x: spine[i].x - nx * spine[i].r, y: spine[i].y - ny * spine[i].r });
    }

    const tail = spine[N - 1], prev = spine[N - 2];
    const tAng = Math.atan2(tail.y - prev.y, tail.x - prev.x);
    cr.save();
    cr.translate(tail.x, tail.y);
    cr.rotate(tAng);
    cr.setSourceRGBA(0.62, 0.74, 0.84, 0.94);
    cr.newPath();
    cr.moveTo(0, 0);
    cr.lineTo(4.8, -3.5);
    cr.lineTo(2.6, 0);
    cr.lineTo(4.8, 3.5);
    cr.closePath();
    cr.fill();
    cr.restore();

    const mid = spine[2];
    cr.setSourceRGBA(0.88, 0.36, 0.30, 0.92);
    cr.newPath();
    cr.moveTo(mid.x, rightPts[2].y);
    cr.lineTo(mid.x - 2.6, rightPts[2].y + 3.4);
    cr.lineTo(mid.x + 1.2, rightPts[2].y + 0.5);
    cr.closePath();
    cr.fill();
    cr.setSourceRGBA(0.96, 0.99, 1.0, 0.92);
    cr.setLineWidth(0.55);
    cr.newPath();
    cr.moveTo(mid.x + 1.0, rightPts[2].y + 0.4);
    cr.lineTo(mid.x - 2.6, rightPts[2].y + 3.4);
    cr.stroke();

    cr.setSourceRGBA(0.30, 0.44, 0.58, 0.92);
    cr.newPath();
    cr.moveTo(leftPts[2].x, leftPts[2].y);
    cr.lineTo(leftPts[3].x - 0.8, leftPts[3].y - 2.8);
    cr.lineTo(leftPts[4].x, leftPts[4].y);
    cr.closePath();
    cr.fill();

    const bg = new Cairo.LinearGradient(0, -3.5, 0, 3.5);
    bg.addColorStopRGBA(0.0, 0.20, 0.32, 0.46, 0.98);
    bg.addColorStopRGBA(0.46, 0.80, 0.88, 0.96, 0.98);
    bg.addColorStopRGBA(0.76, 0.94, 0.46, 0.36, 0.96);
    bg.addColorStopRGBA(1.0, 0.98, 0.90, 0.84, 0.96);
    cr.setSource(bg);
    cr.newPath();
    cr.moveTo(spine[0].x + 1.0, spine[0].y);
    for (let i = 0; i < N; i++)
        cr.lineTo(leftPts[i].x, leftPts[i].y);
    for (let i = N - 1; i >= 0; i--)
        cr.lineTo(rightPts[i].x, rightPts[i].y);
    cr.closePath();
    cr.fill();

    cr.setSourceRGBA(1.0, 1.0, 1.0, 0.62);
    cr.setLineWidth(0.75);
    cr.newPath();
    for (let i = 1; i < N - 1; i++) {
        if (i === 1)
            cr.moveTo(spine[i].x, spine[i].y - 0.4);
        else
            cr.lineTo(spine[i].x, spine[i].y - 0.4);
    }
    cr.stroke();

    cr.setSourceRGBA(0.08, 0.10, 0.14, 0.98);
    cr.newPath();
    cr.arc(spine[0].x - 0.8, spine[0].y - 0.4, 0.85, 0, TWO_PI);
    cr.fill();

    cr.restore();
}

/* S1 (< 0°F Snow & Clear Day): Inuit Ice Fishing, Flexing Arctic Char, Igloo & Husky Sled Trail */
function drawIceFishingFloor(cr, width, height, scale, time, night) {
    const sh = sceneHeight(width, height);
    const groundOffset = height - sh;
    const floorTop = groundOffset + 0.685 * sh;
    const ridgeY = floorTop - 14 * scale;

    // Upper snow ridge wash
    const rg = new Cairo.LinearGradient(0, ridgeY - 6 * scale, 0, floorTop + 14 * scale);
    if (night) {
        rg.addColorStopRGBA(0, 0.24, 0.34, 0.48, 0.0);
        rg.addColorStopRGBA(0.35, 0.24, 0.34, 0.48, 0.28);
        rg.addColorStopRGBA(1, 0.16, 0.24, 0.36, 0.42);
    } else {
        rg.addColorStopRGBA(0, 0.88, 0.94, 1.0, 0.0);
        rg.addColorStopRGBA(0.35, 0.84, 0.91, 0.98, 0.34);
        rg.addColorStopRGBA(1, 0.72, 0.82, 0.92, 0.46);
    }
    cr.setSource(rg);
    cr.newPath();
    cr.moveTo(0, ridgeY + 4 * scale);
    cr.curveTo(width * 0.35, ridgeY - 5 * scale, width * 0.68, ridgeY + 4 * scale, width, ridgeY - 1 * scale);
    cr.lineTo(width, floorTop + 14 * scale);
    cr.lineTo(0, floorTop + 14 * scale);
    cr.closePath();
    cr.fill();

    // Glacial ice sheet floor wash
    const iceG = new Cairo.LinearGradient(0, floorTop + 8 * scale, 0, height);
    if (night) {
        iceG.addColorStopRGBA(0, 0.14, 0.24, 0.36, 0.34);
        iceG.addColorStopRGBA(1, 0.08, 0.15, 0.26, 0.56);
    } else {
        iceG.addColorStopRGBA(0, 0.66, 0.80, 0.92, 0.36);
        iceG.addColorStopRGBA(1, 0.52, 0.68, 0.84, 0.52);
    }
    cr.setSource(iceG);
    cr.rectangle(0, floorTop + 8 * scale, width, height - floorTop - 8 * scale);
    cr.fill();

    // 1. Qamutiik Dog Sled + Musher + 3 Articulated Huskies on upper ridge
    const span = width + 180 * scale;
    const dtShift = ((time - 1.1) * 22 * scale % span + span) % span;
    const sledX = ((width * 0.388 + dtShift + 90 * scale) % span) - 90 * scale;
    cr.save();
    cr.translate(sledX, ridgeY);
    cr.scale(1.42 * scale, 1.42 * scale);

    cr.setSourceRGBA(0.16, 0.24, 0.34, 0.92);
    cr.setLineWidth(1.3);
    cr.newPath();
    cr.moveTo(-28, 0);
    cr.lineTo(-4, 0);
    cr.curveTo(0, 0, 2, -3.5, -1, -5.0);
    cr.lineTo(-22, -5.0);
    cr.moveTo(-24, 0);
    cr.lineTo(-22, -9.5);
    cr.moveTo(-14, 0);
    cr.lineTo(-14, -5.0);
    cr.moveTo(-6, 0);
    cr.lineTo(-6, -5.0);
    cr.stroke();

    cr.setSourceRGBA(0.30, 0.40, 0.50, 0.92);
    cr.newPath();
    cr.moveTo(-20, -5.0);
    cr.curveTo(-16, -9.2, -8, -8.8, -4, -5.0);
    cr.closePath();
    cr.fill();

    const kick = Math.sin(time * 7.0) * 1.8;
    cr.setSourceRGBA(0.18, 0.26, 0.36, 0.95);
    cr.setLineWidth(1.5);
    cr.newPath();
    cr.moveTo(-25, -4.5);
    cr.lineTo(-27, 0);
    cr.moveTo(-25, -4.5);
    cr.lineTo(-29 - kick, -1.2);
    cr.moveTo(-23, -9.0);
    cr.lineTo(-21, -8.5);
    cr.stroke();
    cr.newPath();
    cr.arc(-23, -11.8, 2.0, 0, TWO_PI);
    cr.fill();
    cr.rectangle(-25.5, -10.2, 3.6, 5.6);
    cr.fill();

    // Sled lantern glow + gangline
    const lg = new Cairo.RadialGradient(-1, -4.5, 0.5, -1, -4.5, 7.5);
    lg.addColorStopRGBA(0, 1.0, 0.90, 0.48, 0.95);
    lg.addColorStopRGBA(1, 1.0, 0.68, 0.20, 0.0);
    cr.setSource(lg);
    cr.newPath();
    cr.arc(-1, -4.5, 7.5, 0, TWO_PI);
    cr.fill();

    cr.setSourceRGBA(0.75, 0.85, 0.95, 0.65);
    cr.setLineWidth(0.75);
    cr.newPath();
    cr.moveTo(0, -3.2);
    cr.lineTo(58, -3.8);
    cr.stroke();
    cr.restore();

    drawHusky(cr, sledX + 18 * scale, ridgeY, 1.42 * scale, time * 10 + 0.4, 'agouti');
    drawHusky(cr, sledX + 48 * scale, ridgeY - 0.5 * scale, 1.42 * scale, time * 10 + 2.2, 'white');
    drawHusky(cr, sledX + 78 * scale, ridgeY - 1.0 * scale, 1.42 * scale, time * 10 + 4.0, 'black');

    // 2. Spiral-Coursed Snow-Block Igloo in Alley 1 (x = 0.267w, y = h - 70*scale)
    const igX = width * 0.267, igY = height - 70 * scale;
    cr.save();
    cr.translate(igX, igY);
    cr.scale(1.68 * scale, 1.68 * scale);

    cr.save();
    cr.scale(16.0, 5.2);
    cr.setSourceRGBA(0.06, 0.14, 0.24, 0.34);
    cr.newPath();
    cr.arc(0, 0.4, 1, 0, TWO_PI);
    cr.fill();
    cr.restore();

    const domeG = new Cairo.RadialGradient(-5, -8, 2, 0, 0, 16);
    domeG.addColorStopRGBA(0, 0.95, 0.98, 1.0, 0.96);
    domeG.addColorStopRGBA(0.58, 0.72, 0.84, 0.95, 0.95);
    domeG.addColorStopRGBA(1, 0.46, 0.62, 0.78, 0.96);
    cr.setSource(domeG);
    cr.newPath();
    cr.arc(0, 0, 14, Math.PI, 0);
    cr.curveTo(14, 3.2, -14, 3.2, -14, 0);
    cr.closePath();
    cr.fill();

    cr.setSourceRGBA(0.28, 0.44, 0.62, 0.50);
    cr.setLineWidth(0.70);
    cr.newPath();
    cr.moveTo(-13.2, -3.8);
    cr.curveTo(-4, -5.8, 4, -5.8, 13.2, -3.8);
    cr.moveTo(-11.2, -8.2);
    cr.curveTo(-3, -9.8, 3, -9.8, 11.2, -8.2);
    cr.moveTo(-6.8, -11.8);
    cr.curveTo(-2, -12.8, 2, -12.8, 6.8, -11.8);
    cr.moveTo(-6, 0.8);
    cr.lineTo(-5.5, -4.4);
    cr.moveTo(2, 1.2);
    cr.lineTo(2.2, -4.5);
    cr.moveTo(-2, -4.6);
    cr.lineTo(-1.6, -9.0);
    cr.moveTo(5, -4.2);
    cr.lineTo(4.4, -8.6);
    cr.stroke();

    // Barrel-vaulted torsuk entrance tunnel + warm seal-oil lamp glow
    cr.setSourceRGBA(0.76, 0.88, 0.98, 0.96);
    cr.newPath();
    cr.arc(10.5, 1.2, 5.2, Math.PI * 1.08, Math.PI * 1.96);
    cr.lineTo(15.5, 3.8);
    cr.lineTo(5.5, 3.8);
    cr.closePath();
    cr.fill();

    const lampG = new Cairo.RadialGradient(12.2, 2.2, 0.8, 13.5, 3.2, 10.5);
    lampG.addColorStopRGBA(0, 1.0, 0.88, 0.44, 0.96);
    lampG.addColorStopRGBA(0.45, 1.0, 0.68, 0.22, 0.58);
    lampG.addColorStopRGBA(1, 1.0, 0.54, 0.14, 0.0);
    cr.setSource(lampG);
    cr.newPath();
    cr.arc(12.2, 2.2, 10.5, 0, TWO_PI);
    cr.fill();
    cr.restore();

    // 3. Inuit Angler in Alley 2 (x = 0.485w) + Glowing Aqua Ice Hole & Flexing Char in Alley 3 (x = 0.715w)
    const angX = width * 0.485, angY = height - 50 * scale;
    const holeX = width * 0.715, holeY = height - 46 * scale;
    const haul = 0.5 + 0.5 * Math.sin((time - 1.1) * 1.8 + 0.65);

    // Glowing aqua ice hole in Alley 3
    cr.save();
    cr.translate(holeX, holeY);
    cr.scale(1.68 * scale, 1.68 * scale);
    cr.save();
    cr.scale(11.0, 3.8);
    cr.setSourceRGBA(0.86, 0.94, 1.0, 0.94);
    cr.newPath();
    cr.arc(0, 0, 1.15, 0, TWO_PI);
    cr.fill();
    const hg = new Cairo.RadialGradient(0, 0, 0.1, 0, 0, 1.0);
    hg.addColorStopRGBA(0, 0.24, 0.88, 0.98, 0.96);
    hg.addColorStopRGBA(0.65, 0.08, 0.52, 0.74, 0.96);
    hg.addColorStopRGBA(1, 0.04, 0.26, 0.44, 0.98);
    cr.setSource(hg);
    cr.newPath();
    cr.arc(0, 0, 1.0, 0, TWO_PI);
    cr.fill();
    cr.restore();
    cr.restore();

    // Inuit Angler in Caribou Parka with Wolverine Sunburst Ruff in Alley 2
    cr.save();
    cr.translate(angX, angY);
    cr.scale(1.68 * scale, 1.68 * scale);

    // Snow-block seat
    cr.setSourceRGBA(0.84, 0.92, 0.99, 0.95);
    cr.rectangle(-10.5, -3.5, 9.5, 6.2);
    cr.fill();

    // Kamik mukluk boots
    cr.setSourceRGBA(0.32, 0.20, 0.12, 0.98);
    cr.newPath();
    cr.arc(2.5, 1.2, 3.2, Math.PI, 0);
    cr.lineTo(5.7, 2.8);
    cr.lineTo(-0.7, 2.8);
    cr.closePath();
    cr.fill();

    // Caribou-skin atigi parka with decorative cream trim
    const pkG = new Cairo.LinearGradient(-8, -16, 6, 0);
    pkG.addColorStopRGBA(0, 0.64, 0.38, 0.20, 0.98);
    pkG.addColorStopRGBA(0.6, 0.48, 0.26, 0.14, 0.98);
    pkG.addColorStopRGBA(1, 0.34, 0.18, 0.09, 0.98);
    cr.setSource(pkG);
    cr.newPath();
    cr.moveTo(-7.5, -1.2);
    cr.curveTo(-8.2, -8.5, -5.5, -14.8, -1.2, -15.5);
    cr.curveTo(3.2, -15.2, 4.8, -9.5, 4.2, -1.2);
    cr.closePath();
    cr.fill();

    cr.setSourceRGBA(0.96, 0.92, 0.82, 0.94);
    cr.setLineWidth(1.1);
    cr.newPath();
    cr.moveTo(-7.2, -2.2);
    cr.lineTo(4.0, -2.2);
    cr.stroke();

    // Extended arm & mitten holding jigging rod
    cr.setSourceRGBA(0.56, 0.32, 0.16, 0.98);
    cr.setLineWidth(3.0);
    cr.setLineCap(Cairo.LineCap.ROUND);
    cr.newPath();
    cr.moveTo(0.5, -11.5);
    cr.lineTo(7.2, -9.8);
    cr.stroke();

    // Plush multi-ringed wolverine/wolf sunburst fur ruff (nasak)
    cr.setSourceRGBA(0.42, 0.28, 0.16, 0.96);
    cr.newPath();
    cr.arc(-0.5, -17.2, 5.2, 0, TWO_PI);
    cr.fill();
    cr.setSourceRGBA(0.86, 0.76, 0.62, 0.96);
    cr.newPath();
    cr.arc(0.2, -17.2, 4.1, 0, TWO_PI);
    cr.fill();
    cr.setSourceRGBA(0.82, 0.58, 0.42, 0.98);
    cr.newPath();
    cr.arc(1.0, -17.2, 2.5, 0, TWO_PI);
    cr.fill();
    cr.restore();

    // Parabolic bending jigging rod + taut line + 7-segment flexing Arctic char
    const rodBaseX = angX + 12.0 * scale, rodBaseY = angY - 16.5 * scale;
    const tipX = holeX - 6.0 * scale, tipY = holeY - (29.0 - haul * 5.0) * scale;
    cr.setSourceRGBA(0.42, 0.26, 0.14, 0.96);
    cr.setLineWidth(1.5 * scale);
    cr.setLineCap(Cairo.LineCap.ROUND);
    cr.newPath();
    cr.moveTo(rodBaseX, rodBaseY);
    cr.curveTo(
        (rodBaseX + tipX) * 0.45, rodBaseY - 14 * scale,
        (rodBaseX + tipX) * 0.78, tipY - 6 * scale,
        tipX, tipY);
    cr.stroke();

    const fishX = holeX - 2.0 * scale;
    const fishY = holeY - (8.0 + haul * 11.0) * scale;
    cr.setSourceRGBA(0.88, 0.95, 1.0, 0.78);
    cr.setLineWidth(0.95 * scale);
    cr.newPath();
    cr.moveTo(tipX, tipY);
    cr.lineTo(fishX + 3.5 * scale, fishY - 7.5 * scale);
    cr.stroke();

    drawArcticChar(cr, fishX, fishY, 1.52 * scale, -Math.PI * 0.44, time);
    drawSnowPine(cr, width * 0.945, height - 28 * scale, 36 * scale, true, -1.5 * scale, 1.0, night);
}

/* S2 (0°F .. 32°F Snow & Clear Day): Snowman, Pine Woodland & Smaller Distant Thu–Fri Smoking Chalet */
function drawSnowmanChaletFloor(cr, width, height, scale, time, night) {
    const sh = sceneHeight(width, height);
    const groundOffset = height - sh;
    const floorTop = groundOffset + 0.685 * sh;

    // Distant snow ridge wash
    const dg = new Cairo.LinearGradient(0, floorTop - 6 * scale, 0, height);
    if (night) {
        dg.addColorStopRGBA(0, 0.22, 0.32, 0.46, 0.0);
        dg.addColorStopRGBA(0.28, 0.20, 0.30, 0.44, 0.34);
        dg.addColorStopRGBA(1, 0.10, 0.18, 0.28, 0.56);
    } else {
        dg.addColorStopRGBA(0, 0.86, 0.92, 0.98, 0.0);
        dg.addColorStopRGBA(0.28, 0.78, 0.86, 0.95, 0.34);
        dg.addColorStopRGBA(1, 0.58, 0.70, 0.84, 0.52);
    }
    cr.setSource(dg);
    cr.newPath();
    cr.moveTo(0, floorTop + 5 * scale);
    cr.curveTo(width * 0.35, floorTop - 6 * scale, width * 0.68, floorTop + 6 * scale, width, floorTop + 2 * scale);
    cr.lineTo(width, height);
    cr.lineTo(0, height);
    cr.closePath();
    cr.fill();

    // Foreground snowbank contour
    const fgSnow = new Cairo.LinearGradient(0, height - 62 * scale, 0, height);
    if (night) {
        fgSnow.addColorStopRGBA(0, 0.16, 0.26, 0.38, 0.38);
        fgSnow.addColorStopRGBA(1, 0.08, 0.15, 0.24, 0.58);
    } else {
        fgSnow.addColorStopRGBA(0, 0.72, 0.82, 0.92, 0.38);
        fgSnow.addColorStopRGBA(1, 0.52, 0.66, 0.80, 0.54);
    }
    cr.setSource(fgSnow);
    cr.newPath();
    cr.moveTo(0, height - 48 * scale);
    cr.curveTo(
        width * 0.38, height - 62 * scale,
        width * 0.72, height - 44 * scale,
        width, height - 52 * scale);
    cr.lineTo(width, height);
    cr.lineTo(0, height);
    cr.closePath();
    cr.fill();

    // 1. Smaller Distant Warm-Lit Alpine Timber & Stone Chalet with Curling Chimney Smoke
    //    Placed further in the distance between tiles Thu and Fri (x = 0.733w, y = floorTop + 18*scale)
    const chX = width * 0.733, chY = floorTop + 18 * scale;
    cr.save();
    cr.translate(chX, chY);
    cr.scale(1.08 * scale, 1.08 * scale);

    // Warm golden window-light aura spilled onto the distant snow ridge
    const snowAura = new Cairo.RadialGradient(0, 1.5, 1.5, 0, 2.5, 16.5);
    snowAura.addColorStopRGBA(0, 1.0, 0.80, 0.36, 0.42);
    snowAura.addColorStopRGBA(0.6, 1.0, 0.68, 0.24, 0.16);
    snowAura.addColorStopRGBA(1, 1.0, 0.60, 0.18, 0.0);
    cr.save();
    cr.scale(1.0, 0.42);
    cr.setSource(snowAura);
    cr.newPath();
    cr.arc(0, 4.0, 16.5, 0, TWO_PI);
    cr.fill();
    cr.restore();

    // Animated curling chimney smoke puffs rising gently between Thu and Fri
    for (let i = 0; i < 5; i++) {
        const u = ((i / 5) + ((time - 1.1) * 0.16) % 1 + 1) % 1;
        const px = 6.2 + Math.sin(u * 5.2 + time * 1.8) * (1.2 + u * 1.4);
        const py = -20.5 - u * 18.0;
        const pr = 1.6 + u * 3.4;
        const pa = (1 - u) * 0.52;
        const sg = new Cairo.RadialGradient(px - pr * 0.25, py - pr * 0.25, pr * 0.15, px, py, pr);
        sg.addColorStopRGBA(0, 0.92, 0.96, 1.0, pa);
        sg.addColorStopRGBA(1, 0.74, 0.84, 0.95, 0);
        cr.setSource(sg);
        cr.newPath();
        cr.arc(px, py, pr, 0, TWO_PI);
        cr.fill();
    }
    cr.setSourceRGBA(0.88, 0.94, 1.0, 0.36);
    cr.setLineWidth(1.3);
    cr.setLineCap(Cairo.LineCap.ROUND);
    cr.newPath();
    cr.moveTo(6.0, -19.2);
    cr.curveTo(
        8.4 + Math.sin(time * 2.0) * 0.8, -23.5,
        4.6 - Math.sin(time * 2.0) * 0.8, -28.0,
        7.6, -33.5);
    cr.stroke();

    // Stone chimney + snow cap
    cr.setSourceRGBA(0.42, 0.44, 0.50, 0.98);
    cr.rectangle(4.4, -19.2, 3.2, 8.5);
    cr.fill();
    cr.setSourceRGBA(0.92, 0.96, 1.0, 0.96);
    cr.rectangle(4.0, -19.6, 4.0, 1.1);
    cr.fill();

    // Cut-stone masonry foundation + cedar/larch log cabin walls
    cr.setSourceRGBA(0.36, 0.40, 0.46, 0.98);
    cr.rectangle(-10.2, -0.8, 20.4, 2.6);
    cr.fill();

    const wallG = new Cairo.LinearGradient(-10, -11, 10, 0);
    wallG.addColorStopRGBA(0, 0.56, 0.36, 0.22, 0.98);
    wallG.addColorStopRGBA(0.55, 0.46, 0.28, 0.16, 0.98);
    wallG.addColorStopRGBA(1, 0.34, 0.20, 0.12, 0.98);
    cr.setSource(wallG);
    cr.newPath();
    cr.moveTo(-9.8, -0.6);
    cr.lineTo(-9.8, -10.5);
    cr.lineTo(0, -17.8);
    cr.lineTo(9.8, -10.5);
    cr.lineTo(9.8, -0.6);
    cr.closePath();
    cr.fill();

    // Horizontal log courses & corner notches
    cr.setSourceRGBA(0.24, 0.14, 0.08, 0.55);
    cr.setLineWidth(0.45);
    cr.newPath();
    for (let ly = -2.4; ly >= -10.0; ly -= 1.9) {
        cr.moveTo(-10.4, ly);
        cr.lineTo(10.4, ly);
    }
    cr.stroke();

    // Arched front door + glowing windows
    cr.setSourceRGBA(0.28, 0.16, 0.10, 0.98);
    cr.newPath();
    cr.arc(0, -4.6, 2.0, Math.PI, 0);
    cr.lineTo(2.0, -0.6);
    cr.lineTo(-2.0, -0.6);
    cr.closePath();
    cr.fill();

    for (const [wx, wy, ww, wh] of [[-5.6, -5.2, 3.4, 3.2], [5.6, -5.2, 3.4, 3.2], [0.0, -12.2, 2.8, 2.6]]) {
        const wg = new Cairo.RadialGradient(wx, wy, 0.4, wx, wy, ww * 1.3);
        wg.addColorStopRGBA(0, 1.0, 0.92, 0.56, 0.98);
        wg.addColorStopRGBA(0.6, 1.0, 0.74, 0.24, 0.92);
        wg.addColorStopRGBA(1, 0.90, 0.52, 0.12, 0.0);
        cr.setSource(wg);
        cr.newPath();
        cr.arc(wx, wy, ww * 1.3, 0, TWO_PI);
        cr.fill();
        cr.setSourceRGBA(1.0, 0.90, 0.48, 0.98);
        cr.rectangle(wx - ww * 0.5, wy - wh * 0.5, ww, wh);
        cr.fill();
    }

    // Gable eaves + thick pillowy snowpack roof
    cr.setSourceRGBA(0.24, 0.15, 0.10, 0.98);
    cr.setLineWidth(1.5);
    cr.setLineJoin(Cairo.LineJoin.ROUND);
    cr.newPath();
    cr.moveTo(-12.2, -9.2);
    cr.lineTo(0, -18.4);
    cr.lineTo(12.2, -9.2);
    cr.stroke();

    const roofSnowG = new Cairo.LinearGradient(0, -20.2, 0, -8.5);
    roofSnowG.addColorStopRGBA(0, 0.96, 0.98, 1.0, 0.98);
    roofSnowG.addColorStopRGBA(0.65, 0.80, 0.88, 0.97, 0.97);
    roofSnowG.addColorStopRGBA(1, 0.58, 0.72, 0.88, 0.96);
    cr.setSource(roofSnowG);
    cr.newPath();
    cr.moveTo(-12.8, -9.2);
    cr.curveTo(-8.0, -13.6, -3.5, -17.6, 0, -20.0);
    cr.curveTo(3.5, -17.6, 8.0, -13.6, 12.8, -9.2);
    cr.curveTo(12.2, -7.8, 9.5, -8.8, 0, -16.8);
    cr.curveTo(-9.5, -8.8, -12.2, -7.8, -12.8, -9.2);
    cr.closePath();
    cr.fill();
    cr.restore();

    // 2. 8-Tree Snow-Laden Evergreen Pine Woodland (distant ridge, Alley 2/3, and outer margins; no birds)
    const sway = Math.sin((time - 1.1) * 1.6) * 0.5 * scale;
    drawSnowPine(cr, width * 0.460, floorTop + 8 * scale, 22 * scale, true, 0.3 * scale + sway, 0.72, night);
    drawSnowPine(cr, width * 0.527, floorTop + 11 * scale, 26 * scale, true, -0.4 * scale + sway, 0.76, night);
    drawSnowPine(cr, width * 0.497, height - 50 * scale, 32 * scale, true, 0.5 * scale + sway, 0.90, night);
    drawSnowPine(cr, width * 0.733, height - 46 * scale, 30 * scale, true, -0.4 * scale + sway, 0.92, night);
    drawSnowPine(cr, width * 0.042, height - 64 * scale, 30 * scale, true, 0.8 * scale + sway, 1.0, night);
    drawSnowPine(cr, width * 0.088, height - 46 * scale, 24 * scale, true, 0.5 * scale + sway, 1.0, night);
    drawSnowPine(cr, width * 0.903, height - 62 * scale, 28 * scale, true, -0.8 * scale + sway, 1.0, night);
    drawSnowPine(cr, width * 0.952, height - 26 * scale, 40 * scale, true, -1.2 * scale + sway, 1.0, night);

    // 3. 3-Tier Snowman in Alley 1 (x = 0.267w, y = h - 54*scale)
    const smX = width * 0.267, smY = height - 54 * scale;
    cr.save();
    cr.translate(smX, smY);
    cr.scale(1.72 * scale, 1.72 * scale);

    cr.save();
    cr.scale(10.5, 3.6);
    cr.setSourceRGBA(0.05, 0.10, 0.18, 0.36);
    cr.newPath();
    cr.arc(0.1, 0.5, 1, 0, TWO_PI);
    cr.fill();
    cr.restore();

    for (const [sy, sr] of [[-4.2, 6.8], [-12.6, 5.1], [-19.6, 3.8]]) {
        const sg = new Cairo.RadialGradient(-sr * 0.32, sy - sr * 0.32, sr * 0.12, 0, sy, sr);
        sg.addColorStopRGBA(0, 0.96, 0.98, 1.0, 0.98);
        sg.addColorStopRGBA(0.65, 0.76, 0.86, 0.95, 0.96);
        sg.addColorStopRGBA(1, 0.50, 0.64, 0.80, 0.96);
        cr.setSource(sg);
        cr.newPath();
        cr.arc(0, sy, sr, 0, TWO_PI);
        cr.fill();
    }

    // Branched twig arms
    cr.setSourceRGBA(0.32, 0.21, 0.14, 0.95);
    cr.setLineWidth(1.05);
    cr.setLineCap(Cairo.LineCap.ROUND);
    cr.newPath();
    cr.moveTo(-4.6, -13.0);
    cr.lineTo(-10.8, -16.8);
    cr.moveTo(-8.2, -15.2);
    cr.lineTo(-10.2, -18.2);
    cr.moveTo(4.6, -13.0);
    cr.lineTo(10.6, -16.2);
    cr.moveTo(8.0, -14.8);
    cr.lineTo(10.2, -17.6);
    cr.stroke();

    // Coal buttons & eyes + 3D carrot nose + fluttering crimson scarf + top hat
    cr.setSourceRGBA(0.10, 0.14, 0.20, 0.96);
    for (const [bx, by, br] of [[0, -10.5, 0.75], [0, -12.8, 0.75], [0, -15.0, 0.75],
        [-1.3, -20.6, 0.75], [1.4, -20.6, 0.75]]) {
        cr.newPath();
        cr.arc(bx, by, br, 0, TWO_PI);
        cr.fill();
    }

    cr.setSourceRGBA(0.94, 0.46, 0.14, 0.98);
    cr.newPath();
    cr.moveTo(0.8, -19.8);
    cr.lineTo(6.4, -19.0);
    cr.lineTo(0.8, -18.3);
    cr.closePath();
    cr.fill();

    const scarfWave = Math.sin((time - 1.1) * 3.2) * 1.1;
    cr.setSourceRGBA(0.84, 0.20, 0.24, 0.96);
    cr.setLineWidth(2.2);
    cr.newPath();
    cr.moveTo(-3.8, -16.2);
    cr.lineTo(3.8, -16.2);
    cr.moveTo(2.8, -16.2);
    cr.curveTo(6.5, -15.0 + scarfWave * 0.4, 8.8, -13.2 + scarfWave, 10.6, -11.5 + scarfWave);
    cr.stroke();

    cr.setSourceRGBA(0.12, 0.16, 0.22, 0.98);
    cr.rectangle(-5.0, -23.8, 10.0, 1.5);
    cr.rectangle(-3.2, -28.8, 6.4, 5.0);
    cr.fill();
    cr.setSourceRGBA(0.84, 0.20, 0.24, 0.95);
    cr.rectangle(-3.2, -24.8, 6.4, 1.1);
    cr.fill();
    cr.restore();
}

/* T3 (Thunderstorm): Eurasian Tree Sparrow (Passer montanus) Sheltering Under Overhanging Sacred Lotus Flower on Lotus Pad */
function drawStormPadShadow(cr, x, y, pr, notch, scale, gap = 0.21) {
    cr.save();
    cr.translate(x + 3.2 * scale, y + 5.5 * scale);
    cr.scale(1, 0.56);
    traceKoiLotusPad(cr, pr * 1.02, notch, gap);
    cr.setSourceRGBA(0.01, 0.03, 0.06, 0.44);
    cr.fill();
    cr.restore();
}

function drawUmbrellaLotusFlower(cr, x, y, sc, tilt, lum) {
    cr.save();
    cr.translate(x, y);
    cr.rotate(tilt);
    cr.scale(sc, sc);

    const drawStriatedPetal = (dx, dy, rot, len, wid, curveBias, baseCol, midCol, tipCol, alpha = 0.90) => {
        cr.save();
        cr.translate(dx, dy);
        cr.rotate(rot);

        const pg = new Cairo.LinearGradient(0, 0, 0, -len);
        pg.addColorStopRGBA(0.00, baseCol[0] * lum, baseCol[1] * lum, baseCol[2] * lum, alpha);
        pg.addColorStopRGBA(0.52, midCol[0] * lum, midCol[1] * lum, midCol[2] * lum, alpha);
        pg.addColorStopRGBA(1.00, tipCol[0] * lum, tipCol[1] * lum, tipCol[2] * lum, alpha);
        cr.setSource(pg);

        cr.newPath();
        cr.moveTo(0, 0);
        cr.curveTo(-wid * 1.18, -len * 0.28, -wid * 0.92 + curveBias, -len * 0.76, curveBias * 0.6, -len);
        cr.curveTo(wid * 0.92 + curveBias, -len * 0.76, wid * 1.18, -len * 0.28, 0, 0);
        cr.closePath();
        cr.fillPreserve();

        cr.setSourceRGBA(0.50 * lum, 0.16 * lum, 0.30 * lum, 0.32);
        cr.setLineWidth(0.40);
        cr.stroke();

        cr.setSourceRGBA(1.0 * lum, 0.90 * lum, 0.94 * lum, 0.24);
        cr.setLineWidth(0.28);
        for (const v of [-0.45, 0.0, 0.45]) {
            cr.newPath();
            cr.moveTo(v * wid * 0.25, -len * 0.14);
            cr.curveTo(v * wid * 0.80, -len * 0.44, v * wid * 0.60 + curveBias * 0.4, -len * 0.74, curveBias * 0.5 + v * wid * 0.15, -len * 0.90);
            cr.stroke();
        }
        cr.restore();
    };

    // Basal green-blush calyx sepals on far left/right
    drawStriatedPetal(-2.8, 0.8, -1.42, 11.2, 3.0, -0.4, [0.22, 0.44, 0.28], [0.48, 0.56, 0.42], [0.78, 0.60, 0.66], 0.84);
    drawStriatedPetal( 2.8, 0.8,  1.42, 11.2, 3.0,  0.4, [0.22, 0.44, 0.28], [0.48, 0.56, 0.42], [0.78, 0.60, 0.66], 0.84);

    // Back / upper tier of tall pointed petals fanning upward
    for (const [dx, dy, rot, len, wid, bias] of [
        [-2.6, -1.4, -0.74, 13.4, 3.4, -0.4],
        [-1.4, -2.0, -0.44, 14.2, 3.7, -0.2],
        [ 0.0, -2.2,  0.00, 14.8, 3.9,  0.0],
        [ 1.4, -2.0,  0.44, 14.2, 3.7,  0.2],
        [ 2.6, -1.4,  0.74, 13.4, 3.4,  0.4],
    ]) {
        drawStriatedPetal(dx, dy, rot, len, wid, bias, [0.60, 0.18, 0.36], [0.85, 0.44, 0.60], [0.98, 0.80, 0.88], 0.89);
    }

    // Golden receptacle (seed head) & yellow stamens peeking from the heart of the blossom
    cr.save();
    cr.translate(0, -5.8);
    for (let i = -5; i <= 5; i++) {
        const sx = i * 0.72;
        cr.setSourceRGBA(0.95 * lum, 0.74 * lum, 0.18 * lum, 0.88);
        cr.setLineWidth(0.48);
        cr.newPath();
        cr.moveTo(sx * 0.6, 1.2);
        cr.lineTo(sx, -1.3 - Math.cos(i * 0.3) * 0.7);
        cr.stroke();
    }
    const rg = new Cairo.RadialGradient(-0.8, -0.5, 0.3, 0, 0, 3.5);
    rg.addColorStopRGBA(0.0, 0.98 * lum, 0.88 * lum, 0.34 * lum, 0.92);
    rg.addColorStopRGBA(0.7, 0.86 * lum, 0.68 * lum, 0.16 * lum, 0.92);
    rg.addColorStopRGBA(1.0, 0.62 * lum, 0.46 * lum, 0.10 * lum, 0.92);
    cr.setSource(rg);
    cr.save();
    cr.scale(3.5, 1.4);
    cr.newPath();
    cr.arc(0, 0, 1.0, 0, TWO_PI);
    cr.fill();
    cr.restore();
    cr.setSourceRGBA(0.46 * lum, 0.32 * lum, 0.06 * lum, 0.72);
    for (const [cx, cy] of [[-1.7, -0.2], [-0.6, -0.4], [0.6, -0.4], [1.7, -0.2], [-1.0, 0.4], [0.0, 0.5], [1.0, 0.4]]) {
        cr.newPath();
        cr.arc(cx, cy, 0.32, 0, TWO_PI);
        cr.fill();
    }
    cr.restore();

    // Wide sweeping mid-tier canopy petals
    for (const [dx, dy, rot, len, wid, bias] of [
        [-3.0, -0.3, -1.28, 15.0, 3.8, -0.9],
        [ 3.0, -0.3,  1.28, 15.0, 3.8,  0.9],
        [-2.2, -0.7, -0.92, 13.8, 4.0, -0.5],
        [ 2.2, -0.7,  0.92, 13.8, 4.0,  0.5],
        [-1.1, -1.0, -0.48, 12.8, 4.1, -0.2],
        [ 1.1, -1.0,  0.48, 12.8, 4.1,  0.2],
    ]) {
        drawStriatedPetal(dx, dy, rot, len, wid, bias, [0.68, 0.22, 0.40], [0.92, 0.56, 0.70], [1.00, 0.90, 0.94], 0.90);
    }

    // Front-facing cupped petals & plump basal petals hugging the stem top
    for (const [dx, dy, rot, len, wid, bias] of [
        [-2.0,  0.4, -1.52, 11.2, 3.5, -0.6],
        [ 2.0,  0.4,  1.52, 11.2, 3.5,  0.6],
        [-1.0,  0.2, -0.78, 10.2, 3.8, -0.2],
        [ 1.0,  0.2,  0.78, 10.2, 3.8,  0.2],
        [ 0.0,  0.4,  0.00, 10.8, 4.2,  0.0],
        [-0.9,  1.0, -2.18,  6.0, 2.7,  0.0],
        [ 0.9,  1.0,  2.18,  6.0, 2.7,  0.0],
        [ 0.0,  1.2,  Math.PI, 4.6, 2.8, 0.0],
    ]) {
        drawStriatedPetal(dx, dy, rot, len, wid, bias, [0.64, 0.20, 0.38], [0.88, 0.50, 0.66], [0.99, 0.86, 0.92], 0.90);
    }

    // Translucent crystal dewdrop hanging off the outer-left petal tip
    cr.setSourceRGBA(0.82 * lum, 0.94 * lum, 1.0 * lum, 0.68);
    cr.newPath();
    cr.moveTo(-17.4, -4.6);
    cr.curveTo(-18.0, -3.6, -17.9, -2.9, -17.4, -2.8);
    cr.curveTo(-16.9, -2.9, -16.8, -3.6, -17.4, -4.6);
    cr.closePath();
    cr.fill();

    cr.restore();
}

function drawEurasianTreeSparrowOnPad(cr, x, y, sc, lum) {
    cr.save();
    cr.translate(x, y);
    cr.scale(sc, sc);

    // 1. Soft contact shadow on lotus pad beneath feet
    const sg = new Cairo.RadialGradient(0.2, 6.2, 0.8, 0.2, 6.2, 7.2);
    sg.addColorStopRGBA(0, 0.01, 0.04, 0.03, 0.62);
    sg.addColorStopRGBA(1, 0.01, 0.04, 0.03, 0.0);
    cr.setSource(sg);
    cr.save();
    cr.scale(1.2, 0.45);
    cr.newPath();
    cr.arc(0.2, 13.5, 7.2, 0, TWO_PI);
    cr.fill();
    cr.restore();

    // 2. Slender warm flesh-ochre tarsi & articulated toes gripping the lotus leaf
    cr.setSourceRGBA(0.76 * lum, 0.52 * lum, 0.44 * lum, 0.98);
    cr.setLineWidth(0.62);
    cr.setLineCap(Cairo.LineCap.ROUND);
    cr.newPath();
    cr.moveTo(0.8, 2.4);
    cr.lineTo(2.1, 5.7);
    cr.moveTo(0.9, 5.7);
    cr.lineTo(3.9, 5.7);
    cr.moveTo(2.1, 5.7);
    cr.lineTo(3.4, 6.2);
    cr.stroke();

    cr.setSourceRGBA(0.84 * lum, 0.58 * lum, 0.48 * lum, 0.99);
    cr.newPath();
    cr.moveTo(-1.0, 2.7);
    cr.lineTo(0.4, 6.3);
    cr.moveTo(-1.1, 6.4);
    cr.lineTo(2.6, 6.4);
    cr.moveTo(0.4, 6.3);
    cr.lineTo(2.0, 7.0);
    cr.stroke();

    // 3. Slender notched sepia-brown tail with pale buff outer web
    cr.setSourceRGBA(0.30 * lum, 0.20 * lum, 0.14 * lum, 0.98);
    cr.newPath();
    cr.moveTo(-4.8, 1.0);
    cr.lineTo(-13.0, 4.5);
    cr.lineTo(-12.3, 5.8);
    cr.lineTo(-3.8, 2.6);
    cr.closePath();
    cr.fillPreserve();
    cr.setSourceRGBA(0.78 * lum, 0.68 * lum, 0.56 * lum, 0.62);
    cr.setLineWidth(0.32);
    cr.stroke();

    // 4. Plump warm-buff & pearl-taupe breast/belly
    const bg = new Cairo.RadialGradient(2.2, -0.5, 0.8, 0.0, 0.5, 7.8);
    bg.addColorStopRGBA(0.00, 0.92 * lum, 0.89 * lum, 0.83 * lum, 0.99);
    bg.addColorStopRGBA(0.58, 0.76 * lum, 0.70 * lum, 0.62 * lum, 0.99);
    bg.addColorStopRGBA(1.00, 0.48 * lum, 0.40 * lum, 0.32 * lum, 0.99);
    cr.setSource(bg);
    cr.newPath();
    cr.moveTo(-5.6, 1.6);
    cr.curveTo(-4.2, -2.2, -0.6, -4.8, 2.8, -4.6);
    cr.curveTo(5.8, -2.0, 5.4, 2.4, 2.2, 3.5);
    cr.curveTo(-1.0, 4.1, -4.0, 3.1, -5.6, 1.6);
    cr.closePath();
    cr.fill();

    // Downy feather texture strokes on breast
    cr.setSourceRGBA(0.56 * lum, 0.50 * lum, 0.42 * lum, 0.34);
    cr.setLineWidth(0.32);
    for (const [fx, fy, dx, dy] of [[3.2, -0.6, -0.8, 1.5], [2.0, 0.4, -1.0, 1.4], [0.6, 1.2, -1.2, 1.2]]) {
        cr.newPath();
        cr.moveTo(fx, fy);
        cr.lineTo(fx + dx, fy + dy);
        cr.stroke();
    }

    // 5. Layered chestnut, sepia & buff-edged folded wing with two white wing-bars
    const wg = new Cairo.LinearGradient(-5.5, -2.8, 2.0, 2.5);
    wg.addColorStopRGBA(0.00, 0.60 * lum, 0.34 * lum, 0.17 * lum, 0.99);
    wg.addColorStopRGBA(0.55, 0.40 * lum, 0.23 * lum, 0.13 * lum, 0.99);
    wg.addColorStopRGBA(1.00, 0.16 * lum, 0.11 * lum, 0.08 * lum, 0.99);
    cr.setSource(wg);
    cr.newPath();
    cr.moveTo(1.0, -3.5);
    cr.curveTo(-2.6, -3.4, -5.8, -0.6, -7.2, 2.3);
    cr.curveTo(-3.4, 2.7, 0.8, 1.3, 2.0, -1.0);
    cr.closePath();
    cr.fill();

    cr.setSourceRGBA(0.12 * lum, 0.08 * lum, 0.06 * lum, 0.78);
    cr.setLineWidth(0.55);
    for (const [x0, y0, x1, y1] of [[-0.4, -2.5, -3.2, -0.8], [-1.6, -1.4, -4.8, 0.4], [-2.8, -0.2, -6.2, 1.6]]) {
        cr.newPath();
        cr.moveTo(x0, y0);
        cr.lineTo(x1, y1);
        cr.stroke();
    }
    cr.setSourceRGBA(0.88 * lum, 0.78 * lum, 0.62 * lum, 0.82);
    cr.setLineWidth(0.36);
    for (const [x0, y0, x1, y1] of [[-0.2, -2.2, -3.0, -0.5], [-1.4, -1.1, -4.6, 0.7], [-2.6, 0.1, -6.0, 1.9]]) {
        cr.newPath();
        cr.moveTo(x0, y0);
        cr.lineTo(x1, y1);
        cr.stroke();
    }

    cr.setSourceRGBA(0.96 * lum, 0.94 * lum, 0.88 * lum, 0.92);
    cr.setLineWidth(0.58);
    cr.newPath();
    cr.moveTo(0.2, -1.9);
    cr.lineTo(-1.4, -0.3);
    cr.moveTo(-1.4, -0.9);
    cr.lineTo(-3.2, 0.7);
    cr.stroke();

    // 6. Sculpted head & rich chestnut-mahogany crown flowing smoothly into the nape
    const cg = new Cairo.RadialGradient(3.2, -6.4, 0.5, 2.8, -4.8, 4.6);
    cg.addColorStopRGBA(0.0, 0.66 * lum, 0.32 * lum, 0.18 * lum, 0.99);
    cg.addColorStopRGBA(0.65, 0.48 * lum, 0.21 * lum, 0.12 * lum, 0.99);
    cg.addColorStopRGBA(1.0, 0.34 * lum, 0.15 * lum, 0.09 * lum, 0.99);
    cr.setSource(cg);
    cr.newPath();
    cr.moveTo(0.0, -3.4);
    cr.curveTo(0.0, -6.6, 2.2, -8.2, 4.5, -7.6);
    cr.curveTo(6.2, -7.1, 6.7, -5.6, 6.2, -4.2);
    cr.curveTo(5.2, -2.4, 2.0, -2.2, 0.0, -3.4);
    cr.closePath();
    cr.fill();

    // 7. Snow-white cheek patch & sub-triangular black ear-covert spot
    cr.setSourceRGBA(0.97 * lum, 0.96 * lum, 0.93 * lum, 0.99);
    cr.newPath();
    cr.moveTo(5.6, -4.8);
    cr.curveTo(4.2, -5.6, 1.8, -5.3, 1.0, -3.9);
    cr.curveTo(0.9, -2.5, 2.8, -2.1, 4.8, -2.7);
    cr.closePath();
    cr.fill();

    cr.setSourceRGBA(0.08, 0.07, 0.07, 0.97);
    cr.newPath();
    cr.moveTo(1.8, -4.2);
    cr.curveTo(2.5, -4.6, 3.3, -4.2, 3.2, -3.4);
    cr.curveTo(3.0, -2.9, 2.0, -3.0, 1.7, -3.6);
    cr.closePath();
    cr.fill();

    // 8. Velvety black lores & feathered black chin/throat bib
    cr.setSourceRGBA(0.06, 0.05, 0.06, 0.99);
    cr.newPath();
    cr.moveTo(6.2, -5.2);
    cr.lineTo(4.5, -5.6);
    cr.lineTo(4.4, -3.5);
    cr.lineTo(3.7, -1.4);
    cr.curveTo(5.0, -1.2, 5.8, -1.8, 6.1, -3.4);
    cr.closePath();
    cr.fill();

    // 9. Stout conical dark seed-eating bill with horn highlight
    cr.setSourceRGBA(0.15, 0.16, 0.19, 0.99);
    cr.newPath();
    cr.moveTo(5.9, -6.0);
    cr.lineTo(8.5, -5.1);
    cr.lineTo(5.9, -4.1);
    cr.closePath();
    cr.fill();
    cr.setSourceRGBA(0.68, 0.72, 0.78, 0.60);
    cr.setLineWidth(0.32);
    cr.newPath();
    cr.moveTo(6.0, -5.8);
    cr.lineTo(8.2, -5.1);
    cr.stroke();

    // 10. Glossy dark eye with crisp white catchlight
    cr.setSourceRGBA(0.04, 0.04, 0.05, 0.99);
    cr.newPath();
    cr.arc(4.7, -5.5, 0.74, 0, TWO_PI);
    cr.fill();
    cr.setSourceRGBA(1.0, 1.0, 1.0, 0.96);
    cr.newPath();
    cr.arc(4.88, -5.68, 0.25, 0, TWO_PI);
    cr.fill();

    cr.restore();
}

function drawStormFrogsFloor(cr, width, height, scale, time, night) {
    const sh = sceneHeight(width, height);
    const groundOffset = height - sh;
    const floorTop = groundOffset + 0.685 * sh;

    const marshG = new Cairo.LinearGradient(0, floorTop - 10 * scale, 0, height);
    marshG.addColorStopRGBA(0, 0.05, 0.14, 0.18, 0.0);
    marshG.addColorStopRGBA(0.28, 0.05, 0.14, 0.18, night ? 0.42 : 0.36);
    marshG.addColorStopRGBA(1, 0.02, 0.08, 0.12, night ? 0.72 : 0.62);
    cr.setSource(marshG);
    cr.rectangle(0, floorTop - 10 * scale, width, height - floorTop + 10 * scale);
    cr.fill();

    const lum = night ? 0.68 : 0.74;

    // 1. Mid-water stepping-stone lotus pad + pink bud in Mon–Tue pocket (x = 0.500w, y = h - 89*scale)
    const x1 = width * 0.500, y1 = height - 89 * scale, r1 = 17.5 * scale;
    drawStormPadShadow(cr, x1, y1, r1, 0.55, scale);
    drawKoiLotusPadLeaf(cr, x1, y1, r1, 0.55, scale, lum);
    drawKoiLotusBud(cr, x1 - 12 * scale, y1 - 5 * scale, scale * 0.90, -0.20, lum);

    // 2. Distant flowerless lotus pad in Tue–Wed pocket (x = 0.733w, y = h - 95*scale)
    const x2 = width * 0.733, y2 = height - 95 * scale, r2 = 15.5 * scale;
    drawStormPadShadow(cr, x2, y2, r2, 2.35, scale);
    drawKoiLotusPadLeaf(cr, x2, y2, r2, 2.35, scale, lum);

    // 3. Flowerless Twin-Leaf Sacred Lotus pads in Fri–Sat / Sat–Sun alley (x = 0.733w, y = h - 43*scale)
    const x3 = width * 0.733, y3 = height - 43 * scale, r3 = 24.5 * scale;
    const x3c = x3 - 24 * scale, y3c = y3 + 16 * scale, r3c = 14.5 * scale;
    drawStormPadShadow(cr, x3c, y3c, r3c, 3.6, scale);
    drawStormPadShadow(cr, x3, y3, r3, 0.42, scale);
    drawKoiLotusPadLeaf(cr, x3c, y3c, r3c, 3.6, scale, lum);
    drawKoiLotusPadLeaf(cr, x3, y3, r3, 0.42, scale, lum);

    // 4. Option B: Eurasian Tree Sparrow (Passer montanus) standing on the Thu–Fri lotus pad,
    // sheltering under an overarching pink Sacred Lotus flower whose stem emerges from the pad's V-split opening!
    const xf = width * 0.258, yf = height - 42 * scale, rf = 27.5 * scale;
    const padNotch = 0.08, padGap = 0.28;

    drawStormPadShadow(cr, xf, yf, rf, padNotch, scale, padGap);
    drawKoiLotusPadLeaf(cr, xf, yf, rf, padNotch, scale, lum, padGap);

    // Stem base inside the lotus pad's right-hand V-split opening (with concentric water meniscus ripple)
    const stemX0 = xf + 13.5 * scale, stemY0 = yf + 1.2 * scale;
    const sway = Math.sin((time - 1.1) * 1.6) * 0.8 * scale;
    const stemX1 = xf + 6.0 * scale + sway, stemY1 = yf - 42.0 * scale;

    cr.save();
    cr.translate(stemX0, stemY0);
    cr.scale(1.0, 0.56);
    cr.setSourceRGBA(0.66, 0.82, 0.92, 0.22 * lum);
    cr.setLineWidth(Math.max(0.55, 0.65 * scale));
    cr.newPath();
    cr.arc(0, 0, 3.0 * scale, 0, TWO_PI);
    cr.stroke();
    cr.restore();

    // Arching green lotus stem emerging out of the V-split opening up to the flower canopy
    cr.save();
    cr.setLineCap(Cairo.LineCap.ROUND);
    cr.setSourceRGBA(0.11 * lum, 0.28 * lum, 0.17 * lum, 0.90);
    cr.setLineWidth(Math.max(1.6, 2.4 * scale));
    cr.newPath();
    cr.moveTo(stemX0, stemY0);
    cr.curveTo(xf + 14.5 * scale, yf - 19 * scale, xf + 11.0 * scale + sway * 0.6, yf - 31 * scale, stemX1, stemY1);
    cr.stroke();

    cr.setSourceRGBA(0.38 * lum, 0.66 * lum, 0.34 * lum, 0.88);
    cr.setLineWidth(Math.max(0.8, 1.15 * scale));
    cr.newPath();
    cr.moveTo(stemX0 - 0.4 * scale, stemY0);
    cr.curveTo(xf + 14.1 * scale, yf - 19 * scale, xf + 10.6 * scale + sway * 0.6, yf - 31 * scale, stemX1 - 0.4 * scale, stemY1);
    cr.stroke();
    cr.restore();

    // Eurasian Tree Sparrow standing on the solid left/center lobe of the lotus pad leaf
    drawEurasianTreeSparrowOnPad(cr, xf - 5.0 * scale, yf - 9.0 * scale, 1.38 * scale, lum);

    // Overhanging pink Sacred Lotus flower canopy tilted slightly left to roof over the sparrow
    drawUmbrellaLotusFlower(cr, stemX1, stemY1, 1.24 * scale, -0.08 + sway * 0.012, lum);

    // Subtle feathered storm-atmosphere veil to gently recess floor elements behind foreground UI labels
    const veilG = new Cairo.LinearGradient(0, floorTop - 12 * scale, 0, height);
    veilG.addColorStopRGBA(0, 0.03, 0.08, 0.12, 0.0);
    veilG.addColorStopRGBA(0.22, 0.03, 0.08, 0.12, night ? 0.10 : 0.06);
    veilG.addColorStopRGBA(1, 0.02, 0.06, 0.10, night ? 0.12 : 0.08);
    cr.setSource(veilG);
    cr.rectangle(0, floorTop - 12 * scale, width, height - floorTop + 12 * scale);
    cr.fill();
}

/* C1 (Clear Day 55–75°F & Overcast/Cloudy Day): Option C — 2 Dutch Windmills (Foreground + Horizon) & 3 Realistic Pastoral Oaks */
function makeHazeTinter(subdued, lum, distFade) {
    const hazeR = subdued ? 0.56 : 0.62;
    const hazeG = subdued ? 0.64 : 0.75;
    const hazeB = subdued ? 0.70 : 0.84;
    const aMul = 1.0 - distFade * 0.22;
    return {
        aMul,
        tint: (r, g, b) => [
            (r * lum) * (1 - distFade) + hazeR * distFade,
            (g * lum) * (1 - distFade) + hazeG * distFade,
            (b * lum) * (1 - distFade) + hazeB * distFade,
        ],
    };
}

function drawRealisticPastoralOak(cr, x, baseY, treeHeight, subdued = true, bend = 0, seed = 1, distFade = 0.0) {
    cr.save();
    const r = seededRand(seed * 173 + 19);
    const s = treeHeight / 50;
    const lum = subdued ? 0.84 : 0.98;
    const { tint, aMul } = makeHazeTinter(subdued, lum, distFade);

    // 1. Soft ground shadow under tree
    cr.save();
    cr.translate(x + 2 * s, baseY + 1.5 * s);
    cr.scale(14 * s, 3.6 * s);
    const shG = new Cairo.RadialGradient(0, 0, 0.1, 0, 0, 1.0);
    shG.addColorStopRGBA(0, ...tint(0.05, 0.11, 0.07), 0.34 * aMul);
    shG.addColorStopRGBA(1, ...tint(0.05, 0.11, 0.07), 0.0);
    cr.setSource(shG);
    cr.newPath();
    cr.arc(0, 0, 1.0, 0, TWO_PI);
    cr.fill();
    cr.restore();

    const forkX = x + bend * 0.25;
    const forkY = baseY - treeHeight * 0.40;

    const traceScallopedDome = (cx, cy, rx, ry, lobes = 11, ph = 0) => {
        cr.newPath();
        const steps = 44;
        for (let i = 0; i <= steps; i++) {
            const u = i / steps;
            const a = u * TWO_PI;
            const bump = 1.0
                + 0.11 * Math.sin(a * lobes + ph)
                + 0.06 * Math.cos(a * (lobes - 3) - ph * 0.7);
            const px = cx + Math.cos(a) * rx * bump;
            const py = cy + Math.sin(a) * ry * bump;
            if (i === 0) cr.moveTo(px, py);
            else cr.lineTo(px, py);
        }
        cr.closePath();
    };

    const domes = [
        [-11.5 * s, -28.0 * s, 9.2 * s, 6.2 * s, 0.4],
        [ 11.8 * s, -26.5 * s, 9.0 * s, 6.0 * s, 1.7],
        [ -6.2 * s, -36.5 * s, 10.2 * s, 6.8 * s, 2.8],
        [  6.8 * s, -35.5 * s,  9.6 * s, 6.5 * s, 4.1],
        [  0.4 * s, -42.5 * s,  9.2 * s, 6.4 * s, 5.3],
    ];

    // 2. Deep interior shadow foliage behind the boughs
    for (const [ox, oy, rx, ry, ph] of domes) {
        const cx = x + bend * 0.55 + ox;
        const cy = baseY + oy + 2.2 * s;
        traceScallopedDome(cx, cy, rx * 0.98, ry * 0.96, 10, ph);
        cr.setSourceRGBA(...tint(0.10, 0.19, 0.12), 0.92 * aMul);
        cr.fill();
    }

    // 3. Gnarled 3D-shaded trunk with root flare (nebari) & exposed primary limbs
    const baseW = 3.1 * s;
    const trkG = new Cairo.LinearGradient(x - baseW * 1.4, baseY, x + baseW * 1.4, baseY);
    trkG.addColorStopRGBA(0.0, ...tint(0.40, 0.29, 0.20), 0.96 * aMul);
    trkG.addColorStopRGBA(0.55, ...tint(0.28, 0.20, 0.14), 0.96 * aMul);
    trkG.addColorStopRGBA(1.0, ...tint(0.17, 0.12, 0.08), 0.96 * aMul);
    cr.setSource(trkG);

    cr.newPath();
    cr.moveTo(x - baseW * 1.35, baseY + 2.2 * s);
    cr.curveTo(x - baseW * 0.85, baseY - 3 * s, x - baseW * 0.72, baseY - 11 * s, forkX - baseW * 0.52, forkY);
    cr.lineTo(forkX + baseW * 0.52, forkY);
    cr.curveTo(x + baseW * 0.72, baseY - 11 * s, x + baseW * 0.85, baseY - 3 * s, x + baseW * 1.35, baseY + 2.2 * s);
    cr.closePath();
    cr.fill();

    const limbs = [
        [forkX - 0.8 * s, forkY + 1 * s, 1.45 * s, forkX - 5.5 * s, forkY - 4 * s, forkX - 9.0 * s, forkY - 7 * s, x + bend * 0.5 - 12.0 * s, baseY - 28.5 * s, 0.55 * s],
        [forkX + 0.8 * s, forkY + 1 * s, 1.40 * s, forkX + 5.5 * s, forkY - 3.5 * s, forkX + 9.2 * s, forkY - 6.5 * s, x + bend * 0.5 + 12.2 * s, baseY - 27.0 * s, 0.55 * s],
        [forkX - 0.3 * s, forkY, 1.55 * s, forkX - 2.5 * s, forkY - 7 * s, forkX - 5.0 * s, forkY - 12 * s, x + bend * 0.6 - 6.5 * s, baseY - 37.0 * s, 0.50 * s],
        [forkX + 0.4 * s, forkY, 1.45 * s, forkX + 2.8 * s, forkY - 6.5 * s, forkX + 5.2 * s, forkY - 11.5 * s, x + bend * 0.6 + 6.8 * s, baseY - 36.0 * s, 0.50 * s],
        [forkX, forkY - 2 * s, 1.25 * s, forkX - 0.5 * s, forkY - 10 * s, forkX + 0.8 * s, forkY - 16 * s, x + bend * 0.7 + 0.4 * s, baseY - 42.5 * s, 0.45 * s],
    ];
    for (const b of limbs) {
        drawSmoothLimb(cr, b[0], b[1], b[2], b[3], b[4], b[5], b[6], b[7], b[8], b[9]);
        cr.fill();
    }

    // Subtle vertical bark texture lines on trunk
    cr.setSourceRGBA(...tint(0.14, 0.09, 0.06), 0.45 * aMul);
    cr.setLineWidth(0.45 * s);
    cr.newPath();
    cr.moveTo(x - 0.5 * s, baseY + 1 * s);
    cr.curveTo(x - 0.3 * s, baseY - 8 * s, forkX - 0.2 * s, forkY + 5 * s, forkX, forkY);
    cr.moveTo(x + 0.9 * s, baseY + 1.5 * s);
    cr.curveTo(x + 0.6 * s, baseY - 7 * s, forkX + 0.5 * s, forkY + 4 * s, forkX + 0.4 * s, forkY + 1 * s);
    cr.stroke();

    // 4. Unified canopy gradient with toned-down luminance matching the windmill & hills
    const crownX = x + bend * 0.55;
    const crownY = baseY - 34.5 * s;
    const globalCanopyG = new Cairo.LinearGradient(
        crownX - 18 * s, crownY - 14 * s,
        crownX + 18 * s, crownY + 14 * s
    );
    if (subdued) {
        globalCanopyG.addColorStopRGBA(0.00, ...tint(0.30, 0.44, 0.28), 0.96 * aMul);
        globalCanopyG.addColorStopRGBA(0.45, ...tint(0.22, 0.35, 0.22), 0.96 * aMul);
        globalCanopyG.addColorStopRGBA(0.82, ...tint(0.16, 0.27, 0.17), 0.96 * aMul);
        globalCanopyG.addColorStopRGBA(1.00, ...tint(0.12, 0.21, 0.14), 0.96 * aMul);
    } else {
        globalCanopyG.addColorStopRGBA(0.00, ...tint(0.36, 0.54, 0.29), 0.97 * aMul);
        globalCanopyG.addColorStopRGBA(0.45, ...tint(0.26, 0.42, 0.22), 0.97 * aMul);
        globalCanopyG.addColorStopRGBA(0.82, ...tint(0.18, 0.32, 0.17), 0.97 * aMul);
        globalCanopyG.addColorStopRGBA(1.00, ...tint(0.13, 0.25, 0.13), 0.97 * aMul);
    }

    for (let i = 0; i < domes.length; i++) {
        const [ox, oy, rx, ry, ph] = domes[i];
        const cx = crownX + ox;
        const cy = baseY + oy;

        if (i >= 2) {
            traceScallopedDome(cx + 0.9 * s, cy + 1.6 * s, rx * 0.90, ry * 0.86, 11, ph);
            cr.setSourceRGBA(...tint(0.10, 0.19, 0.12), 0.30 * aMul);
            cr.fill();
        }

        traceScallopedDome(cx, cy, rx, ry, 11, ph);
        cr.setSource(globalCanopyG);
        cr.fill();

        traceScallopedDome(cx - rx * 0.16, cy - ry * 0.18, rx * 0.68, ry * 0.64, 9, ph + 1.1);
        cr.setSourceRGBA(
            ...tint(subdued ? 0.32 : 0.39, subdued ? 0.47 : 0.57, subdued ? 0.30 : 0.31),
            0.22 * aMul
        );
        cr.fill();

        cr.setSourceRGBA(
            ...tint(subdued ? 0.34 : 0.42, subdued ? 0.49 : 0.60, subdued ? 0.31 : 0.32),
            0.46 * aMul
        );
        for (let k = 0; k < 6; k++) {
            const a = -Math.PI * 0.90 + (k / 5) * Math.PI * 0.75 + r(-0.08, 0.08);
            const lx = cx + Math.cos(a) * rx * r(0.52, 0.82);
            const ly = cy + Math.sin(a) * ry * r(0.52, 0.82);
            const lr = r(1.3, 2.0) * s;
            cr.save();
            cr.translate(lx, ly);
            cr.rotate(a + 1.2);
            cr.scale(1.35, 0.72);
            cr.newPath();
            cr.arc(0, 0, lr, 0, TWO_PI);
            cr.restore();
            cr.fill();
        }
    }

    cr.restore();
}

function drawDutchWindmill(cr, x, y, scale, time = 1.1, subdued = true, distFade = 0.0, sailPhase = 0.0) {
    cr.save();
    cr.translate(x, y);
    cr.scale(1.62 * scale, 1.62 * scale);

    const lum = subdued ? 0.84 : 0.98;
    const { tint, aMul } = makeHazeTinter(subdued, lum, distFade);

    // Elliptical ground shadow
    cr.save();
    cr.scale(10.5, 3.2);
    const sg = new Cairo.RadialGradient(0, 0.5, 0.1, 0.3, 0.6, 1.0);
    sg.addColorStopRGBA(0, ...tint(0.04, 0.12, 0.06), 0.36 * aMul);
    sg.addColorStopRGBA(0.65, ...tint(0.05, 0.14, 0.07), 0.18 * aMul);
    sg.addColorStopRGBA(1, ...tint(0.05, 0.14, 0.07), 0.0);
    cr.setSource(sg);
    cr.newPath();
    cr.arc(0, 0.5, 1.0, 0, TWO_PI);
    cr.fill();
    cr.restore();

    // Lower Octagonal Red-Brown Brick Tower Base (y = -5.0 .. +2.4)
    const brickG = new Cairo.LinearGradient(-5.2, 0, 5.2, 0);
    brickG.addColorStopRGBA(0.00, ...tint(0.62, 0.33, 0.24), 0.97 * aMul);
    brickG.addColorStopRGBA(0.35, ...tint(0.54, 0.28, 0.20), 0.97 * aMul);
    brickG.addColorStopRGBA(0.75, ...tint(0.39, 0.20, 0.15), 0.97 * aMul);
    brickG.addColorStopRGBA(1.00, ...tint(0.28, 0.14, 0.11), 0.97 * aMul);
    cr.setSource(brickG);
    cr.newPath();
    cr.moveTo(-5.3, 2.4);
    cr.lineTo(-4.5, -5.0);
    cr.lineTo( 4.5, -5.0);
    cr.lineTo( 5.3, 2.4);
    cr.closePath();
    cr.fill();

    // Horizontal mortar courses on brick base
    cr.setSourceRGBA(...tint(0.76, 0.68, 0.60), 0.22 * aMul);
    cr.setLineWidth(0.24);
    for (let by = -4.0; by <= 1.8; by += 1.15) {
        const hw = 4.5 + ((by + 5.0) / 7.4) * 0.75;
        cr.newPath();
        cr.moveTo(-hw, by);
        cr.lineTo( hw, by);
        cr.stroke();
    }

    // Arched double wooden entrance door with pale stone architrave
    cr.setSourceRGBA(...tint(0.76, 0.72, 0.64), 0.90 * aMul);
    cr.newPath();
    cr.moveTo(-1.65, 2.4);
    cr.lineTo(-1.65, -0.8);
    cr.arc(0, -0.8, 1.65, Math.PI, 0);
    cr.lineTo(1.65, 2.4);
    cr.closePath();
    cr.fill();

    cr.setSourceRGBA(...tint(0.22, 0.15, 0.11), 0.95 * aMul);
    cr.newPath();
    cr.moveTo(-1.25, 2.4);
    cr.lineTo(-1.25, -0.7);
    cr.arc(0, -0.7, 1.25, Math.PI, 0);
    cr.lineTo(1.25, 2.4);
    cr.closePath();
    cr.fill();

    // Upper Tapered Octagonal Thatch / Timber Smock Body (y = -15.8 .. -5.0)
    const smockG = new Cairo.LinearGradient(-4.5, 0, 4.5, 0);
    smockG.addColorStopRGBA(0.00, ...tint(0.52, 0.46, 0.35), 0.97 * aMul);
    smockG.addColorStopRGBA(0.28, ...tint(0.46, 0.41, 0.31), 0.97 * aMul);
    smockG.addColorStopRGBA(0.68, ...tint(0.34, 0.30, 0.23), 0.97 * aMul);
    smockG.addColorStopRGBA(1.00, ...tint(0.23, 0.20, 0.15), 0.97 * aMul);
    cr.setSource(smockG);
    cr.newPath();
    cr.moveTo(-4.5, -5.0);
    cr.lineTo(-3.25, -15.8);
    cr.lineTo( 3.25, -15.8);
    cr.lineTo( 4.5, -5.0);
    cr.closePath();
    cr.fill();

    // Octagonal facet seam lines & white-painted Dutch corner trim ribs
    cr.setSourceRGBA(...tint(0.84, 0.81, 0.74), 0.65 * aMul);
    cr.setLineWidth(0.38);
    cr.newPath();
    cr.moveTo(-4.35, -5.0);
    cr.lineTo(-3.15, -15.6);
    cr.moveTo(-1.85, -5.0);
    cr.lineTo(-1.35, -15.6);
    cr.stroke();

    cr.setSourceRGBA(...tint(0.16, 0.14, 0.11), 0.48 * aMul);
    cr.newPath();
    cr.moveTo(1.85, -5.0);
    cr.lineTo(1.35, -15.6);
    cr.stroke();

    // Two mullioned 4-pane windows with white frames
    for (const [wx, wy, ww, wh] of [[0, -11.4, 1.8, 2.3], [0, -7.8, 1.9, 2.1]]) {
        cr.setSourceRGBA(...tint(0.84, 0.81, 0.74), 0.92 * aMul);
        cr.rectangle(wx - ww * 0.5 - 0.25, wy - wh * 0.5 - 0.25, ww + 0.5, wh + 0.5);
        cr.fill();
        cr.setSourceRGBA(...tint(0.14, 0.18, 0.22), 0.94 * aMul);
        cr.rectangle(wx - ww * 0.5, wy - wh * 0.5, ww, wh);
        cr.fill();
        cr.setSourceRGBA(...tint(0.82, 0.79, 0.72), 0.85 * aMul);
        cr.setLineWidth(0.28);
        cr.newPath();
        cr.moveTo(wx, wy - wh * 0.5); cr.lineTo(wx, wy + wh * 0.5);
        cr.moveTo(wx - ww * 0.5, wy); cr.lineTo(wx + ww * 0.5, wy);
        cr.stroke();
    }

    // Cantilevered Wooden Stage Gallery (Stelling) at y = -5.0
    cr.setSourceRGBA(...tint(0.38, 0.28, 0.20), 0.92 * aMul);
    cr.setLineWidth(0.65);
    cr.setLineCap(Cairo.LineCap.ROUND);
    cr.newPath();
    for (const [x0, y0, x1, y1] of [
        [-4.6, -1.2, -6.8, -4.9],
        [-4.5, -2.8, -5.7, -4.9],
        [ 4.6, -1.2,  6.8, -4.9],
        [ 4.5, -2.8,  5.7, -4.9],
    ]) {
        cr.moveTo(x0, y0);
        cr.lineTo(x1, y1);
    }
    cr.stroke();

    cr.setSourceRGBA(...tint(0.46, 0.34, 0.24), 0.96 * aMul);
    cr.rectangle(-7.1, -5.3, 14.2, 0.75);
    cr.fill();

    cr.setSourceRGBA(...tint(0.80, 0.76, 0.68), 0.85 * aMul);
    cr.setLineWidth(0.38);
    cr.newPath();
    cr.moveTo(-6.9, -6.6);
    cr.lineTo( 6.9, -6.6);
    cr.moveTo(-6.9, -5.9);
    cr.lineTo( 6.9, -5.9);
    for (let px = -6.8; px <= 6.85; px += 1.36) {
        cr.moveTo(px, -5.2);
        cr.lineTo(px, -6.7);
    }
    cr.stroke();

    // Domed Boat-Shaped Cap (Kap) with white cornice trim
    cr.setSourceRGBA(...tint(0.82, 0.79, 0.72), 0.90 * aMul);
    cr.rectangle(-3.55, -16.1, 7.1, 0.55);
    cr.fill();

    const capG = new Cairo.LinearGradient(-3.6, -19.2, 3.6, -15.8);
    capG.addColorStopRGBA(0.0, ...tint(0.36, 0.32, 0.26), 0.97 * aMul);
    capG.addColorStopRGBA(0.5, ...tint(0.26, 0.23, 0.19), 0.97 * aMul);
    capG.addColorStopRGBA(1.0, ...tint(0.16, 0.14, 0.12), 0.97 * aMul);
    cr.setSource(capG);
    cr.newPath();
    cr.moveTo(-3.6, -15.8);
    cr.curveTo(-3.8, -18.2, -1.8, -19.4, 0, -19.4);
    cr.curveTo( 1.8, -19.4,  3.8, -18.2, 3.6, -15.8);
    cr.closePath();
    cr.fill();

    // 4 Realistic Dutch Lattice & Canvas Sails (Wieken) centered at (0, -16.8)
    cr.save();
    cr.translate(0, -16.8);
    cr.rotate(0.76 + sailPhase + (time - 1.1) * 0.55);

    for (let b = 0; b < 4; b++) {
        cr.save();
        cr.rotate((b * Math.PI) / 2);

        cr.setSourceRGBA(0.04, 0.06, 0.08, 0.14 * aMul);
        cr.rectangle(-0.1, -13.2, 3.3, 11.2);
        cr.fill();

        // Leading-edge wooden windboard (stormplank)
        cr.setSourceRGBA(...tint(0.76, 0.70, 0.60), 0.90 * aMul);
        cr.newPath();
        cr.moveTo(-0.2, -2.2);
        cr.lineTo(-0.78, -2.5);
        cr.lineTo(-0.68, -13.2);
        cr.lineTo(-0.2, -13.4);
        cr.closePath();
        cr.fill();

        // Trailing-side billowing canvas sailcloth (zeildoek)
        const sailG = new Cairo.LinearGradient(0.2, -13.2, 3.1, -2.2);
        sailG.addColorStopRGBA(0.0, ...tint(0.86, 0.82, 0.73), 0.88 * aMul);
        sailG.addColorStopRGBA(0.6, ...tint(0.78, 0.72, 0.63), 0.86 * aMul);
        sailG.addColorStopRGBA(1.0, ...tint(0.66, 0.60, 0.50), 0.84 * aMul);
        cr.setSource(sailG);
        cr.newPath();
        cr.moveTo(0.2, -2.2);
        cr.lineTo(2.95, -2.4);
        cr.lineTo(2.75, -13.1);
        cr.lineTo(0.2, -13.2);
        cr.closePath();
        cr.fill();

        // Wooden lattice bars (hekwerk): 2 longitudinal stringers + 10 transverse rungs
        cr.setSourceRGBA(...tint(0.30, 0.20, 0.13), 0.90 * aMul);
        cr.setLineWidth(0.26);
        cr.newPath();
        cr.moveTo(1.15, -2.3); cr.lineTo(1.08, -13.15);
        cr.moveTo(2.05, -2.35); cr.lineTo(1.92, -13.12);
        for (let r = 0; r <= 9; r++) {
            const ry = -2.4 - r * 1.18;
            const rw = 2.95 - r * 0.02;
            cr.moveTo(-0.65, ry);
            cr.lineTo(rw, ry);
        }
        cr.stroke();

        // Main central iron/timber whip stock (roede)
        cr.setSourceRGBA(...tint(0.24, 0.16, 0.10), 0.96 * aMul);
        cr.setLineWidth(0.62);
        cr.newPath();
        cr.moveTo(0, 0);
        cr.lineTo(0, -13.6);
        cr.stroke();

        cr.restore();
    }

    // Cast-iron windshaft hub (askop) with white collar ring
    cr.setSourceRGBA(...tint(0.80, 0.78, 0.72), 0.94 * aMul);
    cr.newPath();
    cr.arc(0, 0, 1.55, 0, TWO_PI);
    cr.fill();
    cr.setSourceRGBA(...tint(0.18, 0.20, 0.22), 0.96 * aMul);
    cr.newPath();
    cr.arc(0, 0, 1.05, 0, TWO_PI);
    cr.fill();

    cr.restore();
    cr.restore();
}

function drawClearHillsFloor(cr, width, height, scale, time, subdued = false) {
    const sh = sceneHeight(width, height);
    const groundOffset = height - sh;
    const floorTop = groundOffset + 0.685 * sh;

    // 1. Hill 1 (Distant horizon ridge — subtle atmospheric depth)
    const h1 = new Cairo.LinearGradient(0, floorTop - 14 * scale, 0, height);
    if (subdued) {
        h1.addColorStopRGBA(0.00, 0.54, 0.66, 0.59, 0.28);
        h1.addColorStopRGBA(0.45, 0.50, 0.62, 0.55, 0.30);
        h1.addColorStopRGBA(1.00, 0.46, 0.58, 0.50, 0.24);
    } else {
        h1.addColorStopRGBA(0.00, 0.50, 0.75, 0.48, 0.34);
        h1.addColorStopRGBA(0.45, 0.44, 0.69, 0.42, 0.38);
        h1.addColorStopRGBA(1.00, 0.38, 0.62, 0.36, 0.32);
    }
    cr.setSource(h1);
    cr.newPath();
    cr.moveTo(0, floorTop + 8 * scale);
    cr.curveTo(width * 0.30, floorTop - 12 * scale, width * 0.62, floorTop + 6 * scale, width, floorTop + 2 * scale);
    cr.lineTo(width, height);
    cr.lineTo(0, height);
    cr.closePath();
    cr.fill();

    // Distant oak on Hill 1 ridge (gentle depth fade so details stay crisp)
    const ridgeFade = subdued ? 0.28 : 0.22;
    drawRealisticPastoralOak(cr, width * 0.733, floorTop + 12 * scale, 24 * scale, subdued, 0.4 * scale, 69, ridgeFade);

    // 2. Subtle Valley Atmospheric Mist Veil
    const mistG = new Cairo.LinearGradient(0, floorTop - 8 * scale, 0, floorTop + 38 * scale);
    if (subdued) {
        mistG.addColorStopRGBA(0.00, 0.74, 0.80, 0.85, 0.0);
        mistG.addColorStopRGBA(0.42, 0.74, 0.80, 0.85, 0.10);
        mistG.addColorStopRGBA(0.75, 0.74, 0.80, 0.85, 0.06);
        mistG.addColorStopRGBA(1.00, 0.74, 0.80, 0.85, 0.0);
    } else {
        mistG.addColorStopRGBA(0.00, 0.82, 0.91, 0.97, 0.0);
        mistG.addColorStopRGBA(0.45, 0.82, 0.91, 0.97, 0.06);
        mistG.addColorStopRGBA(1.00, 0.82, 0.91, 0.97, 0.0);
    }
    cr.setSource(mistG);
    cr.rectangle(0, floorTop - 8 * scale, width, 46 * scale);
    cr.fill();

    // 3. Hill 2 (Midground slope — silvery-sage tone that preserves icon & text contrast)
    const h2 = new Cairo.LinearGradient(0, floorTop + 32 * scale, 0, height);
    if (subdued) {
        h2.addColorStopRGBA(0.00, 0.48, 0.62, 0.51, 0.34);
        h2.addColorStopRGBA(0.50, 0.44, 0.58, 0.47, 0.34);
        h2.addColorStopRGBA(1.00, 0.40, 0.54, 0.43, 0.28);
    } else {
        h2.addColorStopRGBA(0.00, 0.44, 0.70, 0.40, 0.38);
        h2.addColorStopRGBA(0.50, 0.38, 0.64, 0.34, 0.40);
        h2.addColorStopRGBA(1.00, 0.33, 0.58, 0.30, 0.36);
    }
    cr.setSource(h2);
    cr.newPath();
    cr.moveTo(0, floorTop + 46 * scale);
    cr.curveTo(width * 0.36, floorTop + 58 * scale, width * 0.68, floorTop + 40 * scale, width, floorTop + 42 * scale);
    cr.lineTo(width, height);
    cr.lineTo(0, height);
    cr.closePath();
    cr.fill();

    // Split-rail wooden fence on Hill 2 (light midground depth fade)
    const fHaze = makeHazeTinter(subdued, subdued ? 0.84 : 0.98, subdued ? 0.15 : 0.12);
    cr.setLineCap(Cairo.LineCap.ROUND);
    for (let i = 0; i <= 7; i++) {
        const px = width * (0.44 + i * 0.042);
        const py = floorTop + (52.5 - i * 1.25) * scale;
        cr.setSourceRGBA(...fHaze.tint(0.06, 0.12, 0.08), 0.20 * fHaze.aMul);
        cr.setLineWidth(0.85 * scale);
        cr.newPath();
        cr.moveTo(px, py);
        cr.lineTo(px + 2.0 * scale, py + 0.8 * scale);
        cr.stroke();

        cr.setSourceRGBA(...fHaze.tint(0.42, 0.30, 0.19), 0.68 * fHaze.aMul);
        cr.setLineWidth(1.0 * scale);
        cr.newPath();
        cr.moveTo(px, py + 0.4 * scale);
        cr.lineTo(px, py - 4.5 * scale);
        cr.stroke();
    }
    cr.setSourceRGBA(...fHaze.tint(0.46, 0.33, 0.21), 0.64 * fHaze.aMul);
    cr.setLineWidth(0.82 * scale);
    cr.newPath();
    cr.moveTo(width * 0.44, floorTop + 50.8 * scale);
    cr.lineTo(width * 0.734, floorTop + 42.0 * scale);
    cr.moveTo(width * 0.44, floorTop + 48.7 * scale);
    cr.lineTo(width * 0.734, floorTop + 39.9 * scale);
    cr.stroke();

    // Subtle lower-valley mist ribbon between Hill 2 and Hill 3
    const mistG2 = new Cairo.LinearGradient(0, height - 64 * scale, 0, height - 34 * scale);
    mistG2.addColorStopRGBA(0.0, 0.74, 0.80, 0.85, 0.0);
    mistG2.addColorStopRGBA(0.5, 0.74, 0.80, 0.85, subdued ? 0.07 : 0.04);
    mistG2.addColorStopRGBA(1.0, 0.74, 0.80, 0.85, 0.0);
    cr.setSource(mistG2);
    cr.rectangle(0, height - 64 * scale, width, 30 * scale);
    cr.fill();

    // 4. Hill 3 (Foreground meadow slope — balanced luminance for bottom-row day tiles)
    const h3 = new Cairo.LinearGradient(0, height - 54 * scale, 0, height);
    if (subdued) {
        h3.addColorStopRGBA(0.00, 0.42, 0.57, 0.44, 0.36);
        h3.addColorStopRGBA(0.55, 0.38, 0.53, 0.40, 0.38);
        h3.addColorStopRGBA(1.00, 0.34, 0.49, 0.36, 0.40);
    } else {
        h3.addColorStopRGBA(0.00, 0.38, 0.65, 0.34, 0.42);
        h3.addColorStopRGBA(0.55, 0.33, 0.59, 0.29, 0.46);
        h3.addColorStopRGBA(1.00, 0.28, 0.53, 0.25, 0.50);
    }
    cr.setSource(h3);
    cr.newPath();
    cr.moveTo(0, height - 42 * scale);
    cr.curveTo(width * 0.45, height - 56 * scale, width * 0.78, height - 44 * scale, width, height - 36 * scale);
    cr.lineTo(width, height);
    cr.lineTo(0, height);
    cr.closePath();
    cr.fill();

    // Foreground wildflower dots
    const r = seededRand(77);
    const flLum = subdued ? 0.80 : 0.96;
    for (let i = 0; i < 14; i++) {
        const fx = width * 0.055 + r(0, width * 0.89);
        const fy = height - (6 + r(0, 13)) * scale;
        const isGold = i % 3 !== 0;
        cr.setSourceRGBA((isGold ? 0.95 : 0.88) * flLum, (isGold ? 0.78 : 0.28) * flLum, (isGold ? 0.20 : 0.24) * flLum, subdued ? 0.65 : 0.85);
        cr.newPath();
        cr.arc(fx, fy, 1.25 * scale, 0, TWO_PI);
        cr.fill();
    }

    // 5. Foreground Objects (distFade = 0.0, matched luminance across windmill & outer margin oaks)
    drawDutchWindmill(cr, width * 0.267, height - 42 * scale, scale, time, subdued, 0.0, 0.0);
    drawRealisticPastoralOak(cr, width * 0.036, height - 44 * scale, 32 * scale, subdued, -1.2 * scale, 23, 0.0);
    drawRealisticPastoralOak(cr, width * 0.962, height - 26 * scale, 36 * scale, subdued,  1.4 * scale, 11, 0.0);
}

/* C2 (Clear Day ≥ 76°F): Tropical Beach, High Thu–Fri Sailboat, Low Dry-Sand Umbrella & Anatomical Crab */
function drawClearBeachFloor(cr, width, height, scale, time) {
    const sh = sceneHeight(width, height);
    const groundOffset = height - sh;
    const floorTop = groundOffset + 0.685 * sh;
    const shoreY = height - 68 * scale;
    const surfShift = Math.sin((time - 1.1) * 1.8) * 1.8 * scale;

    // 1. Sunlit turquoise ocean cove kept higher up (floorTop .. shoreY) so NO waves are near the umbrella
    const seaG = new Cairo.LinearGradient(0, floorTop - 6 * scale, 0, shoreY + 6 * scale);
    seaG.addColorStopRGBA(0, 0.14, 0.66, 0.82, 0.44);
    seaG.addColorStopRGBA(0.55, 0.16, 0.74, 0.86, 0.58);
    seaG.addColorStopRGBA(1, 0.28, 0.84, 0.90, 0.68);
    cr.setSource(seaG);
    cr.rectangle(0, floorTop - 4 * scale, width, shoreY - floorTop + 10 * scale);
    cr.fill();

    // 2. Wide dry golden-sand beach below shoreY (shoreY .. height)
    const sandG = new Cairo.LinearGradient(0, shoreY - 4 * scale, 0, height);
    sandG.addColorStopRGBA(0, 0.90, 0.78, 0.54, 0.72);
    sandG.addColorStopRGBA(0.35, 0.86, 0.72, 0.46, 0.78);
    sandG.addColorStopRGBA(1, 0.78, 0.62, 0.38, 0.84);
    cr.setSource(sandG);
    cr.newPath();
    cr.moveTo(0, shoreY + 2 * scale + surfShift);
    cr.curveTo(
        width * 0.32, shoreY - 6 * scale + surfShift,
        width * 0.68, shoreY + 6 * scale + surfShift,
        width, shoreY - 2 * scale + surfShift);
    cr.lineTo(width, height);
    cr.lineTo(0, height);
    cr.closePath();
    cr.fill();

    // Gentle foamy surf line along shoreY (well above the umbrella at height - 32*scale)
    cr.setSourceRGBA(0.96, 0.99, 1.0, 0.85);
    cr.setLineWidth(2.0 * scale);
    cr.newPath();
    cr.moveTo(0, shoreY + 1 * scale + surfShift);
    cr.curveTo(
        width * 0.32, shoreY - 7 * scale + surfShift,
        width * 0.68, shoreY + 5 * scale + surfShift,
        width, shoreY - 3 * scale + surfShift);
    cr.stroke();

    // 3. Realistic Sloop Sailboat moved FURTHER UP between Thu and Fri tiles (x = 0.733w, y = floorTop + 18*scale)
    const boatX = width * 0.733 + Math.sin((time - 1.1) * 0.55) * 5.0 * scale;
    const boatY = floorTop + 18 * scale;
    cr.save();
    cr.translate(boatX, boatY);
    cr.rotate(Math.sin((time - 1.1) * 1.9) * 0.035);
    cr.scale(1.50 * scale, 1.50 * scale);

    cr.setSourceRGBA(0.94, 0.99, 1.0, 0.76);
    cr.setLineWidth(0.9);
    cr.newPath();
    cr.moveTo(-10.5, 1.8);
    cr.curveTo(-4.0, 2.6, 4.0, 2.4, 9.5, 1.4);
    cr.stroke();

    cr.setSourceRGBA(0.96, 0.97, 0.99, 0.98);
    cr.newPath();
    cr.moveTo(-8.2, -0.8);
    cr.lineTo(8.8, -1.2);
    cr.lineTo(6.8, 1.6);
    cr.lineTo(-6.8, 1.6);
    cr.closePath();
    cr.fill();
    cr.setSourceRGBA(0.56, 0.24, 0.14, 0.96);
    cr.newPath();
    cr.moveTo(-7.4, 0.4);
    cr.lineTo(7.6, 0.2);
    cr.lineTo(6.8, 1.6);
    cr.lineTo(-6.8, 1.6);
    cr.closePath();
    cr.fill();

    cr.setSourceRGBA(0.32, 0.24, 0.18, 0.96);
    cr.setLineWidth(0.85);
    cr.newPath();
    cr.moveTo(0.5, -0.8);
    cr.lineTo(0.5, -16.2);
    cr.moveTo(0.5, -2.4);
    cr.lineTo(-7.2, -2.0);
    cr.stroke();

    const mainSailG = new Cairo.LinearGradient(-7.0, -15.5, 0.5, -2.4);
    mainSailG.addColorStopRGBA(0, 1.0, 0.99, 0.95, 0.98);
    mainSailG.addColorStopRGBA(1, 0.84, 0.88, 0.94, 0.95);
    cr.setSource(mainSailG);
    cr.newPath();
    cr.moveTo(0.2, -15.5);
    cr.curveTo(-4.6, -10.0, -6.4, -5.5, -6.8, -2.4);
    cr.lineTo(0.2, -2.6);
    cr.closePath();
    cr.fill();

    const jibG = new Cairo.LinearGradient(1.0, -14.2, 8.2, -2.0);
    jibG.addColorStopRGBA(0, 1.0, 0.98, 0.94, 0.98);
    jibG.addColorStopRGBA(1, 0.86, 0.90, 0.95, 0.94);
    cr.setSource(jibG);
    cr.newPath();
    cr.moveTo(0.8, -14.5);
    cr.curveTo(5.2, -9.8, 7.4, -5.4, 8.2, -1.8);
    cr.curveTo(5.0, -2.4, 2.6, -2.5, 0.8, -2.2);
    cr.closePath();
    cr.fill();

    cr.setSourceRGBA(0.92, 0.26, 0.22, 0.95);
    cr.newPath();
    cr.moveTo(0.5, -16.2);
    cr.lineTo(-3.2, -15.4);
    cr.lineTo(0.5, -14.8);
    cr.closePath();
    cr.fill();
    cr.restore();

    // 4. Striped Beach Umbrella + Teak Lounger moved FURTHER DOWN on dry sand in Alley 1 (x = 0.267w, y = h - 32*scale)
    cr.save();
    cr.translate(width * 0.267, height - 32 * scale);
    cr.scale(1.68 * scale, 1.68 * scale);

    cr.save();
    cr.scale(11.5, 3.4);
    cr.setSourceRGBA(0.24, 0.16, 0.08, 0.34);
    cr.newPath();
    cr.arc(0.5, 0.8, 1, 0, TWO_PI);
    cr.fill();
    cr.restore();

    cr.setSourceRGBA(0.48, 0.28, 0.14, 0.96);
    cr.setLineWidth(1.1);
    cr.setLineCap(Cairo.LineCap.ROUND);
    cr.newPath();
    cr.moveTo(-7.5, 1.5);
    cr.lineTo(4.2, 1.5);
    cr.lineTo(7.4, -2.2);
    cr.moveTo(-5.8, 1.5);
    cr.lineTo(-6.8, 3.4);
    cr.moveTo(3.2, 1.5);
    cr.lineTo(4.2, 3.4);
    cr.stroke();
    cr.setSourceRGBA(0.98, 0.95, 0.88, 0.96);
    cr.setLineWidth(1.35);
    cr.newPath();
    cr.moveTo(-6.8, 0.9);
    cr.lineTo(3.8, 0.9);
    cr.lineTo(6.6, -2.3);
    cr.stroke();

    cr.setSourceRGBA(0.42, 0.28, 0.16, 0.96);
    cr.setLineWidth(1.15);
    cr.newPath();
    cr.moveTo(-0.5, 2.2);
    cr.lineTo(-2.4, -15.5);
    cr.stroke();

    cr.save();
    cr.translate(-2.4, -15.0);
    cr.rotate(-0.12);
    const ribX = [-12.5, -7.2, -2.2, 2.2, 7.2, 12.5];
    for (let g = 0; g < 5; g++) {
        const xL = ribX[g], xR = ribX[g + 1];
        const isCoral = g % 2 === 0;
        cr.setSourceRGBA(
            isCoral ? 0.92 : 0.99,
            isCoral ? 0.28 : 0.96,
            isCoral ? 0.24 : 0.88,
            0.98);
        cr.newPath();
        cr.moveTo(0, -3.6);
        cr.curveTo(xL * 0.55, -3.2, xL * 0.88, -0.5, xL, 2.8);
        cr.curveTo((xL + xR) * 0.5, 1.6, (xL + xR) * 0.5, 1.6, xR, 2.8);
        cr.curveTo(xR * 0.88, -0.5, xR * 0.55, -3.2, 0, -3.6);
        cr.closePath();
        cr.fill();
    }
    cr.setSourceRGBA(0.96, 0.82, 0.34, 0.98);
    cr.newPath();
    cr.arc(0, -4.0, 0.85, 0, TWO_PI);
    cr.fill();
    cr.restore();
    cr.restore();

    // 5. Realistic Anatomical Crab scuttling on dry sand in Alley 2 (x = 0.50w, y = h - 36*scale)
    const crabX = width * 0.50 + Math.sin((time - 1.1) * 1.6) * 4.5 * scale;
    const crabY = height - 36 * scale;
    cr.save();
    cr.translate(crabX, crabY);
    cr.scale(1.76 * scale, 1.76 * scale);

    cr.save();
    cr.scale(7.2, 2.5);
    cr.setSourceRGBA(0.22, 0.14, 0.06, 0.34);
    cr.newPath();
    cr.arc(0, 0.7, 1, 0, TWO_PI);
    cr.fill();
    cr.restore();

    cr.setLineCap(Cairo.LineCap.ROUND);
    cr.setLineJoin(Cairo.LineJoin.ROUND);
    for (const side of [-1, 1]) {
        for (let l = 0; l < 4; l++) {
            const step = Math.sin((time - 1.1) * 8.0 + l * 1.4 + side) * 0.45;
            const bx = side * (3.2 + l * 0.55);
            const by = -0.8 + l * 0.85;
            const kx = side * (6.4 + l * 0.55);
            const ky = -1.8 + l * 1.05 - Math.abs(step) * 0.6;
            const tx = side * (8.2 - l * 0.25) + step;
            const ty = 0.8 + l * 0.75;
            cr.setSourceRGBA(0.84, 0.28, 0.16, 0.96);
            cr.setLineWidth(1.05);
            cr.newPath();
            cr.moveTo(bx, by);
            cr.lineTo(kx, ky);
            cr.stroke();
            cr.setSourceRGBA(0.94, 0.42, 0.22, 0.98);
            cr.setLineWidth(0.80);
            cr.newPath();
            cr.moveTo(kx, ky);
            cr.lineTo(tx, ty);
            cr.stroke();
        }
    }

    for (const side of [-1, 1]) {
        cr.setSourceRGBA(0.86, 0.26, 0.16, 0.98);
        cr.setLineWidth(1.45);
        cr.newPath();
        cr.moveTo(side * 2.8, -1.8);
        cr.lineTo(side * 5.2, -4.2);
        cr.lineTo(side * 4.4, -6.4);
        cr.stroke();

        cr.save();
        cr.translate(side * 4.2, -6.8);
        cr.rotate(side * -0.25);
        const clawG = new Cairo.RadialGradient(-side * 0.5, -0.5, 0.2, 0, 0, 2.8);
        clawG.addColorStopRGBA(0, 1.0, 0.48, 0.26, 0.99);
        clawG.addColorStopRGBA(1, 0.78, 0.18, 0.12, 0.98);
        cr.setSource(clawG);
        cr.newPath();
        cr.moveTo(0, 0.8);
        cr.curveTo(side * 2.4, 0.4, side * 2.8, -2.2, side * 0.6, -3.4);
        cr.curveTo(side * 0.2, -2.4, side * 0.8, -1.4, 0, -0.8);
        cr.curveTo(-side * 0.8, -1.4, -side * 0.3, -2.3, -side * 0.2, -3.1);
        cr.curveTo(-side * 1.8, -2.0, -side * 1.6, 0.4, 0, 0.8);
        cr.closePath();
        cr.fill();
        cr.restore();
    }

    const shellG = new Cairo.RadialGradient(-1.2, -1.8, 0.6, 0, -0.5, 5.2);
    shellG.addColorStopRGBA(0, 1.0, 0.46, 0.24, 0.99);
    shellG.addColorStopRGBA(0.65, 0.88, 0.24, 0.14, 0.99);
    shellG.addColorStopRGBA(1, 0.62, 0.14, 0.08, 0.99);
    cr.setSource(shellG);
    cr.newPath();
    cr.moveTo(-4.6, -0.8);
    cr.curveTo(-4.2, -3.2, -2.0, -4.0, 0, -3.8);
    cr.curveTo(2.0, -4.0, 4.2, -3.2, 4.6, -0.8);
    cr.curveTo(3.6, 1.8, 1.8, 2.4, 0, 2.4);
    cr.curveTo(-1.8, 2.4, -3.6, 1.8, -4.6, -0.8);
    cr.closePath();
    cr.fill();

    for (const side of [-1, 1]) {
        cr.setSourceRGBA(0.86, 0.28, 0.16, 0.98);
        cr.setLineWidth(0.75);
        cr.newPath();
        cr.moveTo(side * 1.1, -3.5);
        cr.lineTo(side * 1.35, -4.8);
        cr.stroke();
        cr.setSourceRGBA(0.08, 0.10, 0.14, 0.99);
        cr.newPath();
        cr.arc(side * 1.35, -4.9, 0.62, 0, TWO_PI);
        cr.fill();
    }
    cr.restore();

    // 6. Leaning Coconut Palm on Right Outer Margin (x = 0.945w, y = h - 28*scale)
    cr.save();
    cr.translate(width * 0.945, height - 28 * scale);
    cr.scale(1.50 * scale, 1.50 * scale);

    drawSmoothLimb(cr, 0, 4, 2.2, -3, -12, -8, -26, -13, -38, 1.0);
    const trkG = new Cairo.LinearGradient(-14, -38, 2, 4);
    trkG.addColorStopRGBA(0, 0.56, 0.40, 0.26, 0.98);
    trkG.addColorStopRGBA(1, 0.36, 0.24, 0.14, 0.98);
    cr.setSource(trkG);
    cr.fill();

    cr.setSourceRGBA(0.34, 0.20, 0.10, 0.98);
    for (const [cx2, cy2] of [[-11.8, -36.5], [-14.0, -36.8], [-12.8, -35.2]]) {
        cr.newPath();
        cr.arc(cx2, cy2, 1.4, 0, TWO_PI);
        cr.fill();
    }

    cr.translate(-13, -38);
    for (const [cpx, cpy, ex, ey, col] of [
        [-12, -6, -24, -2, [0.22, 0.56, 0.28]],
        [-14, -12, -26, -14, [0.30, 0.66, 0.32]],
        [-4, -14, -8, -24, [0.36, 0.72, 0.36]],
        [8, -10, 14, -4, [0.26, 0.60, 0.30]],
        [6, -4, 11, 6, [0.20, 0.50, 0.24]],
    ]) {
        cr.setSourceRGBA(col[0], col[1], col[2], 0.96);
        cr.newPath();
        cr.moveTo(0, 0);
        cr.curveTo(cpx, cpy - 3.2, (cpx + ex) * 0.5, cpy, ex, ey);
        cr.curveTo((cpx + ex) * 0.5, cpy + 2.4, cpx * 0.8, cpy + 1.2, 0, 0);
        cr.closePath();
        cr.fill();
    }
    cr.restore();
}

function drawSceneFloor(cr, width, height, scale, time, scene, night, temp) {
    const floorId = resolveFloorScene(scene, night, temp);
    if (floorId === 'S1')
        drawIceFishingFloor(cr, width, height, scale, time, night);
    else if (floorId === 'S2')
        drawSnowmanChaletFloor(cr, width, height, scale, time, night);
    else if (floorId === 'T3')
        drawStormFrogsFloor(cr, width, height, scale, time, night);
    else if (floorId === 'C1')
        drawClearHillsFloor(cr, width, height, scale, time, scene === 'cloud' || scene === 'partly');
    else if (floorId === 'C2')
        drawClearBeachFloor(cr, width, height, scale, time);
}

function drawLightning(cr, width, height, scale, time) {
    const sh = sceneHeight(width, height);
    const shifted = time + 2.08;
    const cycleTime = ((shifted % 3.1) + 3.1) % 3.1;
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
        const sx = width * BOLT_ORIGINS[(Math.floor(Math.max(0, shifted) / 3.1) + 1) % 3];
        const sy = sh * 0.18;
        const rad = 125 * scale;
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

    const strikeIdx = Math.floor(Math.max(0, shifted) / 3.1) % 3;
    const originX = width * BOLT_ORIGINS[strikeIdx];
    const originY = sh * 0.25;

    // Sky-wide flash + internal cloud-underbelly illumination
    cr.setSourceRGBA(1, 0.99, 0.92, 0.07 * flashIntensity);
    cr.paint();
    const cloudGlow = new Cairo.RadialGradient(
        originX, originY - 12 * scale, 3 * scale,
        originX, originY - 12 * scale, 95 * scale);
    cloudGlow.addColorStopRGBA(0, 1.0, 0.95, 0.82, 0.44 * flashIntensity);
    cloudGlow.addColorStopRGBA(0.45, 0.88, 0.82, 0.98, 0.18 * flashIntensity);
    cloudGlow.addColorStopRGBA(1, 0.80, 0.78, 0.96, 0);
    cr.setSource(cloudGlow);
    cr.arc(originX, originY - 12 * scale, 95 * scale, 0, TWO_PI);
    cr.fill();

    cr.save();
    cr.translate(originX, originY);
    cr.setLineJoin(Cairo.LineJoin.ROUND);
    cr.setLineCap(Cairo.LineCap.ROUND);

    const traceUpper = () => {
        cr.newPath();
        cr.moveTo(0, -10 * scale);
        cr.lineTo(-6 * scale, 8 * scale);
        cr.lineTo(-2 * scale, 22 * scale);
        cr.lineTo(-14 * scale, 44 * scale);
        cr.lineTo(-7 * scale, 60 * scale);
        cr.lineTo(8 * scale, 72 * scale);
    };
    const traceLower = () => {
        cr.newPath();
        cr.moveTo(8 * scale, 72 * scale);
        cr.lineTo(-3 * scale, 96 * scale);
        cr.lineTo(-12 * scale, 118 * scale);
        cr.lineTo(-6 * scale, 134 * scale);
        cr.lineTo(-17 * scale, 156 * scale);
    };
    const traceBranches = () => {
        cr.newPath();
        cr.moveTo(-2 * scale, 22 * scale);
        cr.lineTo(11 * scale, 35 * scale);
        cr.lineTo(17 * scale, 49 * scale);
        cr.lineTo(25 * scale, 58 * scale);
        cr.moveTo(-14 * scale, 44 * scale);
        cr.lineTo(-27 * scale, 58 * scale);
        cr.lineTo(-33 * scale, 73 * scale);
        cr.moveTo(-3 * scale, 96 * scale);
        cr.lineTo(10 * scale, 114 * scale);
        cr.lineTo(7 * scale, 128 * scale);
        cr.lineTo(14 * scale, 140 * scale);
    };

    // Outer atmospheric glow pass
    cr.setSourceRGBA(0.88, 0.78, 1.0, 0.28 * flashIntensity);
    cr.setLineWidth(7.0 * scale);
    traceUpper();
    cr.stroke();
    cr.setLineWidth(5.2 * scale);
    traceLower();
    cr.stroke();
    cr.setLineWidth(3.8 * scale);
    traceBranches();
    cr.stroke();

    // Mid golden-amber bolt pass (tapered upper -> lower -> branches)
    cr.setSourceRGBA(1, 0.86, 0.31, flashIntensity);
    cr.setLineWidth(2.7 * scale);
    traceUpper();
    cr.stroke();
    cr.setLineWidth(1.9 * scale);
    traceLower();
    cr.stroke();
    cr.setLineWidth(1.3 * scale);
    traceBranches();
    cr.stroke();

    // Hot white-gold inner core
    cr.setSourceRGBA(1, 0.98, 0.90, flashIntensity);
    cr.setLineWidth(1.2 * scale);
    traceUpper();
    cr.stroke();
    cr.setLineWidth(0.85 * scale);
    traceLower();
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
    code = null, variant = null, temp = null, quiet = false, fxScale = null }) {
    const tStartMs = Date.now();
    const rw = Math.round(width), rh = Math.round(height);
    const sh = sceneHeight(width, height);
    if (sky.scene !== scene || sky.w !== rw || sky.h <= 0)
        rebuild(sky, rw, rh, scene);
    else if (sky.h !== rh)
        adjustSkyHeight(sky, rw, rh);

    const lastTime = sky.lastTime ?? sky.lastT;
    const dt = lastTime === null ? 0 : Math.min(0.1, time - lastTime);
    sky.lastTime = time;
    sky.lastT = time;
    const features = SCENE_FEATURES[scene] ?? {};
    const twilight = twilightOf(scene, glow);
    const noon = noonOf(scene, night, solar);
    const scale = sh / 420;

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

    const clearSky = code === null || code === undefined || code <= 2;
    drawHorizonGlow(fc, sky, rw, rh, twilight, night, time);
    if (!quiet) {
        drawBodies(fc, sky, rw, rh, scale, features, time, night, phase,
            twilight, solar, noon, scene, clearSky);
        const hasMoon = Boolean(features.moon) && night && clearSky;
        if (night && (features.stars || features.moon) && clearSky) {
            const moonScale = features.moon ?? 1;
            const [mx, my] = scene === 'wind'
                ? [rw * 0.80, sh * 0.125]
                : sunSpot(rw, rh, night, solar);
            const keepOutR = scene === 'wind'
                ? 64 * scale * moonScale * 0.95
                : 64 * scale * 0.85;
            const zenithH = scene === 'wind' ? 0.29 * sh : 0;
            drawStars(fc, sky.stars, time, twilight,
                hasMoon ? { x: mx, y: my, r: keepOutR } : null,
                zenithH);
        }
        drawClouds(fc, sky, width, height, scale, dt, time, scene, night, twilight,
            Boolean(features.bolt));
        drawFog(fc, sky, width, dt, time, night, scale);
        drawSceneFloor(fc, width, height, scale, time, scene, night, temp);
        drawRain(fc, sky, width, height, scale, dt, scene, code, time, night);
        drawSnow(fc, sky, width, height, scale, dt, time, code, variant);
        drawSleetPellets(fc, sky, width, height, scale, dt);
        drawHail(fc, sky, width, height, dt);
        drawWindStreaks(fc, sky, width, height, dt, time, night, scale);
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
