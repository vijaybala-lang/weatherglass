/* weather.js — Open-Meteo client (no API key) + WMO code mapping. */

import GLib from 'gi://GLib';
import Soup from 'gi://Soup';
import {_, N_} from './i18n.js';

const API = 'https://api.open-meteo.com/v1/forecast';
const GEO = 'https://geocoding-api.open-meteo.com/v1/search';
const IPINFO = 'https://ipinfo.io/json';
// MET Norway (Norwegian Meteorological Institute), keyless, global;
// strict about identifying User-Agents (403 otherwise)
const MET = 'https://api.met.no/weatherapi/locationforecast/2.0/complete';
const NWS = 'https://api.weather.gov';

/* ── WMO 4677 weather codes → description + animation scene ─────────────── */

export const WMO = {
    0:  {desc: N_('Clear sky'),        day: 'sun',    night: 'moon'},
    1:  {desc: N_('Mainly clear'),     day: 'sun',    night: 'moon'},
    2:  {desc: N_('Partly cloudy'),    day: 'partly', night: 'partly'},
    3:  {desc: N_('Overcast'),         day: 'cloud',  night: 'cloud'},
    45: {desc: N_('Fog'),              day: 'fog',    night: 'fog'},
    48: {desc: N_('Rime fog'),         day: 'fog',    night: 'fog'},
    51: {desc: N_('Light drizzle'),    day: 'rain',   night: 'rain'},
    53: {desc: N_('Drizzle'),          day: 'rain',   night: 'rain'},
    55: {desc: N_('Dense drizzle'),    day: 'rain',   night: 'rain'},
    56: {desc: N_('Freezing drizzle'), day: 'sleet',  night: 'sleet'},
    57: {desc: N_('Freezing drizzle'), day: 'sleet',  night: 'sleet'},
    61: {desc: N_('Light rain'),       day: 'rain',   night: 'rain'},
    63: {desc: N_('Rain'),             day: 'rain',   night: 'rain'},
    65: {desc: N_('Heavy rain'),       day: 'rain',   night: 'rain'},
    66: {desc: N_('Freezing rain'),    day: 'sleet',  night: 'sleet'},
    67: {desc: N_('Freezing rain'),    day: 'sleet',  night: 'sleet'},
    71: {desc: N_('Light snow'),       day: 'snow',   night: 'snow'},
    73: {desc: N_('Snow'),             day: 'snow',   night: 'snow'},
    75: {desc: N_('Heavy snow'),       day: 'snow',   night: 'snow'},
    77: {desc: N_('Snow grains'),      day: 'snow',   night: 'snow'},
    80: {desc: N_('Light showers'),    day: 'rain',   night: 'rain'},
    81: {desc: N_('Showers'),          day: 'rain',   night: 'rain'},
    82: {desc: N_('Violent showers'),  day: 'rain',   night: 'rain'},
    85: {desc: N_('Snow showers'),     day: 'snow',   night: 'snow'},
    86: {desc: N_('Heavy snow showers'), day: 'snow', night: 'snow'},
    95: {desc: N_('Thunderstorm'),     day: 'storm',  night: 'storm'},
    96: {desc: N_('Thunderstorm, hail'), day: 'hail', night: 'hail'},
    99: {desc: N_('Thunderstorm, hail'), day: 'hail', night: 'hail'},
};

export function sceneFor(code, isDay = true) {
    const w = WMO[code] ?? {desc: N_('Unknown'), day: 'cloud', night: 'cloud'};
    return {scene: isDay ? w.day : w.night, desc: _(w.desc)};
}

/**
 * Pick the animated scene from the WMO code PLUS raw physical variables.
 * Open-Meteo's code derivation almost never emits fog (45/48), thunder (95)
 * or hail (96/99) — measured across live forecasts and reanalysis — so we
 * trust the underlying data too:
 *   fog  : visibility < 1 km while it isn't precipitating
 *   storm: CAPE >= 1200 J/kg with liquid precipitation (embedded convection)
 *   hail : CAPE >= 2500 J/kg with liquid precipitation (severe convection)
 */
