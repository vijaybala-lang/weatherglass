/* weather.js -- Open-Meteo client (no API key) + WMO code mapping. */

import GLib from 'gi://GLib';
import Soup from 'gi://Soup';

const N_ = s => s;

const OPEN_METEO_FORECAST_API = 'https://api.open-meteo.com/v1/forecast';
const OPEN_METEO_GEOCODING_API = 'https://geocoding-api.open-meteo.com/v1/search';
const IPINFO_API = 'https://ipinfo.io/json';
// MET Norway (Norwegian Meteorological Institute), keyless, global;
// strict about identifying User-Agents (403 otherwise)
const MET_NORWAY_API = 'https://api.met.no/weatherapi/locationforecast/2.0/complete';
const NOAA_NWS_API = 'https://api.weather.gov';

/* -- WMO 4677 weather codes -> description + animation scene --------------- */

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
    const entry = WMO[code] ?? {desc: N_('Unknown'), day: 'cloud', night: 'cloud'};
    return {scene: isDay ? entry.day : entry.night, desc: entry.desc};
}

/**
 * Pick the animated scene from the WMO code PLUS raw physical variables.
 * Open-Meteo's code derivation almost never emits fog (45/48), thunder (95)
 * or hail (96/99) -- measured across live forecasts and reanalysis -- so we
 * trust the underlying data too:
 *   fog  : visibility < 1 km while it isn't precipitating
 *   storm: CAPE >= 1200 J/kg with liquid precipitation (embedded convection)
 *   hail : CAPE >= 2500 J/kg with liquid precipitation (severe convection)
 */
export function deriveScene(current) {
    const {code, visibility, cape, isDay} = current;
    const isLiquidPrecip = code >= 51 && code <= 82;   // drizzle ... showers
    if (code === 96 || code === 99 || (cape >= 2500 && isLiquidPrecip))
        return {scene: 'hail', desc: N_('Thunderstorm, hail')};
    if (code === 95 || (cape >= 1200 && isLiquidPrecip))
        return {scene: 'storm', desc: N_('Thunderstorm')};
    if (code === 45 || code === 48)
        return sceneFor(code, isDay);
    if (visibility !== null && visibility < 1000 && !isLiquidPrecip)
        return {scene: 'fog', desc: N_('Fog')};
    return sceneFor(code, isDay);
}

/* -- formatting helpers --------------------------------------------------- */

export function fmtTemp(celsiusTemp, units) {
    const convertedTemp = units === 'imperial' ? celsiusTemp * 9 / 5 + 32 : celsiusTemp;
    return `${Math.round(convertedTemp)}°`;
}

const DAYS = [N_('Sun'), N_('Mon'), N_('Tue'), N_('Wed'),
              N_('Thu'), N_('Fri'), N_('Sat')];

/** 'YYYY-MM-DD' -> short weekday, localized (UTC parse keeps the date
 *  itself zone-independent; the msgids are the three-letter English
 *  abbreviations, translated to the locale's usual short weekday). */
export function dayName(iso) {
    const [year, month, day] = iso.split('-').map(Number);
    return DAYS[new Date(Date.UTC(year, month - 1, day)).getUTCDay()];
}

/**
 * NOAA low-precision solar almanac for the sky painter: sun altitude in
 * degrees plus the day's sunrise/sunset epochs (ms, null at the poles
 * where the sun never crosses the horizon). Julian century -> mean
 * anomaly -> equation of time -> declination -> hour angle at zenith
 * 90.833 degrees (refraction-corrected). Minute-accurate — golden-hour
 * shading, not navigation. Computed from coordinates instead of
 * provider strings so all three providers get one continuous path.
 */
