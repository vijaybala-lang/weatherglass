/* tools/card-demo.mjs -- render the FULL menu card (sky, header, tabs,
 * chart, strip, day tiles) from fake data: city, coordinates, local time
 * and a weather condition. No network, no shell -- for docs, review,
 * marketing shots of scenes your sky never serves, and debugging the
 * layout at any hour the almanac supports.
 *
 *   gjs -m tools/card-demo.mjs                      # every preset
 *   gjs -m tools/card-demo.mjs --preset sf-sunset
 *   gjs -m tools/card-demo.mjs --city Berlin --lat 52.52 --lon 13.40 \
 *       --local "2026-01-14T16:30+01:00" --condition snow
 *
 * Output: tools/out/demo/demo-<slug>.png
 *
 * The sky's sun position comes from the real almanac: --local time +
 * coordinates flow through sunGeometry exactly like menu._sunShade, so
 * "18:37 in San Francisco" paints actual golden hour. Header, tabs and
 * tiles use the stylesheet's real metrics (11px base, 3em/200 temp,
 * 0.8em tiles, dark-glass pills) via Pango. Series are seeded: the same
 * flags give the same pixels. */

import Cairo from 'gi://cairo';
import GLib from 'gi://GLib';
import Pango from 'gi://Pango';
import PangoCairo from 'gi://PangoCairo';

/* determinism: pin the RNG for this process (same recipe as card-preview) */
{
    let s = 1337 >>> 0;
    Math.random = () => {
        s = (s * 1664525 + 1013904223) >>> 0;
        return s / 4294967296;
    };
}

import {paintSky, sampleSky, createSky, bodyOf} from '../sky.js';
import {paintChart, CODE_PRECIP_INTENSITY, STRIP_PRECIP_INTENSITY, tileGlyphPale,
        pickInk, INK_DARK} from '../chart.js';
import {chromeVerdicts} from '../ink-policy.js';
import {paintWeather} from '../painter.js';
import {sceneFor, sunGeometry} from '../weather.js';
import {moonPhase} from '../moon.js';

/* stylesheet.css is the single source of truth for every metric the demo
 * SHARES with the live menu: the scraper reads the same rules St parses,
 * so a stylesheet edit moves the goldens -- the lock fires and a human
 * blesses, instead of the demo quietly diverging. Forgiveness is only in
 * the SYNTAX (comments, whitespace); a missing token is a LOUD error,
 * never a silent fallback to the old number. */
