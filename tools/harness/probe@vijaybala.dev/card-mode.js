/* card-mode -- stage 2 of the tier-2 gate: render the REAL ForecastPanel
 * inside the nested shell from a golden fixture, then capture its rect.
 * DEV ONLY, never packaged.
 *
 * Location and weather are mocked by construction: ForecastPanel has no
 * provider, no network, no geolocation -- it is a pure function of the
 * `state` object render() receives. We hand it the exact shape weather.js
 * produces (and card-demo.mjs fabricates), so one slug selects city,
 * coordinates, wall-clock instant, condition code, style and session.
 *
 * Determinism mirrors tools/card-demo.mjs: same LCG (seed 1337), same
 * fixture generator (buildData ported verbatim), clock pinned BEFORE the
 * panel is constructed, data built before the panel constructor so both
 * pipelines consume the random stream in the same order up to SkyPool.
 * Where they must diverge (the panel's own star/particle draws) the
 * shot-diff budget absorbs the difference -- that divergence IS the
 * measurement this harness exists to make. */

import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

/* card-demo.mjs WMO map -- condition slug to code, one source of truth */
const WMO = {clear: 0, partly: 2, cloud: 3, rain: 61, storm: 95,
    snow: 71, sleet: 57, fog: 45, wind: 1, hail: 96};

/* card-demo.mjs PRESETS (minus the style-* quartet above, which carry
 * their own style/session); coverage rosters rotate through these */
const PRESETS = {
    'sf-sunset': {city: 'San Francisco', lat: 37.77, lon: -122.42,
        local: '2026-10-07T18:37-07:00', condition: 'partly'},
    'tokyo-storm-night': {city: 'Tokyo', lat: 35.68, lon: 139.69,
        local: '2026-07-18T21:40+09:00', condition: 'storm'},
    'berlin-rain-day': {city: 'Berlin', lat: 52.52, lon: 13.4,
        local: '2026-11-03T14:10+01:00', condition: 'rain'},
    'kilimanjaro-clear-noon': {city: 'Kilimanjaro', lat: -3.07, lon: 37.35,
        local: '2026-10-08T12:05+03:00', condition: 'clear'},
    'ny-snow-day': {city: 'New York', lat: 40.71, lon: -74.01,
        local: '2027-01-19T10:20-05:00', condition: 'snow'},
};

/* card-demo's coverage roster, mirrored VERBATIM: same CONDS x SLOTS
 * rotation over the preset cities, the same golden-hour rule (sunset
 * minus 12 min, sunrise+12 in polar night), the same moon search. It
 * must stay in step with renderCoverage() in tools/card-demo.mjs --
 * the slugs it names are the blessed golden names. */
const COV_CONDS = ['clear', 'partly', 'cloud', 'fog', 'rain',
    'snow', 'sleet', 'storm', 'hail', 'wind'];
const COV_SLOTS = ['day', 'night', 'golden'];
const MOON_NAMES = ['new', 'waxing-crescent', 'first-quarter',
    'waxing-gibbous', 'full', 'waning-gibbous', 'last-quarter',
    'waning-crescent'];

function slotFx(city, slot) {
    const sign = city.tzMin >= 0 ? '+' : '-';
    const abs = Math.abs(city.tzMin);
    const tz = `${sign}${String(Math.floor(abs / 60)).padStart(2, '0')}:${String(abs % 60).padStart(2, '0')}`;
    if (slot !== 'golden')
        return Date.parse(`${city.date}T${slot === 'day' ? '13:00' : '22:30'}${tz}`);
    const noon = Date.parse(`${city.date}T12:00${tz}`);
    const sun = weatherRef.sunGeometry(city.lat, city.lon, noon);
    if (sun.sunset !== null && sun.sunset !== undefined)
        return sun.sunset - 12 * 60000;
    if (sun.sunrise !== null && sun.sunrise !== undefined)
        return sun.sunrise + 12 * 60000;               // polar-night cities
    throw new Error(`no sun event for ${city.city} on ${city.date}`);
}

let weatherRef = null;   // module handles for the roster math (set at boot)