export function sunGeometry(lat, lon, ms) {
    const rad = Math.PI / 180;
    const jd = ms / 86400000 + 2440587.5;
    const T = (jd - 2451545.0) / 36525.0;
    const L0 = 280.46646 + T * (36000.76983 + 0.0003032 * T);
    const M = 357.52911 + T * (35999.05029 - 0.0001537 * T);
    const e = 0.016708634 - T * (0.000042037 + 0.0000001250 * T);
    const C = Math.sin(M * rad) * (1.914602 - T * (0.004817 + 0.00000014 * T)) +
        Math.sin(2 * M * rad) * (0.019993 - 0.000101 * T) +
        Math.sin(3 * M * rad) * 0.000289;
    const omega = 125.04 - 1934.136 * T;
    const lambda = L0 + C - 0.00569 - 0.00478 * Math.sin(omega * rad);
    const eps = 23 + (26 + (21.448 - T * (46.815 + T * (0.00059 - T * 0.001813))) / 60) / 60 +
        0.00256 * Math.cos(omega * rad);
    const decl = Math.asin(Math.sin(eps * rad) * Math.sin(lambda * rad));
    const varY = Math.tan(eps * rad / 2) ** 2;
    const eqTime = 4 * (180 / Math.PI) * (
        varY * Math.sin(2 * L0 * rad) -
        2 * e * Math.sin(M * rad) +
        4 * e * varY * Math.sin(M * rad) * Math.cos(2 * L0 * rad) -
        0.5 * varY * varY * Math.sin(4 * L0 * rad) -
        1.25 * e * e * Math.sin(2 * M * rad));                 // minutes
    const dayStart = Math.floor(ms / 86400000) * 86400000;
    const solarNoonMin = 720 - 4 * lon - eqTime;               // UTC minutes
    const cosH = Math.cos(90.833 * rad) / Math.cos(lat * rad) -
        Math.tan(lat * rad) * Math.tan(decl);
    let sunrise = null;
    let sunset = null;
    if (Math.abs(cosH) <= 1) {
        const ha = Math.acos(cosH) / rad;                      // degrees
        sunrise = dayStart + (solarNoonMin - 4 * ha) * 60000;
        sunset = dayStart + (solarNoonMin + 4 * ha) * 60000;
    }
    const solarTimeMin = (ms - dayStart) / 60000 + eqTime + 4 * lon;
    const hourAngle = (solarTimeMin / 4 - 180) * rad;         // cos is 360-deg periodic
    const altitude = Math.asin(Math.sin(lat * rad) * Math.sin(decl) +
        Math.cos(lat * rad) * Math.cos(decl) * Math.cos(hourAngle)) / rad;
    return {altitude, sunrise, sunset};
}


/**
 * Hourly-array indices for the chart's window. Today is a ROLLING 24 HOURS:
 * now through the next 24, backfilled before now (clamped at the array
 * start) so the curve stays full at every hour of the day -- at 23:30 the
 * tail is tomorrow's early hours, and just past midnight the window simply
 * becomes the new day plus its 2-hour backfill. Today's tile hi/lo follows
 * the window (menu recomputes it from the plotted hours), so tile, curve
 * and the now marker always describe the same hours across the midnight
 * boundary. Other days run exact calendar midnight-to-midnight slices. All
 * day arithmetic reads the DATE out of the provider's own stamps -- they
 * always carry the city's local date -- so neither the viewer's timezone
 * nor half-hour offsets can tip an edge across a day boundary. nowIso is
 * the city wall-clock anchor the providers hand us.
 */
const NOW_BACKFILL_HOURS = 2;
const TODAY_WINDOW_HOURS = 24;

export function daySlice(hourly, daily, dayIndex, nowIso = '') {
    const times = hourly?.time ?? [];
    const count = times.length;
    if (!count)
        return [];
    if (dayIndex === 0 && nowIso) {
        const hourPrefix = nowIso.slice(0, 13);
        const nowIndex = times.findIndex(timeStr => timeStr.slice(0, 13) === hourPrefix);
        if (nowIndex >= 0) {
            const startIndex = Math.max(0, nowIndex - NOW_BACKFILL_HOURS);
            const endIndex = Math.min(nowIndex + TODAY_WINDOW_HOURS, count) - 1;
            const hourlyIndices = [];
            for (let i = startIndex; i <= endIndex; i++)
                hourlyIndices.push(i);
            return hourlyIndices;
        }
    }
    const dayKey = daily?.[dayIndex]?.date ?? '';
    const hourlyIndices = [];
    if (!dayKey)
        return hourlyIndices;
    for (let i = 0; i < count; i++)
        if (times[i].startsWith(dayKey))
            hourlyIndices.push(i);
    return hourlyIndices.slice(0, 24);
}

/** Where the anchor instant sits inside a daySlice as a 0..1 fraction of
 *  the chart's x axis (matches chart.js X(i) = i/(n-1)), minute-precise;
 *  null outside the window. */
