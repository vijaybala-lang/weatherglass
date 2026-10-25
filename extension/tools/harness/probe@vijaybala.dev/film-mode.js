/* film-mode -- stage 3 of the tier-2 harness: cast the EGO demo video
 * headlessly (issue #60). DEV ONLY, never packaged.
 *
 * This is the golden machine put on a timer. The SAME ForecastPanel the
 * golden lock certifies -- same menu.js/chart/sky code from the working
 * tree, same fixture-forced clock + weather (buildState imported from
 * card-mode, not re-implemented) -- stays alive on the stage while a
 * scripted beat sheet fires on the shell's own clock and every ~33 ms
 * one frame lands as a PNG through the in-process composite chain.
 *
 * The honesty contract is the goldens' own: only the SCENE is a fixture;
 * the animation TIMING is real. Chart morphs (420 ms GLib timeline), the
 * sky ticker and the fades run on the live nested frame clock while the
 * main loop pumps -- nothing here steps a fake clock. Beats drive the
 * panel by DIRECT calls (_selectMetric / _selectDay), never synthetic
 * input -- the same door card-mode already uses.
 *
 * "open" / "close" fade the harness host actor (GLib-timeout ticks, the
 * mechanism menu.js itself uses for morphs): the shell's own popup-menu
 * chrome is out of scope -- the card-region framing matches the goldens.
 *
 * Frame cadence is nominal: a capture slower than FRAME_MS shifts later
 * frames (recorded per-frame `t` shows the truth), which the encoded
 * video plays back slightly fast -- reported, never hidden. */

import GLib from 'gi://GLib';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import { allFixtures, buildState, loadCss } from './card-mode.js';

const FRAME_MS = 33;     // ~30 fps capture cadence (encode: -framerate 30)
const FADE_MS = 240;     // open/close fade duration (visible tail in the film)
const TAIL_MS = 60;      // grace after the final fade before the last frame

const wait = ms => new Promise(r => GLib.timeout_add(GLib.PRIORITY_DEFAULT, ms,
    () => (r(), GLib.SOURCE_REMOVE)));

/* card-mode's buildData only synthesises the first 24h (day 0). Film mode
 * taps future day tiles (beat 4 -> day #2), so extend state.hourly across
 * all 8 daily dates using a local LCG that leaves Math.random untouched. */