const BASE_FONT = 11;   // Adwaita base px; the stylesheet's em values are legs of this
function scrapeStylesheet() {
    const here = GLib.filename_from_uri(import.meta.url)[0];
    const path = GLib.build_filenamev([GLib.path_get_dirname(
        GLib.path_get_dirname(here)), 'stylesheet.css']);
    const text = new TextDecoder().decode(GLib.file_get_contents(path)[1])
        .replace(/\/\*[\s\S]*?\*\//g, '');
    const rules = [];
    for (const m of text.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
        const decls = {};
        for (const d of m[2].split(';')) {
            const i = d.indexOf(':');
            if (i > 0)
                (decls[d.slice(0, i).trim()] ??= []).push(d.slice(i + 1).trim());
        }
        for (const sel of m[1].split(',').map(s => s.trim()).filter(Boolean))
            rules.push({sel, decls});
    }
    const allOf = (sel, prop) => {
        /* every declaration for prop across all rules naming sel, in file
         * order -- later blocks win for tok; rgbaToken reads the list
         * front-to-back so double-declared washes (plain rgba first,
         * st-mix(accent) second) yield their parseable fallback */
        const out = [];
        for (const r of rules)
            if (r.sel === sel && r.decls[prop])
                out.push(...r.decls[prop]);
        if (!out.length)
            throw new Error(`card-demo: '${prop}' vanished from ${sel} `
                + 'in stylesheet.css -- update the demo token list deliberately');
        return out;
    };
    const tok = (sel, prop) => allOf(sel, prop).at(-1);
    const px = v => parseFloat(v);
    const em = v => parseFloat(v) * (v.endsWith('em') ? BASE_FONT : 1);
    const rgba = v => {
        const m = v.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/);
        if (m)
            return [+m[1] / 255, +m[2] / 255, +m[3] / 255,
                m[4] === undefined ? 1 : +m[4]];
        const h = v.match(/^#([\da-f]{6})$/i);
        if (h)
            return [0, 2, 4].map(i => parseInt(h[1].slice(i, i + 2), 16) / 255)
                .concat(1);
        throw new Error(`card-demo: unparseable stylesheet color '${v}'`);
    };
    const rgbaToken = (sel, prop) => {
        for (const v of allOf(sel, prop)) {
            try {
                return rgba(v.match(/rgba?\([^)]*\)|#[\da-f]{6}/i)[0]);
            } catch {
                /* st-mix(-st-accent-color, ...) and friends: skip to the
                 * next declared value -- the fallback chain CSS itself
                 * walks when the fancy function is unsupported */
            }
        }
        throw new Error(`card-demo: no parseable color for ${sel} ${prop}`);
    };
    const pad = v => {
        const n = v.trim().split(/\s+/).map(parseFloat);
        if (n.length === 1)
            return {t: n[0], r: n[0], b: n[0], l: n[0]};
        if (n.length === 2)
            return {t: n[0], r: n[1], b: n[0], l: n[1]};
        if (n.length === 4)
            return {t: n[0], r: n[1], b: n[2], l: n[3]};
        throw new Error(`card-demo: unparseable padding '${v}'`);
    };
    return {
        radius: px(tok('.aw-content', 'border-radius')),
        contentPad: pad(tok('.aw-content', 'padding')),
        cardPadX: pad(tok('.aw-header', 'padding')).l,
        rowGap: px(tok('.aw-days-grid', 'spacing')),
        colGap: px(tok('.aw-days', 'spacing')),
        tilePad: pad(tok('.aw-day', 'padding')),
        tileRadius: px(tok('.aw-day', 'border-radius')),
        colInner: px(tok('.aw-day-col', 'spacing')),
        dayNameSize: em(tok('.aw-day-name', 'font-size')),
        dayNameBold: tok('.aw-day-name', 'font-weight') === 'bold',
        hlGap: px(tok('.aw-day-hl', 'spacing')),
        hlSize: em(tok('.aw-day-hi', 'font-size')),
        hiWeight: +tok('.aw-day-hi', 'font-weight'),
        loWeight: +tok('.aw-day-lo', 'font-weight'),
        tabGap: px(tok('.aw-tabs', 'spacing')),
        tabPad: pad(tok('.aw-tab', 'padding')),
        tabBorder: px(tok('.aw-tab', 'border').split(/\s+/)[0]),
        tabFont: em(tok('.aw-tab-label', 'font-size')),
        tempFont: em(tok('.aw-current-temp', 'font-size')),
        descFont: em(tok('.aw-desc', 'font-size')),
        cityFont: em(tok('.aw-city', 'font-size')),
        ink: rgbaToken('.aw-dark', 'color'),
        inkSoft: rgbaToken('.aw-dark .aw-desc', 'color'),
        inkLo: rgbaToken('.aw-dark .aw-day-lo', 'color'),
        glass: rgbaToken('.aw-dark .aw-day-sel', 'background-color'),
        glassBorder: rgbaToken('.aw-dark .aw-day-sel', 'border'),
        tabIdle: rgbaToken('.aw-dark .aw-tab', 'color'),
        tabActive: rgbaToken('.aw-dark .aw-tab.aw-tab-active', 'color'),
        /* light-session + theme-gate rules (solid/accent styles) */
        lightInk: rgbaToken('.aw-light', 'color'),
        lightSoft: rgbaToken('.aw-light .aw-desc', 'color'),
        lightLo: rgbaToken('.aw-light .aw-day-lo', 'color'),
        lightIdle: rgbaToken('.aw-light .aw-tab', 'color'),
        lightSelBg: rgbaToken('.aw-light .aw-day-sel', 'background-color'),
        lightSelBorder: rgbaToken('.aw-light .aw-day-sel', 'border'),
        lightTabBg: rgbaToken('.aw-light .aw-tab.aw-tab-active', 'background-color'),
        lightTabBorder: rgbaToken('.aw-light .aw-tab.aw-tab-active', 'border-color'),
        lightTabInk: rgbaToken('.aw-light .aw-tab.aw-tab-active', 'color'),
        themeTabWash: rgbaToken('.aw-theme .aw-tab.aw-tab-active', 'background-color'),
        themeSelWash: rgbaToken('.aw-theme .aw-day-sel', 'background-color'),
    };
}
const S = scrapeStylesheet();

const W = 330, RADIUS = S.radius, PAD = S.cardPadX;
const HEADER_Y = S.contentPad.t, TABS_Y = 84, CHART_Y = 118, CHART_H = 165;
const TILE_ROWS = 2, TILE_COLS = 4;
const TILE_ICON = 26;   // WeatherIcon size (menu.js geometry, not CSS)
const NAME_BOX = measureBox('Today', S.dayNameSize, S.dayNameBold);
const HL_BOX = measureBox('23°', S.hlSize, false);
/* the tile's height is the box the stylesheet builds: pad + name + gap +
 * icon + gap + hi/lo row + pad -- same arithmetic St performs */
const TILE_H = S.tilePad.t + NAME_BOX.h + S.colInner + TILE_ICON
    + S.colInner + HL_BOX.h + S.tilePad.b;
const TILES_Y = CHART_Y + CHART_H + 14;
const H = TILES_Y + TILE_ROWS * TILE_H + (TILE_ROWS - 1) * S.rowGap
    + S.contentPad.b;
/* menu.js verbatim: the glass, the frame, the slab */
const STATIC_TIME = 1.1;
const SLAB_DARK = [16 / 255, 20 / 255, 28 / 255];
const SLAB_LIGHT = [1, 1, 1];   // menu.js verbatim (compGlass pairs)
const glassOver = (bg, tint, alpha) =>
    bg.map((c, i) => c * (1 - alpha) + tint[i] * alpha);

const INK = S.ink, INK_SOFT = S.inkSoft, INK_LO = S.inkLo;

function text(cr, str, {x, y, size, weight = Pango.Weight.NORMAL, color = INK,
                       align = 'left', shadow = true, width = null}) {
    const layout = PangoCairo.create_layout(cr);
    const desc = Pango.FontDescription.new();
    desc.set_family('Cantarell');
    desc.set_size(Math.round(size * Pango.SCALE));
    desc.set_weight(weight);
    layout.set_font_description(desc);
    if (width) {
        layout.set_width(Pango.SCALE * width);
        layout.set_alignment(align === 'right' ? Pango.Alignment.RIGHT
            : align === 'center' ? Pango.Alignment.CENTER : Pango.Alignment.LEFT);
    }
    layout.set_text(str, -1);
    const [tw, th] = layout.get_pixel_size();
    let px = x;
    if (align === 'right' && !width)
        px = x - tw;
    else if (align === 'center' && !width)
        px = x - tw / 2;
    if (shadow) {
        cr.save();
        cr.setSourceRGBA(0, 0, 10 / 255, 0.65);
        cr.translate(px, y + 1);
        PangoCairo.show_layout(cr, layout);
        cr.restore();
    }
    cr.save();
    cr.setSourceRGBA(...color);
    cr.translate(px, y);
    PangoCairo.show_layout(cr, layout);
    cr.restore();
    return [tw, th];
}

function measure(str, size) {
    const surf = new Cairo.ImageSurface(Cairo.Format.ARGB32, 1, 1);
    const cr = new Cairo.Context(surf);
    const layout = PangoCairo.create_layout(cr);
    const desc = Pango.FontDescription.new();
    desc.set_family('Cantarell');
    desc.set_size(Math.round(size * Pango.SCALE));
    layout.set_font_description(desc);
    layout.set_text(str, -1);
    return layout.get_pixel_size()[0];
}

/* box model of a text run (bold like .aw-tab-label) */
function measureBox(str, size, bold = false) {
    const surf = new Cairo.ImageSurface(Cairo.Format.ARGB32, 1, 1);
    const cr = new Cairo.Context(surf);
    const layout = PangoCairo.create_layout(cr);
    const desc = Pango.FontDescription.new();
    desc.set_family('Cantarell');
    desc.set_size(Math.round(size * Pango.SCALE));
    if (bold)
        desc.set_weight(Pango.Weight.BOLD);
    layout.set_font_description(desc);
    layout.set_text(str, -1);
    const [w, h] = layout.get_pixel_size();
    return {w, h};
}
function pill(cr, x, y, w, h, {glass = false} = {}) {
    roundRect(cr, x, y, w, h, h / 2);
    if (glass) {
        cr.setSourceRGBA(...S.glass);
        cr.fillPreserve();
        cr.setSourceRGBA(...S.glassBorder);
        cr.setLineWidth(1);
        cr.stroke();
    }
}

function roundRect(cr, x, y, w, h, r) {
    cr.newSubPath();
    cr.arc(x + w - r, y + r, r, -Math.PI / 2, 0);
    cr.arc(x + w - r, y + h - r, r, 0, Math.PI / 2);
    cr.arc(x + r, y + h - r, r, Math.PI / 2, Math.PI);
    cr.arc(x + r, y + r, r, Math.PI, 3 * Math.PI / 2);
    cr.closePath();
}

const WMO = {clear: 0, partly: 2, cloud: 3, rain: 61, storm: 95,
    snow: 71, sleet: 57, fog: 45, wind: 1, hail: 96};

/* sun position like menu._sunShade -- glow band +-12 deg, solar sine */
function sunShade(lat, lon, ms) {
    const sun = sunGeometry(lat, lon, ms);
    let glow = 0, solar = null;
    if (sun.altitude > -12 && sun.altitude < 12) {
        const near = 1 - Math.abs(sun.altitude) / 12;
        glow = near * near * (3 - 2 * near);
    }
    if (sun.sunrise !== null && sun.altitude > 0) {
        const f = (ms - sun.sunrise) / (sun.sunset - sun.sunrise);
        solar = Math.sin(Math.PI * Math.min(1, Math.max(0, f)));
    }
    return {glow, solar, altitude: sun.altitude, isDay: sun.altitude > 0};
}

/* seeded fake series for the condition */
function buildData(condition, lat, lon, ms) {
    const baseTemp = {clear: 19, partly: 17, cloud: 14, rain: 11, storm: 16,
        snow: -3, sleet: 0, fog: 9, wind: 12, hail: 14}[condition] ?? 15;
    const code = WMO[condition] ?? 0;
    const hours = [], temps = [], precip = [], winds = [];
    for (let h = 0; h < 24; h++) {
        const when = ms + h * 3600000;
        const alt = sunGeometry(lat, lon, when).altitude;
        const diurnal = Math.max(-0.5, Math.min(1, Math.sin((alt + 5) / 95 * Math.PI / 2)));
        hours.push(when);
        temps.push(+(baseTemp + 5.5 * diurnal - 2.5 + Math.random() * 1.6 - 0.8).toFixed(1));
        const wet = ['rain', 'storm', 'sleet', 'hail'].includes(condition);
        const coldwet = condition === 'snow';
        precip.push(wet ? 35 + Math.round(Math.random() * 50)
            : coldwet ? 30 + Math.round(Math.random() * 40)
            : Math.round(Math.random() * (condition === 'cloud' ? 20 : 8)));
        winds.push(condition === 'wind' ? 30 + Math.round(Math.random() * 18)
            : condition === 'storm' || condition === 'hail' ? 15 + Math.round(Math.random() * 20)
            : 3 + Math.round(Math.random() * 12));
    }
    const daily = [];
    for (let d = 0; d < 8; d++) {
        const wig = Math.random() * 4 - 2;
        const codes = {clear: [0, 1, 2], partly: [2, 3, 1], cloud: [3, 45, 2],
            rain: [61, 80, 3], storm: [95, 80, 61], snow: [71, 73, 85],
            sleet: [57, 61, 3], fog: [45, 3, 2], wind: [1, 2, 3], hail: [96, 95, 80]}[condition] ?? [0];
        daily.push({date: ms + d * 86400000, code: d === 0 ? code : codes[d % codes.length],
            tmax: +(baseTemp + 4 + wig).toFixed(1), tmin: +(baseTemp - 4 - wig).toFixed(1)});
    }
    return {hours, temps, precip, winds, daily, code, baseTemp};
}

const fmtT = (c, units) => units === 'imperial'
    ? `${Math.round(c * 9 / 5 + 32)}°` : `${Math.round(c)}°`;
/* Date.parse shifts the city's ISO stamp to real UTC ms (the almanac's
 * currency); the CITY's wall clock needs the offset re-applied -- the
 * machine's timezone must never leak into labels */
function wallClock(iso) {
    const m = iso.match(/([+-])(\d{2}):(\d{2})$/);
    if (!m)
        return 0;
    return (m[1] === '-' ? -1 : 1) * (+m[2] * 60 + +m[3]) * 60000;
}
let WALL = 0;
const fmtHour = ms => {
    const hh = new Date(ms + WALL).getUTCHours();
    return `${hh % 12 || 12}${hh < 12 ? 'AM' : 'PM'}`;
};
const dayNameOf = ms =>
    ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][new Date(ms + WALL).getUTCDay()];

function renderCard(p, outDir, probe = null) {
    /* menu.js verbatim: presentation theme follows the style;
     * solidDark sends every tile glyph to the pale family on purpose */
    const style = p.style ?? 'animated';         // animated | solid | accent
    const session = p.session ?? 'dark';         // OS dark/light preference
    const paintDark = style === 'animated' || session === 'dark';
    const solidDark = style === 'solid' && session === 'dark';
    const accentRgb = typeof p.accent === 'string'
        ? [0, 2, 4].map(i => parseInt(p.accent.slice(1 + i, 3 + i), 16) / 255)
        : p.accent ?? [0.208, 0.518, 0.894];     // #3584e4, the Adwaita blue
    const ms = p.ms ?? Date.parse(p.local);
    if (!Number.isFinite(ms))
        throw new Error(`bad --local '${p.local}' (use ISO 8601 with offset)`);
    WALL = p.tzMin !== undefined ? p.tzMin * 60000 : wallClock(p.local);
    const {glow, solar, isDay} = sunShade(p.lat, p.lon, ms);
    const wmo = WMO[p.condition] ?? 0;
    const {scene, desc} = sceneFor(wmo, isDay);
    const night = !isDay;
    const data = buildData(p.condition, p.lat, p.lon, ms);

    /* menu.js verbatim: solid washes the scene with a near-opaque slab,
     * accent samples a FIXED ground (no sky at all); animated scrim is
     * null. Transcribed from THEME_CONFIG.scrimSolid and _bgAt. */
    const SCRIM_SOLID = { dark: [0.03, 0.045, 0.08, 0.78],
        light: [0.97, 0.975, 0.995, 0.80] };
    const ACCENT_GROUND = { dark: [0.185, 0.185, 0.19],
        light: [0.96, 0.96, 0.97] };
    const scrim = style === 'solid' ? SCRIM_SOLID[paintDark ? 'dark' : 'light'] : null;
    const bgAt = f => {
        if (style === 'accent')
            return ACCENT_GROUND[paintDark ? 'dark' : 'light'];
        const sky = sampleSky(scene, night, f, glow, solar);
        return scrim
            ? sky.map((c, i) => c * (1 - scrim[3]) + scrim[i] * scrim[3])
            : sky;
    };

    const surf = new Cairo.ImageSurface(Cairo.Format.ARGB32, W, H);
    const cr = new Cairo.Context(surf);

    /* sky backdrop */
    const pool = createSky();
    // the city's real moon for this date+time -- a night-card moon is
    // phase-honest, and the value travels to tiles and strip glyphs
    const mPhase = moonPhase(new Date(ms)).phase;
    if (style === 'accent') {
        /* the .aw-theme gate paints NOTHING of ours: the shell theme's
         * popup surface shows through. The demo stands in with _bgAt's
         * fixed ground -- what the goldens certify here is OUR paint
         * layers over that ground: chart, glyphs, labels, washes */
        roundRect(cr, 0, 0, W, H, RADIUS);
        cr.setSourceRGBA(...bgAt(0), 1);
        cr.fill();
    } else {
        paintSky(cr, {w: W, h: H,
            time: style === 'solid' ? STATIC_TIME : 2.9,   // solid = frozen frame
            scene, night, sky: pool, scrim,
            radius: RADIUS, glow, solar, phase: mPhase});
    }

    /* disc-aware ground under any card fraction: the same bodyOf the
     * live menu's judge samples -- a disc BEHIND the text is part of
     * its ground, so on a clear day the city wears ink */
    const body = style === 'accent' ? null : bodyOf(scene, night, W, H, glow, solar);
    const bgPoint = (fx, fy) => {
        const base = bgAt(fy);
        if (!body)
            return base;
        const d = Math.hypot(fx * W - body.x, fy * H - body.y);
        const cover = d <= body.r ? body.max
            : Math.max(0, body.max * (1 - (d - body.r) / body.soft));
        return cover > 0.02
            ? base.map((c, i) => c + (body.col[i] - c) * cover)
            : base;
    };
    /* chrome verdicts -- the SHARED policy of ink-policy.js, the exact
     * grouping menu._applyTextInk reaches for: header pairs, the whole
     * inactive tab row as one group, the active tab judged through its
     * dark glass. The demo no longer restates the rules; it imports them. */
    const tempStr = fmtT(data.temps[0], p.units);
    const tempBox = measureBox(tempStr, S.tempFont);
    const descBox = measureBox(desc, S.descFont);
    const cityBox = measureBox(p.city, S.cityFont, true);
    const local = new Date(ms + WALL);   // the CITY's wall clock
    const clock = `${String(local.getUTCHours()).padStart(2, '0')}:${String(local.getUTCMinutes()).padStart(2, '0')}`;
    const clockBox = measureBox(clock, S.descFont);
    const tabs = ['Temperature', 'Precipitation', 'Wind'];
    const TAB_FS = S.tabFont;
    const tabsBox = tabs.map(t => measureBox(t, TAB_FS, true));
    const tabWs = tabsBox.map(b => b.w + 2 * (S.tabPad.r + S.tabBorder));
    const tabH = Math.max(...tabsBox.map(b => b.h)) + 2 * (S.tabPad.t + S.tabBorder);
    let tx = (W - (tabWs.reduce((a, b) => a + b, 0) + 2 * S.tabGap)) / 2;
    const tabBoxes = tabs.map((t, i) => {
        const bx = tx;
        tx += tabWs[i] + S.tabGap;
        return [bx, TABS_Y, tabWs[i], tabH];
    });
    tx = tabBoxes[0][0];
    const verdicts = chromeVerdicts({
        headerLeft: [[PAD, HEADER_Y + 2, tempBox.w, tempBox.h],
            [PAD, HEADER_Y + 48, descBox.w, descBox.h]],
        headerRight: [[W - PAD - cityBox.w, HEADER_Y + 4, cityBox.w, cityBox.h],
            [W - PAD - clockBox.w, HEADER_Y + 24, clockBox.w, clockBox.h]],
        tabActive: tabBoxes[0],
        tabsIdle: tabBoxes.slice(1),
    }, W, H, bgPoint, bg => glassOver(bg, SLAB_DARK, 0.45));

    /* header: big temp + desc left, city + clock right -- ink solid
     * when the ground earns it, a disc behind the text included */
    /* the accent style never judges (_applyTextInk's plain path): the
     * header wears the CSS ladder straight -- theme ink, soft desc */
    const headInk = style === 'accent'
        ? (paintDark ? S.ink : S.lightInk) : [...verdicts.headerRight.ink, 1];
    const headLeft = style === 'accent'
        ? (paintDark ? S.ink : S.lightInk) : [...verdicts.headerLeft.ink, 1];
    const headSoft = style === 'accent'
        ? (paintDark ? S.inkSoft : S.lightSoft) : [...verdicts.headerLeft.ink, 1];
    const headSoftRight = style === 'accent'
        ? (paintDark ? S.inkSoft : S.lightSoft) : [...verdicts.headerRight.ink, 1];
    text(cr, tempStr, {x: PAD, y: HEADER_Y + 2, size: S.tempFont,
        weight: Pango.Weight.ULTRALIGHT, color: headLeft});
    text(cr, desc, {x: PAD, y: HEADER_Y + 48, size: S.descFont, color: headSoft});
    text(cr, p.city, {x: W - PAD, y: HEADER_Y + 4, size: S.cityFont,
        weight: Pango.Weight.BOLD, color: headInk, align: 'right'});
    text(cr, clock, {x: W - PAD, y: HEADER_Y + 24, size: S.descFont,
        color: headSoftRight, align: 'right'});

    /* metric tabs -- the real .aw-tabs box: x_align CENTER row, spacing 8,
     * .aw-tab padding 3px 10px around a 1px border (radius 99 = capsule),
     * label 0.9em bold; verdicts come from the shared policy above */
    /* selection pill: dark glass | light glass | accent wash (no border:
     * the .aw-theme rule paints background only) */
    const tabSelBg = style === 'accent' ? S.themeTabWash
        : paintDark ? S.glass : S.lightTabBg;
    const tabSelBorder = style === 'accent' ? null
        : paintDark ? S.glassBorder : S.lightTabBorder;
    const tabSelInk = style === 'accent'
        ? (paintDark ? S.ink : S.lightTabInk)
        : [...verdicts.tabActive.ink, 1];
    const tabIdleInk = style === 'accent'
        ? (paintDark ? S.tabIdle : S.lightIdle)
        : [...verdicts.tabsIdle.ink, 1];
    tabs.forEach((t, i) => {
        if (i === 0) {
            cr.save();
            roundRect(cr, tx + 0.5, TABS_Y + 0.5, tabWs[i] - 1, tabH - 1,
                (tabH - 1) / 2);
            cr.setSourceRGBA(...tabSelBg);
            cr.fillPreserve();
            if (tabSelBorder) {
                cr.setSourceRGBA(...tabSelBorder);
                cr.setLineWidth(1);
                cr.stroke();
            }
            cr.restore();
        }
        text(cr, t, {x: tx + tabWs[i] / 2 - tabsBox[i].w / 2,
            y: TABS_Y + (tabH - tabsBox[i].h) / 2,
            size: TAB_FS, weight: Pango.Weight.BOLD,
            color: i === 0 ? tabSelInk : tabIdleInk});
        tx += tabWs[i] + S.tabGap;
    });

    const cells = probe ? [] : null;

    /* chart + condition strip (same engine, same referee as the menu) */
    cr.save();
    cr.translate(0, CHART_Y);
    const stripScenes = [], stripNights = [];
    data.hours.forEach((when, i) => {
        const alt = sunGeometry(p.lat, p.lon, when).altitude;
        const hourlyCode = i < 3 ? data.code
            : data.daily[Math.min(7, Math.floor(i / 3))].code;
        stripScenes.push(sceneFor(hourlyCode, alt > 0).scene);
        stripNights.push(alt <= 0);
    });
    paintChart(cr, {
        w: W, h: CHART_H, values: data.temps,
        fmtValue: (idx, v) => fmtT(v, p.units),
        fmtHour: idx => fmtHour(data.hours[idx]),
        accent: style === 'accent' ? accentRgb : [0.96, 0.65, 0.14],
        nowFrac: 0.02,
        scenes: stripScenes, nights: stripNights,
        stripBottom: true, dark: paintDark,
        pillGlass: style !== 'accent', phase: mPhase,
        bgFn: style === 'accent' ? null : yPx => bgAt((CHART_Y + yPx) / H),
        nowLabel: style === 'accent' ? accentRgb : [0.96, 0.65, 0.14],
        fontSize: 8,
        stripProbe: cells ? cell => cells.push({
            i: cell.i, x: cell.x - cell.size / 2,
            y: CHART_Y + cell.y - cell.size / 2,
            size: cell.size, scene: cell.scene, night: cell.night,
            ground: cell.ground,
        }) : undefined,
    });
    cr.restore();

    /* day tiles -- the exact _buildDayTiles + _applyTileInk pipeline:
     * ground at 0.9 (selection glass comped), label ink from pickInk on
     * THAT ground (low at 0.82 alpha), glyph dark from the uncomped 0.8
     * foot, pale from tileGlyphPale on the comped ground, painter
     * groundLum from the uncomped 0.8 (raw sky tier), STATIC_TIME pose,
     * seed i*13+5 */
    const tileW = (W - 2 * PAD - (TILE_COLS - 1) * S.colGap) / TILE_COLS;
    const footRaw = bgAt(0.8);
    const footGlow = style === 'accent' ? paintDark
        : pickInk(footRaw) !== INK_DARK;   // = _iconDark()
    for (let i = 0; i < 8; i++) {
        const row = Math.floor(i / TILE_COLS), col = i % TILE_COLS;
        const x = PAD + col * (tileW + S.colGap);
        const y = TILES_Y + row * (TILE_H + S.rowGap);
        const nameY = y + S.tilePad.t;
        const iconY = nameY + NAME_BOX.h + S.colInner;
        const hlY = iconY + TILE_ICON + S.colInner;
        const selected = i === 0;
        let bg = bgAt(0.9);
        const selBg = style === 'accent' ? S.themeSelWash
            : paintDark ? S.glass : S.lightSelBg;
        const selBorder = style === 'accent' ? null
            : paintDark ? S.glassBorder : S.lightSelBorder;
        if (selected) {
            cr.save();
            roundRect(cr, x + 0.5, y + 0.5, tileW - 1, TILE_H - 1, S.tileRadius);
            cr.setSourceRGBA(...selBg);
            cr.fillPreserve();
            if (selBorder) {
                cr.setSourceRGBA(...selBorder);
                cr.setLineWidth(1);
                cr.stroke();
            }
            cr.restore();
            if (style !== 'accent')   // compGlass: dark | light slab
                bg = glassOver(bg, paintDark ? SLAB_DARK : SLAB_LIGHT,
                    paintDark ? 0.45 : 0.68);
        }
        const ink = pickInk(bg);
        /* the accent style returns tiles to plain CSS ink (the plain
         * path of _applyTileInk): theme ladder, lows by CSS alpha */
        const inkA = a => style === 'accent'
            ? (paintDark ? S.ink : S.lightInk) : [...ink, a];
        const loInk = style === 'accent'
            ? (paintDark ? S.inkLo : S.lightLo) : inkA(0.82);
        const day = data.daily[i];
        const tScene = sceneFor(day.code, true).scene;
        const pale = style === 'accent' ? (selected || solidDark)
            : tileGlyphPale(bg, {selected, solidDark});
        /* St.Label x_align CENTER in a column that fills the tile: the
         * width box spans the tile from its LEFT edge -- not the center */
        text(cr, i === 0 ? 'Today' : dayNameOf(day.date), {
            x, y: nameY, size: S.dayNameSize,
            weight: S.dayNameBold ? Pango.Weight.BOLD : Pango.Weight.NORMAL,
            color: inkA(1), align: 'center', width: tileW});
        /* 26px glyph, same seeds/intensities/time as _buildDayTiles */
        const scale = TILE_ICON / 24;
        cr.save();
        cr.translate(x + tileW / 2 - 12 * scale, iconY);
        cr.scale(scale, scale);
        paintWeather(cr, {
            scene: tScene, time: STATIC_TIME, night: false, dark: footGlow,
            intensity: CODE_PRECIP_INTENSITY[day.code] ?? STRIP_PRECIP_INTENSITY[tScene] ?? 0,
            seed: i * 13 + 5,
            groundLum: style === 'accent' ? -1 : lumOf(footRaw),
            pale, staticPose: true,
        });
        cr.restore();
        /* hi + lo as one centered row, 5px apart -- ink by weight,
         * low by 0.82 alpha, never by position-guessing */
        const wHi = measure(fmtT(day.tmax, p.units), S.hlSize);
        const wLo = measure(fmtT(day.tmin, p.units), S.hlSize);
        const rowW = wHi + S.hlGap + wLo;
        const hlX = x + (tileW - rowW) / 2;
        text(cr, fmtT(day.tmax, p.units), {
            x: hlX, y: hlY, size: S.hlSize, weight: S.hiWeight,
            color: inkA(1)});
        text(cr, fmtT(day.tmin, p.units), {
            x: hlX + wHi + S.hlGap, y: hlY, size: S.hlSize,
            weight: S.loWeight, color: loInk});
    }

    surf.flush();
    const name = `demo-${(p.slug ?? p.city).toLowerCase().replace(/[^a-z0-9]+/g, '-')}.png`;
    surf.writeToPNG(GLib.build_filenamev([outDir, name]));
    if (probe)
        return {name, cells};
    print(`demo card: ${p.city}, ${p.local ?? 'almanac slot'}, ${p.condition} `
        + `(${night ? 'night' : 'day'}, glow ${glow.toFixed(2)}, `
        + `solar ${solar === null ? 'n/a' : solar.toFixed(2)}) -> ${name}`);
    return null;
}

/* WCAG lumOf -- kept local so the demo needs no menu internals */
const lumOf = c => {
    const f = v => v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
    return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]);
};

