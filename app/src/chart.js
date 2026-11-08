// chart.js — hourly profile chart (temperature / precipitation / wind).
// Visual DNA from the WeatherGlass extension chart.js: padded plot, smooth
// spline, sparse labeled points, "now" marker inside the rolling-24h window,
// per-hour condition glyphs. Static redraw only — no animation timers.

import GObject from 'gi://GObject?version=2.0';
import Gtk from 'gi://Gtk?version=4.0';
import Cairo from 'gi://cairo?version=1.0';
import { drawScene } from './glyph.js';
import { fmtTemp, shortHourLabel, sceneFor, precipIntensity } from './weather.js';

export const CHART_SERIES = {
    temp: { rgb: [0.96, 0.65, 0.14], label: 'Temperature' },
    precip: { rgb: [0.30, 0.64, 1.00], label: 'Precipitation' },
    wind: { rgb: [0.24, 0.81, 0.56], label: 'Wind' },
};

const PAD = { left: 26, right: 16, top: 30, bottom: 36 };
const STRIP = 18; // condition glyph band height, above the hour labels

function seriesValues(slice, metric) {
    switch (metric) {
    case 'precip': return slice.precipProb.map(v => v ?? 0);
    case 'wind': return slice.wind.map(v => v ?? null);
    default: return slice.temp.map(v => v ?? null);
    }
}

function valueLabel(metric, v, units) {
    if (v == null) return '';
    if (metric === 'precip') return `${Math.round(v)}%`;
    if (metric === 'wind')
        return `${Math.round(units === 'imperial' ? v * 0.621371 : v)}`;
    return fmtTemp(v, units).replace('°', '');
}

/**
 * Pure renderer used both by the widget and headless tests.
 * state: { slice, metric, units, h12, dark, fgRgb?, seriesRgb? }
 * fgRgb/seriesRgb come from the adaptive-ink judges (ink.js) when the chart
 * sits over the animated sky; without them the classic dark/light fallback
 * applies — the extension's own separation of judged vs themed ink.
 */
