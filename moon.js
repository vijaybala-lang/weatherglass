/* moon.js -- lunar phase calculation and rendering */

import Cairo from 'gi://cairo';

const TWO_PI = Math.PI * 2;

// Mean synodic month (days) and a reference new moon: 2000-01-06 18:14 UTC.
const SYNODIC_MONTH_DAYS = 29.530588853;
const NEW_MOON_EPOCH = Date.UTC(2000, 0, 6, 18, 14, 0);
const MILLISECONDS_PER_DAY = 86400000;

const PHASE_NAMES = [
    [0.03, 'New Moon'], [0.22, 'Waxing Crescent'], [0.28, 'First Quarter'],
    [0.47, 'Waxing Gibbous'], [0.53, 'Full Moon'], [0.72, 'Waning Gibbous'],
    [0.78, 'Last Quarter'], [0.97, 'Waning Crescent'], [1.0, 'New Moon'],
];

/** Illuminated fraction 0..1 for a phase value (0..1). */
export function illumOf(phase) {
    return (1 - Math.cos(TWO_PI * (((phase % 1) + 1) % 1))) / 2;
}

/** {phase 0..1, illum 0..1, waxing bool, name} for the given date (default now). */
export function moonPhase(date = new Date()) {
    const daysSinceEpoch = (date.getTime() - NEW_MOON_EPOCH) / MILLISECONDS_PER_DAY;
    let phase = (daysSinceEpoch % SYNODIC_MONTH_DAYS) / SYNODIC_MONTH_DAYS;
    if (phase < 0)
        phase += 1;
    const illum = (1 - Math.cos(TWO_PI * phase)) / 2;
    const name = PHASE_NAMES.find(([threshold]) => phase < threshold)[1];
    return { phase, illum, waxing: phase < 0.5, name };
}

const MARIA_SPOTS = [
    [-0.15, -0.35, 0.30, 11],   // Imbrium
    [0.05, -0.58, 0.12, 88],   // Frigoris
    [-0.45, -0.05, 0.26, 22],   // Procellarum (north)
    [-0.36, 0.22, 0.24, 33],   // Procellarum (south)
    [0.20, -0.22, 0.18, 44],   // Serenitatis
    [0.34, 0.04, 0.20, 55],   // Tranquillitatis
    [0.30, 0.30, 0.16, 66],   // Fecunditatis
    [-0.10, 0.45, 0.16, 77],   // Nubium / Humorum
    [0.05, -0.12, 0.15, 99],   // light bridge linking the seas
    [0.44, -0.30, 0.13, 111],  // east of Serenitatis
    [0.10, 0.58, 0.14, 122],  // south mass
    [-0.52, 0.42, 0.12, 133],  // south-west
];

const SPECKS = [
    [-0.25, -0.15, 0.030], [0.12, 0.25, 0.028], [-0.05, 0.20, 0.022],
    [0.42, -0.38, 0.024], [-0.40, 0.40, 0.026], [0.15, -0.45, 0.020],
    [-0.20, 0.30, 0.024], [0.50, 0.15, 0.020], [0.22, 0.55, 0.022],
];

function prng(seed) {
    let state = seed >>> 0;
    return () => {
        state |= 0;
        state = (state + 0x6D2B79F5) | 0;
        let temp = Math.imul(state ^ (state >>> 15), 1 | state);
        temp = (temp + Math.imul(temp ^ (temp >>> 7), 61 | temp)) ^ temp;
        return ((temp ^ (temp >>> 14)) >>> 0) / 4294967296;
    };
}

let mariaCache = null;
function mariaCircles() {
    if (!mariaCache) {
        mariaCache = [];
        for (const [centerX, centerY, radius, seed] of MARIA_SPOTS) {
            const random = prng(seed);
            const spotCount = 8;
            for (let i = 0; i < spotCount; i++) {
                const angle = (i / spotCount) * TWO_PI + random() * 0.8;
                const distance = radius * (0.3 + random() * 0.80);
                mariaCache.push([
                    centerX + Math.cos(angle) * distance,
                    centerY + Math.sin(angle) * distance * 0.85,
                    radius * (0.36 + random() * 0.34),
                ]);
            }
        }
    }
    return mariaCache;
}

function litPath(cr, radius, phase) {
    const terminatorScale = Math.cos(TWO_PI * phase);   // signed terminator x-radius / radius
    cr.newPath();
    cr.arc(0, 0, radius, -Math.PI / 2, Math.PI / 2);     // limb: top -> right -> bottom
    cr.save();
    cr.scale(terminatorScale, 1);                         // sign swings the bulge L/R
    (cr.arcNegative ?? cr.arc_negative).call(cr, 0, 0, radius, Math.PI / 2, -Math.PI / 2);
    cr.restore();                                        // terminator: bottom -> top
    cr.closePath();
}

