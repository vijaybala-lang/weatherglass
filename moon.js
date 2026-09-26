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

/* Flat vector-style face, matching the reference art: a plain disc with a
 * few large organic shade regions (built as union paths of overlapping
 * ellipses, one flat fill each so overlaps never double-darken) and oval
 * two-tone craters whose inner shadow reads as a crescent. Light comes
 * from the upper left. All coords are unit-disc [x, y, rx, ry, rot], y down.
 * kind: 0 dark crater · 1 light crater · 2 bright streak · 3 speck */
const REGION_LIGHT = [
    [ 0.24, -0.16, 0.52, 0.44, -0.5],
    [-0.06, -0.44, 0.30, 0.22, -0.3],
    [ 0.50, -0.36, 0.22, 0.18, -0.6],
];
const REGION_DARK = [
    [-0.12,  0.30, 0.56, 0.40, 0.30],
    [-0.44,  0.00, 0.28, 0.44, 0.25],
    [ 0.28,  0.50, 0.34, 0.24, 0.1],
];
const CRATERS = [
    [-0.34, -0.42, 0.15, 0.11, -0.35, 0],
    [-0.02, -0.02, 0.11, 0.09,  0.15, 0],
    [ 0.36, -0.40, 0.09, 0.08,  0.45, 0],
    [ 0.14,  0.14, 0.13, 0.10, -0.25, 0],
    [-0.18,  0.48, 0.11, 0.08,  0.20, 0],
    [-0.50,  0.26, 0.08, 0.07,  0.10, 0],
    [ 0.50,  0.12, 0.07, 0.06,  0.30, 0],
    [-0.02,  0.66, 0.09, 0.06,  0.05, 0],
    [ 0.24, -0.58, 0.10, 0.07,  0.35, 1],
    [-0.30,  0.08, 0.11, 0.09, -0.20, 1],
    [ 0.42,  0.38, 0.07, 0.06,  0.15, 1],
    [-0.46, -0.16, 0.045, 0.11, 0.25, 2],   // bright streak craters
    [-0.40,  0.02, 0.032, 0.09, 0.30, 2],
    [-0.42, -0.34, 0.030, 0.025, 0.20, 3],
    [ 0.06,  0.42, 0.035, 0.028, 0.10, 3],
    [ 0.30,  0.66, 0.030, 0.026, 0.00, 3],
    [-0.22, -0.10, 0.028, 0.026, 0.00, 3],
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

/* Ellipse sub-path with optional rotation: arc() on a scaled CTM. cairo
 * accumulates paths in device space, so the restore() cannot distort it. */
function ell(cr, x, y, rx, ry, rot = 0) {
    cr.save();
    cr.translate(x, y);
    if (rot)
        cr.rotate(rot);
    cr.scale(rx, ry);
    cr.arc(0, 0, 1, 0, TAU);
    cr.restore();
}

/* One shade region: its ellipses traced as subpaths of a single union path,
 * filled once so overlaps never double-darken. */
function region(cr, r, spots, rgb) {
    cr.newPath();
    for (const [x, y, rx, ry, rot] of spots)
        ell(cr, x * r, y * r, rx * r, ry * r, rot);
    cr.setSourceRGB(rgb[0], rgb[1], rgb[2]);
    cr.fill();
}

/* Two-tone crater: fill the shadow tone, then an identical copy nudged
 * toward the light paints the interior — the uncovered sliver toward the
 * dark limb is the crescent shadow that gives every crater its depth. */
function crater(cr, r, c, shadow, inner) {
    const x = c[0] * r, y = c[1] * r, rx = c[2] * r, ry = c[3] * r, rot = c[4];
    cr.save();
    cr.newPath();
    ell(cr, x, y, rx, ry, rot);
    cr.setSourceRGB(shadow[0], shadow[1], shadow[2]);
    cr.fillPreserve();
    cr.clip();
    cr.newPath();
    ell(cr, x - rx * 0.35, y - ry * 0.35, rx, ry, rot);
    cr.setSourceRGB(inner[0], inner[1], inner[2]);
    cr.fill();
    cr.restore();
}

/**
 * paintMoon(cr, cx, cy, r, phase, style, opts)
 *   style 'icon' — flat warm-lit disc, transparent unlit part (crisp at 24px)
 *   style 'sky'  — flat vector face: regions + crescent-shadow craters
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

    // ── sky style: flat vector face, clipped to the lit crescent ──
    cr.fillPreserve();
    cr.clip();

    // plain lavender-grey disc — flat like the reference, never bright white
    cr.newPath();
    cr.arc(0, 0, r, 0, TAU);
    cr.setSourceRGB(0.80, 0.81, 0.88);
    cr.fill();

    // large organic shade regions, then the craters riding across them
    region(cr, r, REGION_LIGHT, [0.865, 0.875, 0.93]);
    region(cr, r, REGION_DARK, [0.665, 0.675, 0.78]);

    for (const c of CRATERS) {
        const kind = c[5];
        if (kind === 3) {                              // speck
            cr.newPath();
            ell(cr, c[0] * r, c[1] * r, c[2] * r, c[3] * r, c[4]);
            cr.setSourceRGB(0.58, 0.59, 0.70);
            cr.fill();
        } else if (kind === 2) {                       // bright streak
            cr.newPath();
            ell(cr, c[0] * r, c[1] * r, c[2] * r, c[3] * r, c[4]);
            cr.setSourceRGB(0.955, 0.96, 0.99);
            cr.fill();
        } else if (kind === 1) {                       // raised light crater
            crater(cr, r, c, [0.855, 0.865, 0.925], [0.935, 0.94, 0.975]);
        } else {                                       // dark crater
            crater(cr, r, c, [0.52, 0.53, 0.66], [0.645, 0.655, 0.765]);
        }
    }

    cr.restore();      // discards the clip + mirror
    cr.restore();
}

/* moonPhase() needs a Date; paintMoon only has the 0..1 number — derive the
 * two fields it uses without re-reading the clock. */
function moonPhaseFrom(phase) {
    return {illum: (1 - Math.cos(TAU * phase)) / 2, waxing: phase < 0.5};
}
