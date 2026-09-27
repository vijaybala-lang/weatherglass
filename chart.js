/* chart.js — pure cairo hourly line chart (mirrors the mockup's SVG renderer).
 *
 * paintChart(cr, opts) draws: gradient area fill + smooth Catmull-Rom line,
 * value labels every N points (edge-aware anchors), hour labels, and an
 * optional dashed "now" marker. Stateless — morphing between metrics is the
 * caller's job (it interpolates `values` and repaints).
 *
 * Call in logical coordinates: scale the context for HiDPI first
 * (cr.scale(dpr, dpr)), then pass w/h in logical px.
 */

import Cairo from 'gi://cairo';
import Pango from 'gi://Pango';
import PangoCairo from 'gi://PangoCairo';

import {paintWeather} from './painter.js';

const TOP = 38, BOT = 30, PADX = 2;      // mockup's padding values
const LINE_W = 3, LABEL_EVERY = 3;
const STRIP_Y = 13, STRIP_S = 0.6;       // condition-icon band: centre y, icon scale
// a little precip in the static icon poses so rain/snow scenes read right
const STRIP_INT = {rain: 2, snow: 2, sleet: 3, hail: 4, storm: 5};

/* GJS Pango bindings are snake_case on some releases and camelCase on newer
 * ones — feature-detect once per call rather than betting on one. */
function call(obj, camel, snake, ...args) {
    const fn = obj[camel] ?? obj[snake];
    return fn.call(obj, ...args);
}

/* ── shared WCAG referee: menu text, tabs, tiles and chart labels all
 *   pick their ink with these. 'dark wins down to L≈0.18, white above'
 *   is decided on RATIO, not a luminance threshold (thresholds
 *   misclassify mid-bright skies). Exported for menu.js. ── */
export const lumOf = c => {
    const f = v => v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
    return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]);
};
export const ratio = (a, b) => {
    const la = lumOf(a), lb = lumOf(b);
    return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
};
export function contrastSafe(accent, bg) {
    if (ratio(accent, bg) >= 3.1)
        return accent;
    // pick whichever ink wins on contrast (dark is better down to L≈0.18,
    // white above) — a luminance threshold misclassifies mid-bright skies
    const darkT = [0.09, 0.11, 0.15], lightT = [1, 1, 1];
    const target = ratio(darkT, bg) >= ratio(lightT, bg) ? darkT : lightT;
    let best = accent;
    for (let t = 0.1; t <= 1.001; t += 0.1) {
        best = accent.map((v, i) => v + (target[i] - v) * t);
        if (ratio(best, bg) >= 3.1)
            return best;
    }
    return best;
}
export const INK_DARK = [0.063, 0.094, 0.137];    // #101823
export const INK_LIGHT = [1, 1, 1];
/* Black-vs-white over sky tones. WCAG is symmetric but perception is not:
 * halation smears thin dark glyphs over mid-tone color, so dark ink must
 * win the ratio by a clear ~35% margin before it beats white. That moves
 * the flip from L~0.20 to L~0.24+: header text over a mid-blue day sky and
 * the dark-glass selected tile read white (right), while chart labels
 * (L~0.33+) and day tiles (L~0.45+) keep their dark ink. */
export const pickInk = bg =>
    ratio(INK_DARK, bg) >= ratio(INK_LIGHT, bg) * 1.35 ? INK_DARK : INK_LIGHT;

/* Curve ink over the animated/solid sky. The metric colour is identity
 * (precip blue, temp amber, wind mint) — so over bright skies we deepen
 * rather than replace. Multiplying channels darkens but ALSO dulls (olive
 * amber, steel blue — the eye reads desaturated), so the twin is built in
 * HSV instead: brightness walks down only as far as it must, saturation
 * pushes UP to stay vivid — the eye reads a multiplied dark twin as
 * desaturated (steel blue), an HSV-darkened one as the same colour. */
const deepen = base => {
    const mx = Math.max(...base), mn = Math.min(...base), d = mx - mn;
    let h = d === 0 ? 0
        : mx === base[0] ? (60 * ((base[1] - base[2]) / d) + 360) % 360
        : mx === base[1] ? 60 * ((base[2] - base[0]) / d + 2)
        : 60 * ((base[0] - base[1]) / d + 4);
    const s = Math.min(1, (mx === 0 ? 0 : d / mx) * 1.3 + 0.12);
    const toRgb = v => {
        const c = v * s, x = c * (1 - Math.abs((h / 60) % 2 - 1)), m = v - c;
        return [[c, x, 0], [x, c, 0], [0, c, x],
                [0, x, c], [x, 0, c], [c, 0, x]][Math.floor(h / 60) % 6]
            .map(k => k + m);
    };
    return toRgb;
};