/**
 * paintMoon(cr, centerX, centerY, radius, phase, style, opts)
 *   style 'icon' -- flat warm-lit disc, transparent unlit part (crisp at 24px)
 *   style 'sky'  -- pale soft sphere: gentle shading + low-contrast maria
 * opts: reserved.
 */
export function paintMoon(cr, centerX, centerY, radius, phase, style = 'sky', opts = {}) {
    const { illum, waxing } = moonPhaseFrom(phase);

    cr.save();
    cr.translate(centerX, centerY);

    // Dark-side earthshine: sky keeps a whisper of the whole disc so a thin
    // moon reads against the sky; the icon keeps a stronger ghost so the
    // panel icon never vanishes at new moon.
    if (illum < 0.99) {
        const earthshineAlpha = style === 'icon' ? 0.16 : 0.03 + 0.10 * (1 - illum);
        cr.setSourceRGBA(0.72, 0.74, 0.86, earthshineAlpha);
        cr.arc(0, 0, radius, 0, TWO_PI);
        cr.fill();
    }

    if (illum < 0.012) {
        cr.restore();
        return;
    }

    if (!waxing)
        cr.scale(-1, 1);

    cr.save();
    litPath(cr, radius, phase);

    if (style === 'icon') {
        // opts.face: light-card palette dims the disc to porcelain --
        // bare 0.95 white blows out over bright day skies
        const faceColor = opts.face ?? [0.95, 0.95, 0.99];
        if (opts.outline) {           // pale disc needs an edge on light cards
            const outlineColor = opts.outline;
            cr.setSourceRGBA(faceColor[0], faceColor[1], faceColor[2], 1);
            cr.fillPreserve();
            cr.setSourceRGBA(outlineColor[0], outlineColor[1], outlineColor[2], outlineColor[3]);
            cr.setLineWidth(0.5);
            cr.stroke();
        } else {
            cr.setSourceRGBA(faceColor[0], faceColor[1], faceColor[2], 1);   // warm off-white
            cr.fill();
        }
        cr.restore();
        cr.restore();
        return;
    }

    // -- sky style: soft pale sphere, clipped to the lit crescent --
    cr.fillPreserve();
    cr.clip();

    // gentle sphere shading: light off the upper-left limb, slightly cooler
    // and darker toward the far edge -- pale grey, never a bright white coin
    const gradient = new Cairo.RadialGradient(-radius * 0.3, -radius * 0.3, radius * 0.15,
        0, 0, radius * 1.25);
    gradient.addColorStopRGBA(0, 0.95, 0.95, 0.945, 1);
    gradient.addColorStopRGBA(0.6, 0.875, 0.88, 0.895, 1);
    gradient.addColorStopRGBA(1, 0.715, 0.73, 0.775, 1);
    cr.setSource(gradient);
    cr.newPath();
    cr.arc(0, 0, radius, 0, TWO_PI);
    cr.fill();

    // maria: every clump circle is a subpath of ONE union path, painted with
    // a single low-alpha pass -- overlapping circles therefore merge into
    // continuous soft shading instead of doubling into darker dots
    const newSubPath = cr.newSubPath ?? cr.new_sub_path;
    cr.newPath();
    for (const [spotX, spotY, spotRadius] of mariaCircles()) {
        newSubPath.call(cr);
        cr.arc(spotX * radius, spotY * radius, spotRadius * radius, 0, TWO_PI);
    }
    cr.setSourceRGBA(0.60, 0.62, 0.68, 0.20);
    cr.fill();

    // a whisper of small craters + Tycho's bright dot low-centre
    for (const [speckX, speckY, speckRadius] of SPECKS) {
        cr.newPath();
        cr.arc(speckX * radius, speckY * radius, speckRadius * radius, 0, TWO_PI);
        cr.setSourceRGBA(0.45, 0.47, 0.56, 0.13);
        cr.fill();
    }
    cr.newPath();
    cr.arc(0.04 * radius, 0.60 * radius, radius * 0.028, 0, TWO_PI);
    cr.setSourceRGBA(1, 1, 1, 0.35);
    cr.fill();

    cr.restore();
    cr.restore();
}

/* moonPhase() needs a Date; paintMoon only has the 0..1 number -- derive the
 * two fields it uses without re-reading the clock. */
function moonPhaseFrom(phase) {
    return { illum: (1 - Math.cos(TWO_PI * phase)) / 2, waxing: phase < 0.5 };
}