export function deriveScene(current) {
    const {code, visibility, cape, isDay} = current;
    const liquid = code >= 51 && code <= 82;   // drizzle … showers
    if (code === 96 || code === 99 || (cape >= 2500 && liquid))
        return {scene: 'hail', desc: _('Thunderstorm, hail')};
    if (code === 95 || (cape >= 1200 && liquid))
        return {scene: 'storm', desc: _('Thunderstorm')};
    if (code === 45 || code === 48)
        return sceneFor(code, isDay);
    if (visibility !== null && visibility < 1000 && !liquid)
        return {scene: 'fog', desc: _('Fog')};
    return sceneFor(code, isDay);
}

/* ── formatting helpers ─────────────────────────────────────────────────── */

const WIND_DIRS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE',
                   'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];

export function windDir(deg) {
    return WIND_DIRS[Math.round(deg / 22.5) % 16];
}

export function fmtTemp(c, units) {
    const v = units === 'imperial' ? c * 9 / 5 + 32 : c;
    return `${Math.round(v)}°`;
}

export function tempUnit(units) {
    return units === 'imperial' ? '°F' : '°C';
}

export function fmtWind(kmh, units) {
    if (units === 'imperial')
        return `${Math.round(kmh * 0.621371)} mph`;
    return `${Math.round(kmh)} km/h`;
}

const DAYS = [N_('Sun'), N_('Mon'), N_('Tue'), N_('Wed'),
              N_('Thu'), N_('Fri'), N_('Sat')];

/** 'YYYY-MM-DD' → short weekday, localized (UTC parse keeps the date
 *  itself zone-independent; the msgids are the three-letter English
 *  abbreviations, translated to the locale's usual short weekday). */
export function dayName(iso) {
    const [y, m, d] = iso.split('-').map(Number);
    return _(DAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]);
}

/** '2026-09-25T06:08' → '06:08', or 'HH:MM' as-is. */
export function fmtTime(iso) {
    return iso && iso.includes('T') ? iso.slice(11, 16) : (iso ?? '');
}

/**
 * Hourly-array indices covering ~24 points for the chart. Today starts at
 * the CURRENT hour and runs a full 24h ROLLING WINDOW into tomorrow (like
 * the mockup's slice(16, 40)) — a mere "rest of today" slice would leave a
 * 6-point flat line in the evening. Today's window backfills 2 h before now
 * (clamped at midnight, whose hourly data the API always returns) so the
 * "now" marker isn't glued to the chart's left edge. Other days run
 * midnight to midnight.
 * Comparison is on ISO strings (zero-padded) — no Date parsing, no tz traps.
 */
const NOW_BACKFILL = 2;

export function daySlice(hourly, daily, dayIndex, nowIso) {
    if (dayIndex === 0 && nowIso) {
        const hour = nowIso.slice(0, 13);                     // 'YYYY-MM-DDTHH'
        const at = hourly.time.findIndex(t => t.slice(0, 13) === hour);
        if (at >= 0) {
            const start = Math.max(0, at - NOW_BACKFILL);
            const idx = [];
            for (let i = start; i < Math.min(start + 24, hourly.time.length); i++)
                idx.push(i);
            return idx;
        }
    }
    const key = daily[dayIndex]?.date ?? '';
    const idx = [];
    for (let i = 0; i < hourly.time.length; i++)
        if (hourly.time[i].startsWith(key))
            idx.push(i);
    return idx.slice(0, 24);
}

/** Where the current hour sits inside a daySlice as a 0..1 fraction of the
 *  chart's x axis (matches chart.js X(i) = i/(n-1)); null if outside. */
export function nowFracIn(hourly, idx, nowIso) {
    if (!nowIso || !idx || idx.length < 2)
        return null;
    const hour = nowIso.slice(0, 13);
    const at = idx.indexOf(hourly.time.findIndex(t => t.slice(0, 13) === hour));
    return at < 0 ? null : at / (idx.length - 1);
}

/* ── HTTP ────────────────────────────────────────────────────────────────── */

function qs(params) {
    return Object.entries(params)
        .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
        .join('&');
}

