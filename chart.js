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
const STRIP_DISC_RADIUS = 12.5;
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

export const ratio = (colorA, colorB) => {
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
export const INK_LIGHT = [1, 1, 1];

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

export const lineInk = (baseColor, bgColors) => {
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
    const conditionScenes = Array.isArray(opts.scenes) && opts.scenes.length === pointCount
        ? opts.scenes : null;
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
    if (opts.labelEvery === undefined && fmtHour && pointCount > 8) {
        let widestTextWidth = 0;
        for (let i = firstLabelIndex; i < pointCount; i++) {
            const hourText = fmtHour(i);
            if (hourText)
                widestTextWidth = Math.max(widestTextWidth, textPx(cr, hourText, scaledFontSize, false, hourFontWeight)[0]);
            if (fmtValue)
                widestTextWidth = Math.max(widestTextWidth,
                    textPx(cr, fmtValue(i, values[i]), scaledFontSize, false, valueFontWeight)[0]);
        }
        for (const candidateInterval of [3, 4, 6, 8, 12])
            if (candidateInterval >= labelInterval && pointSpacing * candidateInterval >= widestTextWidth + 9) {
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
    const boxOf = (leftX, textWidth, textHeight, baselineY) =>
        [leftX - 1.5, leftX + textWidth + 1.5, baselineY - textHeight - 1, baselineY + 1];
    const usedBoxes = [];
    const hourTextHeight = textPx(cr, '0', scaledFontSize, false, hourFontWeight)[1];
    const placeLabel = (text, labelX, preferredY, anchor) => {
        const [textWidth, textHeight] = textPx(cr, text, scaledFontSize, false, valueFontWeight);
        const leftX = anchor === 'start' ? labelX : anchor === 'end' ? labelX - textWidth : labelX - textWidth / 2;
        const curveCeiling = curveMin(leftX, leftX + textWidth) - LINE_WIDTH / 2 - 2;
        // below the stroke: glyph top clears the curve, baseline capped so
        // the label never crowds the hour band at the chart foot
        const belowStrokeY = Math.min(
            curveMax(leftX, leftX + textWidth) + LINE_WIDTH / 2 + 3 + textHeight,
            height - 7 - hourTextHeight - textHeight);
        for (const candidateY of [...new Set([Math.min(preferredY, curveCeiling), belowStrokeY])]) {
            const box = boxOf(leftX, textWidth, textHeight, candidateY);
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
        const [textWidth, textHeight] = textPx(cr, text, scaledFontSize, false, valueFontWeight);
        const leftX = anchor === 'start' ? labelX : anchor === 'end' ? labelX - textWidth : labelX - textWidth / 2;
        const labelY = Math.min(mapY(values[nowIndex]) - 22 + 1,
            curveMin(leftX, leftX + textWidth) - LINE_WIDTH / 2 - 2);
        nowPlacement = { text, labelX, y: labelY, anchor };
        usedBoxes.push(boxOf(leftX, textWidth, textHeight, labelY));
    }
    if (conditionScenes) {
        const bandCenterY = opts.stripBottom ? height - 34 : STRIP_CENTER_Y;
        // the band's DOWN margin shrinks to the hour text's height: a
        // 'large' label row would otherwise collide with the fixed band
        // and every hour label gets dropped (observed live in the menu)
        usedBoxes.push([0, width, bandCenterY - 13,
            Math.min(bandCenterY + 13, height - 7 - hourTextHeight)]);
    }
    for (let i = firstLabelIndex; fmtValue && i < pointCount; i += labelInterval) {
        if (i === nowIndex)
            continue;
        const anchorX = mapX(i);
        const anchor = anchorOf(anchorX), labelX = labelXOf(anchorX, anchor);
        const placed = placeLabel(fmtValue(i, values[i]), labelX,
            mapY(values[i]) - 12 + 1, anchor);
        if (placed)
            drawText(cr, placed.text, labelX, placed.y,
                { size: scaledFontSize, weight: valueFontWeight, rgba: [...inkAt(placed.y), 0.62], anchor });
    }
    // hour labels stay flat on their baseline -- a clash drops the label
    // instead of staggering the row
    for (let i = firstLabelIndex; fmtHour && i < pointCount; i += labelInterval) {
        const hourText = fmtHour(i);
        if (!hourText)
            continue;
        const anchorX = mapX(i);
        const anchor = anchorOf(anchorX), labelX = labelXOf(anchorX, anchor);
        const box = boxAt(hourText, labelX, height - 5, anchor);
        if (!hitsAny(box, usedBoxes)) {
            usedBoxes.push(box);
            drawText(cr, hourText, labelX, height - 5, { size: scaledFontSize, weight: hourFontWeight, rgba: [...inkAt(height - 5), 0.62], anchor });
        }
    }

    // condition strip along the top -- the same flat vocabulary as the panel
    // icon (painter.js), posed statically. Two modes:
    //   'icons': one icon per stride slot (>=30 px apart), edge ones nudge in;
    //            each rides a translucent medallion so the glyph always sits
    //            on a dark-ish ground instead of raw sky (no outline fuzz)
    //   'pills': consecutive same-condition hours merge into one rounded pill
    //            spanning exactly their slice of the axis, icon centred
    // dark=true paints for the dark sky; loose icons on bright sky fall back
    // to dark painter glyphs + the outline stencil inside pills (light cards
    // pass dark:false so pale glyphs (moon/snow/fog) use their INK_* twins).
    // pillGlass=true switches the pill fill from the accent tint to the
    // day-tile hover glass (same design language as the tiles).
    if (conditionScenes) {
        const span = (plotEndX - plotStartX) / Math.max(1, pointCount - 1);
        const nights = Array.isArray(opts.nights) ? opts.nights : [];
        const isDark = opts.dark !== false;
        // band sits at the chart top, or docked above the hour labels when
        // the user picks 'bottom'. drawText anchors text UP from its y, so
        // the label glyphs occupy ~h-18..h-5: the docked pill bottom lands
        // 5+ px clear of that, and even the lowest value label (floor
        // h-42) stays off the band top.
        const stripCenterY = opts.stripBottom ? height - 34 : STRIP_CENTER_Y;
        const iconOutline = Array.isArray(opts.iconOutline) ? opts.iconOutline : null;
        const iconIntensities = Array.isArray(opts.iconIntensities) ? opts.iconIntensities : null;
        const paintSingleIcon = (scene, centerX, isNight, scale, centerY = stripCenterY, onDisc = false, intensity = null) => {
            const iconIntensity = intensity ?? STRIP_PRECIP_INTENSITY[scene] ?? 0;
            // the medallion composites to a dark ground everywhere (even over
            // the noon sun), so its glyph can always pick the light palette;
            // loose/stencil paths still judge the live background per icon
            const isPaletteDark = onDisc ? false
                : bgFn ? lumOf(bgFn(centerY)) >= 0.55 : isDark;
            const poseIcon = ctx => {
                ctx.translate(centerX - 12 * scale, centerY - 12 * scale);
                ctx.scale(scale, scale);
                paintWeather(ctx, {
                    scene: scene ?? 'cloud', time: 4.1,
                    night: !!isNight, dark: !isPaletteDark,
                    intensity: iconIntensity
                });
            };
            if (onDisc) {
                // uniform coins; capped only so the rim survives the canvas
                // edge at the top strip position (stripCenterY == 13)
                const radius = Math.min(STRIP_DISC_RADIUS, stripCenterY - 0.5);
                cr.save();
                cr.arc(centerX, centerY, radius, 0, 2 * Math.PI);
                cr.setSourceRGBA(16 / 255, 20 / 255, 28 / 255, 0.42);
                cr.fillPreserve();
                cr.setSourceRGBA(1, 1, 1, 0.16);
                cr.setLineWidth(1);
                cr.stroke();
                // glyphs are clipped to the disc: the moon's glow halo stays
                // inside the medallion instead of bleeding into the hour label
                cr.newPath();
                cr.arc(centerX, centerY, radius, 0, 2 * Math.PI);
                cr.clip();
                poseIcon(cr);
                cr.restore();
                return;
            }
            if (!iconOutline || isPaletteDark) {
                cr.save();
                poseIcon(cr);
                cr.restore();
                return;
            }
            const iconDiameter = Math.ceil(24 * scale) + 4, iconRadius = iconDiameter / 2;
            const surfaceS = new Cairo.ImageSurface(Cairo.Format.ARGB32, iconDiameter, iconDiameter);
            const ctxS = new Cairo.Context(surfaceS);
            ctxS.translate(iconRadius - 12 * scale, iconRadius - 12 * scale);
            ctxS.scale(scale, scale);
            paintWeather(ctxS, {
                scene: scene ?? 'cloud', time: 4.1, night: !!isNight,
                dark: !isPaletteDark, intensity: iconIntensity
            });
            ctxS.$dispose();
            const surfaceT = new Cairo.ImageSurface(Cairo.Format.ARGB32, iconDiameter, iconDiameter);
            const ctxT = new Cairo.Context(surfaceT);
            ctxT.setSourceRGBA(iconOutline[0], iconOutline[1], iconOutline[2], iconOutline[3]);
            ctxT.paint();
            ctxT.setOperator(Cairo.Operator.IN);
            ctxT.setSourceSurface(surfaceS, 0, 0);
            ctxT.paint();
            ctxT.$dispose();
            for (const [dx, dy] of [[-1.25, 0], [1.25, 0], [0, 1.25], [0, -1.25],
            [-0.95, -0.95], [0.95, -0.95],
            [-0.95, 0.95], [0.95, 0.95],
            [-0.55, 0], [0.55, 0], [0, -0.55], [0, 0.55]]) {
                cr.setSourceSurface(surfaceT, centerX - iconRadius + dx, centerY - iconRadius + dy);
                cr.paint();
            }
            cr.save();
            poseIcon(cr);
            cr.restore();
        };

        if (opts.pills) {
            const PILL_HALF_HEIGHT = 10.5, PILL_ICON_SCALE = 0.58, MIN_PILL_WIDTH = 23, PILL_RADIUS = 6, BOTTOM_BORDER_HEIGHT = 1.9;
            const isGlass = !!opts.pillGlass;
            const fillColor = isGlass
                ? (isDark ? [16 / 255, 20 / 255, 28 / 255, 0.22] : [1, 1, 1, 0.36])
                : (isDark ? [1, 1, 1, 0.10] : [0.14, 0.16, 0.19, 0.07]);
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
            cr.setSourceRGBA(edgeColor[0], edgeColor[1], edgeColor[2], Math.min(0.42, edgeColor[3] * 1.9));
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
                    PILL_ICON_SCALE * (ICON_FOOTPRINT_SCALE[run.scene] ?? 1), stripCenterY, false,
                    run.intensity);
                currX += flowDir * pillWidths[k];
            }
            cr.restore();
        } else {
            const step = labelInterval * Math.max(1, Math.ceil(30 / span / labelInterval));
            for (let i = firstLabelIndex; i < pointCount; i += step) {
                const anchorX = mapX(i);
                if (anchorX > width - edgeGutter)
                    continue;
                const anchor = anchorOf(anchorX);
                const labelX = labelXOf(anchorX, anchor);
                let textWidth = textPx(cr, fmtValue ? fmtValue(i, values[i])
                    : String(values[i]), scaledFontSize, false, valueFontWeight)[0];
                if (fmtHour) {
                    const hourText = fmtHour(i);
                    if (hourText)
                        textWidth = Math.max(textWidth, textPx(cr, hourText, scaledFontSize, false, hourFontWeight)[0]);
                }
                const iconCenterX = anchor === 'start' ? labelX + textWidth / 2
                    : anchor === 'end' ? labelX - textWidth / 2 : labelX;
                paintSingleIcon(conditionScenes[i], iconCenterX, nights[i],
                    STRIP_ICON_SCALE * (ICON_FOOTPRINT_SCALE[conditionScenes[i]] ?? 1),
                    stripCenterY, true, iconIntensities?.[i] ?? null);
            }
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
        drawText(cr, nowPlacement.text, nowPlacement.labelX, nowPlacement.y,
            {
                size: scaledFontSize, weight: valueFontWeight,
                rgba: [...(bgFn ? contrastSafe(accent, bgFn(nowPlacement.y))
                    : (opts.nowLabel ?? [accentR, accentG, accentB])), 1],
                anchor: nowPlacement.anchor
            });
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
