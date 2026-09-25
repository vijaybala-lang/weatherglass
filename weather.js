/* weather.js — Open-Meteo client (no API key) + WMO code mapping. */

import GLib from 'gi://GLib';
import Soup from 'gi://Soup';

const API = 'https://api.open-meteo.com/v1/forecast';
const GEO = 'https://geocoding-api.open-meteo.com/v1/search';
const IPINFO = 'https://ipinfo.io/json';

/* ── WMO 4677 weather codes → description + animation scene ─────────────── */

const WMO = {
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

/* ── HTTP ────────────────────────────────────────────────────────────────── */

function qs(params) {
    return Object.entries(params)
        .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
        .join('&');
}

function get(url) {
    return new Promise((resolve, reject) => {
        const session = new Soup.Session({
            user_agent: 'gnome-shell-animated-weather/1.0',
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

/* ── client ──────────────────────────────────────────────────────────────── */

export class WeatherClient {
    /** IP-based approximate location (keyless, ~city accuracy). */
    async detectLocation() {
        const raw = await get(IPINFO);
        const [lat, lon] = (raw.loc ?? '').split(',').map(Number);
        if (!Number.isFinite(lat) || !Number.isFinite(lon))
            throw new Error('IP geolocation failed');
        return {
            latitude: lat,
            longitude: lon,
            name: [raw.city, raw.country].filter(Boolean).join(', '),
        };
    }

    /**
     * auto=true → coordinates come from IP-based detection first.
     * Values always come back in canonical metric units (°C, km/h, mm/h);
     * callers convert for display.
     * Resolves with the parsed forecast, or rejects with an Error.
     */
    async fetch({latitude, longitude, auto, days = 7}) {
        let lat = latitude;
        let lon = longitude;
        let detectedName = null;
        if (auto) {
            const det = await this.detectLocation();
            lat = det.latitude;
            lon = det.longitude;
            detectedName = det.name || null;
        }
        const params = {
            latitude: lat,
            longitude: lon,
            current: [
                'temperature_2m', 'relative_humidity_2m', 'apparent_temperature',
                'is_day', 'precipitation', 'weather_code', 'cloud_cover',
                'wind_speed_10m', 'wind_direction_10m',
                // physical proxies: WMO codes almost never report fog or
                // storms, but these two variables catch them reliably
                'visibility', 'cape',
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

        const c = raw.current;
        const d = raw.daily;
        const current = {
            temp: c.temperature_2m,
            feels: c.apparent_temperature,
            code: c.weather_code,
            isDay: !!c.is_day,
            humidity: c.relative_humidity_2m,
            precip: c.precipitation ?? 0,
            wind: c.wind_speed_10m,          // always km/h
            windDeg: c.wind_direction_10m,
            visibility: c.visibility ?? null,   // metres
            cape: c.cape ?? null,               // J/kg convective available energy
            // mm/h always (API called with metric); drives drop/flake density
            intensity: c.precipitation ?? 0,
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

        return {current, daily, detectedName, latitude: lat, longitude: lon};
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