/** slug -> fixture, the full 47-slug registry the goldens are named for */
export function allFixtures(weather, moon) {
    weatherRef = weather;
    const all = {...PRESETS, ...FIXTURES};
    const roster = Object.values(PRESETS).map(p => ({city: p.city,
        lat: p.lat, lon: p.lon, date: p.local.slice(0, 10),
        tzMin: wallClock(p.local) / 60000}));
    let k = 0;
    for (const condition of COV_CONDS)
        for (const slot of COV_SLOTS) {
            const city = roster[k % roster.length];
            all[`cov-${condition}-${slot}`] = {city: city.city, lat: city.lat,
                lon: city.lon, ms: slotFx(city, slot), tzMin: city.tzMin,
                condition};
            k++;
        }
    const berlin = roster.find(c => c.city === 'Berlin');
    if (!berlin)
        throw new Error('coverage roster lost Berlin, the moon anchor');
    for (let j = 0; j < 8; j++) {
        const target = j / 8;
        let best = null;
        for (let d = 0; d < 60; d++) {   // 2026-10-01 .. 2026-11-29: two cycles
            const ms = Date.parse('2026-10-01T22:30+02:00') + d * 86400000;
            const ph = moon.moonPhase(new Date(ms)).phase;
            const err = Math.min(Math.abs(ph - target),
                1 - Math.abs(ph - target));
            if (!best || err < best.err)
                best = {ms, err};
        }
        if (best.err > 0.03)
            throw new Error(`no Berlin night within 3% of phase ${target}`);
        all[`cov-moon-${MOON_NAMES[j]}`] = {city: berlin.city,
            lat: berlin.lat, lon: berlin.lon, ms: best.ms,
            tzMin: berlin.tzMin, condition: 'clear'};
    }
    return all;
}

/* the style/session quartet + two preset cities (presets also live in
 * PRESETS above; these entries add the style/session overlays) */
export const FIXTURES = {
    'style-solid-dark': {city: 'Berlin', lat: 52.52, lon: 13.4,
        local: '2026-11-03T14:10+01:00', condition: 'rain',
        style: 'solid', session: 'dark'},
    'style-solid-light': {city: 'Berlin', lat: 52.52, lon: 13.4,
        local: '2026-11-03T14:10+01:00', condition: 'rain',
        style: 'solid', session: 'light'},
    'style-accent-dark': {city: 'New York', lat: 40.71, lon: -74.01,
        local: '2027-01-19T10:20-05:00', condition: 'snow',
        style: 'accent', session: 'dark'},
    'style-accent-light': {city: 'New York', lat: 40.71, lon: -74.01,
        local: '2027-01-19T10:20-05:00', condition: 'snow',
        style: 'accent', session: 'light'},
    'berlin-rain-day': {city: 'Berlin', lat: 52.52, lon: 13.4,
        local: '2026-11-03T14:10+01:00', condition: 'rain'},
    'ny-snow-day': {city: 'New York', lat: 40.71, lon: -74.01,
        local: '2027-01-19T10:20-05:00', condition: 'snow'},
};

/* card-demo's buildData, ported verbatim (consumes the pinned LCG) */
function buildData(weather, condition, lat, lon, ms) {
    const {sunGeometry} = weather;
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
        daily.push({ms: ms + d * 86400000, code: d === 0 ? code : codes[d % codes.length],
            tmax: +(baseTemp + 4 + wig).toFixed(1), tmin: +(baseTemp - 4 - wig).toFixed(1)});
    }
    return {hours, temps, precip, winds, daily, code, baseTemp};
}

/* fixture-local wall clock helpers (machine TZ must not leak) */
function wallClock(iso) {
    const m = iso.match(/([+-])(\d{2}):(\d{2})$/);
    if (!m)
        return 0;
    return (m[1] === '-' ? -1 : 1) * (+m[2] * 60 + +m[3]) * 60000;
}