export function paintChart(cr, w, h, state) {
    const { slice, metric = 'temp', units = 'metric', h12 = false, dark = false,
        fgRgb = null, seriesRgb = null } = state;
    const FG = fgRgb ?? (dark ? [1, 1, 1] : [0, 0, 0]);
    const fg = (alpha = 1) => {
        cr.setSourceRGBA(...FG, alpha);
    };

    cr.selectFontFace('Cantarell', Cairo.FontSlant.NORMAL, Cairo.FontWeight.NORMAL);

    if (!slice || !slice.time?.length) {
        fg(0.4);
        cr.setFontSize(11);
        cr.moveTo(12, h / 2);
        cr.showText('Waiting for the forecast…');
        return;
    }

    // seriesRgb arrives as the judged dict {temp:[..], precip:[..], wind:[..]}
    // — unwrap THIS metric's triple (spreading the dict would throw)
    const judgedSeries = seriesRgb?.[metric];
    const [sr, sg, sb] = judgedSeries ?? CHART_SERIES[metric].rgb;
    const vals = seriesValues(slice, metric);
    const n = vals.length;
    const plotW = w - PAD.left - PAD.right;
    const stripTop = h - PAD.bottom - STRIP;
    const plotBot = stripTop - 8;
    const plotH = Math.max(20, plotBot - PAD.top);
    const xs = i => PAD.left + (n > 1 ? (i / (n - 1)) * plotW : plotW / 2);

    const present = vals.filter(v => v != null);
    if (!present.length) return;
    /* Metric-agnostic window, like the extension's chart: it plots whatever
     * values[] it is handed through ONE y-window + padding pass — precipitation
     * probabilities are ordinary data points, not a 0-100 gauge. (The app once
     * special-cased precip into a forced 0..100 axis with rounded bars; the
     * extension never draws bars. Deleted, do not resurrect.) */
    let vmin = Math.min(...present);
    let vmax = Math.max(...present);
    if (!Number.isFinite(vmin) || !Number.isFinite(vmax)) { vmin = 0; vmax = 1; }
    if (vmax - vmin < 1) { vmax += 0.5; vmin -= 0.5; }
    const padV = (vmax - vmin) * 0.22;
    vmin -= padV;
    vmax += padV;
    const ys = v => PAD.top + (1 - (v - vmin) / (vmax - vmin)) * plotH;

    const stride = n > 16 ? 3 : 2;

    // --- series -----------------------------------------------------------------
    // ONE path for every metric: spline area + stroke (mirrors the
    // extension's chart — a line, never bars).
    {
        const pts = [];
        for (let i = 0; i < n; i++)
            if (vals[i] != null) pts.push([xs(i), ys(vals[i])]);
        if (pts.length > 1) {
            // soft area under the curve
            cr.newPath();
            cr.moveTo(pts[0][0], pts[0][1]);
            spline(cr, pts);
            cr.lineTo(pts[pts.length - 1][0], plotBot);
            cr.lineTo(pts[0][0], plotBot);
            cr.closePath();
            const grad = new Cairo.LinearGradient(0, PAD.top, 0, plotBot);
            grad.addColorStopRGBA(0, sr, sg, sb, 0.26);
            grad.addColorStopRGBA(1, sr, sg, sb, 0);
            cr.setSource(grad);
            cr.fill();

            cr.newPath();
            cr.moveTo(pts[0][0], pts[0][1]);
            spline(cr, pts);
            cr.setSourceRGBA(sr, sg, sb, 1);
            cr.setLineWidth(3);
            cr.setLineJoin(Cairo.LineJoin.ROUND);
            cr.setLineCap(Cairo.LineCap.ROUND);
            cr.stroke();
        }
    }

    // --- dots + value labels -----------------------------------------------------
    for (let i = 0; i < n; i++) {
        if (vals[i] == null) continue;
        const labeled = i % stride === 0;
        cr.setSourceRGBA(sr, sg, sb, labeled ? 1 : 0.5);
        cr.arc(xs(i), ys(vals[i]), labeled ? 3.1 : 1.7, 0, 2 * Math.PI);
        cr.fill();
        if (labeled) {
            const txt = valueLabel(metric, vals[i], units);
            cr.setFontSize(10.5);
            fg(0.9);
            const ext = cr.textExtents(txt);
            cr.moveTo(clamp(xs(i) - ext.width / 2, 2, w - ext.width - 2),
                Math.max(PAD.top - 12, ys(vals[i]) - 11));
            cr.showText(txt);
        }
    }

    // --- "now" marker -------------------------------------------------------------
    if (slice.dayIndex === 0 && slice.nowFrac > 0) {
        const nx = PAD.left + slice.nowFrac * plotW;
        fg(0.30);
        cr.setDash([4, 4], 0);
        cr.setLineWidth(1);
        cr.moveTo(nx, PAD.top - 16);
        cr.lineTo(nx, plotBot + 6);
        cr.stroke();
        cr.setDash([], 0);
        const near = Math.min(n - 1, Math.max(0, Math.round(slice.nowFrac * (n - 1))));
        if (vals[near] != null) {
            cr.setSourceRGBA(1, 1, 1, 0.96);
            cr.arc(xs(near), ys(vals[near]), 5.4, 0, 2 * Math.PI);
            cr.fill();
            cr.setSourceRGBA(sr, sg, sb, 1);
            cr.arc(xs(near), ys(vals[near]), 3.3, 0, 2 * Math.PI);
            cr.fill();
        }
        cr.setFontSize(9);
        fg(0.6);
        cr.moveTo(nx - 9, PAD.top - 18);
        cr.showText('now');
    }

    // --- condition strip + hour labels --------------------------------------------
    for (let i = 0; i < n; i++) {
        if (i % stride !== 0) continue;
        const x = clamp(xs(i), 8, w - 8);
        if (slice.code?.[i] != null) {
            const sc = sceneFor(slice.code[i], !!slice.isDay?.[i]);
            // over the sky, a day-hours glyph whose composited ground is
            // dark joins the glow family (tileGlyphPale bar, 0.30) without
            // losing its day shapes
            const ground = state.groundLum?.(x, stripTop + 9);
            const pale = ground != null && ground < 0.30 && !sc.night;
            // extension anatomy: 34 px hour glyphs, centred on the tick
            cr.save();
            cr.translate(x - 17, stripTop);
            drawScene(cr, 34, { scene: sc.scene, night: sc.night,
                pale, intensity: precipIntensity(slice.code[i]),
                variant: sc.variant ?? null, seed: i });
            cr.restore();
        }
        const lbl = shortHourLabel(slice.time[i], h12);
        cr.setFontSize(9.5);
        fg(0.55);
        const ext = cr.textExtents(lbl);
        cr.moveTo(clamp(x - ext.width / 2, 2, w - ext.width - 2), h - 4);
        cr.showText(lbl);
    }
}