/* Curve ink over the animated/solid sky. Warm ink is identity: the
 * temperature line is the panel icon's amber on every sky, unaltered.
 * Bright yellow over a bright sky can't also be 3:1 — darkening walks
 * into brown, and every workaround tried (rim, plate) reads as an
 * unwanted outline — so the colour wins and the area gradient carries
 * the shape's legibility instead. Cool inks have the luminance
 * headroom blue and green afford them, and keep deepening plainly. */
export const lineInk = (base, bgs) => {
    if (!bgs.length)
        return base;
    const worst = c => Math.min(...bgs.map(bg => ratio(c, bg)));
    if (base[0] - base[2] > 0.2)          // warm: amber, always
        return base;
    if (worst(base) >= 3)
        return base;
    const toRgb = deepen(base);
    let v = Math.max(...base);
    while (v > 0.08 && worst(toRgb(v)) < 3.05)
        v *= 0.97;
    return toRgb(v);
};

/** [w, h] pixel extents of a label in the chart font (same font set-up as
 *  drawText, so icon placement can centre on printed text, not data points). */
function textPx(cr, text, size, bold, weight = 0) {
    const layout = PangoCairo.create_layout(cr);
    const desc = Pango.FontDescription.new();
    desc.set_family('Cantarell');
    desc.set_size(Math.round(size * Pango.SCALE));
    if (weight)
        desc.set_weight(weight);
    else if (bold)
        desc.set_weight(Pango.Weight.MEDIUM);
    call(layout, 'setFontDescription', 'set_font_description', desc);
    call(layout, 'setText', 'set_text', text, -1);
    const px = call(layout, 'getPixelSize', 'get_pixel_size');
    return Array.isArray(px) ? [...px, layout] : [px.width, px.height, layout];
}

export function drawText(cr, text, x, y, {size = 10, bold = false, weight = 0,
                                          rgba = [1, 1, 1, 1],
                                          anchor = 'middle'} = {}) {
    const [pw, ph, layout] = textPx(cr, text, size, bold, weight);
    const tx = anchor === 'start' ? x : anchor === 'end' ? x - pw : x - pw / 2;
    cr.setSourceRGBA(...rgba);
    cr.moveTo(tx, y - ph);
    (PangoCairo.showLayout ?? PangoCairo.show_layout)(cr, layout);
}

/** Catmull-Rom → cubic Bézier, matching the mockup's smoothPath(). */
function tracePath(cr, pts) {
    cr.moveTo(pts[0][0], pts[0][1]);
    for (let i = 0; i < pts.length - 1; i++) {
        const p0 = pts[Math.max(0, i - 1)], p1 = pts[i],
              p2 = pts[i + 1], p3 = pts[Math.min(pts.length - 1, i + 2)];
        cr.curveTo(
            p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6,
            p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6,
            p2[0], p2[1]);
    }
}

/**
 * opts = {
 *   w, h:            logical size
 *   values:          number[] (24ish points, canonical units)
 *   fmtValue(i, v):  string   value label text
 *   fmtHour(i):      string   x label ('3 PM'); '' hides
 *   accent:          [r, g, b] 0..1
 *   nowFrac:         0..1 | null — dashed marker + accent label on that
 *                    point; everything left of it fades to pastKeep
 *   pastKeep:        alpha kept by past ink (default 0.55)
 *   scenes:          string[] | null — one painter scene name per value
 *                    point ('sun', 'rain'…): static condition icons in a
 *                    band above the line, ~30 px apart, night variants
 *                    via nights[i]; lives inside the fade group, so the
 *                    past hours' icons recede with the rest of the ink
 *   nights:          bool[] matching scenes
 *   labelEvery:      label stride (default 3; narrow cards pass a bigger one)
 *   fontSize:        label font size in pt (default 8.5)
 * }
 */
/* ── pill helpers (grouped condition mode) ──────────────────────────────── */

