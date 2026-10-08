/* chart.js -- hourly line chart */

import Cairo from 'gi://cairo';
import Pango from 'gi://Pango';
import PangoCairo from 'gi://PangoCairo';

import { paintWeather } from './painter.js';

const PADDING_TOP = 38, PADDING_BOTTOM = 30, PADDING_X = 2;
const LINE_WIDTH = 3, DEFAULT_LABEL_INTERVAL = 3;
const STRIP_CENTER_Y = 13, STRIP_ICON_SCALE = 0.6;
/* uniform medallion radius for 'icons' mode: half the widest glyph box
 * (moon: 12 * 0.6 * 1.5) plus ~2 px padding -- every condition gets the
 * same coin, only the glyph varies */
// a little precip in the static icon poses so rain/snow scenes read right
/* canonical precip poses: same icon for the same scene everywhere
 * (chart strip + day tiles); tilt comes from the painter's calm default,
 * never from the day's actual wind -- a forecast icon, not a gauge */
export const STRIP_PRECIP_INTENSITY = { rain: 2, snow: 2, sleet: 3, hail: 4, storm: 5 };

/* severity tiers per WMO code over the scene base: drizzle codes paint
 * sparser streaks than downpours -- still deterministic per code (same
 * code, always the same glyph), but the streak density tells light from
 * heavy at a glance */
export const CODE_PRECIP_INTENSITY = {
    51: 1, 53: 2, 55: 3, 56: 3, 57: 4,
    61: 1, 63: 2, 65: 3, 66: 3, 67: 4,
    71: 1, 73: 2, 75: 3, 77: 1,
    80: 1, 81: 2, 82: 3, 85: 2, 86: 3,
    95: 5, 96: 6, 99: 6,
};

/* GJS Pango bindings are snake_case on some releases and camelCase on newer
 * ones -- feature-detect once per call rather than betting on one. */
function call(obj, camel, snake, ...args) {
    const fn = obj[camel] ?? obj[snake];
    return fn.call(obj, ...args);
}

export const lumOf = rgb => {
    const channelLum = v => v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
    return 0.2126 * channelLum(rgb[0]) + 0.7152 * channelLum(rgb[1]) + 0.0722 * channelLum(rgb[2]);
};

const ratio = (colorA, colorB) => {
    const lumA = lumOf(colorA), lumB = lumOf(colorB);
    return (Math.max(lumA, lumB) + 0.05) / (Math.min(lumA, lumB) + 0.05);
};

export function contrastSafe(accent, bg) {
    if (ratio(accent, bg) >= 3.1)
        return accent;
    // pick whichever ink wins on contrast (dark is better down to L~0.18,
    // white above) -- a luminance threshold misclassifies mid-bright skies
    const darkTarget = [0.09, 0.11, 0.15], lightTarget = [1, 1, 1];
    const target = ratio(darkTarget, bg) >= ratio(lightTarget, bg) ? darkTarget : lightTarget;
    let best = accent;
    for (let t = 0.1; t <= 1.001; t += 0.1) {
        best = accent.map((v, i) => v + (target[i] - v) * t);
        if (ratio(best, bg) >= 3.1)
            return best;
    }
    return best;
}

export const INK_DARK = [0.063, 0.094, 0.137];
const INK_LIGHT = [1, 1, 1];

export const pickInk = bg =>
    ratio(INK_DARK, bg) >= ratio(INK_LIGHT, bg) * 1.35 ? INK_DARK : INK_LIGHT;

export const judgeInk = bgs => {
    bgs = bgs.filter(b => Number.isFinite(b[0] + b[1] + b[2]));
    if (!bgs.length)
        return { ink: INK_LIGHT, emboss: false };
    const worstWhiteRatio = Math.min(...bgs.map(bg => ratio(INK_LIGHT, bg)));
    const worstDarkRatio = Math.min(...bgs.map(bg => ratio(INK_DARK, bg)));
    const ink = worstDarkRatio >= worstWhiteRatio * 1.35 ? INK_DARK : INK_LIGHT;
    return { ink, emboss: (ink === INK_DARK ? worstDarkRatio : worstWhiteRatio) < 3 };
};

const deepen = baseRgb => {
    const maxVal = Math.max(...baseRgb), minVal = Math.min(...baseRgb), delta = maxVal - minVal;
    let hue = delta === 0 ? 0
        : maxVal === baseRgb[0] ? (60 * ((baseRgb[1] - baseRgb[2]) / delta) + 360) % 360
            : maxVal === baseRgb[1] ? 60 * ((baseRgb[2] - baseRgb[0]) / delta + 2)
                : 60 * ((baseRgb[0] - baseRgb[1]) / delta + 4);
    const sat = Math.min(1, (maxVal === 0 ? 0 : delta / maxVal) * 1.3 + 0.12);
    const toRgb = val => {
        const chroma = val * sat, x = chroma * (1 - Math.abs((hue / 60) % 2 - 1)), match = val - chroma;
        return [[chroma, x, 0], [x, chroma, 0], [0, chroma, x],
        [0, x, chroma], [x, 0, chroma], [chroma, 0, x]][Math.floor(hue / 60) % 6]
            .map(k => k + match);
    };
    return toRgb;
};