function stamp(ms, wall) {
    const p = n => String(n).padStart(2, '0');
    const d = new Date(ms + wall);
    return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}`
        + `T${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`;
}

/* the state weather.js produces -- the panel's whole world */
function buildState(weather, moon, fx) {
    const ms = fx.ms ?? Date.parse(fx.local);
    const wall = fx.tzMin !== undefined ? fx.tzMin * 60000 : wallClock(fx.local);
    // fixtures born from sun/moon math carry millisecond instants, not
    // wall strings: synthesise the ISO the panel's city clock parses
    // (second precision -- the clock only ever shows HH:MM)
    const iso = fx.local ?? (() => {
        const t = Math.floor(ms);
        const a = Math.abs(Math.round(wall / 60000));
        return `${stamp(t, wall)}:${String(Math.floor((t % 60000) / 1000)).padStart(2, '0')}`
            + `${wall >= 0 ? '+' : '-'}${String(Math.floor(a / 60)).padStart(2, '0')}:${String(a % 60).padStart(2, '0')}`;
    })();
    const data = buildData(weather, fx.condition, fx.lat, fx.lon, ms);
    const {sunGeometry, sceneFor} = weather;
    const isDay = sunGeometry(fx.lat, fx.lon, ms).altitude > 0;
    const {phase} = moon.moonPhase(new Date(ms));
    return {
        current: {temp: data.temps[0], code: data.code, isDay},
        hourly: {
            time: data.hours.map(h => `${stamp(h, wall).slice(0, 13)}:00`),
            temp: data.temps,
            precipProb: data.precip,
            wind: data.winds,
            code: data.hours.map(() => data.code),
        },
        daily: data.daily.map(d => ({date: stamp(d.ms, wall).slice(0, 10),
            code: d.code, tmax: d.tmax, tmin: d.tmin})),
        currentIso: iso,
        units: 'metric',
        effective: sceneFor(data.code, isDay),
        dark: fx.session !== 'light',
        updated: null,
        phase,
        latitude: fx.lat,
        longitude: fx.lon,
    };
}

/* GNOME 50's St-18 exposes stylesheets as theme properties; the old
 * add_stylesheet_from_file API is gone. Try every reachable door and
 * report which one opened -- the first real-shell run answers this. */
async function loadCss(cssPath, extraCss) {
    const St = (await import('gi://St')).default;
    const theme = St.ThemeContext.get_for_stage(global.stage).get_theme();
    const cssBytes = Gio.File.new_for_path(cssPath).load_contents(null)[1];
    let cssFile = cssPath;
    if (extraCss) {
        // append harness-only rules (the accent stand-in ground) to a
        // temp copy: production CSS stays untouched
        cssFile = '/tmp/opencode/wg-probe.css';
        GLib.file_set_contents(cssFile,
            new TextDecoder().decode(cssBytes) + '\n' + extraCss);
    }
    const attempts = [`current-stylesheet: ${typeof theme.application_stylesheet}`];
    const tryIt = (name, fn) => {
        try {
            fn();
            attempts.push(`${name}: ok`);
            return true;
        } catch (e) {
            attempts.push(`${name}: ${e.message}`);
            return false;
        }
    };
    return {
        // measured facts: load_stylesheet(Gio.File) is the classic door
        // and works on St-18; application-stylesheet is a GFile-typed
        // property (replacement, not append -- kept as fallback)
        ok: tryIt('load_stylesheet(file)', () => {
            theme.load_stylesheet(Gio.File.new_for_path(cssFile));
        }) || tryIt('application-stylesheet(GFile)', () => {
            theme.application_stylesheet = Gio.File.new_for_path(cssFile);
        }),
        attempts,
    };
}

const wait = ms => new Promise(r => GLib.timeout_add(GLib.PRIORITY_LOW, ms,
    () => (r(), GLib.SOURCE_REMOVE)));

/**
 * Render one fixture card on the stage and capture it.
 * captureRegion(rect) must return {result, bytes} for the given
 * stage-coordinate rect (provided by the probe's GI capture core).
 */
/**
 * Render fixture cards on the stage, one boot for all of them.
 * Determinism is pinned PER CARD (clock + LCG reset before each state
 * is built): the blessed shell goldens are their own truth, so a bless
 * must not depend on which slugs were rendered before it or in what
 * order -- each slug's pixels are a pure function of its fixture.
 * The per-card pin IS that guarantee; slug lists may be sliced freely.
 * Each card is destroyed before the next; captureRegion(rect, pngPath)
 * saves it (the probe's GI capture core).
 */
export async function renderCards(slugs, cssPath, pngFor, captureRegion) {
    const weather = await import('./weather.js');
    const moon = await import('./moon.js');
    const REG = allFixtures(weather, moon);   // pure math: no stream use
    if (slugs.length === 1 && slugs[0] === 'all')
        slugs = Object.keys(REG);             // registry order is stable
    for (const slug of slugs)
        if (!REG[slug])
            throw new Error(`unknown fixture '${slug}' (registry has `
                + `${Object.keys(REG).length} slugs)`);

    // the harness ground: an OPAQUE wrapper fills the card's rect, so
    // the rounded-corner cutouts show a constant, not shell chrome --
    // the topbar and the time-keyed background gradient both drift
    // between boots and were bleeding into the corners (sf-sunset's
    // golden-hour pixels sat right at a delta-8 rounding boundary and
    // flipped between two states). Accent cards swap the ground colour
    // via their per-slug class: the stand-in for the theme popup ground
    // the canvas lab used, and CSS order guarantees the override.
    const css = await loadCss(cssPath, ['.wg-probe-host { background-color: #161616; }']
        .concat(slugs.map(slug => REG[slug].style === 'accent'
            ? `.wg-probe-ground-${slug.replace(/[^a-z0-9_-]/g, '-')} { background-color: ${REG[slug].session !== 'light'
                ? '#2f2f30' /* [0.185,0.185,0.19] */ : '#f5f5f7'}; }`
            : '')).filter(Boolean).join('\n'));

    const {ForecastPanel} = await import('./menu.js');
    const St = (await import('gi://St')).default;
    const Clutter = (await import('gi://Clutter')).default;

    const cards = {};
    for (const slug of slugs) {
        const fx = REG[slug];
        if (!Number.isFinite(fx.ms ?? Date.parse(fx.local)))
            throw new Error(`fixture '${slug}' has a non-finite instant`);
        // determinism pinned FRESH per card
        const ms = Math.floor(fx.ms ?? Date.parse(fx.local));
        Date.now = () => ms;
        let s = 1337 >>> 0;
        Math.random = () => {
            s = (s * 1664525 + 1013904223) >>> 0;
            return s / 4294967296;
        };
        const steps = {};
        const panel = new ForecastPanel({animate: false});
        panel.setPlaceName(fx.city);
        // canvas default is animated (a frozen STATIC_TIME frame with
        // animate:false: _time seeded once from the PINNED stream, and
        // the ticker never starts) -- the default here must match
        panel.setStyle(fx.style ?? 'animated');
        panel.setDark(fx.session !== 'light');
        panel.setAccent([0.208, 0.518, 0.894]);   // #3584e4, as the extension does
        panel.setCondPos('bottom');
        panel.setHourFormat(false);
        // the SHIPPED default: extension.js calls setEmboss(get_boolean(
        // 'text-emboss')) and text-emboss defaults false -> .aw-flat kills
        // the inherited .aw-content text-shadow. A settings-free harness
        // left the class default (_emboss=true) in place and every golden
        // was blessed wearing a preference that is OFF by default -- the
        // phantom "emboss on black text" that ships nothing.
        panel.setEmboss(false);
        const host = new St.Widget({
            style_class: ['wg-probe-host',
                fx.style === 'accent'
                    ? `wg-probe-ground-${slug.replace(/[^a-z0-9_-]/g, '-')}` : null]
                .filter(Boolean).join(' '),
            layout_manager: new Clutter.BinLayout(),
        });
        host.add_child(panel.actor);
        Main.uiGroup.add_child(host);
        host.set_position(100, 120);   // clear of the topbar's shadow edge
        panel.render(buildState(weather, moon, fx));
        steps.rendered = true;

        await wait(400);        // one layout + several paint cycles
        const [x, y] = host.get_transformed_position();
        const [w, h] = host.get_transformed_size();
        // virtual monitors are scale-1; St widgets may not expose
        // get_scale_factor at all -- treat absence as 1.
        const scale = host.get_scale_factor?.() ?? 1;
        const rect = [Math.round(x * scale), Math.round(y * scale),
            Math.round(w * scale), Math.round(h * scale)];
        steps.cardRect = rect;

        const cap = await captureRegion(rect, pngFor(slug));
        steps.capture = cap.result;
        steps.bytes = cap.bytes ?? null;

        host.destroy();         // BinLayout owns panel.actor; one destroy
        cards[slug] = steps;
    }
    return {css: css.attempts, cards};
}