/* Footprint compensation: the sun's rays fill the 24-unit grid, cloud-only
 * scenes occupy barely 60 % of it — at one shared scale the cloud pills look
 * half-empty next to the sun. Scale small-footprint scenes up so every pill
 * (and strip icon) reads as an equally sized glyph. Moon stays capped so
 * its stars stay inside a minimum-size pill. */
const FOOT = {
    moon: 1.5, cloud: 1.35, fog: 1.25, rain: 1.2, drizzle: 1.2,
    sleet: 1.2, snow: 1.2, partly: 1.15, hail: 1.1, storm: 1.1,
};

/* Rounded box for the grouped-pill strip: radius < half-height gives a
 * soft rect, not a capsule (capsules read as pills-on-a-stick at 19 px). */
function pillPath(cr, x0, y0, x1, y1, r) {
    r = Math.min(r, (x1 - x0) / 2, (y1 - y0) / 2);
    cr.newPath();
    cr.moveTo(x0 + r, y0);
    cr.lineTo(x1 - r, y0);
    cr.arc(x1 - r, y0 + r, r, -Math.PI / 2, 0);
    cr.lineTo(x1, y1 - r);
    cr.arc(x1 - r, y1 - r, r, 0, Math.PI / 2);
    cr.lineTo(x0 + r, y1);
    cr.arc(x0 + r, y1 - r, r, Math.PI / 2, Math.PI);
    cr.lineTo(x0, y0 + r);
    cr.arc(x0 + r, y0 + r, r, Math.PI, 1.5 * Math.PI);
    cr.closePath();
}