function extendHourlyForAllDays(state, weather, fx) {
    const ms = fx.ms ?? Date.parse(fx.local);
    const wall = fx.tzMin !== undefined ? fx.tzMin * 60000 : (() => {
        const m = (fx.local ?? '').match(/([+-])(\d{2}):(\d{2})$/);
        return m ? (m[1] === '-' ? -1 : 1) * (+m[2] * 60 + +m[3]) * 60000 : 0;
    })();
    const p = n => String(n).padStart(2, '0');
    const stampHour = t => {
        const d = new Date(t + wall);
        return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}`
            + `T${p(d.getUTCHours())}:00`;
    };
    const dailyByDate = new Map(state.daily.map(d => [d.date, d]));
    let r = 24681357 >>> 0;
    const rand = () => {
        r = (r * 1664525 + 1013904223) >>> 0;
        return r / 4294967296;
    };
    for (let h = 24; h < 24 * 9; h += 24) {
        const raw = [];
        for (let k = 0; k < 24; k++) {
            const when = ms + (h + k) * 3600000;
            const alt = weather.sunGeometry(fx.lat, fx.lon, when).altitude;
            raw.push({when, s: Math.sin((alt + 5) / 95 * Math.PI / 2)});
        }
        const sMin = Math.min(...raw.map(x => x.s));
        const sSpan = Math.max(1e-6, Math.max(...raw.map(x => x.s)) - sMin);
        for (const {when, s} of raw) {
            const isoHour = stampHour(when);
            const dayEntry = dailyByDate.get(isoHour.slice(0, 10))
                ?? state.daily[Math.min(state.daily.length - 1, Math.floor(h / 24))];
            const diurnal = (s - sMin) / sSpan;
            const temp = +(dayEntry.tmin + (dayEntry.tmax - dayEntry.tmin) * diurnal).toFixed(1);
            const code = dayEntry.code;
            const wet = code >= 51 && code <= 99;
            const precip = wet ? 35 + Math.round(rand() * 50)
                : code >= 2 ? 5 + Math.round(rand() * 20)
                : Math.round(rand() * 8);
            const wind = 6 + Math.round(rand() * 14);
            state.hourly.time.push(isoHour);
            state.hourly.temp.push(temp);
            state.hourly.precipProb.push(precip);
            state.hourly.wind.push(wind);
            state.hourly.code.push(code);
        }
    }
}

/**
 * Shoot the demo film for one fixture + beat sheet.
 * beats: [{t, do, arg}] -- t in seconds from enable(); `do` is one of
 * open | metric | day | close. captureRegion(rect, pngPath) saves one
 * frame (the probe's GI capture core, primed by the layout wait below).
 * Returns {css, rect, endMs, frames[], wallMs, failures[]}.
 */
export async function shootFilm({fixture, beats, cssPath, pngFor, captureRegion}) {
    const weather = await import('./weather.js');
    const moon = await import('./moon.js');
    const REG = allFixtures(weather, moon);
    // Film-only one-day Berlin sequence for weather-transition demos.
    // 2026-06-29 has a 99.98%-illuminated moon at 23:30 local; the
    // golden frame is derived from that day's actual sunset.
    const berlinDay = {city: 'Berlin', lat: 52.52, lon: 13.4};
    const berlinSunset = weather.sunGeometry(berlinDay.lat, berlinDay.lon,
        Date.parse('2026-06-29T12:00+02:00')).sunset;
    const sfSunset = weather.sunGeometry(37.77, -122.42,
        Date.parse('2026-10-07T12:00-07:00')).sunset;
    const vanSunset = weather.sunGeometry(49.28, -123.12,
        Date.parse('2026-10-07T12:00-07:00')).sunset;
    const mtlSunset = weather.sunGeometry(45.50, -73.57,
        Date.parse('2026-11-15T12:00-05:00')).sunset;
    const osloSunset = weather.sunGeometry(59.91, 10.75,
        Date.parse('2026-11-10T12:00+01:00')).sunset;
    Object.assign(REG, {
        'demo-berlin-sunny': {...berlinDay,
            local: '2026-06-29T13:00+02:00', condition: 'clear'},
        'demo-berlin-rain': {...berlinDay,
            local: '2026-06-29T16:10+02:00', condition: 'rain'},
        'demo-berlin-golden': {...berlinDay, ms: berlinSunset - 12 * 60000,
            tzMin: 120, condition: 'clear'},
        'demo-berlin-fullmoon': {...berlinDay,
            local: '2026-06-29T23:30+02:00', condition: 'clear'},
        // World-tour showcase fixtures (--world flag in tools/film.sh):
        // Covers all 16 supported weather conditions across Day, Golden Hour,
        // and Night, plus Solid & Accent styles in Dark and Light themes.
        // 1. Day (7 conditions: clear, wind, partly, drizzle, rain, showers, hail)
        'world-cairo-clear-day': {city: 'Cairo', lat: 30.04, lon: 31.24,
            local: '2026-06-21T13:15+03:00', condition: 'clear', worldClock: true},
        'world-sydney-wind-day': {city: 'Sydney', lat: -33.87, lon: 151.21,
            local: '2026-11-14T14:30+11:00', condition: 'wind', worldClock: true},
        'world-rio-partly-day': {city: 'Rio de Janeiro', lat: -22.91, lon: -43.17,
            local: '2026-10-12T11:45-03:00', condition: 'partly', worldClock: true},
        'world-london-drizzle-day': {city: 'London', lat: 51.51, lon: -0.13,
            local: '2026-10-14T13:50+01:00', condition: 'drizzle', worldClock: true},
        'world-berlin-rain-day': {city: 'Berlin', lat: 52.52, lon: 13.4,
            local: '2026-10-18T14:10+02:00', condition: 'rain', worldClock: true},
        'world-mumbai-showers-day': {city: 'Mumbai', lat: 19.08, lon: 72.88,
            local: '2026-07-22T15:20+05:30', condition: 'showers', worldClock: true},
        'world-zurich-hail-day': {city: 'Zurich', lat: 47.37, lon: 8.54,
            local: '2026-07-12T16:15+02:00', condition: 'hail', worldClock: true},
        // 2. Golden Hour (4 conditions: cloud, fog, freezing, sleet)
        'world-sf-cloud-golden': {city: 'San Francisco', lat: 37.77, lon: -122.42,
            ms: sfSunset - 12 * 60000, tzMin: -420, condition: 'cloud', worldClock: true},
        'world-vancouver-fog-golden': {city: 'Vancouver', lat: 49.28, lon: -123.12,
            ms: vanSunset - 10 * 60000, tzMin: -420, condition: 'fog', worldClock: true},
        'world-montreal-freezing-golden': {city: 'Montreal', lat: 45.50, lon: -73.57,
            ms: mtlSunset - 10 * 60000, tzMin: -300, condition: 'freezing', worldClock: true},
        'world-oslo-sleet-golden': {city: 'Oslo', lat: 59.91, lon: 10.75,
            ms: osloSunset - 10 * 60000, tzMin: 60, condition: 'sleet', worldClock: true},
        // 3. Night (5 conditions: snow, grains, snowshowers, storm, clear full-moon, unknown)
        'world-reykjavik-snow-night': {city: 'Reykjavik', lat: 64.15, lon: -21.94,
            local: '2027-01-19T21:20+00:00', condition: 'snow', worldClock: true},
        'world-anchorage-grains-night': {city: 'Anchorage', lat: 61.22, lon: -149.90,
            local: '2027-01-22T22:05-09:00', condition: 'grains', worldClock: true},
        'world-sapporo-snowshowers-night': {city: 'Sapporo', lat: 43.06, lon: 141.35,
            local: '2027-01-25T22:40+09:00', condition: 'snowshowers', worldClock: true},
        'world-tokyo-storm-night': {city: 'Tokyo', lat: 35.68, lon: 139.69,
            local: '2026-08-14T23:15+09:00', condition: 'storm', worldClock: true},
        'world-santiago-moon-night': {city: 'Santiago', lat: -33.45, lon: -70.67,
            local: '2026-06-29T23:30-04:00', condition: 'clear', worldClock: true},
        'world-ushuaia-unknown-night': {city: 'Ushuaia', lat: -54.80, lon: -68.30,
            local: '2026-08-03T23:50-03:00', condition: 'unknown', worldClock: true},
        // 4. Themed Dark & Light (solid dark/light + accent dark/light)
        'world-theme-solid-dark': {city: 'Edinburgh', lat: 55.95, lon: -3.19,
            local: '2026-10-18T20:45+01:00', condition: 'rain',
            style: 'solid', session: 'dark', worldClock: true},
        'world-theme-solid-light': {city: 'Paris', lat: 48.86, lon: 2.35,
            local: '2026-07-03T13:20+02:00', condition: 'clear',
            style: 'solid', session: 'light', worldClock: true},
        'world-theme-accent-dark': {city: 'Stockholm', lat: 59.33, lon: 18.07,
            local: '2026-11-20T21:10+01:00', condition: 'snow',
            style: 'accent', session: 'dark', worldClock: true},
        'world-theme-accent-light': {city: 'Copenhagen', lat: 55.68, lon: 12.57,
            local: '2026-05-18T11:45+02:00', condition: 'partly',
            style: 'accent', session: 'light', worldClock: true},
    });
    const fx = REG[fixture];
    if (!fx)
        throw new Error(`film fixture '${fixture}' not in the `
            + `${Object.keys(REG).length}-slug registry`);
    const sheet = beats.slice().sort((a, b) => a.t - b.t);
    for (const b of sheet)
        if (!Number.isFinite(b.t) || !['open', 'metric', 'day', 'fixture', 'close'].includes(b.do))
            throw new Error(`bad beat: ${JSON.stringify(b)}`);

    const css = await loadCss(cssPath, [
        '.wg-probe-host { background-color: #161616; }',
        '.wg-probe-accent-dark { background-color: #2f2f30; border-radius: 14px; }',
        '.wg-probe-accent-light { background-color: #f5f5f7; border-radius: 14px; }',
    ].join('\n'));

    const {ForecastPanel} = await import('./menu.js');
    const St = (await import('gi://St')).default;
    const Clutter = (await import('gi://Clutter')).default;

    // determinism pinned exactly like a golden card (LCG 1337 + pinned
    // Date.now) -- the SAME instant the cov-clear-night golden renders,
    // so a reviewer can hold any open frame against the blessed still.
    const ms = Math.floor(fx.ms ?? Date.parse(fx.local));
    Date.now = () => ms;
    let s = 1337 >>> 0;
    Math.random = () => {
        s = (s * 1664525 + 1013904223) >>> 0;
        return s / 4294967296;
    };

    const applyFixtureState = (targetFx, initial = false) => {
        const targetMs = Math.floor(targetFx.ms ?? Date.parse(targetFx.local));
        Date.now = () => targetMs;
        s = 1337 >>> 0;
        panel._shadeCache = {minute: -1, glow: 0, solar: null};
        panel._day = 0;
        if (panel._morphId) {
            GLib.source_remove(panel._morphId);
            panel._morphId = 0;
        }
        panel._shown = [];
        panel.setPlaceName(targetFx.city);
        const isDark = targetFx.session !== 'light';
        panel.setDark(isDark);
        panel.setShellDark(isDark);
        const style = targetFx.style ?? 'animated';
        panel.setStyle(style);
        panel.actor.remove_style_class_name('wg-probe-accent-dark');
        panel.actor.remove_style_class_name('wg-probe-accent-light');
        if (style === 'accent') {
            panel.actor.add_style_class_name(
                isDark ? 'wg-probe-accent-dark' : 'wg-probe-accent-light');
        }
        const st = buildState(weather, moon, targetFx);
        extendHourlyForAllDays(st, weather, targetFx);
        if (st.currentIso)
            st.currentIso = st.currentIso.replace(/(?:Z|[+-]\d{2}:\d{2})$/, '');
        if (!initial && (targetFx.condition === 'storm' || targetFx.condition === 'hail'))
            panel._skyArea._time = 0.25;
        panel.render(st);
        panel._applyTextInk();
    };

    const panel = new ForecastPanel({animate: true});
    panel.setAccent([0.208, 0.518, 0.894]);
    panel.setCondPos('bottom');
    panel.setHourFormat(false);
    panel.setEmboss(false);
    const host = new St.Widget({
        style_class: 'wg-probe-host',
        layout_manager: new Clutter.BinLayout(),
    });
    panel.actor.opacity = 0;            // the menu opens on the first beat; host stays opaque (#161616)
    host.add_child(panel.actor);
    Main.uiGroup.add_child(host);
    host.set_position(100, 120);        // clear of the topbar's shadow edge
    applyFixtureState(fx, true);

    await wait(500);       // one layout + several paint cycles (card mode's 400 + headroom):
                           // also primes the first composited frame

    const [x, y] = host.get_transformed_position();
    const [w, h] = host.get_transformed_size();
    const scale = host.get_scale_factor?.() ?? 1;
    const rect = [Math.round(x * scale), Math.round(y * scale),
        Math.round(w * scale), Math.round(h * scale)];

    const failures = [];
    // fade = GLib-timeout ticks into actor opacity -- the same live-clock
    // mechanism menu.js._morphTo uses; it advances while captures await.
    const fade = async (from, to) => {
        const t0 = GLib.get_monotonic_time();
        for (;;) {
            const p = Math.min(1, (GLib.get_monotonic_time() - t0) / (FADE_MS * 1000));
            panel.actor.opacity = Math.round(from + (to - from) * p);
            if (p >= 1)
                return;
            await wait(16);
        }
    };
    const runBeat = b => {
        switch (b.do) {
        case 'open':
            fade(0, 255).catch(e => failures.push(`open: ${e.message}`));
            break;
        case 'close':
            fade(255, 0).catch(e => failures.push(`close: ${e.message}`));
            break;
        case 'metric':
            panel._selectMetric(b.arg);
            break;
        case 'day':
            panel._selectDay(Number(b.arg));
            break;
        case 'fixture': {
            const nextFx = REG[b.arg];
            if (!nextFx)
                failures.push(`unknown fixture: ${b.arg}`);
            else
                applyFixtureState(nextFx, false);
            break;
        }
        }
    };

    const t0 = GLib.get_monotonic_time();
    const endMs = sheet[sheet.length - 1].t * 1000 + FADE_MS + TAIL_MS;
    const frames = [];
    let bi = 0;
    for (;;) {
        const now = (GLib.get_monotonic_time() - t0) / 1000;
        let switchedFixture = false;
        while (bi < sheet.length && sheet[bi].t * 1000 <= now) {
            if (sheet[bi].do === 'fixture')
                switchedFixture = true;
            runBeat(sheet[bi++]);
        }
        if (switchedFixture)
            await wait(40);
        if (now >= endMs)
            break;
        const cap = await captureRegion(rect, pngFor(frames.length));
        if (cap.result !== 'ok') {
            failures.push(`frame ${frames.length}: capture ${cap.result}`);
            break;
        }
        frames.push({f: frames.length, t: Math.round(now),
            bytes: cap.bytes ?? null});
        const lag = Math.round(frames.length * FRAME_MS
            - (GLib.get_monotonic_time() - t0) / 1000);
        if (lag > 0)
            await wait(lag);
    }
    const wallMs = Math.round((GLib.get_monotonic_time() - t0) / 1000);

    host.destroy();        // BinLayout owns panel.actor; one destroy
    return {css: css.attempts, rect, endMs: Math.round(endMs),
        frames, wallMs, failures};
}