function get(url) {
    return new Promise((resolve, reject) => {
        const session = new Soup.Session({
            // MET Norway rejects generic agents (403); include identification
            // and a contact per their usage policies
            user_agent: 'gnome-shell-weatherglass/1.0 ' +
                        '(GNOME Shell extension; contact: vijaybala-lang@users.noreply.github.com)',
            timeout: 15,
        });
        const msg = Soup.Message.new('GET', url);
        if (!msg) {
            reject(new Error(`bad url: ${url}`));
            return;
        }
        session.send_and_read_async(msg, GLib.PRIORITY_DEFAULT, null,
                                    (sess, res) => {
            try {
                const bytes = sess.send_and_read_finish(res);
                if (msg.get_status() !== 200) {
                    reject(new Error(`HTTP ${msg.get_status()}`));
                    return;
                }
                resolve(JSON.parse(new TextDecoder().decode(bytes.get_data())));
            } catch (e) {
                reject(e);
            } finally {
                session.abort();
            }
        });
    });
}

/* ── provider adapters ─────────────────────────────────────────────────────
 *
 * The UI (icon, sky, menu, charts) consumes exactly ONE normalized shape,
 * whichever provider answered:
 *
 *   {
 *     current: {temp °C, feels °C, code WMO-int, isDay, humidity %,
 *               precip mm/h, wind km/h, windDeg, uv, visibility m|null,
 *               cape J/kg|null, intensity mm/h,
 *               timeIso 'YYYY-MM-DDTHH:mm' in the forecast's own tz},
 *     daily:   [{date, code, tmax, tmin, precipProb %, sunrise, sunset,
 *               uv, windMax}],
 *     hourly:  {time: ['YYYY-MM-DDTHH:00' local…], temp: [°C…],
 *               precipProb: [%…], wind: [km/h…], code: [WMO-int…],
 *               isDay: [bool…]},
 *     detectedName, latitude, longitude
 *   }
 *
 * Adding a service = subclass WeatherProvider, implement forecast()/
 * parse(), register it in REGISTRY below, and add the id to the
 * gsettings 'provider' enum + the preferences combo. Nothing else
 * in the extension needs to know a provider exists.
 */

class WeatherProvider {
    constructor(id, name, attribution = '') {
        this.id = id;
        this.name = name;
        this.attribution = attribution;
    }

    /** Fetch + normalize. Subclasses must implement. */
    async forecast({latitude, longitude, days}) {   // eslint-disable-line no-unused-vars
        throw new Error(`${this.id}: forecast() not implemented`);
    }

    /** raw JSON → normalized {current, daily, hourly} (pure: unit-testable). */
    parse(raw, {days} = {}) {                       // eslint-disable-line no-unused-vars
        throw new Error(`${this.id}: parse() not implemented`);
    }
}

/* ── Open-Meteo (default) ────────────────────────────────────────────────── */

export class OpenMeteoProvider extends WeatherProvider {
    constructor() {
        super('open-meteo', 'Open-Meteo', ' Forecast by Open-Meteo.com (CC BY 4.0)');
    }

    async forecast({latitude, longitude, days = 8, model}) {
        const params = {
            latitude,
            longitude,
            current: [
                'temperature_2m', 'relative_humidity_2m', 'apparent_temperature',
                'is_day', 'precipitation', 'weather_code', 'cloud_cover',
                'wind_speed_10m', 'wind_direction_10m', 'uv_index',
                // physical proxies: WMO codes almost never report fog or
                // storms, but these two variables catch them reliably
                'visibility', 'cape',
            ].join(','),
            hourly: [
                'temperature_2m', 'precipitation_probability',
                'wind_speed_10m', 'weather_code', 'is_day',
            ].join(','),
            daily: [
                'weather_code', 'temperature_2m_max', 'temperature_2m_min',
                'precipitation_probability_max', 'sunrise', 'sunset',
                'uv_index_max', 'wind_speed_10m_max',
            ].join(','),
            timezone: 'auto',
            forecast_days: days,
            // canonical units are always metric; the formatters convert for
            // display, so all internal math (wind threshold, rain slant,
            // drop density) works on one set of units
            temperature_unit: 'celsius',
            wind_speed_unit: 'kmh',
        };
        /* best_match is Open-Meteo's regional pick and the API default, so
         * it needs no param at all — and asking explicitly for a model the
         * region doesn't offer is an HTTP 400, not a fallback. Anything the
         * endpoint rejects (typo, retired model) is retried once bare, so a
         * stale gsettings value degrades to best_match instead of an empty
         * card. */
        if (model && model !== 'best_match') {
            params.models = model;
            try {
                return this.parse(await get(`${API}?${qs(params)}`));
            } catch (e) {
                delete params.models;
                return this.parse(await get(`${API}?${qs(params)}`));
            }
        }
        const raw = await get(`${API}?${qs(params)}`);
        return this.parse(raw);
    }