export function nowFracIn(hourly, hourlyIndices, nowIso = '') {
    if (!nowIso || !hourlyIndices || hourlyIndices.length < 2)
        return null;
    const hourPrefix = nowIso.slice(0, 13);
    const absolute = hourly.time.findIndex(timeStr => timeStr.slice(0, 13) === hourPrefix);
    if (absolute < 0)
        return null;
    const position = absolute - hourlyIndices[0] + (Number(nowIso.slice(14, 16)) || 0) / 60;
    if (position < 0 || position > hourlyIndices.length - 1)
        return null;
    return position / (hourlyIndices.length - 1);
}

/* -- HTTP ------------------------------------------------------------------ */

function buildQueryString(params) {
    return Object.entries(params)
        .map(([key, val]) => `${encodeURIComponent(key)}=${encodeURIComponent(val)}`)
        .join('&');
}

function get(url) {
    return new Promise((resolve, reject) => {
        const session = new Soup.Session({
            // MET Norway rejects generic agents (403); include identification
            // and a contact per their usage policies
            user_agent: 'gnome-shell-weatherglass/5 ' +
                        '(GNOME Shell extension; ' +
                        'contact: https://github.com/vijaybala-lang/' +
                        'weatherglass/issues)',
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
            } catch (err) {
                reject(err);
            } finally {
                session.abort();
            }
        });
    });
}

/* -- provider adapters -----------------------------------------------------
 *
 * The UI (icon, sky, menu, charts) consumes exactly ONE normalized shape,
 * whichever provider answered:
 *
 *   {
 *     current: {temp degC, feels degC, code WMO-int, isDay, humidity %,
 *               precip mm/h, wind km/h, windDeg, uv, visibility m|null,
 *               cape J/kg|null, intensity mm/h,
 *               timeIso 'YYYY-MM-DDTHH:mm' in the forecast's own tz},
 *     daily:   [{date, code, tmax, tmin, precipProb %, sunrise, sunset,
 *               uv, windMax}],
 *     hourly:  {time: ['YYYY-MM-DDTHH:00' local...], temp: [degC...],
 *               precipProb: [%...], wind: [km/h...], code: [WMO-int...],
 *               isDay: [bool...]},
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

    /** raw JSON -> normalized {current, daily, hourly} (pure: unit-testable). */
    parse(raw, {days} = {}) {                       // eslint-disable-line no-unused-vars
        throw new Error(`${this.id}: parse() not implemented`);
    }
}

/* -- Open-Meteo (default) -------------------------------------------------- */

class OpenMeteoProvider extends WeatherProvider {
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
            temperature_unit: 'celsius',
            wind_speed_unit: 'kmh',
        };
        if (model && model !== 'best_match') {
            params.models = model;
            try {
                return this.parse(await get(`${OPEN_METEO_FORECAST_API}?${buildQueryString(params)}`));
            } catch (err) {
                delete params.models;
                return this.parse(await get(`${OPEN_METEO_FORECAST_API}?${buildQueryString(params)}`));
            }
        }
        const raw = await get(`${OPEN_METEO_FORECAST_API}?${buildQueryString(params)}`);
        return this.parse(raw);
    }

    parse(raw) {
        const rawCurrent = raw.current;
        const rawDaily = raw.daily;
        const rawHourly = raw.hourly;
        const current = {
            temp: rawCurrent.temperature_2m,
            feels: rawCurrent.apparent_temperature,
            code: rawCurrent.weather_code,
            isDay: !!rawCurrent.is_day,
            humidity: rawCurrent.relative_humidity_2m,
            precip: rawCurrent.precipitation ?? 0,
            wind: rawCurrent.wind_speed_10m,          // always km/h
            windDeg: rawCurrent.wind_direction_10m,
            uv: rawCurrent.uv_index ?? null,
            visibility: rawCurrent.visibility ?? null,   // metres
            intensity: rawCurrent.precipitation ?? 0,
            timeIso: rawCurrent.time ?? '',
        };

        const daily = (rawDaily.time ?? []).map((date, i) => ({
            date,
            code: rawDaily.weather_code[i],
            tmax: rawDaily.temperature_2m_max[i],
            tmin: rawDaily.temperature_2m_min[i],
            precipProb: rawDaily.precipitation_probability_max[i] ?? 0,
            sunrise: rawDaily.sunrise[i],
            sunset: rawDaily.sunset[i],
            uv: rawDaily.uv_index_max[i] ?? 0,
            windMax: rawDaily.wind_speed_10m_max[i] ?? 0,
        }));

        const hourly = {
            time: rawHourly?.time ?? [],
            temp: rawHourly?.temperature_2m ?? [],
            precipProb: rawHourly?.precipitation_probability ?? [],
            wind: rawHourly?.wind_speed_10m ?? [],
            code: rawHourly?.weather_code ?? [],
            isDay: (rawHourly?.is_day ?? []).map(val => !!val),
        };

        return {current, daily, hourly};
    }
}