const lineInk = (baseColor, bgColors) => {
    if (!bgColors.length)
        return baseColor;
    const worstRatio = c => Math.min(...bgColors.map(bg => ratio(c, bg)));
    if (baseColor[0] - baseColor[2] > 0.2)          // warm: amber, always
        return baseColor;
    if (worstRatio(baseColor) >= 3)
        return baseColor;
    const toRgb = deepen(baseColor);
    let val = Math.max(...baseColor);
    while (val > 0.08 && worstRatio(toRgb(val)) < 3.05)
        val *= 0.97;
    return toRgb(val);
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
    return Array.isArray(px) ? [px[0], px[1], layout] : [px.width, px.height, layout];
}

export function drawText(cr, text, x, y, { size = 10, bold = false, weight = 0,
    rgba = [1, 1, 1, 1],
    anchor = 'middle',
    vcenter = null } = {}) {
    const [pixelWidth, pixelHeight, layout] = textPx(cr, text, size, bold, weight);
    const tx = anchor === 'start' ? x : anchor === 'end' ? x - pixelWidth : x - pixelWidth / 2;
    cr.setSourceRGBA(...rgba);
    // y is the baseline; vcenter instead centres the line box on cy -- the
    // panel-mock bar hangs its words on the same middle as the glyphs
    cr.moveTo(tx, vcenter === null ? y - pixelHeight : vcenter - pixelHeight / 2);
    (PangoCairo.showLayout ?? PangoCairo.show_layout)(cr, layout);
}

/** Catmull-Rom -> cubic Bezier, matching the mockup's smoothPath(). */
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
 *   nowFrac:         0..1 | null -- dashed marker + accent label on that
 *                    point; everything left of it fades to pastKeep
 *   pastKeep:        alpha kept by past ink (default 0.55)
 *   scenes:          string[] | null -- one painter scene name per value
 *                    point ('sun', 'rain'...): static condition icons in a
 *                    band above the line, ~30 px apart, night variants
 *                    via nights[i]; lives inside the fade group, so the
 *                    past hours' icons recede with the rest of the ink
 *   nights:          bool[] matching scenes
 *   iconIntensities: int[] | null -- per-slot severity overrides (WMO tiers
 *                    from CODE_PRECIP_INTENSITY); null entries fall back to
 *                    the per-scene base pose
 *   labelEvery:      label stride (default 3; narrow cards pass a bigger one)
 *   fontSize:        label font size in pt (default 8.5)
 * }
 */

/* Footprint scale adjustments */
const ICON_FOOTPRINT_SCALE = {
    moon: 1.5, cloud: 1.35, fog: 1.25, rain: 1.2, drizzle: 1.2,
    sleet: 1.2, snow: 1.2, partly: 1.15, hail: 1.1, storm: 1.1,
};

function pillPath(cr, x0, y0, x1, y1, radius) {
    radius = Math.min(radius, (x1 - x0) / 2, (y1 - y0) / 2);
    cr.newPath();
    cr.moveTo(x0 + radius, y0);
    cr.lineTo(x1 - radius, y0);
    cr.arc(x1 - radius, y0 + radius, radius, -Math.PI / 2, 0);
    cr.lineTo(x1, y1 - radius);
    cr.arc(x1 - radius, y1 - radius, radius, 0, Math.PI / 2);
    cr.lineTo(x0 + radius, y1);
    cr.arc(x0 + radius, y1 - radius, radius, Math.PI / 2, Math.PI);
    cr.lineTo(x0, y0 + radius);
    cr.arc(x0 + radius, y0 + radius, radius, Math.PI, 1.5 * Math.PI);
    cr.closePath();
}

function drawAreaAndLine(cr, pts, mapX, pointCount, height, accentR, accentG, accentB) {
    const gradient = new Cairo.LinearGradient(0, PADDING_TOP, 0, height - PADDING_BOTTOM + 10);
    gradient.addColorStopRGBA(0, accentR, accentG, accentB, 0.38);
    gradient.addColorStopRGBA(1, accentR, accentG, accentB, 0);
    cr.newPath();
    tracePath(cr, pts);
    cr.lineTo(mapX(pointCount - 1), height - PADDING_BOTTOM + 10);
    cr.lineTo(mapX(0), height - PADDING_BOTTOM + 10);
    cr.closePath();
    cr.setSource(gradient);
    cr.fill();

    cr.newPath();
    tracePath(cr, pts);
    cr.setSourceRGBA(accentR, accentG, accentB, 1);
    cr.setLineWidth(LINE_WIDTH);
    cr.setLineCap(Cairo.LineCap.ROUND);
    cr.stroke();
}