    parse(raw) {
        const c = raw.current;
        const d = raw.daily;
        const h = raw.hourly;
        const current = {
            temp: c.temperature_2m,
            feels: c.apparent_temperature,
            code: c.weather_code,
            isDay: !!c.is_day,
            humidity: c.relative_humidity_2m,
            precip: c.precipitation ?? 0,
            wind: c.wind_speed_10m,          // always km/h
            windDeg: c.wind_direction_10m,
            uv: c.uv_index ?? null,
            visibility: c.visibility ?? null,   // metres
            cape: c.cape ?? null,               // J/kg convective available energy
            // mm/h always (API called with metric); drives drop/flake density
            intensity: c.precipitation ?? 0,
            // 'YYYY-MM-DDTHH:30' in the forecast location's own timezone —
            // compare against hourly.time, never the machine clock, so the
            // "now" marker is right even if shell TZ and city TZ disagree
            timeIso: c.time ?? '',
        };

        const daily = (d.time ?? []).map((date, i) => ({
            date,
            code: d.weather_code[i],
            tmax: d.temperature_2m_max[i],
            tmin: d.temperature_2m_min[i],
            precipProb: d.precipitation_probability_max[i] ?? 0,
            sunrise: d.sunrise[i],
            sunset: d.sunset[i],
            uv: d.uv_index_max[i] ?? 0,
            windMax: d.wind_speed_10m_max[i] ?? 0,
        }));

        const hourly = {
            time: h?.time ?? [],
            temp: h?.temperature_2m ?? [],
            precipProb: h?.precipitation_probability ?? [],
            wind: h?.wind_speed_10m ?? [],
            code: h?.weather_code ?? [],
            isDay: (h?.is_day ?? []).map(v => !!v),
        };

        return {current, daily, hourly};
    }
}

/* ── MET Norway (api.met.no locationforecast 2.0, complete mode) ─────────── */

/**
 * AGNOS symbol_code → closest WMO 4677 code, so every provider lands in
 * the one scene vocabulary (see WMO table above). MET only tags the clear
 * families with _day/_night; intensity uses light_/moderate_/heavy_ and
 * _showers/_periods modifiers.
 */
export function agnosToWmo(symbol) {
    const c = (symbol || '').replace(/_(?:day|night|polartwilight)$/, '');
    if (!c)
        return 3;                                   // unknown → overcast
    // AGNOS welds intensity INTO the family word (heavyrain, lightsnow,
    // rainshowersandthunder), so match families with includes(), storm
    // modifiers first, and the sleet/mixed families before plain precip
    const heavy = c.includes('heavy');
    const light = c.includes('light') || c.includes('lght');
    const shower = c.includes('shower') || c.includes('periods');
    if (c.includes('hail'))
        return c.includes('thunder') || heavy ? 99 : 96;
    if (c.includes('thunder'))
        return 95;
    if (c.includes('clearsky')) return 0;
    if (c.includes('fair')) return 1;
    if (c.includes('partlycloudy')) return 2;        // before plain cloudy
    if (c.includes('fog')) return 45;
    if (c.includes('cloudy')) return 3;
    if (c.includes('sleet') || c.includes('ice')
        || (c.includes('rain') && c.includes('snow')))
        return light ? 66 : 67;
    if (c.includes('drizzle')) return light ? 51 : heavy ? 55 : 53;
    if (c.includes('snow'))
        return shower ? (heavy ? 86 : 85) : (light ? 71 : heavy ? 75 : 73);
    if (c.includes('rain'))
        return shower ? (light ? 80 : heavy ? 82 : 81) : (light ? 61 : heavy ? 65 : 63);
    return 3;
}

/**
 * MET reports precipitation *amounts*, not probabilities — derive a 0-100 %
 * proxy: any measurable mm starts the curve high (it IS raining in the
 * forecast), saturation ~2 mm/h; dry hours fall back to cloud cover/4.
 */