/* -- MET Norway (api.met.no locationforecast 2.0, complete mode) ----------- */

/**
 * AGNOS symbol_code -> closest WMO 4677 code, so every provider lands in
 * the one scene vocabulary (see WMO table above). MET only tags the clear
 * families with _day/_night; intensity uses light_/moderate_/heavy_ and
 * _showers/_periods modifiers.
 */
function agnosToWmo(symbol) {
    const cleanSymbol = (symbol || '').replace(/_(?:day|night|polartwilight)$/, '');
    if (!cleanSymbol)
        return 3;
    const heavy = cleanSymbol.includes('heavy');
    const light = cleanSymbol.includes('light') || cleanSymbol.includes('lght');
    const shower = cleanSymbol.includes('shower') || cleanSymbol.includes('periods');
    if (cleanSymbol.includes('hail'))
        return cleanSymbol.includes('thunder') || heavy ? 99 : 96;
    if (cleanSymbol.includes('thunder'))
        return 95;
    if (cleanSymbol.includes('clearsky')) return 0;
    if (cleanSymbol.includes('fair')) return 1;
    if (cleanSymbol.includes('partlycloudy')) return 2;        // before plain cloudy
    if (cleanSymbol.includes('fog')) return 45;
    if (cleanSymbol.includes('cloudy')) return 3;
    if (cleanSymbol.includes('sleet') || cleanSymbol.includes('ice')
        || (cleanSymbol.includes('rain') && cleanSymbol.includes('snow')))
        return light ? 66 : 67;
    if (cleanSymbol.includes('drizzle')) return light ? 51 : heavy ? 55 : 53;
    if (cleanSymbol.includes('snow'))
        return shower ? (heavy ? 86 : 85) : (light ? 71 : heavy ? 75 : 73);
    if (cleanSymbol.includes('rain'))
        return shower ? (light ? 80 : heavy ? 82 : 81) : (light ? 61 : heavy ? 65 : 63);
    return 3;
}

/**
 * MET reports precipitation *amounts*, not probabilities -- derive a 0-100 %
 * proxy: any measurable mm starts the curve high (it IS raining in the
 * forecast), saturation ~2 mm/h; dry hours fall back to cloud cover/4.
 */
function precipProbFrom(amountMm, cloudPct = 0) {
    const mm = Number(amountMm) || 0;
    if (mm >= 0.05)
        return Math.min(100, Math.round(40 + 60 * (1 - Math.exp(-mm))));
    return Math.round(Math.min(40, (Number(cloudPct) || 0) * 0.4));
}

/** MET times are UTC 'Z'; the whole pipeline speaks the viewer's local
 *  naive ISO, so convert (auto-located users are always in their own tz).
 *  glib >= 2.84 renamed new_from_iso8601_string -> new_from_iso8601(iso, tz). */
function localFromUtc(iso) {
    let dateTime = null;
    try {
        dateTime = GLib.DateTime.new_from_iso8601(iso, null);
    } catch (err) {
        dateTime = null;
    }
    if (!dateTime)
        return (iso || '').slice(0, 16).replace(' ', 'T');
    return dateTime.to_local().format('%Y-%m-%dT%H:%M');
}

/** _day/_night suffix where present, else a generous 06-21 local heuristic */
function isDayFromSymbol(symbol, hourLocal) {
    if (/_day$/.test(symbol || '')) return true;
    if (/_night$/.test(symbol || '')) return false;
    return hourLocal >= 6 && hourLocal < 21;
}

class MetNorwayProvider extends WeatherProvider {
    constructor() {
        super('met-norway', 'MET Norway',
              'Forecast: MET Norway (CC BY-SA 4.0)');
    }