export function paintChart(cr, opts) {
    const {w, h, values, fmtValue, fmtHour, accent, nowFrac = null} = opts;
    const n = values.length;
    if (n < 2)
        return;
    let EVERY = Math.max(1, opts.labelEvery ?? LABEL_EVERY);
    const FS = opts.fontSize ?? 8.5;
    // "Data text" emphasis: bigger and/or heavier values, hours and the now
    // label. Collision boxes measure with the SAME numbers, so emphasized
    // text reflows the label row instead of overlapping the curve.
    const TS = FS * (opts.textScale ?? 1);
    const VW = opts.textBold ? Pango.Weight.BOLD : Pango.Weight.MEDIUM;
    const HW = opts.textBold ? Pango.Weight.MEDIUM : Pango.Weight.NORMAL;

    const INK = opts.ink ?? [0.96, 0.97, 0.98];   // dark theme: pass dark ink
    // optional menu-supplied sampler: chart-local yPx -> composited backdrop
    // colour. When present every label picks its ink per position, so hour
    // text over a bright day sky goes dark and night text stays white.
    const bgFn = typeof opts.bgFn === 'function' ? opts.bgFn : null;
    const inkAt = yPx => (bgFn ? pickInk(bgFn(yPx)) : INK);

    // y window with the mockup's asymmetric padding (headroom for labels);
    // an enabled condition strip asks for noticeably more sky above the line
    const strip = Array.isArray(opts.scenes) && opts.scenes.length === n
        ? opts.scenes : null;
    let lo = Math.min(...values), hi = Math.max(...values);
    if (hi - lo < 1e-6) { lo -= 1; hi += 1; }
    const pad = (hi - lo) * 0.35 + 1;
    lo -= pad; hi += pad * (strip ? 1.75 : 1.15);

    // Data bleeds edge-to-edge (the mockup's behaviour); the LABEL rhythm
    // is what's inset: the first/last printed hour sits at least GUT px
    // from the card edge, with unlabeled hours still rendered beyond them.
    // (Unlabeled hours = real data points before/after the label range.)
    const GUT = opts.gutter ?? 14;
    const PX0 = PADX, PX1 = w - PADX;
    /* RTL (Arabic/Hebrew sessions): time flows right → left. Every x in
     * this painter rides X() or the sx()/so() edges below, so one mirror
     * flips curve, labels, strip band, past-fade and now marker together.
     * Slot order stays chronological in the data — only the canvas maps
     * it backwards, which is exactly what an RTL reader expects. */
    const rtl = !!opts.rtl;
    const sx = f => PADX + (rtl ? 1 - f : f) * (w - PADX * 2);
    const X = i => sx(i / (n - 1));
    // with the band docked bottom, the line + its value labels lift off the
    // floor so nothing sits in the pill zone; the area fill still flows to
    // its usual depth (behind the translucent band, Apple-style)
    const bot = opts.stripBottom && Array.isArray(opts.scenes) ? BOT + 14 : BOT;
    const Y = v => TOP + (1 - (v - lo) / (hi - lo)) * (h - TOP - bot);
    const pts = values.map((v, i) => [X(i), Y(v)]);

    /* Smart curve ink: a light-blue 2px line milks out over bright
     * overcast cloud (worst case ~1.6:1 in the wild). Sample the real
     * backdrop across the curve's own y-spread; cool inks deepen to a
     * vivid HSV twin, warm ink stays true amber on every sky. */
    const curveBgs = [];
    if (bgFn)
        for (let i = 0; i < pts.length; i += Math.max(1, pts.length >> 2))
            curveBgs.push(bgFn(pts[i][1]));
    const [acR, acG, acB] = lineInk(accent, curveBgs);

    // All grid ink (area fill, curve, value/hour labels) is drawn into an
    // isolated cairo group and composited back at the end: past the marker
    // at pastKeep alpha, future at full. This fades ONLY the chart's own
    // ink — the widget background and the sky behind it stay untouched.
    // (An earlier DEST_OUT attempt punched a see-through hole in the
    // composited widget background instead: the "box left of the marker".)
    const hasNow = nowFrac !== null && nowFrac >= 0 && nowFrac <= 1;
    cr.save();
    cr.pushGroup();

    // area (gradient) — fill under the curve to just above the hour labels
    const grad = new Cairo.LinearGradient(0, TOP, 0, h - BOT + 10);
    grad.addColorStopRGBA(0, acR, acG, acB, 0.38);
    grad.addColorStopRGBA(1, acR, acG, acB, 0);
    cr.newPath();
    tracePath(cr, pts);
    cr.lineTo(X(n - 1), h - BOT + 10);
    cr.lineTo(X(0), h - BOT + 10);
    cr.closePath();
    cr.setSource(grad);
    cr.fill();
    // stroke ONLY the curve (re-trace): fillPreserve here would outline the
    // whole closed area polygon — the "box around the line" bug
    cr.newPath();
    tracePath(cr, pts);
    cr.setSourceRGBA(acR, acG, acB, 1);
    cr.setLineWidth(LINE_W);
    cr.setLineCap(Cairo.LineCap.ROUND);
    cr.stroke();

    // The curve's TOP edge at any x: labels float above the line, so we
    // sample the same Catmull-Rom → cubic segments tracePath draws —
    // clearance matches the visible stroke, not a straight-line guess.
    const curve = [];
    for (let i = 0; i < pts.length - 1; i++) {
        const p0 = pts[Math.max(0, i - 1)], p1 = pts[i],
              p2 = pts[i + 1], p3 = pts[Math.min(pts.length - 1, i + 2)];
        const c1x = p1[0] + (p2[0] - p0[0]) / 6, c1y = p1[1] + (p2[1] - p0[1]) / 6,
              c2x = p2[0] - (p3[0] - p1[0]) / 6, c2y = p2[1] - (p3[1] - p1[1]) / 6;
        for (let k = 0; k <= 8; k++) {
            const t = k / 8, u = 1 - t;
            curve.push([
                u * u * u * p1[0] + 3 * u * u * t * c1x
                    + 3 * u * t * t * c2x + t * t * t * p2[0],
                u * u * u * p1[1] + 3 * u * u * t * c1y
                    + 3 * u * t * t * c2y + t * t * t * p2[1],
            ]);
        }
    }
    const curveMin = (xa, xb) => {
        let m = Infinity;
        for (const [sx, sy] of curve)
            if (sx >= xa - 1 && sx <= xb + 1 && sy < m)
                m = sy;
        return m;
    };

    // value + hour labels. Data bleeds off both ends (the edge hours are
    // still drawn), but the first/last PRINTED label is inset past GUT so
    // nothing clips: we offset the every-EVERY stride to the first index
    // whose x clears the gutter, leaving unlabeled hours at both ends.
    // Past that, TEXT-AWARE collision handling: every label is measured,
    // committed boxes are remembered, and a colliding label nudges one line
    // up, then one line down — dropped only if all three slots clash. Wide
    // wind labels ("11 mph") used to ride over their neighbours at the 3-h
    // stride, and the accent "now" label (drawn LAST, so its box gets
    // reserved up front) used to land right on top of them.
    const nowI = nowFrac === null ? -1 : Math.round(nowFrac * (n - 1));
    const span0 = (w - PADX * 2) / (n - 1);
    let off0 = Math.ceil((GUT - PADX) / span0);
    if (off0 < 0) off0 = 0;
    // text-aware stride: measure the widest label at the current emphasis
    // and widen the tick until neighbouring boxes fit with breathing room.
    // 'large' AM/PM labels (~33 px) overrun the ~37 px slots of a 3-h tick,
    // and the collision referee's only answer for neighbour-vs-neighbour
    // clashes is dropping every other hour (seen live as a broken axis).
    if (opts.labelEvery === undefined && fmtHour && n > 8) {
        let widest = 0;
        for (let i = off0; i < n; i += 2) {
            const t = fmtHour(i);
            if (t)
                widest = Math.max(widest, textPx(cr, t, TS, false, HW)[0]);
            if (fmtValue)
                widest = Math.max(widest,
                    textPx(cr, fmtValue(i, values[i]), TS, false, VW)[0]);
        }
        for (const c of [3, 4, 6, 8, 12])
            if (c >= EVERY && span0 * c >= widest + 5) {
                EVERY = c;
                break;
            }
    }
    const anchorOf = ax => ax < 46 ? 'start' : ax > w - 46 ? 'end' : 'middle';
    const lxOf = (ax, anchor) =>
        anchor === 'start' ? Math.max(GUT, ax - 6)
        : anchor === 'end' ? Math.min(w - GUT, ax + 6) : ax;
    const boxAt = (txt, lx, y, anchor) => {
        const [tw, th] = textPx(cr, txt, TS, false, HW);
        const x0 = anchor === 'start' ? lx
                 : anchor === 'end'   ? lx - tw : lx - tw / 2;
        return [x0 - 1.5, x0 + tw + 1.5, y - th - 1, y + 1];
    };
    const hits = (b, list) =>
        list.some(o => b[0] < o[1] && o[0] < b[1] && b[2] < o[3] && o[2] < b[3]);
    const boxOf = (x0, tw, th, y) => [x0 - 1.5, x0 + tw + 1.5, y - th - 1, y + 1];
    const used = [];
    // A value label's home: measure once, cap its baseline at the curve's
    // top edge under its own span (labels read ABOVE the line even where
    // the curve climbs steeply through them), then walk the collision slots.
    const placeLabel = (txt, lx, y0, a) => {
        const [tw, th] = textPx(cr, txt, TS, false, VW);
        const x0 = a === 'start' ? lx : a === 'end' ? lx - tw : lx - tw / 2;
        const floor = curveMin(x0, x0 + tw) - LINE_W / 2 - 2;
        for (const yy of [Math.min(y0, floor), y0 - 15, y0 + 15]) {
            const yc = Math.min(yy, floor);
            const b = boxOf(x0, tw, th, yc);
            if (b[2] < 2 || hits(b, used))
                continue;
            used.push(b);
            return { b, lx, y: yc, a, txt };
        }
        return null;
    };
    let nowPlace = null;
    if (nowI >= 0 && fmtValue) {          // reserve the accent label's slot
        const ax = X(nowI);
        const a = anchorOf(ax), lx = lxOf(ax, a);
        const txt = fmtValue(nowI, values[nowI]);
        const [tw, th] = textPx(cr, txt, TS, false, VW);
        const x0 = a === 'start' ? lx : a === 'end' ? lx - tw : lx - tw / 2;
        const y = Math.min(Y(values[nowI]) - 22 + 1,
                           curveMin(x0, x0 + tw) - LINE_W / 2 - 2);
        nowPlace = { txt, lx, y, a };
        used.push(boxOf(x0, tw, th, y));
    }
    if (strip) {                          // and the condition band's row —
        const bandY = opts.stripBottom ? h - 34 : STRIP_Y;
        // the band's DOWN margin shrinks to the hour text's height: a
        // 'large' label row would otherwise collide with the fixed band
        // and every hour label gets dropped (observed live in the menu)
        const hourH = textPx(cr, '0', TS, false, HW)[1];
        used.push([0, w, bandY - 13,
                   Math.min(bandY + 13, h - 7 - hourH)]);
    }
    for (let i = off0; fmtValue && i < n; i += EVERY) {
        const ax = X(i);
        const a = anchorOf(ax), lx = lxOf(ax, a);
        const placed = placeLabel(fmtValue(i, values[i]), lx,
                                  Y(values[i]) - 12 + 1, a);
        if (placed)
            drawText(cr, placed.txt, lx, placed.y,
                     {size: TS, weight: VW, rgba: [...inkAt(placed.y), 0.62], anchor: a});
    }
    // hour labels stay flat on their baseline — a clash drops the label
    // instead of staggering the row
    for (let i = off0; fmtHour && i < n; i += EVERY) {
        const t = fmtHour(i);
        if (!t)
            continue;
        const ax = X(i);
        const a = anchorOf(ax), lx = lxOf(ax, a);
        const b = boxAt(t, lx, h - 5, a);
        if (!hits(b, used)) {
            used.push(b);
            drawText(cr, t, lx, h - 5, {size: TS, weight: HW, rgba: [...inkAt(h - 5), 0.62], anchor: a});
        }
    }

    // condition strip along the top — the same flat vocabulary as the panel
    // icon (painter.js), posed statically. Two modes:
    //   'icons': one icon per stride slot (>=30 px apart), edge ones nudge in
    //   'pills': consecutive same-condition hours merge into one rounded pill
    //            spanning exactly their slice of the axis, icon centred
    // dark=true paints for the dark sky; light cards pass dark:false so pale
    // glyphs (moon/snow/fog) use their darker twins (painter.js INK_*).
    // pillGlass=true switches the pill fill from the accent tint to the
    // day-tile hover glass (same design language as the tiles).
    if (strip) {
        const span = (PX1 - PX0) / Math.max(1, n - 1);
        const nights = Array.isArray(opts.nights) ? opts.nights : [];
        const dark = opts.dark !== false;
        // band sits at the chart top, or docked above the hour labels when
        // the user picks 'bottom'. drawText anchors text UP from its y, so
        // the label glyphs occupy ~h-18..h-5: the docked pill bottom lands
        // 5+ px clear of that, and even the lowest value label (floor
        // h-42) stays off the band top.
        const stripY = opts.stripBottom ? h - 34 : STRIP_Y;
        // flat icons vanish on mid-tone skies (overcast days especially).
        // When the panel hands us an iconOutline colour (picked against the
        // REAL composited backdrop), stamp a 1-px silhouette ring of it
        // under the icon: render once offscreen, knock the flat colour out
        // of the icon's own alpha, stamp the silhouette at 8 sub-pixel
        // offsets, then the real icon on top.
        const OUT = Array.isArray(opts.iconOutline) ? opts.iconOutline : null;
        const paint1 = (scene, cx, night, scale, cy = stripY) => {
            /* The palette follows the SKY the icon rides, not the theme:
             * white moons and stars blow out across a bright day foot
             * (1 AM glyphs over a clear-sky noon backdrop). Each icon
             * samples its own backdrop — genuinely bright (0.55 up)
             * turns pale glyphs into their dark twins, and the
             * silhouette ring (built to edge OUT pale glyphs) stands
             * down, else dark-on-dark reads chunky. Mid-tone skies
             * (overcast foot ~0.52) keep the approved pale + ring look. */
            const palDark = bgFn ? lumOf(bgFn(cy)) >= 0.55 : dark;
            const pose = c => {
                c.translate(cx - 12 * scale, cy - 12 * scale);
                c.scale(scale, scale);
                paintWeather(c, {scene: scene ?? 'cloud', time: 4.1,
                                 night: !!night, dark: !palDark,
                                 intensity: STRIP_INT[scene] ?? 0});
            };
            if (!OUT || palDark) {
                cr.save();
                pose(cr);
                cr.restore();
                return;
            }
            const d = Math.ceil(24 * scale) + 4, r = d / 2;
            const S = new Cairo.ImageSurface(Cairo.Format.ARGB32, d, d);
            const c2 = new Cairo.Context(S);
            c2.translate(r - 12 * scale, r - 12 * scale);
            c2.scale(scale, scale);
            paintWeather(c2, {scene: scene ?? 'cloud', time: 4.1, night: !!night,
                              dark: !palDark, intensity: STRIP_INT[scene] ?? 0});
            c2.$dispose();
            const T = new Cairo.ImageSurface(Cairo.Format.ARGB32, d, d);
            const c3 = new Cairo.Context(T);
            c3.setSourceRGBA(OUT[0], OUT[1], OUT[2], OUT[3]);
            c3.paint();
            c3.setOperator(Cairo.Operator.IN);
            c3.setSourceSurface(S, 0, 0);
            c3.paint();
            c3.$dispose();
            // denser ring than a lone 4-way stamp: inner + mid offsets fuse
            // into a solid ~1.5 px contour so pale night-cloud glyphs read
            // even on a matching overcast wash
            for (const [dx, dy] of [[-1.25, 0], [1.25, 0], [0, 1.25], [0, -1.25],
                                    [-0.95, -0.95], [0.95, -0.95],
                                    [-0.95, 0.95], [0.95, 0.95],
                                    [-0.55, 0], [0.55, 0], [0, -0.55], [0, 0.55]]) {
                cr.setSourceSurface(T, cx - r + dx, cy - r + dy);
                cr.paint();
            }
            cr.save();
            pose(cr);
            cr.restore();
        };

        if (opts.pills) {
            // Grouped band: consecutive same-condition hours become one
            // CELL; cells share edges (no gaps) inside a single rounded
            // band. Dotted vertical seams mark condition changes (never at
            // the band's outer edges) and a heavier bottom rule grounds it
            // as an axis — doubly so when docked above the hour labels.
            // Cells narrower than MINW borrow width from longer neighbours,
            // so they stay consistent AND can never overlap. Tint: light
            // neutral gray on plain (accent-style) cards; the day-tile
            // hover glass, a shade lighter, on animated/solid skies.
            const PH = 10.5, SS = 0.58, MINW = 23, PILL_R = 6, BW = 1.9;
            const glass = !!opts.pillGlass;
            const fill = glass
                ? (dark ? [16 / 255, 20 / 255, 28 / 255, 0.22] : [1, 1, 1, 0.36])
                : (dark ? [1, 1, 1, 0.10] : [0.14, 0.16, 0.19, 0.07]);
            const edge = glass
                ? (dark ? [1, 1, 1, 0.16] : [16 / 255, 24 / 255, 35 / 255, 0.15])
                : (dark ? [1, 1, 1, 0.16] : [0.14, 0.16, 0.19, 0.12]);
            const runs = [];
            let a = 0;
            while (a < n) {
                const key = `${strip[a]}|${nights[a] ? 1 : 0}`;
                let b = a;
                while (b + 1 < n && `${strip[b + 1]}|${nights[b + 1] ? 1 : 0}` === key)
                    b++;
                const x0 = a === 0 ? sx(0) : (X(a - 1) + X(a)) / 2;
                const x1 = b === n - 1 ? sx(1) : (X(b) + X(b + 1)) / 2;
                runs.push({scene: strip[a], night: nights[a], w: Math.abs(x1 - x0)});
                a = b + 1;
            }
            const def = runs.map(r => Math.max(0, MINW - r.w));
            const debt = def.reduce((s, v) => s + v, 0);
            const pool = runs.reduce((s, r) => s + Math.max(0, r.w - MINW), 0);
            const back = pool > 0 ? Math.min(1, debt / pool) : 0;
            const cellW = runs.map((r, k) =>
                def[k] > 0 ? r.w + def[k] : r.w - Math.max(0, r.w - MINW) * back);
            const bandX1 = PX0 + cellW.reduce((s, v) => s + v, 0);
            const band = () =>
                pillPath(cr, PX0, stripY - PH, bandX1, stripY + PH, PILL_R);

            cr.save();
            band();
            cr.setSourceRGBA(fill[0], fill[1], fill[2], fill[3]);
            cr.fillPreserve();
            cr.setSourceRGBA(edge[0], edge[1], edge[2], edge[3]);
            cr.setLineWidth(1);
            cr.stroke();
            cr.restore();

            // everything below rides inside the band clip: the bottom rule
            // follows the rounded corners, and boosted scenes (moon glow,
            // stars) can never leak over the band edges
            cr.save();
            band();
            cr.clip();
            cr.setSourceRGBA(edge[0], edge[1], edge[2], Math.min(0.42, edge[3] * 1.9));
            cr.rectangle(PX0, stripY + PH - BW, bandX1 - PX0, BW);
            cr.fill();

            // dotted seams at interior cell borders (GJS cairo has no
            // setDash — real dots it is). RTL walks right → left.
            const dir = rtl ? -1 : 1;
            cr.setSourceRGBA(edge[0], edge[1], edge[2], Math.min(0.65, edge[3] * 2.6));
            let acc = rtl ? PX1 : PX0;
            for (let k = 0; k < runs.length - 1; k++) {
                acc += dir * cellW[k];
                for (let y = stripY - PH + 2.5; y <= stripY + PH - 2.5; y += 3.2) {
                    cr.arc(acc, y, 0.6, 0, Math.PI * 2);
                    cr.fill();
                }
            }

            acc = rtl ? PX1 : PX0;
            for (const [k, r] of runs.entries()) {
                paint1(r.scene, acc + dir * cellW[k] / 2, r.night,
                       SS * (FOOT[r.scene] ?? 1));
                acc += dir * cellW[k];
            }
            cr.restore();
        } else {
            // Icons only: ride the exact printed-label rhythm — same stride
            // (multiples of EVERY), same gutter offset, same edge anchors —
            // so every icon sits centred over its hour/value text column.
            // At the card edges the labels flow inward and the icon follows
            // the TEXT centre, not the data point.
            const step = EVERY * Math.max(1, Math.ceil(30 / span / EVERY));
            for (let i = off0; i < n; i += step) {
                const ax = X(i);
                if (ax > w - GUT)          // same skip as the label loop
                    continue;
                const anchor = ax < 46 ? 'start' : ax > w - 46 ? 'end' : 'middle';
                const lx = anchor === 'start' ? Math.max(GUT, ax - 6)
                         : anchor === 'end'   ? Math.min(w - GUT, ax + 6) : ax;
                let tw = textPx(cr, fmtValue ? fmtValue(i, values[i])
                                             : String(values[i]), TS, false, VW)[0];
                if (fmtHour) {
                    const t = fmtHour(i);
                    if (t)
                        tw = Math.max(tw, textPx(cr, t, TS, false, HW)[0]);
                }
                const cx = anchor === 'start' ? lx + tw / 2
                         : anchor === 'end'   ? lx - tw / 2 : lx;
                paint1(strip[i], cx, nights[i], STRIP_S * (FOOT[strip[i]] ?? 1));
            }
        }
    }

    cr.popGroupToSource();
    if (hasNow && nowFrac > 0) {
        const fx = PX0 + nowFrac * (PX1 - PX0);
        cr.save();
        cr.rectangle(0, 0, fx, h);
        cr.clip();
        cr.paintWithAlpha(opts.pastKeep ?? 0.55);   // lived hours recede
        cr.restore();
        cr.save();
        cr.rectangle(fx, 0, w - fx, h);
        cr.clip();
        cr.paint();
        cr.restore();
    } else {
        cr.paint();
    }
    cr.restore();

    // now marker (manual dashes — cr.setDash binding is unreliable in GJS)
    if (nowFrac !== null && nowFrac >= 0 && nowFrac <= 1) {
        const nx = PX0 + nowFrac * (PX1 - PX0);
        cr.save();
        cr.setSourceRGBA(1, 1, 1, 0.35);
        cr.setLineWidth(1);
        for (let y = TOP - 26; y < h - BOT; y += 8) {
            cr.moveTo(nx, y);
            cr.lineTo(nx, Math.min(y + 3, h - BOT));
        }
        cr.stroke();
        cr.restore();
    }

    // accent label riding the now marker, above the veil — drawn at the
    // exact slot reserved in the label pass (curve-cleared baseline, inward
    // flow near the edges) so nothing ever lands under it. With a bgFn the
    // accent is re-safened against the backdrop at ITS y, not the chart mid.
    if (nowPlace)
        drawText(cr, nowPlace.txt, nowPlace.lx, nowPlace.y,
                 {size: TS, weight: VW,
                  rgba: [...(bgFn ? contrastSafe(accent, bgFn(nowPlace.y))
                                  : (opts.nowLabel ?? [acR, acG, acB])), 1],
                  anchor: nowPlace.a});
}

/* ── morphing helper (shared by the menu) ──────────────────────────────── */

/** ease-out cubic, 0..1 */
export function ease(k) {
    return 1 - Math.pow(1 - k, 3);
}

export function lerp(from, to, k) {
    if (!from || from.length !== to.length)
        return to.slice();
    return to.map((v, i) => from[i] + (v - from[i]) * k);
}