/* -- presets: honest postcards of scenes the sky rationales ------------- */
const PRESETS = [
    {slug: 'sf-sunset', city: 'San Francisco', lat: 37.77, lon: -122.42,
        local: '2026-10-07T18:37-07:00', condition: 'partly'},
    {slug: 'tokyo-storm-night', city: 'Tokyo', lat: 35.68, lon: 139.69,
        local: '2026-07-18T21:40+09:00', condition: 'storm'},
    {slug: 'berlin-rain-day', city: 'Berlin', lat: 52.52, lon: 13.40,
        local: '2026-11-03T14:10+01:00', condition: 'rain'},
    {slug: 'kilimanjaro-clear-noon', city: 'Kilimanjaro', lat: -3.07, lon: 37.35,
        local: '2026-10-08T12:05+03:00', condition: 'clear'},
    {slug: 'ny-snow-day', city: 'New York', lat: 40.71, lon: -74.01,
        local: '2027-01-19T10:20-05:00', condition: 'snow'},
    /* the other two backdrop styles, both sessions: solid = frozen sky
     * frame under the theme's near-opaque slab; accent = the theme's own
     * popup ground with the data unified in the OS accent colour */
    {slug: 'style-solid-dark', city: 'Berlin', lat: 52.52, lon: 13.40,
        local: '2026-11-03T14:10+01:00', condition: 'rain',
        style: 'solid', session: 'dark'},
    {slug: 'style-solid-light', city: 'Berlin', lat: 52.52, lon: 13.40,
        local: '2026-11-03T14:10+01:00', condition: 'rain',
        style: 'solid', session: 'light'},
    {slug: 'style-accent-dark', city: 'New York', lat: 40.71, lon: -74.01,
        local: '2027-01-19T10:20-05:00', condition: 'snow',
        style: 'accent', session: 'dark'},
    {slug: 'style-accent-light', city: 'New York', lat: 40.71, lon: -74.01,
        local: '2027-01-19T10:20-05:00', condition: 'snow',
        style: 'accent', session: 'light'},
];