    async forecast({latitude, longitude, days = 8}) {
        // locationforecast covers ~9 days regardless; 4-decimal coords
        const url = `${MET_NORWAY_API}?lat=${Number(latitude).toFixed(4)}`
                  + `&lon=${Number(longitude).toFixed(4)}`;
        const raw = await get(url);
        return this.parse(raw, {days});
    }

    parse(raw, {days = 8} = {}) {
        const timeseries = raw?.properties?.timeseries ?? [];
        const hourly = {time: [], temp: [], precipProb: [], wind: [], code: [], isDay: []};
        const byDate = new Map();

        for (const entry of timeseries) {
            const iso = localFromUtc(entry.time);              // '...T21:00'
            const inst = entry.data?.instant?.details ?? {};
            const next1Hours = entry.data?.next_1_hours ?? {};
            const sym = next1Hours?.summary?.symbol_code
                ?? entry.data?.next_6_hours?.summary?.symbol_code
                ?? entry.data?.next_12_hours?.summary?.symbol_code ?? '';
            const temp = inst.air_temperature ?? null;
            const prob = precipProbFrom(next1Hours?.details?.precipitation_amount,
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

        const firstDetails = timeseries[0]?.data?.instant?.details ?? {};
        const next1Hours = timeseries[0]?.data?.next_1_hours ?? {};
        const sym = next1Hours?.summary?.symbol_code ?? '';
        const current = {
            temp: firstDetails.air_temperature ?? null,
            feels: firstDetails.apparent_air_temperature ?? firstDetails.air_temperature ?? null,
            code: agnosToWmo(sym),
            isDay: isDayFromSymbol(sym, Number(hourly.time[0]?.slice(11, 13))),
            humidity: firstDetails.relative_humidity ?? 0,
            precip: next1Hours?.details?.precipitation_amount ?? 0,
            wind: (firstDetails.wind_speed ?? 0) * 3.6,
            windDeg: firstDetails.wind_from_direction ?? 0,
            uv: firstDetails.ultraviolet_index_clear_sky ?? null,
            visibility: null,
            cape: null,
            intensity: next1Hours?.details?.precipitation_amount ?? 0,
            timeIso: hourly.time[0] ?? '',
        };

        return {current, daily, hourly};
    }
}

/* -- NOAA National Weather Service (api.weather.gov, US only, keyless) ----- */

/**
 * NWS forecasts carry no codes -- only English ("Chance Rain And Thunder",
 * "Mostly Cloudy"). Map to the closest WMO 4677 code, matching the same
 * family-first logic as agnosToWmo above. Null on empty input so callers
 * can fall back to sky cover.
 */
function nwsTextToWmo(text) {
    const lowerText = (text || '').toLowerCase();
    if (!lowerText)
        return null;
    if (lowerText.includes('thunder') || lowerText.includes('storm'))
        return lowerText.includes('hail') ? 99 : 95;
    if (lowerText.includes('sleet') || lowerText.includes('freezing rain')
        || lowerText.includes('freezing drizzle') || lowerText.includes('wintry mix')
        || (lowerText.includes('snow') && lowerText.includes('rain')))
        return 67;
    if (lowerText.includes('fog') || lowerText.includes('mist') || lowerText.includes('haze'))
        return 45;
    if (lowerText.includes('snow') || lowerText.includes('blizzard')) {
        if (lowerText.includes('shower'))
            return lowerText.includes('heavy') ? 86 : 85;
        return lowerText.includes('blizzard') || lowerText.includes('heavy') ? 75
            : lowerText.includes('light') ? 71 : 73;
    }
    if (lowerText.includes('drizzle'))
        return lowerText.includes('heavy') ? 55 : 51;
    if (lowerText.includes('rain') || lowerText.includes('shower')) {
        if (lowerText.includes('shower'))
            return lowerText.includes('heavy') ? 82 : lowerText.includes('light') ? 80 : 81;
        return lowerText.includes('heavy') ? 65 : lowerText.includes('light') ? 61 : 63;
    }
    if (lowerText.includes('overcast') || lowerText.includes('mostly cloudy')
        || lowerText.includes('scattered') || lowerText.includes('widespread'))
        return 3;
    if (lowerText.includes('partly') || lowerText.includes('mostly clear')
        || lowerText.includes('mostly sunny'))
        return 2;
    if (lowerText.includes('cloud'))                    // "cloudy", "increasing clouds"
        return 3;
    return 0;                                   // sunny / clear / fair / dry
}

/** first number in '10 to 15 mph' / 'Calm' / '57' -- max when a range */
function nwsNum(text) {
    const matches = String(text ?? '').match(/-?\d+(?:\.\d+)?/g);
    return matches ? Math.max(...matches.map(Number)) : null;
}

/** wind phrase -> km/h ('10 mph', '12 kt', 'Calm' -> 0, metric passthrough) */
function nwsWindKmh(text) {
    const num = nwsNum(text);
    if (num === null)
        return 0;
    const lower = String(text).toLowerCase();
    if (lower.includes('kt') || lower.includes('knot')) return num * 1.852;
    if (lower.includes('km')) return num;
    if (lower.includes('m/s')) return num * 3.6;
    return num * 1.60934;                         // default: mph
}

const nwsTempC = (val, unit) =>
    val === null ? null : (String(unit).toUpperCase() === 'F' ? (val - 32) * 5 / 9 : val);

class NoaaNwsProvider extends WeatherProvider {
    constructor() {
        super('noaa-nws', 'NOAA NWS',
              'Forecast: National Weather Service (US public data)');
    }

    async forecast({latitude, longitude, days = 8}) {
        let pointsData;
        try {
            pointsData = await get(`${NOAA_NWS_API}/points/${Number(latitude).toFixed(4)},`
                                 + `${Number(longitude).toFixed(4)}`);
        } catch (err) {
            throw new Error(/HTTP 4\d\d/.test(err.message)
                ? _('NOAA NWS covers US locations only — pick another provider')
                : err.message);
        }
        const props = pointsData?.properties ?? {};
        if (!props.forecastHourly || !props.forecast)
            throw new Error(_('NOAA NWS returned no forecast for this location'));

        const [hourly, daily] = await Promise.all([
            get(props.forecastHourly), get(props.forecast)]);

        let observationData = null;
        try {
            const stationsData = await get(props.observationStations);
            const stationFeatures = (stationsData?.features ?? []).map(feature => ({
                id: feature?.properties?.stationIdentifier ?? feature?.properties?.stationId,
                distance: feature?.properties?.distance?.value ?? Infinity,
            })).filter(feature => feature.id);
            if (stationFeatures.length) {
                const nearestStation = stationFeatures.reduce((closest, curr) => (curr.distance < closest.distance ? curr : closest));
                observationData = await get(`${NOAA_NWS_API}/stations/${nearestStation.id}/observations/latest`);
            }
        } catch (err) {
            observationData = null;
        }
        return this.parse({hourly, daily, obs: observationData, days});
    }

    parse({hourly, daily, obs, days = 8} = {}) {
        const hourlyData = {time: [], temp: [], precipProb: [], wind: [], code: [], isDay: []};
        // NWS times are already local-with-offset -- slice() keeps local naive
        for (const period of hourly?.properties?.periods ?? []) {
            // NWS periods: startTime '2026-09-27T07:00:00-07:00', isDaytime
            const iso = String(period.startTime ?? period.time ?? '').slice(0, 16);
            if (!iso)
                continue;
            hourlyData.time.push(`${iso.slice(0, 13)}:00`);
            hourlyData.temp.push(nwsTempC(nwsNum(period.temperature), period.temperatureUnit));
            hourlyData.precipProb.push(period.probabilityOfPrecipitation?.value ?? 0);
            hourlyData.wind.push(nwsWindKmh(period.windSpeed));
            hourlyData.code.push(nwsTextToWmo(period.shortForecast) ?? 3);
            hourlyData.isDay.push(!!(period.isDaytime ?? period.isDayTime));
        }

        // day/night period pairs -> daily rows keyed by the period's start date
        const byDate = new Map();
        for (const period of daily?.properties?.periods ?? []) {
            const date = String(period.startTime ?? period.time ?? '').slice(0, 10);
            if (!date)
                continue;
            let row = byDate.get(date);
            if (!row)
                byDate.set(date, row = {date, code: 3, tmax: null, tmin: null,
                                        precipProb: 0, windMax: 0});
            const temp = nwsTempC(nwsNum(period.temperature), period.temperatureUnit);
            if (period.isDaytime ?? period.isDayTime) {
                row.code = nwsTextToWmo(period.shortForecast) ?? row.code;
                row.tmax = temp ?? row.tmax;
                row.precipProb = Math.max(row.precipProb,
                                          period.probabilityOfPrecipitation?.value ?? 0);
                row.windMax = Math.max(row.windMax, nwsWindKmh(period.windSpeed));
            } else {
                row.tmin = temp ?? row.tmin;       // tonight's low owns tonight's date
                row.precipProb = Math.max(row.precipProb,
                                          period.probabilityOfPrecipitation?.value ?? 0);
            }
        }
        const rows = [...byDate.values()].slice(0, days);
        const day = {
            current: null,
            daily: rows.map(r => ({...r, sunrise: null, sunset: null, uv: null})),
            hourly: hourlyData,
        };

        const observationProps = obs?.properties;
        const hourRh = hourly?.properties?.periods?.[0]
            ?.relativeHumidity?.value ?? 0;
        if (observationProps?.temperature?.value !== undefined && observationProps?.temperature?.value !== null) {
            const code = nwsTextToWmo(observationProps.textDescription)
                ?? (observationProps.skyCover?.value >= 87 ? 3 : observationProps.skyCover?.value >= 25 ? 2 : 0);
            day.current = {
                temp: observationProps.temperature.value,
                feels: observationProps.apparentTemperature?.value ?? observationProps.temperature.value,
                code,
                isDay: (() => {
                    const hr = Number(String(observationProps.timestamp ?? '').slice(11, 13));
                    return hr >= 6 && hr < 21;
                })(),
                humidity: observationProps.relativeHumidity?.value ?? hourRh,
                precip: observationProps.precipitation?.value ?? 0,
                wind: observationProps.windSpeed?.value ?? 0,           // already km/h
                windDeg: observationProps.windDirection?.value ?? 0,
                uv: observationProps.uvIndex ?? null,
                visibility: observationProps.visibility?.value ?? null,
                cape: null,                               // NWS ob has no CAPE
                intensity: observationProps.precipitation?.value ?? 0,
                timeIso: String(observationProps.timestamp ?? '').slice(0, 16),
            };
        } else {
            const i = 0;
            day.current = {
                temp: hourlyData.temp[i] ?? null, feels: hourlyData.temp[i] ?? null,
                code: hourlyData.code[i] ?? 3, isDay: !!hourlyData.isDay[i],
                humidity: hourRh, precip: 0, wind: hourlyData.wind[i] ?? 0, windDeg: 0,
                uv: null, visibility: null, cape: null, intensity: 0,
                timeIso: hourlyData.time[i] ?? '',
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
function providerFor(id) {
    return REGISTRY.get(id) ?? REGISTRY.get('open-meteo');
}

/* -- client ---------------------------------------------------------------- */

export class WeatherClient {
    constructor(providerId = 'open-meteo', model = null) {
        this.providerId = providerId;
        this.model = model;
    }

    get provider() {
        return providerFor(this.providerId);
    }

    /** IP-based approximate location (keyless, ~city accuracy). */
    async detectLocation() {
        const raw = await get(IPINFO_API);
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
     * provider adapter. auto=true -> coordinates come from IP-based
     * detection first. Values always come back in canonical metric units
     * (degC, km/h, mm/h); callers convert for display.
     */
    async fetch({latitude, longitude, auto, days = 8}) {
        let lat = latitude;
        let lon = longitude;
        let detectedName = null;
        if (auto) {
            const detectedLocation = await this.detectLocation();
            lat = detectedLocation.latitude;
            lon = detectedLocation.longitude;
            detectedName = detectedLocation.name || null;
        }
        const data = await this.provider.forecast({latitude: lat, longitude: lon,
                                                   days, model: this.model});
        return {...data, detectedName, latitude: lat, longitude: lon};
    }

    /** City search for the preferences dialog. */
    async geocode(query) {
        const raw = await get(`${OPEN_METEO_GEOCODING_API}?${buildQueryString({name: query, count: 6,
                                                                              language: 'en', format: 'json'})}`);
        return (raw.results ?? []).map(result => ({
            name: result.name,
            admin: result.admin1 ?? '',
            country: result.country ?? '',
            latitude: result.latitude,
            longitude: result.longitude,
        }));
    }
}
