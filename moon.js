/* moon.js — the real moon: computed phase + a cratered, off-white face.
 *
 * moonPhase(date) gives the lunar age (0=new, .25=first quarter, .5=full,
 * .75=last quarter) from a known new-moon epoch and the mean synodic month
 * — accurate to a few hours, plenty to pick the right picture.
 *
 * paintMoon() draws that phase as a single lit region bounded by the limb
 * (a true half-circle) and the terminator (a half-ellipse whose signed
 * x-radius cos(2π·phase) swings it toward the lit side for a crescent and
 * away for a gibbous moon — the classic two-arc construction). Craters/maria
 * are painted only inside the lit region, so the terminator bites into them.
 *
 * Pure cairo + real time: importable from the host for offscreen previews,
 * and side-effect free (the caller supplies the phase it wants).
 */

import Cairo from 'gi://cairo';

const TAU = Math.PI * 2;

// Mean synodic month (days) and a reference new moon: 2000-01-06 18:14 UTC.
const SYNODIC = 29.530588853;
const NEW_MOON_EPOCH = Date.UTC(2000, 0, 6, 18, 14, 0);

const PHASE_NAMES = [
    [0.03, 'New Moon'], [0.22, 'Waxing Crescent'], [0.28, 'First Quarter'],
    [0.47, 'Waxing Gibbous'], [0.53, 'Full Moon'], [0.72, 'Waning Gibbous'],
    [0.78, 'Last Quarter'], [0.97, 'Waning Crescent'], [1.0, 'New Moon'],
];

/** Illuminated fraction 0..1 for a phase value (0..1). */
export function illumOf(phase) {
    return (1 - Math.cos(TAU * (((phase % 1) + 1) % 1))) / 2;
}

/** {phase 0..1, illum 0..1, waxing bool, name} for the given date (default now). */
export function moonPhase(date = new Date()) {
    const days = (date.getTime() - NEW_MOON_EPOCH) / 86400000;
    let phase = (days % SYNODIC) / SYNODIC;
    if (phase < 0)
        phase += 1;
    const illum = (1 - Math.cos(TAU * phase)) / 2;
    const name = PHASE_NAMES.find(b => phase < b[0])[1];
    return {phase, illum, waxing: phase < 0.5, name};
}

/* The near side's major maria, in unit-disc coords [x, y, r] (y down).
 * Oceanus Procellarum's elongated chain down the west limb, Imbrium top,
 * the Serenitatis→Tranquillitatis→Fecunditatis column on the east: the
 * pattern that makes the moon recognisable. */
const MARIA = [
    [-0.12, -0.42, 0.28],  // Imbrium
    [-0.50, -0.15, 0.22],  // Procellarum (north)
    [-0.42,  0.05, 0.24],  // Procellarum (mid)
    [-0.30,  0.22, 0.17],  // Procellarum (south)
    [ 0.18, -0.28, 0.17],  // Serenitatis
    [ 0.32, -0.05, 0.19],  // Tranquillitatis
    [ 0.40,  0.18, 0.15],  // Fecunditatis
    [ 0.22,  0.30, 0.11],  // Nectaris
    [-0.32,  0.42, 0.13],  // Humorum
    [-0.10,  0.48, 0.12],  // Nubium
];

const CRATER_DOTS = [
    [-0.20, -0.08, 0.045], [0.10, -0.55, 0.04], [0.52, -0.32, 0.04],
    [0.06, 0.20, 0.035], [-0.48, 0.32, 0.04], [-0.18, 0.24, 0.035],
];

// broad low-contrast basins under the maria, so the seas sit in dark
// regions and merge instead of reading as separate circles
const BASINS = [
    [-0.28, -0.08, 0.50, 0.16],
    [ 0.26, -0.06, 0.42, 0.15],
    [ 0.00,  0.36, 0.36, 0.10],
];

/* Trace the lit region of a phase into the current path (centre = CTM origin,
 * radius r). Assumes the "right-lit" convention; waning is a mirror-image
 * of this, so paintMoon mirrors the whole face with scale(-1,1). */
function litPath(cr, r, phase) {
    const s = Math.cos(TAU * phase);   // signed terminator x-radius / r
    cr.newPath();
    cr.arc(0, 0, r, -Math.PI / 2, Math.PI / 2);     // limb: top -> right -> bottom
    cr.save();
    cr.scale(s, 1);                                  // sign swings the bulge L/R
    (cr.arcNegative ?? cr.arc_negative).call(cr, 0, 0, r, Math.PI / 2, -Math.PI / 2);
    cr.restore();                                    // terminator: bottom -> top
    cr.closePath();
}

/**
 * paintMoon(cr, cx, cy, r, phase, style, opts)
 *   style 'icon' — flat warm-lit disc, transparent unlit part (crisp at 24px)
 *   style 'sky'  — cratered, shaded, off-white (not bright white), soft glow
 * opts: {glow:0..1} extra glow alpha multiplier for the sky style.
 */
