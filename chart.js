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

const TOP = 38, BOT = 30, PADX = 2;      // mockup's padding values
const LINE_W = 3, LABEL_EVERY = 3;

/* GJS Pango bindings are snake_case on some releases and camelCase on newer
 * ones — feature-detect once per call rather than betting on one. */
function call(obj, camel, snake, ...args) {
    const fn = obj[camel] ?? obj[snake];
    return fn.call(obj, ...args);
}

function drawText(cr, text, x, y, {size = 10, bold = false, rgba = [1, 1, 1, 1],
                                   anchor = 'middle'} = {}) {
    const layout = PangoCairo.create_layout(cr);
    const desc = Pango.FontDescription.new();
    desc.set_family('Cantarell');
    desc.set_size(Math.round(size * Pango.SCALE));
    if (bold)
        desc.set_weight(Pango.Weight.MEDIUM);
    call(layout, 'setFontDescription', 'set_font_description', desc);
    call(layout, 'setText', 'set_text', text, -1);
    const px = call(layout, 'getPixelSize', 'get_pixel_size');
    const [pw, ph] = Array.isArray(px) ? px : [px.width, px.height];
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
 *   labelEvery:      label stride (default 3; narrow cards pass a bigger one)
 *   fontSize:        label font size in pt (default 8.5)
 * }
 */
export function paintChart(cr, opts) {
    const {w, h, values, fmtValue, fmtHour, accent, nowFrac = null} = opts;
    const n = values.length;
    if (n < 2)
        return;
    const EVERY = Math.max(1, opts.labelEvery ?? LABEL_EVERY);
    const FS = opts.fontSize ?? 8.5;

    const [acR, acG, acB] = accent;
    const INK = opts.ink ?? [0.96, 0.97, 0.98];   // dark theme: pass dark ink

    // y window with the mockup's asymmetric padding (headroom for labels)
    let lo = Math.min(...values), hi = Math.max(...values);
    if (hi - lo < 1e-6) { lo -= 1; hi += 1; }
    const pad = (hi - lo) * 0.35 + 1;
    lo -= pad; hi += pad * 1.15;

    const X = i => PADX + i * (w - PADX * 2) / (n - 1);
    const Y = v => TOP + (1 - (v - lo) / (hi - lo)) * (h - TOP - BOT);
    const pts = values.map((v, i) => [X(i), Y(v)]);

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

    // value + hour labels. The "now" point and its immediate neighbours
    // make way: the accent label gets drawn AFTER the group composite so
    // it stays crisp (the 2 h backfill usually puts now off the label
    // stride anyway, hence the crowded() logic).
    const nowI = nowFrac === null ? -1 : Math.round(nowFrac * (n - 1));
    for (let i = 0; i < n; i += EVERY) {
        const ax = X(i);
        const anchor = ax < 46 ? 'start' : ax > w - 46 ? 'end' : 'middle';
        const lx = anchor === 'start' ? Math.max(4, ax - 6)
                 : anchor === 'end'   ? Math.min(w - 4, ax + 6) : ax;
        const crowded = nowI >= 0 && Math.abs(i - nowI) < 2;
        if (!crowded)
            drawText(cr, fmtValue ? fmtValue(i, values[i]) : String(values[i]),
                     lx, Y(values[i]) - 12 + 1,
                     {size: FS, bold: true, rgba: [...INK, 0.62], anchor});
        if (fmtHour) {
            const t = fmtHour(i);
            if (t)
                drawText(cr, t, lx, h - 8, {size: FS, rgba: [...INK, 0.62], anchor});
        }
    }

    cr.popGroupToSource();
    if (hasNow && nowFrac > 0) {
        const fx = PADX + nowFrac * (w - PADX * 2);
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
        const nx = PADX + nowFrac * (w - PADX * 2);
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

    // accent label riding the now marker, above the veil
    if (nowI >= 0 && fmtValue) {
        const ax = X(nowI);
        const anchor = ax < 46 ? 'start' : ax > w - 46 ? 'end' : 'middle';
        const lx = anchor === 'start' ? Math.max(4, ax - 6)
                 : anchor === 'end'   ? Math.min(w - 4, ax + 6) : ax;
        drawText(cr, fmtValue(nowI, values[nowI]), lx, Y(values[nowI]) - 22 + 1,
                 {size: FS, bold: true, rgba: [acR, acG, acB, 1], anchor});
    }
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