function spline(cr, pts) {
    for (let i = 0; i < pts.length - 1; i++) {
        const p0 = pts[Math.max(i - 1, 0)];
        const p1 = pts[i];
        const p2 = pts[i + 1];
        const p3 = pts[Math.min(i + 2, pts.length - 1)];
        cr.curveTo(
            p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6,
            p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6,
            p2[0], p2[1]);
    }
}

function clamp(v, lo, hi) {
    return Math.min(hi, Math.max(lo, v));
}

/**
 * Pre-rasterized chart surface, repainted only on invalidate/resize/scale
 * change and blitted 1:1 into the snapshot context every draw.
 *
 * Why this exists: a Gtk.DrawingArea snapshot is a Cairo RECORDING, and
 * the GPU renderer re-rasterizes that recording whenever it needs the
 * node as an image — inside the ScrolledWindow's clip that was every
 * presented frame, so the whole chart (splines, labels, 24 strip glyphs,
 * all gradients) replayed at device scale per frame while the sky
 * animated behind it. Measured on a 2880x1800@1.67 display: frame times
 * of 70 ms (GL) to 278 ms (Vulkan) and a 2-4 fps app, from a chart whose
 * data had not changed. With the raster cached here, the recording GSK
 * replays is a single surface paint and frames return to ~4 ms.
 * paintChart itself is unchanged and stays the one renderer (headless
 * previews call it directly, glyph-for-glyph identical).
 */
export class ChartRaster {
    #surf = null;
    #key = '';
    #version = 0;
    rasters = 0;

    invalidate() { this.#version++; }

    /** Blit the chart into `cr` (logical coords), rasterizing at the
     * device scale factor `sf` first if anything material changed. */
    paint(cr, w, h, sf, opts) {
        if (w < 2 || h < 2) return;
        const scale = Math.max(1, sf || 1);
        const key = `${w}x${h}@${scale}|${this.#version}`;
        if (!this.#surf || this.#key !== key) {
            this.#surf = new Cairo.ImageSurface(Cairo.Format.ARGB32,
                Math.max(1, Math.round(w * scale)),
                Math.max(1, Math.round(h * scale)));
            const cc = new Cairo.Context(this.#surf);
            cc.scale(scale, scale);
            paintChart(cc, w, h, opts);
            cc.$dispose();
            this.#surf.flush();
            this.#key = key;
            this.rasters++;
        }
        cr.save();
        cr.scale(1 / scale, 1 / scale);
        cr.setSourceSurface(this.#surf, 0, 0);
        cr.paint();
        cr.restore();
    }
}

export const HourlyChart = GObject.registerClass({ gTypeName: 'WHourlyChart' },
class HourlyChart extends Gtk.DrawingArea {
    #slice = null;
    #metric = 'temp';
    #units = 'metric';
    #h12 = false;
    #dark = false;
    #fgRgb = null;
    #seriesRgb = null;
    #groundLum = null;
    #raster = new ChartRaster();

    constructor() {
        super();
        this.add_css_class('hourly-chart'); // identifiable scenery: interactive by design
        this.set_content_height(196);
        this.set_vexpand(false);
        this.set_draw_func((_w, cr, w, h) =>
            this.#raster.paint(cr, w, h, this.get_scale_factor(), {
                slice: this.#slice,
                metric: this.#metric,
                units: this.#units,
                h12: this.#h12,
                dark: this.#dark,
                fgRgb: this.#fgRgb,
                seriesRgb: this.#seriesRgb,
                groundLum: this.#groundLum,
            }));
    }

    #invalidate() {
        this.#raster.invalidate();
        this.queue_draw();
    }

    set metric(name) {
        if (CHART_SERIES[name]) {
            this.#metric = name;
            this.#invalidate();
        }
    }

    get metric() { return this.#metric; }

    set units(v) { this.#units = v; this.#invalidate(); }
    set h12(v) { this.#h12 = !!v; this.#invalidate(); }
    set dark(v) { this.#dark = !!v; this.#invalidate(); }

    /** Adaptive-ink injection from the sky judges (see ink.js). Passing
     * null resets to the theme-derived fallback. */
    setJudgedInk(fgRgb, seriesRgb) {
        this.#fgRgb = fgRgb;
        this.#seriesRgb = seriesRgb;
        this.#invalidate();
    }

    /** (px, py) -> composited ground luminance under the strip glyphs. */
    setGroundSampler(fn) {
        this.#groundLum = fn;
        this.#invalidate();
    }

    setData(slice) {
        this.#slice = slice;
        this.#invalidate();
    }
});