function sampleCurveBounds(pts) {
    const curvePoints = [];
    for (let i = 0; i < pts.length - 1; i++) {
        const p0 = pts[Math.max(0, i - 1)], p1 = pts[i],
            p2 = pts[i + 1], p3 = pts[Math.min(pts.length - 1, i + 2)];
        const c1x = p1[0] + (p2[0] - p0[0]) / 6, c1y = p1[1] + (p2[1] - p0[1]) / 6,
            c2x = p2[0] - (p3[0] - p1[0]) / 6, c2y = p2[1] - (p3[1] - p1[1]) / 6;
        for (let k = 0; k <= 8; k++) {
            const t = k / 8, u = 1 - t;
            curvePoints.push([
                u * u * u * p1[0] + 3 * u * u * t * c1x
                + 3 * u * t * t * c2x + t * t * t * p2[0],
                u * u * u * p1[1] + 3 * u * u * t * c1y
                + 3 * u * t * t * c2y + t * t * t * p2[1],
            ]);
        }
    }
    const curveMin = (minX, maxX) => {
        let minY = Infinity;
        for (const [sampleX, sampleY] of curvePoints)
            if (sampleX >= minX - 1 && sampleX <= maxX + 1 && sampleY < minY)
                minY = sampleY;
        return minY;
    };
    const curveMax = (minX, maxX) => {
        let maxY = -Infinity;
        for (const [sampleX, sampleY] of curvePoints)
            if (sampleX >= minX - 1 && sampleX <= maxX + 1 && sampleY > maxY)
                maxY = sampleY;
        return maxY;
    };
    return { curveMin, curveMax };
}

function drawTimeFade(cr, width, height, fadeX, pastKeepAlpha) {
    cr.save();
    cr.rectangle(0, 0, fadeX, height);
    cr.clip();
    cr.paintWithAlpha(pastKeepAlpha);
    cr.restore();
    cr.save();
    cr.rectangle(fadeX, 0, width - fadeX, height);
    cr.clip();
    cr.paint();
    cr.restore();
}

function drawNowMarker(cr, markerX, height) {
    cr.save();
    cr.setSourceRGBA(1, 1, 1, 0.35);
    cr.setLineWidth(1);
    for (let y = PADDING_TOP - 26; y < height - PADDING_BOTTOM; y += 8) {
        cr.moveTo(markerX, y);
        cr.lineTo(markerX, Math.min(y + 3, height - PADDING_BOTTOM));
    }
    cr.stroke();
    cr.restore();
}