const argv = globalThis.ARGV ?? [];
const outDir = GLib.build_filenamev([GLib.get_current_dir(), 'tools', 'out', 'demo']);
GLib.mkdir_with_parents(outDir, 0o755);

function opt(flag, dflt) {
    const i = argv.indexOf(flag);
    return i >= 0 ? argv[i + 1] : dflt;
}

/* unknown flags must die loudly: silently ignoring --coverage once let
 * 30 STALE cards masquerade as a fresh render set */
const FLAGS = ['--city', '--lat', '--lon', '--local', '--condition',
    '--units', '--slug', '--preset', '--coverage'];
for (const a of argv)
    if (a.startsWith('--') && !FLAGS.includes(a))
        throw new Error(`unknown flag '${a}' (known: ${FLAGS.join(' ')})`);

/* coverage roster: the preset cities with their UTC offsets, so every
 * card's clock, almanac and tiles share one instant */
const ROSTER = PRESETS.map(p => ({city: p.city, lat: p.lat, lon: p.lon,
    date: p.local.slice(0, 10), tzMin: wallClock(p.local) / 60000}));
const CONDS = ['clear', 'partly', 'cloud', 'fog', 'rain',
    'snow', 'sleet', 'storm', 'hail', 'wind'];
const SLOTS = ['day', 'night', 'golden'];