export function precipProbFrom(amountMm, cloudPct = 0) {
    const mm = Number(amountMm) || 0;
    if (mm >= 0.05)
        return Math.min(100, Math.round(40 + 60 * (1 - Math.exp(-mm))));
    return Math.round(Math.min(40, (Number(cloudPct) || 0) * 0.4));
}

/** MET times are UTC 'Z'; the whole pipeline speaks the viewer's local
 *  naive ISO, so convert (auto-located users are always in their own tz).
 *  glib ≥ 2.84 renamed new_from_iso8601_string → new_from_iso8601(iso, tz). */
function localFromUtc(iso) {
    let dt = null;
    try {
        dt = GLib.DateTime.new_from_iso8601
            ? GLib.DateTime.new_from_iso8601(iso, null)
            : GLib.DateTime.new_from_iso8601_string?.(iso) ?? null;
    } catch (e) {
        dt = null;
    }
    if (!dt)
        return (iso || '').slice(0, 16).replace(' ', 'T');
    return dt.to_local().format('%Y-%m-%dT%H:%M');
}

/** _day/_night suffix where present, else a generous 06-21 local heuristic */
function isDayFromSymbol(symbol, hourLocal) {
    if (/_day$/.test(symbol || '')) return true;
    if (/_night$/.test(symbol || '')) return false;
    return hourLocal >= 6 && hourLocal < 21;
}

export class MetNorwayProvider extends WeatherProvider {
    constructor() {
        super('met-norway', 'MET Norway',
              'Forecast: MET Norway (CC BY-SA 4.0)');
    }

    async forecast({latitude, longitude, days = 8}) {
        // locationforecast covers ~9 days regardless; 4-decimal coords
        const url = `${MET}?lat=${Number(latitude).toFixed(4)}`
                  + `&lon=${Number(longitude).toFixed(4)}`;
        const raw = await get(url);
        return this.parse(raw, {days});
    }

    parse(raw, {days = 8} = {}) {
        const ts = raw?.properties?.timeseries ?? [];
        const hourly = {time: [], temp: [], precipProb: [], wind: [], code: [], isDay: []};
        const byDate = new Map();

        for (const t of ts) {
            const iso = localFromUtc(t.time);              // '…T21:00'
            const inst = t.data?.instant?.details ?? {};
            const n1 = t.data?.next_1_hours ?? {};
            const sym = n1?.summary?.symbol_code
                ?? t.data?.next_6_hours?.summary?.symbol_code
                ?? t.data?.next_12_hours?.summary?.symbol_code ?? '';
            const temp = inst.air_temperature ?? null;
            const prob = precipProbFrom(n1?.details?.precipitation_amount,
                                        inst.cloud_area_fraction);
            const wind = inst.wind_speed !== undefined ? inst.wind_speed * 3.6 : null;
            hourly.time.push(`${iso.slice(0, 13)}:00`);
            hourly.temp.push(temp);
            hourly.precipProb.push(prob);
            hourly.wind.push(wind);
            hourly.code.push(agnosToWmo(sym));
            hourly.isDay.push(isDayFromSymbol(sym, Number(iso.slice(11, 13))));

            // daily buckets over local dates; MET has no daily section
            const date = iso.slice(0, 10);
            let day = byDate.get(date);
            if (!day)
                byDate.set(date, day = {date, temps: [], probMax: 0, windMax: 0,
                                        uvMax: 0, syms: []});
            if (temp !== null)
                day.temps.push(temp);
            day.probMax = Math.max(day.probMax, prob);
            day.windMax = Math.max(day.windMax, wind ?? 0);
            day.uvMax = Math.max(day.uvMax, inst.ultraviolet_index_clear_sky ?? 0);
            day.syms.push({hour: Number(iso.slice(11, 13)), sym});
        }

        const daily = [...byDate.values()].slice(0, days).map(day => {
            // representative symbol: the hourly slot nearest local 13:00
            let best = null;
            for (const s of day.syms) {
                if (!s.sym)
                    continue;
                const near = Math.abs(s.hour - 13);
                if (!best || near < best.near)
                    best = {near, sym: s.sym};
            }
            return {
                date: day.date,
                code: agnosToWmo(best?.sym ?? ''),
                tmax: day.temps.length ? Math.max(...day.temps) : null,
                tmin: day.temps.length ? Math.min(...day.temps) : null,
                precipProb: day.probMax,
                sunrise: null, sunset: null,  // MET locationforecast has none
                uv: day.uvMax,                // (unused by the card anyway)
                windMax: day.windMax,
            };
        });

        // "current" = first timestep's instant; timeIso deliberately matches
        // hourly[0] so daySlice()/now-marker math stays consistent
        const fd = ts[0]?.data?.instant?.details ?? {};
        const n1 = ts[0]?.data?.next_1_hours ?? {};
        const sym = n1?.summary?.symbol_code ?? '';
        const current = {
            temp: fd.air_temperature ?? null,
            feels: fd.apparent_air_temperature ?? fd.air_temperature ?? null,
            code: agnosToWmo(sym),
            isDay: isDayFromSymbol(sym, Number(hourly.time[0]?.slice(11, 13))),
            humidity: fd.relative_humidity ?? 0,
            precip: n1?.details?.precipitation_amount ?? 0,
            wind: (fd.wind_speed ?? 0) * 3.6,
            windDeg: fd.wind_from_direction ?? 0,
            uv: fd.ultraviolet_index_clear_sky ?? null,
            // no visibility/cape fields: fog arrives via symbol_code,
            // storms too (thunder family) — deriveScene's code path covers it
            visibility: null,
            cape: null,
            intensity: n1?.details?.precipitation_amount ?? 0,
            timeIso: hourly.time[0] ?? '',
        };

        return {current, daily, hourly};
    }
}