export function paintChart(cr, opts) {
    const { w: width, h: height, values, fmtValue, fmtHour, accent, nowFrac = null } = opts;
    const pointCount = values.length;
    if (pointCount < 2)
        return;
    let labelInterval = Math.max(1, opts.labelEvery ?? DEFAULT_LABEL_INTERVAL);
    const baseFontSize = opts.fontSize ?? 8.5;
    // "Data text" emphasis: bigger and/or heavier values, hours and the now
    // label. Collision boxes measure with the SAME numbers, so emphasized
    // text reflows the label row instead of overlapping the curve.
    const scaledFontSize = baseFontSize * (opts.textScale ?? 1);
    const valueFontWeight = opts.textBold ? Pango.Weight.BOLD : Pango.Weight.MEDIUM;
    const hourFontWeight = opts.textBold ? Pango.Weight.MEDIUM : Pango.Weight.NORMAL;

    const defaultInk = opts.ink ?? [0.96, 0.97, 0.98];   // dark theme: pass dark ink
    // optional menu-supplied sampler: chart-local yPx -> composited backdrop
    // colour. When present every label picks its ink per position, so hour
    // text over a bright day sky goes dark and night text stays white.
    const bgFn = typeof opts.bgFn === 'function' ? opts.bgFn : null;
    const inkAt = yPx => (bgFn ? pickInk(bgFn(yPx)) : defaultInk);

    // y window with the mockup's asymmetric padding (headroom for labels);
    // an enabled condition strip asks for noticeably more sky above the line
    // the condition strip needs one scene per plotted point -- refuse
    // mismatched data outright so a short feed can never phantom-paint
    // icons past the last value (the 'missing 8 PM' failure mode)
    const conditionScenes = Array.isArray(opts.scenes) && opts.scenes.length === pointCount
        ? opts.scenes : null;
    if (Array.isArray(opts.scenes) && !conditionScenes && opts.scenes.length)
        log(`weatherglass: condition strip needs ${pointCount} scenes, got ${opts.scenes.length} -- strip disabled`);
    let minVal = Math.min(...values), maxVal = Math.max(...values);
    if (maxVal - minVal < 1e-6) { minVal -= 1; maxVal += 1; }
    const yPadding = (maxVal - minVal) * 0.35 + 1;
    minVal -= yPadding; maxVal += yPadding * (conditionScenes ? 1.75 : 1.15);

    const edgeGutter = opts.gutter ?? 14;
    const plotStartX = PADDING_X, plotEndX = width - PADDING_X;
    const isRtl = !!opts.rtl;
    const scaleX = frac => PADDING_X + (isRtl ? 1 - frac : frac) * (width - PADDING_X * 2);
    const mapX = index => scaleX(index / (pointCount - 1));
    const padBottom = opts.stripBottom && Array.isArray(opts.scenes) ? PADDING_BOTTOM + 14 : PADDING_BOTTOM;
    const mapY = val => PADDING_TOP + (1 - (val - minVal) / (maxVal - minVal)) * (height - PADDING_TOP - padBottom);
    const pts = values.map((val, index) => [mapX(index), mapY(val)]);

    const curveBackdrops = [];
    if (bgFn)
        for (let i = 0; i < pts.length; i += Math.max(1, pts.length >> 2))
            curveBackdrops.push(bgFn(pts[i][1]));
    const [accentR, accentG, accentB] = lineInk(accent, curveBackdrops);

    const hasNow = nowFrac !== null && nowFrac >= 0 && nowFrac <= 1;
    cr.save();
    cr.pushGroup();

    drawAreaAndLine(cr, pts, mapX, pointCount, height, accentR, accentG, accentB);
    const { curveMin, curveMax } = sampleCurveBounds(pts);

    const nowIndex = nowFrac === null ? -1 : Math.round(nowFrac * (pointCount - 1));
    const pointSpacing = (width - PADDING_X * 2) / (pointCount - 1);
    let firstLabelIndex = Math.ceil((edgeGutter - PADDING_X) / pointSpacing);
    if (firstLabelIndex < 0) firstLabelIndex = 0;
    // optional two-line values: the digit on the number baseline, the unit
    // stacked below it at a smaller, lighter step (wind metrics). Stacking
    // keeps a column ~two glyphs wide -- '12 mph' side-wide would push the
    // whole row to a coarser stride and re-flow it between calm and gusty
    // days, which is exactly what the stride engine exists to prevent
    const fmtUnit = typeof opts.fmtValueUnit === 'function' ? opts.fmtValueUnit : null;
    const unitSize = scaledFontSize * 0.74;
    const unitTextOf = (index, value) => (fmtUnit ? fmtUnit(index, value) || '' : '');
    const unitHeight = fmtUnit ? textPx(cr, '0', unitSize, false, 0)[1] : 0;
    const drawValue = (text, unitText, labelX, y, anchor, rgba) => {
        drawText(cr, text, labelX, y,
            { size: scaledFontSize, weight: valueFontWeight, rgba, anchor });
        if (unitText)
            drawText(cr, unitText, labelX, y + unitHeight + 1.5,
                { size: unitSize, weight: 0,
                    rgba: [rgba[0], rgba[1], rgba[2], rgba[3] * 0.78], anchor });
    };
    // left/right extent of the two-line block under one anchor
    const lineEdges = (mainWidth, unitWidth, labelX, anchor) => {
        const place = w => anchor === 'start' ? [labelX, labelX + w]
            : anchor === 'end' ? [labelX - w, labelX] : [labelX - w / 2, labelX + w / 2];
        const [left1, right1] = place(mainWidth);
        if (!unitWidth)
            return [left1, right1];
        const [left2, right2] = place(unitWidth);
        return [Math.min(left1, left2), Math.max(right1, right2)];
    };
    if (opts.labelEvery === undefined && fmtHour && pointCount > 8) {
        let widestTextWidth = 0;
        // the stride is judged from the widest label this METRIC can
        // produce on any day (the caller feeds formatted samples for the
        // whole forecast), otherwise a calm wind day ('7 mph') packs its
        // columns twice as dense as a breezy one ('12 mph') and the
        // rhythm changes under the cursor as the user tabs across days.
        // Day-only measurement is the fallback for unsampled callers.
        const samples = Array.isArray(opts.valueSamples) && opts.valueSamples.length
            ? [...new Set(opts.valueSamples)] : null;
        if (fmtUnit)
            widestTextWidth = Math.max(widestTextWidth,
                textPx(cr, fmtUnit(0, values[0]), unitSize, false, 0)[0]);
        for (let i = firstLabelIndex; i < pointCount; i++) {
            const hourText = fmtHour(i);
            if (hourText)
                widestTextWidth = Math.max(widestTextWidth, textPx(cr, hourText, scaledFontSize, false, hourFontWeight)[0]);
            if (fmtValue && !samples)
                widestTextWidth = Math.max(widestTextWidth,
                    textPx(cr, fmtValue(i, values[i]), scaledFontSize, false, valueFontWeight)[0]);
        }
        for (const sample of samples ?? [])
            widestTextWidth = Math.max(widestTextWidth,
                textPx(cr, sample, scaledFontSize, false, valueFontWeight)[0]);
        for (const candidateInterval of [3, 4, 6, 8, 12])
            // 30 px floor: the condition glyph row shares this stride, so
            // the interval must also breathe for an icon, not just text
            if (candidateInterval >= labelInterval &&
                pointSpacing * candidateInterval >= Math.max(widestTextWidth + 9, 30)) {
                labelInterval = candidateInterval;
                break;
            }
    }
    const anchorOf = xPos => xPos < 46 ? 'start' : xPos > width - 46 ? 'end' : 'middle';
    const labelXOf = (anchorX, anchor) =>
        anchor === 'start' ? Math.max(edgeGutter, anchorX - 6)
            : anchor === 'end' ? Math.min(width - edgeGutter, anchorX + 6) : anchorX;
    const boxAt = (text, labelX, baselineY, anchor) => {
        const [textWidth, textHeight] = textPx(cr, text, scaledFontSize, false, hourFontWeight);
        const leftX = anchor === 'start' ? labelX
            : anchor === 'end' ? labelX - textWidth : labelX - textWidth / 2;
        return [leftX - 1.5, leftX + textWidth + 1.5, baselineY - textHeight - 1, baselineY + 1];
    };
    const hitsAny = (box, boxList) =>
        boxList.some(other => box[0] < other[1] && other[0] < box[1] && box[2] < other[3] && other[2] < box[3]);
    const boxOf = (leftX, textWidth, textHeight, baselineY, below = 0) =>
        [leftX - 1.5, leftX + textWidth + 1.5, baselineY - textHeight - 1, baselineY + 1 + below];
    const usedBoxes = [];
    const hourTextHeight = textPx(cr, '0', scaledFontSize, false, hourFontWeight)[1];
    const placeLabel = (text, labelX, preferredY, anchor, unitText = '') => {
        const [textWidth, textHeight] = textPx(cr, text, scaledFontSize, false, valueFontWeight);
        const [leftX, rightX] = lineEdges(textWidth,
            unitText ? textPx(cr, unitText, unitSize, false, 0)[0] : 0, labelX, anchor);
        // the stroke must stay clear of the block's LOWEST line: for
        // stacked units the 'mph' hangs below the number baseline, and a
        // ceiling judged on the number alone parks the unit on the stroke
        const blockBelow = unitText ? unitHeight + 1.5 : 0;
        const curveCeiling = curveMin(leftX, rightX) - LINE_WIDTH / 2 - 2 - blockBelow;
        // below the stroke: glyph top clears the curve, baseline capped so
        // the label (unit line included) never crowds the hour band
        const blockHeight = textHeight + blockBelow;
        const belowStrokeY = Math.min(
            curveMax(leftX, rightX) + LINE_WIDTH / 2 + 3 + blockHeight,
            height - 7 - hourTextHeight - blockHeight);
        for (const candidateY of [...new Set([Math.min(preferredY, curveCeiling), belowStrokeY])]) {
            const box = boxOf(leftX, rightX - leftX, textHeight, candidateY,
                unitText ? unitHeight + 1.5 : 0);
            if (box[2] < 2 || box[3] > height - 2 || hitsAny(box, usedBoxes))
                continue;
            usedBoxes.push(box);
            return { box, labelX, y: candidateY, anchor, text };
        }
        return null;
    };
    let nowPlacement = null;
    if (nowIndex >= 0 && fmtValue) {
        const anchorX = mapX(nowIndex);
        const anchor = anchorOf(anchorX), labelX = labelXOf(anchorX, anchor);
        const text = fmtValue(nowIndex, values[nowIndex]);
        const unitText = unitTextOf(nowIndex, values[nowIndex]);
        const [textWidth, textHeight] = textPx(cr, text, scaledFontSize, false, valueFontWeight);
        const [leftX, rightX] = lineEdges(textWidth,
            unitText ? textPx(cr, unitText, unitSize, false, 0)[0] : 0, labelX, anchor);
        const nowBlockBelow = unitText ? unitHeight + 1.5 : 0;
        const labelY = Math.min(mapY(values[nowIndex]) - 22 + 1 - nowBlockBelow,
            curveMin(leftX, rightX) - LINE_WIDTH / 2 - 2 - nowBlockBelow);
        nowPlacement = { text, unitText, labelX, y: labelY, anchor };
        usedBoxes.push(boxOf(leftX, rightX - leftX, textHeight, labelY,
            unitText ? unitHeight + 1.5 : 0));
    }
    if (conditionScenes) {
        const bandCenterY = opts.stripBottom ? height - 34 : STRIP_CENTER_Y;
        // the band's DOWN margin shrinks to the hour text's height: a
        // 'large' label row would otherwise collide with the fixed band
        // and every hour label gets dropped (observed live in the menu)
        usedBoxes.push([0, width, bandCenterY - 13,
            Math.min(bandCenterY + 13, height - 7 - hourTextHeight)]);
    }
    // icon-mode columns: computed BEFORE the label rows so hour text,
    // glyphs and numbers all share one set of x positions. Slots whose
    // widest tenant (number, hour text or glyph) would crowd its neighbor
    // are dropped -- a dropped slot simply gets no number/glyph/hour, so
    // the strip can never print the collision-prone '8' that the fixed
    // label stride leaves behind next to the now bubble
    const iconSlots = [];
    let iconStep = 0;
    if (conditionScenes && !opts.pills) {
        const slotSpan = (plotEndX - plotStartX) / Math.max(1, pointCount - 1);
        iconStep = labelInterval * Math.max(1, Math.ceil(30 / slotSpan / labelInterval));
        const iconHalf = 8.5;
        // clamp every slot's column on the metric's widest sample (whole
        // forecast), so slot geometry is identical on every day -- per-day
        // widths alone shift the first column when a gusty day replaces
        // a calm one. The floor guards the gutters only: collisions test
        // the text a slot actually draws (see `own` below).
        let globalValueNeed = 0;
        if (Array.isArray(opts.valueSamples) && opts.valueSamples.length)
            for (const sample of new Set(opts.valueSamples))
                globalValueNeed = Math.max(globalValueNeed,
                    textPx(cr, sample, scaledFontSize, false, valueFontWeight)[0] / 2);
        if (fmtUnit)
            globalValueNeed = Math.max(globalValueNeed,
                textPx(cr, fmtUnit(0, values[0]), unitSize, false, 0)[0] / 2);
        let lastSlotRight = -Infinity, lastIndex = -Infinity;
        for (let i = firstLabelIndex; i < pointCount; i += iconStep) {
            const anchorX = mapX(i);
            if (anchorX > width - edgeGutter)
                continue;
            const hourText = fmtHour ? fmtHour(i) : '';
            const valueText = fmtValue ? fmtValue(i, values[i]) : '';
            const hourNeed = hourText
                ? textPx(cr, hourText, scaledFontSize, false, hourFontWeight)[0] / 2 : 0;
            let valueNeed = valueText
                ? textPx(cr, valueText, scaledFontSize, false, valueFontWeight)[0] / 2 : 0;
            if (fmtUnit)
                valueNeed = Math.max(valueNeed,
                    textPx(cr, fmtUnit(i, values[i]), unitSize, false, 0)[0] / 2);
            // collision is measured on the ink this column actually draws;
            // testing padded widest-sample envelopes instead dropped whole
            // hours whose printed labels still stood ~20 px apart (a flat
            // 100% precip plateau killed the 4 AM and 10 PM slots on a
            // 400 px-wide card -- the widest floor then inflated every
            // column and neighbours double-charged one another)
            const own = Math.max(iconHalf, hourNeed + 3, valueNeed + 3);
            const need = Math.max(own, globalValueNeed + 3);
            const labelX = Math.min(Math.max(anchorX, need), width - need);
            const left = labelX - own, right = labelX + own;
            if (left > lastSlotRight + 6 && i - lastIndex >= 2) {
                iconSlots.push({
                    i, labelX, iconX: Math.min(Math.max(anchorX, iconHalf), width - iconHalf),
                });
                lastSlotRight = right;
                lastIndex = i;
            }
        }
    }
    const slotAt = index => iconSlots.find(slot => slot.i === index);
    for (let i = firstLabelIndex; fmtValue && i < pointCount; i += labelInterval) {
        if (i === nowIndex)
            continue;
        let anchorX = mapX(i);
        let anchor = anchorOf(anchorX), labelX = labelXOf(anchorX, anchor);
        if (iconSlots.length) {
            // icon mode: numbers live on slot columns -- an hour without a
            // slot (crowded neighbors, the 8 PM just after the now marker)
            // shows no number, exactly like its hour label and glyph
            const slot = slotAt(i);
            if (!slot)
                continue;
            labelX = slot.labelX;
            anchor = 'middle';
        }
        const unitText = unitTextOf(i, values[i]);
        const placed = placeLabel(fmtValue(i, values[i]), labelX,
            mapY(values[i]) - 12 + 1 - (unitText ? unitHeight + 1.5 : 0),
            anchor, unitText);
        if (placed)
            drawValue(placed.text, unitText, labelX, placed.y, anchor,
                [...inkAt(placed.y), 0.62]);
    }
    // hour labels stay flat on their baseline -- a clash drops the label
    // instead of staggering the row
    for (let i = firstLabelIndex; fmtHour && i < pointCount; i += labelInterval) {
        const hourText = fmtHour(i);
        if (!hourText)
            continue;
        let anchorX = mapX(i);
        let anchor = anchorOf(anchorX), labelX = labelXOf(anchorX, anchor);
        if (iconSlots.length) {
            // icon mode: the hour rides its slot column, guaranteed room
            const slot = slotAt(i);
            if (!slot)
                continue;
            drawText(cr, hourText, slot.labelX, height - 5,
                { size: scaledFontSize, weight: hourFontWeight, rgba: [...inkAt(height - 5), 0.62], anchor: 'middle' });
            continue;
        }
        const box = boxAt(hourText, labelX, height - 5, anchor);
        if (!hitsAny(box, usedBoxes)) {
            usedBoxes.push(box);
            drawText(cr, hourText, labelX, height - 5, { size: scaledFontSize, weight: hourFontWeight, rgba: [...inkAt(height - 5), 0.62], anchor });
        }
    }

    // condition strip along the chart top -- the same flat vocabulary as
    // the panel icon (painter.js), posed statically. Two modes:
    //   'icons': loose glyphs, no backing plate. Each glyph judges the sky
    //            under it (bgFn, like the label ink does): pale ground
    //            (noon sun, white cloud banks) paints the dark-twin
    //            painter glyphs, dark skies the pale ones -- the icon
    //            carries its own contrast, which is what killed the
    //            medallion discs and the stencil outlines
    //   'pills': consecutive same-condition hours merge into one rounded
    //            pill spanning exactly their slice of the axis, icon
    //            centred (the band itself is the ground there)
    // pillGlass=true switches the pill fill from the accent tint to the
    // day-tile hover glass (same design language as the tiles).
    if (conditionScenes) {
        const nights = Array.isArray(opts.nights) ? opts.nights : [];
        const isDark = opts.dark !== false;
        // band sits at the chart top, or docked above the hour labels when
        // the user picks 'bottom'. drawText anchors text UP from its y, so
        // the label glyphs occupy ~h-18..h-5: the docked pill bottom lands
        // 5+ px clear of that, and even the lowest value label (floor
        // h-42) stays off the band top.
        const stripCenterY = opts.stripBottom ? height - 34 : STRIP_CENTER_Y;
        const iconIntensities = Array.isArray(opts.iconIntensities) ? opts.iconIntensities : null;
        const paintSingleIcon = (scene, centerX, isNight, scale, centerY = stripCenterY, intensity = null) => {
            const iconIntensity = intensity ?? STRIP_PRECIP_INTENSITY[scene] ?? 0;
            // judge the live backdrop under this glyph (same referee as
            // the ink labels); un-sampled surfaces (accent style, preview)
            // follow the card's theme instead
            const bgLum = bgFn ? lumOf(bgFn(centerY)) : -1;
            const isPaletteDark = bgFn ? bgLum >= 0.55 : isDark;
            cr.save();
            cr.translate(centerX - 12 * scale, centerY - 12 * scale);
            cr.scale(scale, scale);
            paintWeather(cr, {
                scene: scene ?? 'cloud', time: 4.1,
                night: !!isNight, dark: !isPaletteDark,
                intensity: iconIntensity, staticPose: true,
                // per-column layout variety that stays put across repaints
                seed: Math.round(centerX * 3),
                groundLum: bgLum,
                // strip glyph mirrors its labels too: when the sampled
                // band ground is too dark for ink text, the glyph glows
                pale: !!bgFn && !isPaletteDark
            });
            cr.restore();
        };

        if (opts.pills) {
            const PILL_HALF_HEIGHT = 10.5, PILL_ICON_SCALE = 0.58, MIN_PILL_WIDTH = 23, PILL_RADIUS = 6, BOTTOM_BORDER_HEIGHT = 1.9;
            const isGlass = !!opts.pillGlass;
            // the plate is now only a grouping whisper: with the glyphs
            // embossed they separate from the sky on their own, so the
            // band fill recedes toward transparency (the mid-alpha scrim
            // was the visual noise). Stroke + separators carry grouping.
            const fillColor = isGlass
                ? (isDark ? [16 / 255, 20 / 255, 28 / 255, 0.09] : [1, 1, 1, 0.15])
                : (isDark ? [1, 1, 1, 0.05] : [0.14, 0.16, 0.19, 0.03]);
            const edgeColor = isGlass
                ? (isDark ? [1, 1, 1, 0.16] : [16 / 255, 24 / 255, 35 / 255, 0.15])
                : (isDark ? [1, 1, 1, 0.16] : [0.14, 0.16, 0.19, 0.12]);
            const conditionRuns = [];
            let startIndex = 0;
            while (startIndex < pointCount) {
                const key = `${conditionScenes[startIndex]}|${nights[startIndex] ? 1 : 0}`;
                let endIndex = startIndex;
                while (endIndex + 1 < pointCount && `${conditionScenes[endIndex + 1]}|${nights[endIndex + 1] ? 1 : 0}` === key)
                    endIndex++;
                const x0 = startIndex === 0 ? scaleX(0) : (mapX(startIndex - 1) + mapX(startIndex)) / 2;
                const x1 = endIndex === pointCount - 1 ? scaleX(1) : (mapX(endIndex) + mapX(endIndex + 1)) / 2;
                conditionRuns.push({ scene: conditionScenes[startIndex], night: nights[startIndex],
                    intensity: iconIntensities?.[startIndex] ?? null,
                    width: Math.abs(x1 - x0) });
                startIndex = endIndex + 1;
            }
            const deficits = conditionRuns.map(run => Math.max(0, MIN_PILL_WIDTH - run.width));
            const totalDeficit = deficits.reduce((sum, val) => sum + val, 0);
            const surplusPool = conditionRuns.reduce((sum, run) => sum + Math.max(0, run.width - MIN_PILL_WIDTH), 0);
            const compressionRatio = surplusPool > 0 ? Math.min(1, totalDeficit / surplusPool) : 0;
            const pillWidths = conditionRuns.map((run, k) =>
                deficits[k] > 0 ? run.width + deficits[k] : run.width - Math.max(0, run.width - MIN_PILL_WIDTH) * compressionRatio);
            const bandEndX = plotStartX + pillWidths.reduce((sum, val) => sum + val, 0);
            const drawBandPath = () =>
                pillPath(cr, plotStartX, stripCenterY - PILL_HALF_HEIGHT, bandEndX, stripCenterY + PILL_HALF_HEIGHT, PILL_RADIUS);

            cr.save();
            drawBandPath();
            cr.setSourceRGBA(fillColor[0], fillColor[1], fillColor[2], fillColor[3]);
            cr.fillPreserve();
            cr.setSourceRGBA(edgeColor[0], edgeColor[1], edgeColor[2], edgeColor[3]);
            cr.setLineWidth(1);
            cr.stroke();
            cr.restore();

            cr.save();
            drawBandPath();
            cr.clip();
            cr.setSourceRGBA(edgeColor[0], edgeColor[1], edgeColor[2],
                Math.min(0.22, edgeColor[3] * 1.05));
            cr.rectangle(plotStartX, stripCenterY + PILL_HALF_HEIGHT - BOTTOM_BORDER_HEIGHT, bandEndX - plotStartX, BOTTOM_BORDER_HEIGHT);
            cr.fill();

            const flowDir = isRtl ? -1 : 1;
            cr.setSourceRGBA(edgeColor[0], edgeColor[1], edgeColor[2], Math.min(0.65, edgeColor[3] * 2.6));
            let currX = isRtl ? plotEndX : plotStartX;
            for (let k = 0; k < conditionRuns.length - 1; k++) {
                currX += flowDir * pillWidths[k];
                for (let y = stripCenterY - PILL_HALF_HEIGHT + 2.5; y <= stripCenterY + PILL_HALF_HEIGHT - 2.5; y += 3.2) {
                    cr.arc(currX, y, 0.6, 0, Math.PI * 2);
                    cr.fill();
                }
            }

            currX = isRtl ? plotEndX : plotStartX;
            for (const [k, run] of conditionRuns.entries()) {
                paintSingleIcon(run.scene, currX + flowDir * pillWidths[k] / 2, run.night,
                    PILL_ICON_SCALE * (ICON_FOOTPRINT_SCALE[run.scene] ?? 1), stripCenterY,
                    run.intensity);
                currX += flowDir * pillWidths[k];
            }
            cr.restore();
        } else {
            for (const slot of iconSlots)
                paintSingleIcon(conditionScenes[slot.i], slot.iconX, nights[slot.i],
                    STRIP_ICON_SCALE * (ICON_FOOTPRINT_SCALE[conditionScenes[slot.i]] ?? 1),
                    stripCenterY, iconIntensities?.[slot.i] ?? null);
        }
    }

    cr.popGroupToSource();
    if (hasNow && nowFrac > 0)
        drawTimeFade(cr, width, height, plotStartX + nowFrac * (plotEndX - plotStartX), opts.pastKeep ?? 0.55);
    else
        cr.paint();
    cr.restore();

    if (nowFrac !== null && nowFrac >= 0 && nowFrac <= 1)
        drawNowMarker(cr, plotStartX + nowFrac * (plotEndX - plotStartX), height);

    // accent label riding the now marker, above the veil -- drawn at the
    // exact slot reserved in the label pass (curve-cleared baseline, inward
    // flow near the edges) so nothing ever lands under it. With a bgFn the
    // accent is re-safened against the backdrop at ITS y, not the chart mid.
    if (nowPlacement)
        drawValue(nowPlacement.text, nowPlacement.unitText, nowPlacement.labelX,
            nowPlacement.y, nowPlacement.anchor,
            [...(bgFn ? contrastSafe(accent, bgFn(nowPlacement.y))
                : (opts.nowLabel ?? [accentR, accentG, accentB])), 1]);
}

/** ease-out cubic, 0..1 */
export function ease(progress) {
    return 1 - Math.pow(1 - progress, 3);
}

export function lerp(from, to, progress) {
    if (!from || from.length !== to.length)
        return to.slice();
    return to.map((v, i) => from[i] + (v - from[i]) * progress);
}