function slotMs(city, slot) {
    const sign = city.tzMin >= 0 ? '+' : '-';
    const abs = Math.abs(city.tzMin);
    const tz = `${sign}${String(Math.floor(abs / 60)).padStart(2, '0')}:${String(abs % 60).padStart(2, '0')}`;
    if (slot !== 'golden')
        return Date.parse(`${city.date}T${slot === 'day' ? '13:00' : '22:30'}${tz}`);
    /* golden hour is not a wall time we get to pick: the city's OWN sun
     * event defines the slot, 12 minutes BEFORE sunset -- sun still up,
     * ~1 degree altitude, glow at its apex (after sunset it is simply
     * night and the sky correctly shows the moon) */
    const noon = Date.parse(`${city.date}T12:00${tz}`);
    const sun = sunGeometry(city.lat, city.lon, noon);
    if (sun.sunset !== null && sun.sunset !== undefined)
        return sun.sunset - 12 * 60000;
    if (sun.sunrise !== null && sun.sunrise !== undefined)
        return sun.sunrise + 12 * 60000;               // polar-night cities
    throw new Error(`no sun event for ${city.city} on ${city.date}`);
}

function renderCoverage() {
    const manifest = [];
    let k = 0;
    for (const condition of CONDS) {
        for (const slot of SLOTS) {
            const city = ROSTER[k % ROSTER.length];
            const cells = [];
            const info = renderCard({city: city.city, lat: city.lat,
                lon: city.lon, ms: slotMs(city, slot), tzMin: city.tzMin,
                condition, units: 'metric', slug: `cov-${condition}-${slot}`,
            }, outDir, cells);
            const markerX = 24 + 0.02 * (W - 48);   // chart nowFrac 0.02
            for (const cell of info.cells)
                manifest.push({png: info.name, markerX, ...cell});
            k++;
        }
    }
    /* the eight cardinal phases as full night cards -- almanac-honest:
     * no fabricated phase values, we SEARCH for real Berlin nights whose
     * true moon falls nearest each quadrant of the cycle */
    const MOON_NAMES = ['new', 'waxing-crescent', 'first-quarter',
        'waxing-gibbous', 'full', 'waning-gibbous', 'last-quarter',
        'waning-crescent'];
    const berlin = ROSTER.find(c => c.city === 'Berlin');
    if (!berlin)
        throw new Error('coverage roster lost Berlin, the moon anchor');
    for (let k = 0; k < 8; k++) {
        const target = k / 8;
        let best = null;
        for (let d = 0; d < 60; d++) {   // 2026-10-01 .. 2026-11-29: two cycles
            const ms = Date.parse('2026-10-01T22:30+02:00') + d * 86400000;
            const ph = moonPhase(new Date(ms)).phase;
            const err = Math.min(Math.abs(ph - target),
                1 - Math.abs(ph - target));
            if (!best || err < best.err)
                best = {ms, err};
        }
        if (best.err > 0.03)
            throw new Error(`no Berlin night within 3% of phase ${target}`);
        const cells = [];
        const info = renderCard({city: berlin.city, lat: berlin.lat,
            lon: berlin.lon, ms: best.ms, tzMin: berlin.tzMin,
            condition: 'clear', units: 'metric',
            slug: `cov-moon-${MOON_NAMES[k]}`,
        }, outDir, cells);
        const markerX = 24 + 0.02 * (W - 48);
        for (const cell of info.cells)
            manifest.push({png: info.name, markerX, ...cell});
    }
    if (!manifest.length)
        throw new Error('coverage produced zero graded glyphs');
    GLib.file_set_contents(GLib.build_filenamev([outDir, 'manifest.json']),
        JSON.stringify({grid: true, fullCards: true,
            scenes: CONDS, slots: SLOTS, cells: manifest}, null, 1));
    print(`coverage: ${k} full cards, ${manifest.length} strip glyphs -> ${outDir}`);
}

if (argv.includes('--city')) {
    renderCard({city: opt('--city'), lat: +opt('--lat'), lon: +opt('--lon'),
        local: opt('--local'), condition: opt('--condition', 'clear'),
        units: opt('--units', 'metric'), slug: opt('--slug', null)}, outDir);
} else if (argv.includes('--coverage')) {
    renderCoverage();
} else {
    const want = opt('--preset', null);
    let n = 0;
    for (const preset of PRESETS)
        if (!want || preset.slug === want) {
            renderCard({...preset, units: 'metric'}, outDir);
            n++;
        }
    if (!n)
        throw new Error(`no preset matches '${want}'`);
}