/* ── NOAA National Weather Service (api.weather.gov, US only, keyless) ───── */

/**
 * NWS forecasts carry no codes — only English ("Chance Rain And Thunder",
 * "Mostly Cloudy"). Map to the closest WMO 4677 code, matching the same
 * family-first logic as agnosToWmo above. Null on empty input so callers
 * can fall back to sky cover.
 */
export function nwsTextToWmo(text) {
    const t = (text || '').toLowerCase();
    if (!t)
        return null;
    if (t.includes('thunder') || t.includes('storm'))
        return t.includes('hail') ? 99 : 95;
    if (t.includes('sleet') || t.includes('freezing rain')
        || t.includes('freezing drizzle') || t.includes('wintry mix')
        || (t.includes('snow') && t.includes('rain')))
        return 67;
    if (t.includes('fog') || t.includes('mist') || t.includes('haze'))
        return 45;
    if (t.includes('snow') || t.includes('blizzard')) {
        if (t.includes('shower'))
            return t.includes('heavy') ? 86 : 85;
        return t.includes('blizzard') || t.includes('heavy') ? 75
            : t.includes('light') ? 71 : 73;
    }
    if (t.includes('drizzle'))
        return t.includes('heavy') ? 55 : 51;
    if (t.includes('rain') || t.includes('shower')) {
        if (t.includes('shower'))
            return t.includes('heavy') ? 82 : t.includes('light') ? 80 : 81;
        return t.includes('heavy') ? 65 : t.includes('light') ? 61 : 63;
    }
    if (t.includes('overcast') || t.includes('mostly cloudy')
        || t.includes('scattered') || t.includes('widespread'))
        return 3;
    if (t.includes('partly') || t.includes('mostly clear')
        || t.includes('mostly sunny'))
        return 2;
    if (t.includes('cloud'))                    // "cloudy", "increasing clouds"
        return 3;
    return 0;                                   // sunny / clear / fair / dry
}

/** first number in '10 to 15 mph' / 'Calm' / '57' — max when a range */
function nwsNum(text) {
    const m = String(text ?? '').match(/-?\d+(?:\.\d+)?/g);
    return m ? Math.max(...m.map(Number)) : null;
}

/** wind phrase → km/h ('10 mph', '12 kt', 'Calm' → 0, metric passthrough) */
function nwsWindKmh(text) {
    const v = nwsNum(text);
    if (v === null)
        return 0;
    const t = String(text).toLowerCase();
    if (t.includes('kt') || t.includes('knot')) return v * 1.852;
    if (t.includes('km')) return v;
    if (t.includes('m/s')) return v * 3.6;
    return v * 1.60934;                         // default: mph
}

