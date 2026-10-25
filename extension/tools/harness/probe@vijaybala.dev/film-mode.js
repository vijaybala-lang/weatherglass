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
    Object.assign(REG, {
        'demo-berlin-sunny': {...berlinDay,
            local: '2026-06-29T13:00+02:00', condition: 'clear'},
        'demo-berlin-rain': {...berlinDay,
            local: '2026-06-29T16:10+02:00', condition: 'rain'},
        'demo-berlin-golden': {...berlinDay, ms: berlinSunset - 12 * 60000,
            tzMin: 120, condition: 'clear'},
        'demo-berlin-fullmoon': {...berlinDay,
            local: '2026-06-29T23:30+02:00', condition: 'clear'},
    });
    const fx = REG[fixture];
    if (!fx)
        throw new Error(`film fixture '${fixture}' not in the `
            + `${Object.keys(REG).length}-slug registry`);
    const sheet = beats.slice().sort((a, b) => a.t - b.t);
    for (const b of sheet)
        if (!Number.isFinite(b.t) || !['open', 'metric', 'day', 'close'].includes(b.do))
            throw new Error(`bad beat: ${JSON.stringify(b)}`);

    const css = await loadCss(cssPath, '.wg-probe-host { background-color: #161616; }');

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

    const panel = new ForecastPanel({animate: true});
    panel.setPlaceName(fx.city);
    panel.setStyle(fx.style ?? 'animated');
    panel.setDark(fx.session !== 'light');
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
    const state = buildState(weather, moon, fx);
    extendHourlyForAllDays(state, weather, fx);
    panel.render(state);

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
        }
    };

    const t0 = GLib.get_monotonic_time();
    const endMs = sheet[sheet.length - 1].t * 1000 + FADE_MS + TAIL_MS;
    const frames = [];
    let bi = 0;
    for (;;) {
        const now = (GLib.get_monotonic_time() - t0) / 1000;
        while (bi < sheet.length && sheet[bi].t * 1000 <= now)
            runBeat(sheet[bi++]);
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