export function paintMoon(cr, cx, cy, r, phase, style = 'sky', opts = {}) {
    const {illum, waxing} = moonPhaseFrom(phase);

    cr.save();
    cr.translate(cx, cy);

    // Dark-side earthshine: sky keeps a whisper of the whole disc so a thin
    // moon reads against the sky; the icon keeps a stronger ghost so the
    // panel icon never vanishes at new moon.
    if (illum < 0.99) {
        const esA = style === 'icon' ? 0.16 : 0.03 + 0.10 * (1 - illum);
        cr.setSourceRGBA(0.72, 0.74, 0.86, esA);
        cr.arc(0, 0, r, 0, TAU);
        cr.fill();
    }

    if (illum < 0.012) {          // new moon: earthshine ghost only
        cr.restore();
        return;
    }

    if (!waxing)
        cr.scale(-1, 1);          // mirror to put the lit limb on the left

    cr.save();
    litPath(cr, r, phase);

    if (style === 'icon') {
        cr.setSourceRGBA(0.95, 0.95, 0.99, 1);   // warm off-white, never clinical
        cr.fill();
        cr.restore();
        cr.restore();
        return;
    }

    // ── sky style: clip to the lit crescent, then paint a cratered face ──
    cr.fillPreserve();
    cr.clip();

    // base: a soft radial "sphere" — bright toward the sub-solar limb, dimmer
    // toward the terminator, and warm-grey not pure white.
    const bg = new Cairo.RadialGradient(-r * 0.25, -r * 0.25, r * 0.1,
                                        0, 0, r * 1.15);
    bg.addColorStopRGBA(0, 0.99, 0.98, 0.93, 1);
    bg.addColorStopRGBA(0.55, 0.90, 0.89, 0.83, 1);
    bg.addColorStopRGBA(1, 0.72, 0.72, 0.68, 1);
    cr.setSource(bg);
    cr.paint();

    // broad basins: soft dark regions the maria merge into
    for (const [bx, by, br, ba] of BASINS) {
        const g = new Cairo.RadialGradient(bx * r, by * r, 0, bx * r, by * r, br * r);
        g.addColorStopRGBA(0, 0.56, 0.57, 0.62, ba);
        g.addColorStopRGBA(1, 0.56, 0.57, 0.62, 0);
        cr.setSource(g);
        cr.newPath();
        cr.arc(bx * r, by * r, br * r, 0, TAU);
        cr.fill();
    }

    // maria: flat basaltic plains — near-flat alpha with a short soft edge
    // (a full center-falloff gradient would read as fuzzy dots, not seas)
    for (const [mx, my, mr] of MARIA) {
        const g = new Cairo.RadialGradient(mx * r, my * r, 0, mx * r, my * r, mr * r);
        g.addColorStopRGBA(0, 0.54, 0.55, 0.60, 0.55);
        g.addColorStopRGBA(0.78, 0.54, 0.55, 0.60, 0.50);
        g.addColorStopRGBA(1, 0.54, 0.55, 0.60, 0);
        cr.setSource(g);
        cr.newPath();
        cr.arc(mx * r, my * r, mr * r, 0, TAU);
        cr.fill();
    }

    // craters: dark floor + a light lower rim catches the "sun"
    for (const [dx, dy, dr] of CRATER_DOTS) {
        const x = dx * r, y = dy * r, rad = dr * r;
        cr.newPath();
        cr.setSourceRGBA(0.50, 0.51, 0.56, 0.38);
        cr.arc(x, y, rad, 0, TAU);
        cr.fill();
        cr.newPath();
        cr.setSourceRGBA(1, 1, 1, 0.22);
        cr.arc(x + rad * 0.25, y + rad * 0.35, rad * 0.7, Math.PI * 0.15, Math.PI * 0.9);
        cr.lineWidth = Math.max(0.5, r * 0.012);
        cr.stroke();
    }

    // Tycho — the bright ray crater low on the near side, signature of a
    // real full moon: white dot + soft halo of ejecta.
    const tx = 0.04 * r, ty = 0.62 * r;
    cr.newPath();
    cr.setSourceRGBA(1, 1, 0.97, 0.85);
    cr.arc(tx, ty, r * 0.04, 0, TAU);
    cr.fill();
    cr.newPath();
    cr.setSourceRGBA(1, 1, 0.97, 0.16);
    cr.arc(tx, ty, r * 0.20, 0, TAU);
    cr.fill();

    // limb darkening: rim opposite the light a touch darker, sells the sphere
    const lg = new Cairo.RadialGradient(-r * 0.3, -r * 0.3, r * 0.6, 0, 0, r);
    lg.addColorStopRGBA(0, 0, 0, 0, 0);
    lg.addColorStopRGBA(1, 0.15, 0.16, 0.22, 0.22);
    cr.setSource(lg);
    cr.paint();

    cr.restore();      // discards the clip + mirror
    cr.restore();
}

/* moonPhase() needs a Date; paintMoon only has the 0..1 number — derive the
 * two fields it uses without re-reading the clock. */
function moonPhaseFrom(phase) {
    return {illum: (1 - Math.cos(TAU * phase)) / 2, waxing: phase < 0.5};
}