const nwsTempC = (v, unit) =>
    v === null ? null : (String(unit).toUpperCase() === 'F' ? (v - 32) * 5 / 9 : v);

export class NoaaNwsProvider extends WeatherProvider {
    constructor() {
        super('noaa-nws', 'NOAA NWS',
              'Forecast: National Weather Service (US public data)');
    }

    async forecast({latitude, longitude, days = 8}) {
        let pts;
        try {
            pts = await get(`${NWS}/points/${Number(latitude).toFixed(4)},`
                          + `${Number(longitude).toFixed(4)}`);
        } catch (e) {
            // NWS answers 400/404 for coordinates outside its grid (US + waters)
            throw new Error(/HTTP 4\d\d/.test(e.message)
                ? _('NOAA NWS covers US locations only — pick another provider')
                : e.message);
        }
        const p = pts?.properties ?? {};
        if (!p.forecastHourly || !p.forecast)
            throw new Error(_('NOAA NWS returned no forecast for this location'));

        const [hourly, daily] = await Promise.all([
            get(p.forecastHourly), get(p.forecast)]);

        // current conditions ride a station observation, not the forecast:
        // nearest station's latest ob (best effort — hourly[0] can stand in)
        let obs = null;
        try {
            const sts = await get(p.observationStations);
            // the list is pre-scored: properties.stationIdentifier + distance
            const feats = (sts?.features ?? []).map(f => ({
                id: f?.properties?.stationIdentifier ?? f?.properties?.stationId,
                dist: f?.properties?.distance?.value ?? Infinity,
            })).filter(f => f.id);
            if (feats.length) {
                const near = feats.reduce((a, b) => (b.dist < a.dist ? b : a));
                obs = await get(`${NWS}/stations/${near.id}/observations/latest`);
            }
        } catch (e) {
            obs = null;
        }
        return this.parse({hourly, daily, obs, days});
    }

    parse({hourly, daily, obs, days = 8} = {}) {
        const h = {time: [], temp: [], precipProb: [], wind: [], code: [], isDay: []};
        // NWS times are already local-with-offset — slice() keeps local naive
        for (const per of hourly?.properties?.periods ?? []) {
            // NWS periods: startTime '2026-09-27T07:00:00-07:00', isDaytime
            const iso = String(per.startTime ?? per.time ?? '').slice(0, 16);
            if (!iso)
                continue;
            h.time.push(`${iso.slice(0, 13)}:00`);
            h.temp.push(nwsTempC(nwsNum(per.temperature), per.temperatureUnit));
            h.precipProb.push(per.probabilityOfPrecipitation?.value ?? 0);
            h.wind.push(nwsWindKmh(per.windSpeed));
            h.code.push(nwsTextToWmo(per.shortForecast) ?? 3);
            h.isDay.push(!!(per.isDaytime ?? per.isDayTime));
        }

        // day/night period pairs → daily rows keyed by the period's start date
        const byDate = new Map();
        for (const per of daily?.properties?.periods ?? []) {
            const date = String(per.startTime ?? per.time ?? '').slice(0, 10);
            if (!date)
                continue;
            let row = byDate.get(date);
            if (!row)
                byDate.set(date, row = {date, code: 3, tmax: null, tmin: null,
                                        precipProb: 0, windMax: 0});
            const t = nwsTempC(nwsNum(per.temperature), per.temperatureUnit);
            if (per.isDaytime ?? per.isDayTime) {
                row.code = nwsTextToWmo(per.shortForecast) ?? row.code;
                row.tmax = t ?? row.tmax;
                row.precipProb = Math.max(row.precipProb,
                                          per.probabilityOfPrecipitation?.value ?? 0);
                row.windMax = Math.max(row.windMax, nwsWindKmh(per.windSpeed));
            } else {
                row.tmin = t ?? row.tmin;       // tonight's low owns tonight's date
                row.precipProb = Math.max(row.precipProb,
                                          per.probabilityOfPrecipitation?.value ?? 0);
            }
        }
        const rows = [...byDate.values()].slice(0, days);
        const day = {
            current: null,
            daily: rows.map(r => ({...r, sunrise: null, sunset: null, uv: null})),
            hourly: h,
        };

        const op = obs?.properties;
        // station obs are flaky on humidity/visibility — hourly periods
        // carry their own relative humidity, use it before giving up
        const hourRh = hourly?.properties?.periods?.[0]
            ?.relativeHumidity?.value ?? 0;
        if (op?.temperature?.value !== undefined && op?.temperature?.value !== null) {
            const code = nwsTextToWmo(op.textDescription)
                ?? (op.skyCover?.value >= 87 ? 3 : op.skyCover?.value >= 25 ? 2 : 0);
            day.current = {
                temp: op.temperature.value,
                feels: op.apparentTemperature?.value ?? op.temperature.value,
                code,
                isDay: (() => {
                    const hr = Number(String(op.timestamp ?? '').slice(11, 13));
                    return hr >= 6 && hr < 21;
                })(),
                humidity: op.relativeHumidity?.value ?? hourRh,
                precip: op.precipitation?.value ?? 0,
                wind: op.windSpeed?.value ?? 0,           // already km/h
                windDeg: op.windDirection?.value ?? 0,
                uv: op.uvIndex ?? null,
                visibility: op.visibility?.value ?? null,
                cape: null,                               // NWS ob has no CAPE
                intensity: op.precipitation?.value ?? 0,
                timeIso: String(op.timestamp ?? '').slice(0, 16),
            };
        } else {
            // no usable observation: the first forecast hour stands in
            const i = 0;
            day.current = {
                temp: h.temp[i] ?? null, feels: h.temp[i] ?? null,
                code: h.code[i] ?? 3, isDay: !!h.isDay[i],
                humidity: hourRh, precip: 0, wind: h.wind[i] ?? 0, windDeg: 0,
                uv: null, visibility: null, cape: null, intensity: 0,
                timeIso: h.time[i] ?? '',
            };
        }
        return day;
    }
}

