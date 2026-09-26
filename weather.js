/* weather.js — Open-Meteo client (no API key) + WMO code mapping. */

import GLib from 'gi://GLib';
import Soup from 'gi://Soup';

const API = 'https://api.open-meteo.com/v1/forecast';
const GEO = 'https://geocoding-api.open-meteo.com/v1/search';
const IPINFO = 'https://ipinfo.io/json';
// MET Norway (Norwegian Meteorological Institute), keyless, global;
// strict about identifying User-Agents (403 otherwise)
const MET = 'https://api.met.no/weatherapi/locationforecast/2.0/complete';

/* ── WMO 4677 weather codes → description + animation scene ─────────────── */

export const WMO = {
    0:  {desc: 'Clear sky',        day: 'sun',    night: 'moon'},
    1:  {desc: 'Mainly clear',     day: 'sun',    night: 'moon'},
    2:  {desc: 'Partly cloudy',    day: 'partly', night: 'partly'},
    3:  {desc: 'Overcast',         day: 'cloud',  night: 'cloud'},
    45: {desc: 'Fog',              day: 'fog',    night: 'fog'},
    48: {desc: 'Rime fog',         day: 'fog',    night: 'fog'},
    51: {desc: 'Light drizzle',    day: 'rain',   night: 'rain'},
    53: {desc: 'Drizzle',          day: 'rain',   night: 'rain'},
    55: {desc: 'Dense drizzle',    day: 'rain',   night: 'rain'},
    56: {desc: 'Freezing drizzle', day: 'sleet',  night: 'sleet'},
    57: {desc: 'Freezing drizzle', day: 'sleet',  night: 'sleet'},
    61: {desc: 'Light rain',       day: 'rain',   night: 'rain'},
    63: {desc: 'Rain',             day: 'rain',   night: 'rain'},
    65: {desc: 'Heavy rain',       day: 'rain',   night: 'rain'},
    66: {desc: 'Freezing rain',    day: 'sleet',  night: 'sleet'},
    67: {desc: 'Freezing rain',    day: 'sleet',  night: 'sleet'},
    71: {desc: 'Light snow',       day: 'snow',   night: 'snow'},
    73: {desc: 'Snow',             day: 'snow',   night: 'snow'},
    75: {desc: 'Heavy snow',       day: 'snow',   night: 'snow'},
    77: {desc: 'Snow grains',      day: 'snow',   night: 'snow'},
    80: {desc: 'Light showers',    day: 'rain',   night: 'rain'},
    81: {desc: 'Showers',          day: 'rain',   night: 'rain'},
    82: {desc: 'Violent showers',  day: 'rain',   night: 'rain'},
    85: {desc: 'Snow showers',     day: 'snow',   night: 'snow'},
    86: {desc: 'Heavy snow showers', day: 'snow', night: 'snow'},
    95: {desc: 'Thunderstorm',     day: 'storm',  night: 'storm'},
    96: {desc: 'Thunderstorm, hail', day: 'hail', night: 'hail'},
    99: {desc: 'Thunderstorm, hail', day: 'hail', night: 'hail'},
};

export function sceneFor(code, isDay = true) {
    const w = WMO[code] ?? {desc: 'Unknown', day: 'cloud', night: 'cloud'};
    return {scene: isDay ? w.day : w.night, desc: w.desc};
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
        return {scene: 'hail', desc: 'Thunderstorm, hail'};
    if (code === 95 || (cape >= 1200 && liquid))
        return {scene: 'storm', desc: 'Thunderstorm'};
    if (code === 45 || code === 48)
        return sceneFor(code, isDay);
    if (visibility !== null && visibility < 1000 && !liquid)
        return {scene: 'fog', desc: 'Fog'};
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

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** 'YYYY-MM-DD' → 'Mon' (UTC parse keeps it locale/zone independent). */
export function dayName(iso) {
    const [y, m, d] = iso.split('-').map(Number);
    return DAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
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
            user_agent: 'gnome-shell-animated-weather/5.6 ' +
                        '(GNOME Shell extension; contact: vbala.dev)',
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
 *               precipProb: [%…], wind: [km/h…], code: [WMO-int…]},
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

    async forecast({latitude, longitude, days = 8}) {
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
                'wind_speed_10m', 'weather_code',
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
        const hourly = {time: [], temp: [], precipProb: [], wind: [], code: []};
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

const REGISTRY = new Map([
    ['open-meteo', new OpenMeteoProvider()],
    ['met-norway', new MetNorwayProvider()],
]);

/** Unknown ids fall back to the default provider, never crash. */
export function providerFor(id) {
    return REGISTRY.get(id) ?? REGISTRY.get('open-meteo');
}

/** For the preferences combo: [{id, name}, …] in registration order. */
export const PROVIDER_LIST = [...REGISTRY.values()].map(p => ({id: p.id, name: p.name}));

/* ── client ──────────────────────────────────────────────────────────────── */

export class WeatherClient {
    constructor(providerId = 'open-meteo') {
        this.providerId = providerId;
    }

    get provider() {
        return providerFor(this.providerId);
    }

    /** IP-based approximate location (keyless, ~city accuracy). */
    async detectLocation() {
        const raw = await get(IPINFO);
        const [lat, lon] = (raw.loc ?? '').split(',').map(Number);
        if (!Number.isFinite(lat) || !Number.isFinite(lon))
            throw new Error('IP geolocation failed');
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
        const data = await this.provider.forecast({latitude: lat, longitude: lon, days});
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
