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
    const EVERY = Math.max(1, opts.labelEvery ?? LABEL_EVERY);
    const FS = opts.fontSize ?? 8.5;

    const [acR, acG, acB] = accent;
    const INK = opts.ink ?? [0.96, 0.97, 0.98];   // dark theme: pass dark ink

    // y window with the mockup's asymmetric padding (headroom for labels);
    // an enabled condition strip asks for noticeably more sky above the line
    const strip = Array.isArray(opts.scenes) && opts.scenes.length === n
        ? opts.scenes : null;
    let lo = Math.min(...values), hi = Math.max(...values);
    if (hi - lo < 1e-6) { lo -= 1; hi += 1; }
    const pad = (hi - lo) * 0.35 + 1;
    lo -= pad; hi += pad * (strip ? 1.75 : 1.15);

    const X = i => PADX + i * (w - PADX * 2) / (n - 1);
    // with the band docked bottom, the line + its value labels lift off the
    // floor so nothing sits in the pill zone; the area fill still flows to
    // its usual depth (behind the translucent band, Apple-style)
    const bot = opts.stripBottom && Array.isArray(opts.scenes) ? BOT + 14 : BOT;
    const Y = v => TOP + (1 - (v - lo) / (hi - lo)) * (h - TOP - bot);
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
                drawText(cr, t, lx, h - 5, {size: FS, rgba: [...INK, 0.62], anchor});
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
        const span = (w - PADX * 2) / Math.max(1, n - 1);
        const nights = Array.isArray(opts.nights) ? opts.nights : [];
        const dark = opts.dark !== false;
        // band sits at the chart top, or docked above the hour labels when
        // the user picks 'bottom'. drawText anchors text UP from its y, so
        // the label glyphs occupy ~h-18..h-5: the docked pill bottom lands
        // 5+ px clear of that, and even the lowest value label (floor
        // h-42) stays off the band top.
        const stripY = opts.stripBottom ? h - 34 : STRIP_Y;
        const paint1 = (scene, cx, night, scale, cy = stripY) => {
            cr.save();
            cr.translate(cx - 12 * scale, cy - 12 * scale);
            cr.scale(scale, scale);
            paintWeather(cr, {scene: scene ?? 'cloud', time: 4.1, night: !!night,
                              dark, intensity: STRIP_INT[scene] ?? 0});
            cr.restore();
        };

        if (opts.pills) {
            // grouped: consecutive same-condition hours tile the axis as one
            // pill per run. Widths start as the exact time slice (edges at the
            // boundary hours' midpoints); runs narrower than MINW borrow width
            // from longer neighbours, so pills stay consistent AND can never
            // overlap. MINW/MINH = the largest scene glyph (sun incl. rays,
            // 15 px) + padding, so no pill is ever smaller than any icon.
            // Tint: a light neutral gray box on plain (accent-style) cards;
            // the day-tile hover glass, a shade lighter, on animated/solid
            // skies so pills and tiles speak one design language over the sky.
            const PH = 10.5, INSET = 2, SS = 0.58, MINW = 23, PILL_R = 6;
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
                const x0 = a === 0 ? PADX : (X(a - 1) + X(a)) / 2;
                const x1 = b === n - 1 ? w - PADX : (X(b) + X(b + 1)) / 2;
                runs.push({scene: strip[a], night: nights[a], w: x1 - x0});
                a = b + 1;
            }
            const def = runs.map(r => Math.max(0, MINW - r.w));
            const debt = def.reduce((s, v) => s + v, 0);
            const pool = runs.reduce((s, r) => s + Math.max(0, r.w - MINW), 0);
            const back = pool > 0 ? Math.min(1, debt / pool) : 0;
            let cur = PADX;
            for (let k = 0; k < runs.length; k++) {
                const r = runs[k];
                const rw = def[k] > 0
                    ? r.w + def[k]
                    : r.w - Math.max(0, r.w - MINW) * back;
                const x0 = cur + INSET;
                const x1 = Math.max(x0 + 4, cur + rw - INSET);
                cur += rw;
                cr.save();
                cr.setSourceRGBA(fill[0], fill[1], fill[2], fill[3]);
                pillPath(cr, x0, stripY - PH, x1, stripY + PH, PILL_R);
                cr.fillPreserve();
                cr.setSourceRGBA(edge[0], edge[1], edge[2], edge[3]);
                cr.setLineWidth(1);
                cr.stroke();
                cr.restore();
                // glyph clipped to the pill body so boosted scenes (moon
                // glow/stars) never leak over the pill's rounded edge
                cr.save();
                pillPath(cr, x0, stripY - PH, x1, stripY + PH, PILL_R);
                cr.clip();
                paint1(r.scene, (x0 + x1) / 2, r.night, SS * (FOOT[r.scene] ?? 1));
                cr.restore();
            }
        } else {
            const every = Math.max(2, Math.ceil(30 / span));
            for (let i = 0; i < n; i += every) {
                const cx = Math.min(Math.max(X(i), 10 + PADX), w - 10 - PADX);
                paint1(strip[i], cx, nights[i], STRIP_S * (FOOT[strip[i]] ?? 1));
            }
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