const REGISTRY = new Map([
    ['open-meteo', new OpenMeteoProvider()],
    ['met-norway', new MetNorwayProvider()],
    ['noaa-nws', new NoaaNwsProvider()],
]);

/** Unknown ids fall back to the default provider, never crash. */
export function providerFor(id) {
    return REGISTRY.get(id) ?? REGISTRY.get('open-meteo');
}

/** For the preferences combo: [{id, name}, …] in registration order. */
export const PROVIDER_LIST = [...REGISTRY.values()].map(p => ({id: p.id, name: p.name}));

/* ── client ──────────────────────────────────────────────────────────────── */

export class WeatherClient {
    constructor(providerId = 'open-meteo', model = null) {
        this.providerId = providerId;
        // Open-Meteo model hint ('ecmwf_ifs025' etc.); null = best_match.
        // Harmless for other providers: their forecast() ignores it.
        this.model = model;
    }

    get provider() {
        return providerFor(this.providerId);
    }

    /** IP-based approximate location (keyless, ~city accuracy). */
    async detectLocation() {
        const raw = await get(IPINFO);
        const [lat, lon] = (raw.loc ?? '').split(',').map(Number);
        if (!Number.isFinite(lat) || !Number.isFinite(lon))
            throw new Error(_('IP geolocation failed'));
        return {
            latitude: lat,
            longitude: lon,
            name: raw.city || raw.country || '',   // city only: menu space
        };
    }

    /**
     * Full forecast for the card + animation engine, via the active
     * provider adapter. auto=true → coordinates come from IP-based
     * detection first. Values always come back in canonical metric units
     * (°C, km/h, mm/h); callers convert for display.
     */
    async fetch({latitude, longitude, auto, days = 8}) {
        let lat = latitude;
        let lon = longitude;
        let detectedName = null;
        if (auto) {
            const det = await this.detectLocation();
            lat = det.latitude;
            lon = det.longitude;
            detectedName = det.name || null;
        }
        const data = await this.provider.forecast({latitude: lat, longitude: lon,
                                                   days, model: this.model});
        return {...data, detectedName, latitude: lat, longitude: lon};
    }

    /** City search for the preferences dialog. */
    async geocode(query) {
        const raw = await get(`${GEO}?${qs({name: query, count: 6,
                                            language: 'en', format: 'json'})}`);
        return (raw.results ?? []).map(r => ({
            name: r.name,
            admin: r.admin1 ?? '',
            country: r.country ?? '',
            latitude: r.latitude,
            longitude: r.longitude,
        }));
    }
}
