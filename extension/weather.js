/* weather.js -- Open-Meteo client (no API key) + WMO code mapping. */

import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import Soup from 'gi://Soup';

const N_ = s => s;

const OPEN_METEO_FORECAST_API = 'https://api.open-meteo.com/v1/forecast';
const OPEN_METEO_GEOCODING_API = 'https://geocoding-api.open-meteo.com/v1/search';
const IPINFO_API = 'https://ipinfo.io/json';
// second opinion when ipinfo is down or blocked (free tier is HTTPS)
const IPAPI_API = 'https://ipapi.co/json/';
// keyless client-side reverse geocoder: names a GeoClue fix (which knows
// coordinates but no city) for the menu label
const REVERSE_GEOCODE_API = 'https://api.bigdatacloud.net/data/reverse-geocode-client';
// MET Norway (Norwegian Meteorological Institute), keyless, global;
// strict about identifying User-Agents (403 otherwise)
const MET_NORWAY_API = 'https://api.met.no/weatherapi/locationforecast/2.0/complete';
const NOAA_NWS_API = 'https://api.weather.gov';
const MET_ALERTS_API = 'https://api.met.no/weatherapi/metalerts/2.0/current.json';

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

/* Per-code glyph variants: family art WITHIN a scene, mirroring the
 * per-code coverage matrix. The scene says
 * what falls; the variant says in what pattern -- drizzle's sparser
 * count, showers' peeking sun/moon, grains instead of flakes, the
 * bolt beside hailstones. Callers that know the code pass it through
 * to the painter; code-less poses (prefs demos) paint the plain scene. */
const CODE_VARIANT = {
    1: 'mainly', 48: 'rime',
    51: 'drizzle', 53: 'drizzle', 55: 'drizzle',
    56: 'freezinglight', 66: 'freezinglight', 67: 'freezingheavy',
    77: 'grains',
    80: 'showers', 81: 'showers', 82: 'showers',
    85: 'showers', 86: 'showers',
    96: 'stormhail', 99: 'stormhailheavy',
};

export function variantForCode(code) {
    return WMO[code] ? (CODE_VARIANT[code] ?? null) : 'unknown';
}

export function sceneFor(code, isDay = true) {
    const entry = WMO[code] ?? {desc: N_('Unknown'), day: 'cloud', night: 'cloud'};
    return {
        scene: isDay ? entry.day : entry.night,
        desc: entry.desc,
        variant: variantForCode(code),
    };
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
        return {
            scene: 'hail', desc: N_('Thunderstorm, hail'),
            variant: code === 99 ? 'stormhailheavy' : 'stormhail',
        };
    if (code === 95 || (cape >= 1200 && isLiquidPrecip))
        return {scene: 'storm', desc: N_('Thunderstorm'), variant: null};
    if (code === 45 || code === 48)
        return sceneFor(code, isDay);
    if (visibility !== null && visibility < 1000 && !isLiquidPrecip)
        return {scene: 'fog', desc: N_('Fog'), variant: null};
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
 * becomes the new day plus its 2-hour backfill. Only the CHART rolls:
 * day tiles always quote the provider's calendar-day hi/lo, because a
 * rolling tile at 4 PM would quote tomorrow afternoon's peak as
 * today's high (issue #94). Other days run exact calendar
 * midnight-to-midnight slices. All
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

function getText(url) {
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
                resolve(new TextDecoder().decode(bytes.get_data()));
            } catch (err) {
                reject(err);
            } finally {
                session.abort();
            }
        });
    });
}

function get(url) {
    return getText(url).then(text => JSON.parse(text));
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
 * WeatherClient.fetch() additionally attaches `alerts` +
 * `alertsCoverage` from the independent advisory layer below --
 * providers stay forecast-only because Open-Meteo (the default) has
 * no warnings product at all.
 *
 * Adding a service = subclass WeatherProvider, implement forecast()/
 * parse(), register it in PROVIDERS below, and add the id to the
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
                // precipitation + cloud_cover: JMA/CMA report no
                // probability and are only selectable because parse
                // derives it from the amount (see below)
                'precipitation', 'cloud_cover',
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

        const rawDailyDays = (rawDaily.time ?? []).map((date, i) => ({
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

        /* JMA and CMA simply do not produce precipitation_probability;
         * an all-null column would render the Rain tab as zeros. Fall
         * back ELEMENTWISE to the same Met.no formula (precipProbFrom
         * on the millimetre amount, cloud cover for dry hours) --
         * wherever the model DID report a probability it is kept. */
        const rawProb = raw.hourly?.precipitation_probability ?? [];
        const rawPrecip = raw.hourly?.precipitation ?? [];
        const rawCloud = raw.hourly?.cloud_cover ?? [];
        const preTrim = {
            time: raw.hourly?.time ?? [],
            temp: raw.hourly?.temperature_2m ?? [],
            precipProb: (raw.hourly?.time ?? []).map(
                (_, i) => rawProb[i] ??
                          precipProbFrom(rawPrecip[i], rawCloud[i])),
            wind: raw.hourly?.wind_speed_10m ?? [],
            code: raw.hourly?.weather_code ?? [],
            isDay: (raw.hourly?.is_day ?? []).map(val => !!val),
        };

        /* Model horizons end early (a 3-hourly global run answers ~10
         * days; beyond it the API sends nulls). Nulls must never reach
         * paintChart: Math.min coerces null to 0, so one null point
         * fakes a 0-degree cliff AND skews the whole y-window. Trim
         * every hourly array at the first missing core sample
         * (temp/wind/code) -- interpolation would fabricate, and the
         * chart's own condition-strip guard refuses mismatched lengths
         * outright. Daily rows trim at their first missing code/max/min:
         * the tile row honestly shows fewer days. */
        let horizon = preTrim.time.length;
        for (const arr of [preTrim.temp, preTrim.wind, preTrim.code]) {
            const first = arr.findIndex(val => val === null || val === undefined);
            if (first !== -1)
                horizon = Math.min(horizon, first);
        }
        const hourly = {};
        for (const key of Object.keys(preTrim))
            hourly[key] = preTrim[key].slice(0, horizon);

        const dayEnd = rawDailyDays.findIndex(d =>
            d.code === null || d.code === undefined ||
            d.tmax === null || d.tmax === undefined ||
            d.tmin === null || d.tmin === undefined);
        const daily = dayEnd === -1 ? rawDailyDays : rawDailyDays.slice(0, dayEnd);

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

/* EGO-L-001: classes, not instances -- the module may not build
 * shell-side resources before enable(). providerFor() constructs each
 * singleton on first use (normalized id, unknown ids land on the
 * default). */
const PROVIDERS = {
    'open-meteo': OpenMeteoProvider,
    'met-norway': MetNorwayProvider,
    'noaa-nws': NoaaNwsProvider,
};
const _liveProviders = new Map();

/** Unknown ids fall back to the default provider, never crash. */
function providerFor(id) {
    const key = PROVIDERS[id] ? id : 'open-meteo';
    let provider = _liveProviders.get(key);
    if (!provider) {
        provider = new PROVIDERS[key]();
        _liveProviders.set(key, provider);
    }
    return provider;
}

/* -- advisories ------------------------------------------------------------
 *
 * Official warnings are not a forecast variable: every source returns
 * the alerts active or upcoming RIGHT NOW, each with its own validity
 * window (startsAt -> endsAt, city-local naive ISO like the hourly
 * stamps). There is no per-day query; a day view is an overlap filter
 * (alertsForDay) over the alerts already held. Normalized shape:
 *
 *   { id, event, headline, level 1|2|3|null, severityLabel,
 *     certainty, urgency, startsAt, endsAt, issuedAt, description,
 *     instruction, areas [], sender, source, language }
 *
 * Colour is not universal: MET issues a native risk colour (used
 * verbatim -- it already folds impact x likelihood), NWS/CAP carry
 * only a severity word, and CAP allows Unknown, which stays level
 * null rather than guessing. Alert text is the issuer's, never
 * translated here; `language` names what the UI is showing.
 *
 * Sources are point queries that self-gate: NWS answers HTTP 400
 * ("point out of bounds") outside the US, MET an empty collection
 * outside Norway. Both run on every fetch, in parallel with the
 * forecast, and can never fail it: a dead advisory feed means no
 * rows, never no weather. alertsCoverage is 'ok' when some source
 * claims the point, 'none' when none does, 'failed' when every
 * source errored for another reason. The UI renders nothing for all
 * flavours of "no alerts"; the flag is for future debug surfaces.
 */

const SEVERITY_LEVEL = { Minor: 1, Moderate: 2, Severe: 3, Extreme: 3 };
const COLOUR_LEVEL = { yellow: 1, orange: 2, red: 3 };

/** NWS GeoJSON -> normalized alerts. "Until" reads `ends` (event
 *  over), never `expires` (message stale) -- measured live: a coastal
 *  advisory had expires the next morning but ends three days out. */
export function parseNwsAlerts(raw) {
    const alerts = [];
    for (const feature of raw?.features ?? []) {
        const p = feature?.properties ?? {};
        if (p.status && p.status !== 'Actual')
            continue;
        if (p.messageType && p.messageType !== 'Alert' && p.messageType !== 'Update')
            continue;
        const cats = Array.isArray(p.category) ? p.category : [p.category];
        if (p.category && !cats.includes('Met'))
            continue;
        const startsAt = String(p.onset ?? p.effective ?? p.sent ?? '').slice(0, 16);
        if (!startsAt)
            continue;
        alerts.push({
            id: String(p.id ?? startsAt + (p.event ?? '')),
            event: p.event ?? '',
            headline: p.headline ?? null,
            level: SEVERITY_LEVEL[p.severity] ?? null,
            severityLabel: p.severity ?? '',
            certainty: p.certainty ?? null,
            urgency: p.urgency ?? null,
            startsAt,
            endsAt: String(p.ends ?? p.expires ?? '').slice(0, 16) || null,
            issuedAt: String(p.sent ?? '').slice(0, 16) || null,
            description: (p.description ?? '').trim(),
            instruction: (p.instruction ?? '').trim() || null,
            areas: String(p.areaDesc ?? '').split(';')
                .map(s => s.trim()).filter(Boolean),
            sender: p.senderName ?? '',
            source: 'NOAA NWS',
            language: String(p.language ?? 'en').slice(0, 2),
        });
    }
    return alerts;
}

/** MET Norway metalerts 2.0 GeoJSON -> normalized alerts. The beta
 *  GeoJSON carries onset only inside `title` ("name, level, area,
 *  <onset UTC>, <ends UTC>"); eventEndingTime, when present, is the
 *  structured ends. Times are UTC: convert like locationforecast. */
export function parseMetAlerts(raw) {
    const alerts = [];
    const isoRe = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?(?:Z|[+-]\d{2}:\d{2})/g;
    for (const feature of raw?.features ?? []) {
        const p = feature?.properties ?? {};
        if (p.status && p.status !== 'Actual')
            continue;
        if (p.type && p.type !== 'Alert' && p.type !== 'Update')
            continue;
        const titleTimes = String(p.title ?? '').match(isoRe) ?? [];
        const onsetUtc = titleTimes[0] ?? '';
        const endsUtc = p.eventEndingTime ?? titleTimes[1] ?? '';
        if (!onsetUtc)
            continue;
        const native = COLOUR_LEVEL[String(p.riskMatrixColor ?? '').toLowerCase()]
            ?? COLOUR_LEVEL[(String(p.awareness_level ?? '').split(';')[1] ?? '').trim()];
        alerts.push({
            id: String(p.id ?? onsetUtc + (p.event ?? '')),
            event: p.eventAwarenessName ?? p.event ?? '',
            headline: p.title ?? null,
            level: native ?? SEVERITY_LEVEL[p.severity] ?? null,
            severityLabel: p.severity ?? '',
            certainty: p.certainty ?? null,
            urgency: null,
            startsAt: localFromUtc(onsetUtc),
            endsAt: endsUtc ? localFromUtc(endsUtc) : null,
            issuedAt: null,
            description: (p.description ?? '').trim(),
            instruction: (p.instruction ?? '').trim() || null,
            areas: [p.area].filter(Boolean),
            sender: 'MET Norway',
            source: 'MET Norway',
            language: raw?.lang ?? 'no',
        });
    }
    return alerts;
}

/* -- point geometry (shared by the GeoJSON + CAP adapters) ---------------- */

/** Ray-casting over one [lat, lon] ring. */
export function pointInPolygon(lat, lon, ring) {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const [yi, xi] = ring[i], [yj, xj] = ring[j];
        if ((yi > lat) !== (yj > lat) &&
            lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi)
            inside = !inside;
    }
    return inside;
}

function distKm(lat1, lon1, lat2, lon2) {
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180 *
        Math.cos((lat1 + lat2) * Math.PI / 360);
    return 6371 * Math.hypot(dLat, dLon);
}

/* -- ECCC (Canada): GeoMet WFS GeoJSON, real polygons --------------------- */

/** GeoMet Current-Alerts features -> alerts covering the point.
 *  Native risk colour, bilingual fields (ctx.language 'en'|'fr'). */
export function parseEcccAlerts(raw, ctx = {}) {
    const lang = ctx.language === 'fr' ? 'fr' : 'en';
    const utcToLocal = ctx.utcToLocal ?? localFromUtc;
    const alerts = [];
    for (const feature of raw?.features ?? []) {
        const p = feature?.properties ?? {};
        const geom = feature?.geometry;
        if ((p.status_en ?? '') === 'ended' || !geom)
            continue;
        const polys = geom.type === 'Polygon' ? [geom.coordinates[0]]
            : geom.type === 'MultiPolygon' ? geom.coordinates.map(poly => poly[0]) : [];
        const ringHit = polys.some(ring => Array.isArray(ring) &&
            pointInPolygon(ctx.latitude, ctx.longitude,
                           ring.map(([lon, lat]) => [lat, lon])));
        if (!ringHit)
            continue;
        const name = p[`alert_name_${lang}`] ?? p.alert_name_en ?? '';
        alerts.push({
            id: String(p.id ?? p.feature_id ?? name),
            event: name.charAt(0).toUpperCase() + name.slice(1),
            headline: null,
            level: COLOUR_LEVEL[String(p.risk_colour_en ?? '').toLowerCase()] ?? null,
            severityLabel: p[`impact_${lang}`] ?? '',
            certainty: p[`confidence_${lang}`] ?? null,
            urgency: null,
            startsAt: utcToLocal(p.validity_datetime ?? p.publication_datetime),
            endsAt: p.event_end_datetime ? utcToLocal(p.event_end_datetime) : null,
            issuedAt: p.publication_datetime ? utcToLocal(p.publication_datetime) : null,
            description: (p[`alert_text_${lang}`] ?? '').trim(),
            instruction: null,
            areas: [p[`feature_name_${lang}`]].filter(Boolean),
            sender: 'Environment and Climate Change Canada',
            source: 'ECCC GeoMet',
            language: lang,
        });
    }
    return alerts;
}

/* -- CAP: one scanner for full documents and MeteoAlarm Atom summaries ----
 * GJS has no XML DOM; CAP's flat tag structure scans safely with
 * tag regexes + entity decoding. Candidates carry private geo
 * fields (_polygons/_circles/_geocodes/_capLink) for matching;
 * adapters strip them before the UI ever sees the alert. */

function decodeXml(text) {
    if (!text)
        return '';
    return text
        .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
        .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
        .replace(/&#(\d+);/g, (m, n) => String.fromCharCode(Number(n)))
        .replace(/&amp;/g, '&')
        .trim();
}

function xmlTag(block, tag) {
    const m = block.match(new RegExp(
        `<(?:\\w+:)?${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</(?:\\w+:)?${tag}>`));
    return m ? decodeXml(m[1]) : '';
}

function xmlBlocks(block, tag) {
    return [...block.matchAll(new RegExp(
        `<(?:\\w+:)?${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</(?:\\w+:)?${tag}>`, 'g'))]
        .map(m => m[1]);
}

function capTime(iso, utcToLocal) {
    if (!iso)
        return null;
    return /Z$|[+-]00:00$/.test(iso) ? utcToLocal(iso) : iso.slice(0, 16);
}

function parseCapAreas(infoBlock) {
    const areas = [], polygons = [], circles = [], geocodes = [];
    for (const area of xmlBlocks(infoBlock, 'area')) {
        const desc = xmlTag(area, 'areaDesc');
        if (desc)
            areas.push(desc);
        for (const polyText of xmlBlocks(area, 'polygon')) {
            const ring = polyText.trim().split(/\s+/).map(pair => {
                const [lat, lon] = pair.split(',').map(Number);
                return [lat, lon];
            }).filter(([lat, lon]) => Number.isFinite(lat) && Number.isFinite(lon));
            if (ring.length >= 3)
                polygons.push(ring);
        }
        for (const circleText of xmlBlocks(area, 'circle')) {
            const [point, radius] = circleText.trim().split(/\s+/);
            const [lat, lon] = (point ?? '').split(',').map(Number);
            if (Number.isFinite(lat) && Number.isFinite(lon))
                circles.push({ lat, lon, km: Number(radius) || 0 });
        }
        for (const geo of xmlBlocks(area, 'geocode')) {
            const value = xmlTag(geo, 'value');
            if (value)
                geocodes.push(value);
        }
    }
    return { areas, polygons, circles, geocodes };
}

function capParam(infoBlock, name) {
    for (const param of xmlBlocks(infoBlock, 'parameter')) {
        if (xmlTag(param, 'valueName') === name)
            return xmlTag(param, 'value');
    }
    return '';
}

export function parseCapAlerts(xml, ctx = {}) {
    const utcToLocal = ctx.utcToLocal ?? localFromUtc;
    const candidates = [];
    if (/<alert[\s>]/.test(xml)) {
        for (const doc of xml.match(/<alert[\s>][\s\S]*?<\/alert>/g) ?? []) {
            if (xmlTag(doc, 'status') !== 'Actual')
                continue;
            const msgType = xmlTag(doc, 'msgType');
            if (msgType && msgType !== 'Alert' && msgType !== 'Update')
                continue;
            const infos = xmlBlocks(doc, 'info');
            const info = infos.find(i => /^en/.test(xmlTag(i, 'language'))) ?? infos[0];
            if (!info)
                continue;
            const categories = xmlBlocks(info, 'category');
            if (categories.length && !categories.includes('Met'))
                continue;
            const geo = parseCapAreas(info);
            const awareness = capParam(info, 'awareness_level');
            const native = COLOUR_LEVEL[(awareness.split(';')[1] ?? '').trim()];
            candidates.push({
                id: xmlTag(doc, 'identifier'),
                event: xmlTag(info, 'event'),
                headline: xmlTag(info, 'headline') || null,
                level: native ?? SEVERITY_LEVEL[xmlTag(info, 'severity')] ?? null,
                severityLabel: xmlTag(info, 'severity'),
                certainty: xmlTag(info, 'certainty') || null,
                urgency: xmlTag(info, 'urgency') || null,
                startsAt: capTime(xmlTag(info, 'onset') || xmlTag(doc, 'sent'), utcToLocal),
                endsAt: capTime(xmlTag(info, 'expires'), utcToLocal),
                issuedAt: capTime(xmlTag(doc, 'sent'), utcToLocal),
                description: xmlTag(info, 'description'),
                instruction: xmlTag(info, 'instruction') || null,
                areas: geo.areas,
                sender: xmlTag(info, 'senderName'),
                source: 'CAP',
                language: xmlTag(info, 'language').slice(0, 2) || 'en',
                _polygons: geo.polygons, _circles: geo.circles,
                _geocodes: geo.geocodes, _capLink: null,
            });
        }
        return candidates;
    }
    // MeteoAlarm legacy Atom: one entry per AREA, grouped by identifier
    const byId = new Map();
    for (const entry of xmlBlocks(xml, 'entry')) {
        if (xmlTag(entry, 'status') !== 'Actual')
            continue;
        const msgType = xmlTag(entry, 'message_type');
        if (msgType && msgType !== 'Alert' && msgType !== 'Update')
            continue;
        const id = xmlTag(entry, 'identifier');
        if (!id)
            continue;
        let cand = byId.get(id);
        if (!cand) {
            const title = xmlTag(entry, 'title');
            const colour = COLOUR_LEVEL[(title.split(' ')[0] ?? '').toLowerCase()];
            const linkMatch = entry.match(/<link[^>]*type="application\/cap\+xml"[^>]*href="([^"]+)"/);
            cand = {
                id,
                event: xmlTag(entry, 'event'),
                headline: title || null,
                level: colour ?? SEVERITY_LEVEL[xmlTag(entry, 'severity')] ?? null,
                severityLabel: xmlTag(entry, 'severity'),
                certainty: xmlTag(entry, 'certainty') || null,
                urgency: xmlTag(entry, 'urgency') || null,
                startsAt: capTime(xmlTag(entry, 'onset') || xmlTag(entry, 'sent'), utcToLocal),
                endsAt: capTime(xmlTag(entry, 'expires'), utcToLocal),
                issuedAt: capTime(xmlTag(entry, 'sent'), utcToLocal),
                description: '',
                instruction: null,
                areas: [],
                sender: 'MeteoAlarm',
                source: 'MeteoAlarm',
                language: 'en',
                _polygons: [], _circles: [], _geocodes: [],
                _capLink: linkMatch ? linkMatch[1] : null,
            };
            byId.set(id, cand);
        }
        const areaDesc = xmlTag(entry, 'areaDesc');
        if (areaDesc && !cand.areas.includes(areaDesc))
            cand.areas.push(areaDesc);
        for (const geo of xmlBlocks(entry, 'geocode')) {
            const value = xmlTag(geo, 'value');
            if (value && !cand._geocodes.includes(value))
                cand._geocodes.push(value);
        }
    }
    return [...byId.values()];
}

/** Point match, most precise first: polygon, circle, geocode,
 *  then district-name match against the user's place names. */
export function alertMatchesPoint(candidate, ctx = {}) {
    const { latitude, longitude } = ctx;
    if (candidate._polygons?.length && Number.isFinite(latitude))
        return candidate._polygons.some(ring => pointInPolygon(latitude, longitude, ring));
    if (candidate._circles?.length && Number.isFinite(latitude))
        return candidate._circles.some(c => distKm(latitude, longitude, c.lat, c.lon) <= c.km);
    if (candidate._geocodes?.length && ctx.geocodes?.length &&
        candidate._geocodes.some(g => ctx.geocodes.includes(g)))
        return true;
    const fold = s => s.toLowerCase().normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/^(kreis|landkreis|stadt|city of|comune di)\s+/, '');
    const names = (ctx.placeNames ?? []).map(fold).filter(n => n.length >= 3);
    if (!names.length)
        return false;
    return candidate.areas.some(area => {
        const folded = fold(area);
        const head = folded.replace(/ - .*$/, '');
        return names.some(n => folded.includes(n) || n.includes(head));
    });
}

/** One list out of many sources: dedupe by id, highest level first
 *  (colourless last), then earliest start. */
export function mergeAlerts(lists) {
    const byId = new Map();
    for (const list of lists)
        for (const alert of list ?? [])
            if (!byId.has(alert.id))
                byId.set(alert.id, alert);
    return [...byId.values()].sort((a, b) =>
        ((b.level ?? 0) - (a.level ?? 0)) ||
        (a.startsAt < b.startsAt ? -1 : a.startsAt > b.startsAt ? 1 : 0));
}

/** Does one alert's window touch one calendar date? An alert
 *  ending exactly at 00:00 does not claim that date; one without
 *  an end counts only its start date. */
export function alertOverlapsDay(alert, date) {
    if (alert.startsAt.slice(0, 10) > date)
        return false;
    if (!alert.endsAt)
        return alert.startsAt.slice(0, 10) === date;
    if (alert.endsAt.slice(0, 10) < date)
        return false;
    return !(alert.endsAt.slice(0, 10) === date &&
             alert.endsAt.slice(11, 16) === '00:00');
}

/** Alerts overlapping daily[dayIndex]. Day 0 is the "today" view:
 *  everything active or upcoming, unfiltered. */
export function alertsForDay(alerts, daily, dayIndex) {
    if (dayIndex === 0)
        return alerts ?? [];
    const date = daily?.[dayIndex]?.date ?? '';
    if (!date)
        return [];
    return (alerts ?? []).filter(a => alertOverlapsDay(a, date));
}

/* -- advisory source adapters ----------------------------------------------
 * The common interface, mirroring the forecast providers above: one
 * adapter per source, each with a network fetch() and a pure parse().
 * fetch(latitude, longitude) resolves to
 *   { alerts: [normalized...], outcome: 'ok' | 'none' | 'failed' }
 * where 'ok' = this source claims the point, 'none' = it answered
 * "not my territory", 'failed' = it could not answer. Adding a
 * source (MeteoAlarm, ECCC, a CAP feed) is one adapter plus one
 * ALERT_SOURCES entry; fetchAlerts, the merge, and every UI surface
 * stay untouched because they only ever see the normalized shape. */

const nwsAlertSource = {
    id: 'noaa-nws',
    parse: parseNwsAlerts,
    async fetch(latitude, longitude) {
        const point = `${Number(latitude).toFixed(4)},${Number(longitude).toFixed(4)}`;
        try {
            const raw = await get(`${NOAA_NWS_API}/alerts/active?point=${point}`);
            return { alerts: parseNwsAlerts(raw), outcome: 'ok' };
        } catch (err) {
            // measured: out-of-US points get HTTP 400 "out of bounds"
            return { alerts: [], outcome: err.message === 'HTTP 400' ? 'none' : 'failed' };
        }
    },
};

const metAlertSource = {
    id: 'met-norway',
    parse: parseMetAlerts,
    async fetch(latitude, longitude) {
        const locale = GLib.get_language_names()[0] ?? '';
        const lang = /^(nb|nn|no)/.test(locale) ? 'no' : 'en';
        try {
            const raw = await get(`${MET_ALERTS_API}?lat=${Number(latitude).toFixed(4)}` +
                `&lon=${Number(longitude).toFixed(4)}&lang=${lang}`);
            const alerts = parseMetAlerts(raw);
            const inNorway = latitude >= 57.5 && latitude <= 71.5 &&
                             longitude >= 4 && longitude <= 32;
            return { alerts, outcome: alerts.length || inNorway ? 'ok' : 'none' };
        } catch {
            return { alerts: [], outcome: 'failed' };
        }
    },
};

const ecccAlertSource = {
    id: 'eccc-canada',
    parse: parseEcccAlerts,
    async fetch(latitude, longitude) {
        if (!(latitude >= 41 && latitude <= 85 && longitude >= -142 && longitude <= -52))
            return { alerts: [], outcome: 'none' };
        const locale = GLib.get_language_names()[0] ?? '';
        const dLat = 50 / 111;
        const dLon = 50 / (111 * Math.cos(latitude * Math.PI / 180));
        const url = `https://geo.weather.gc.ca/geomet?${buildQueryString({
            SERVICE: 'WFS', VERSION: '2.0.0', REQUEST: 'GetFeature',
            TYPENAMES: 'Current-Alerts', outputFormat: 'application/json',
            BBOX: `${(latitude - dLat).toFixed(4)},${(longitude - dLon).toFixed(4)},` +
                  `${(latitude + dLat).toFixed(4)},${(longitude + dLon).toFixed(4)},EPSG:4326`,
        })}`;
        try {
            const raw = await get(url);
            return {
                alerts: parseEcccAlerts(raw, {
                    latitude, longitude,
                    language: locale.startsWith('fr') ? 'fr' : 'en',
                }),
                outcome: 'ok',
            };
        } catch {
            return { alerts: [], outcome: 'failed' };
        }
    },
};

/* MeteoAlarm legacy Atom feeds, keyed by ISO country code. The new
 * EDR API needs a registered key; these feeds stay public. */
const METEOALARM_FEEDS = {
    AD: 'andorra', AT: 'austria', BE: 'belgium', BA: 'bosnia-herzegovina',
    BG: 'bulgaria', HR: 'croatia', CY: 'cyprus', CZ: 'czechia',
    DK: 'denmark', EE: 'estonia', FI: 'finland', FR: 'france',
    DE: 'germany', GR: 'greece', HU: 'hungary', IS: 'iceland',
    IE: 'ireland', IL: 'israel', IT: 'italy', LV: 'latvia',
    LT: 'lithuania', LU: 'luxembourg', MT: 'malta', MD: 'moldova',
    ME: 'montenegro', NL: 'netherlands', NO: 'norway', PL: 'poland',
    PT: 'portugal', MK: 'republic-of-north-macedonia', RO: 'romania',
    RS: 'serbia', SK: 'slovakia', SI: 'slovenia', ES: 'spain',
    SE: 'sweden', CH: 'switzerland', UA: 'ukraine', GB: 'united-kingdom',
};

const stripPrivate = ({ _polygons, _circles, _geocodes, _capLink, ...alert }) => alert;

const meteoalarmAlertSource = {
    id: 'meteoalarm',
    parse: parseCapAlerts,
    async fetch(latitude, longitude, ctx = {}) {
        const slug = METEOALARM_FEEDS[(ctx.countryCode ?? '').toUpperCase()];
        if (!slug)
            return { alerts: [], outcome: 'none' };
        try {
            const xml = await getText(
                `https://feeds.meteoalarm.org/feeds/meteoalarm-legacy-atom-${slug}`);
            const matchCtx = { latitude, longitude, placeNames: ctx.placeNames ?? [] };
            const matched = parseCapAlerts(xml)
                .filter(cand => alertMatchesPoint(cand, matchCtx))
                .filter(cand => !ctx.nowIso || !cand.endsAt || cand.endsAt >= ctx.nowIso);
            // enrich the few matches with their full CAP text (the
            // Atom summary carries no description); a failed fetch
            // keeps the summary form rather than dropping the alert
            const alerts = await Promise.all(matched.slice(0, 5).map(async cand => {
                if (!cand._capLink)
                    return stripPrivate(cand);
                try {
                    const [full] = parseCapAlerts(await getText(cand._capLink));
                    if (!full)
                        return stripPrivate(cand);
                    if (full._polygons.length && !alertMatchesPoint(full, matchCtx))
                        return null;
                    return stripPrivate({
                        ...cand,
                        description: full.description || cand.description,
                        instruction: full.instruction,
                        headline: full.headline ?? cand.headline,
                        sender: full.sender || cand.sender,
                        language: full.language || cand.language,
                    });
                } catch {
                    return stripPrivate(cand);
                }
            }));
            return { alerts: alerts.filter(Boolean), outcome: 'ok' };
        } catch {
            return { alerts: [], outcome: 'failed' };
        }
    },
};

export const ALERT_SOURCES = [nwsAlertSource, metAlertSource,
                              ecccAlertSource, meteoalarmAlertSource];

/** Fan out over every adapter in parallel; merge into the one shape
 *  the UI consumes. Coverage: any 'ok' wins, else any 'failed',
 *  else 'none'. Never throws. */
async function fetchAlerts(latitude, longitude, ctx = {}) {
    const results = await Promise.all(
        ALERT_SOURCES.map(source => source.fetch(latitude, longitude, ctx)));
    let alertsCoverage = 'none';
    if (results.some(r => r.outcome === 'ok'))
        alertsCoverage = 'ok';
    else if (results.some(r => r.outcome === 'failed'))
        alertsCoverage = 'failed';
    return { alerts: mergeAlerts(results.map(r => r.alerts)), alertsCoverage };
}

/* -- auto-location ---------------------------------------------------------
 *
 * Detection prefers GeoClue, the system's own location service: Wi-Fi /
 * cellular / GPS backends, street level where the user granted access.
 * GeoClue stays best-effort by contract: gnome-shell's consent agent only
 * prompts desktop apps, so an extension's request can be left unanswered
 * outright (measured on the dev machine: init hangs to the D-Bus timeout).
 * Every attempt is therefore capped at GEOCLUE_TIMEOUT_SEC, failures back
 * off per geoRetryDelaySec(), and the public-IP lookup (city centroid,
 * VPN-sensitive) serves as the fallback. A good fix is cached for
 * DETECT_TTL_SEC so periodic refreshes never re-roll the dice, and while
 * GeoClue keeps working no IP endpoint is contacted at all.
 */

const GEOCLUE_DESKTOP_ID = 'dev.vijaybala.weatherglass';
const GEOCLUE_TIMEOUT_SEC = 5;
const GEOCLUE_RETRY_SEC = 1800;       // first retry after 30 min, ...
const GEOCLUE_RETRY_MAX_SEC = 86400;  // ... backing off to once a day
const DETECT_TTL_SEC = 1800;

/**
 * One GeoClue fix, name still empty (the menu's fallback 'My location'
 * stays honest until labelFix() names it). Rejects on a missing typelib,
 * a denied client, or silence past the timeout; callers treat every
 * rejection as "use the IP lookup".
 */
async function detectViaGeoClue(client) {
    const {default: Geoclue} = await import('gi://Geoclue');
    const simple = new Geoclue.Simple({
        desktopId: GEOCLUE_DESKTOP_ID,
        accuracyLevel: Geoclue.AccuracyLevel.EXACT,
    });
    return new Promise((resolve, reject) => {
        let timerId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT,
            GEOCLUE_TIMEOUT_SEC, () => {
                client._detectTimers.delete(timerId);
                timerId = 0;
                reject(new Error(`no fix within ${GEOCLUE_TIMEOUT_SEC}s`));
                return GLib.SOURCE_REMOVE;
            });
        client._detectTimers.add(timerId);
        const settle = fn => {
            if (timerId) {
                GLib.source_remove(timerId);
                client._detectTimers.delete(timerId);
                timerId = 0;
            }
            fn();
        };
        simple.init_async(GLib.PRIORITY_DEFAULT, null, (client, res) => {
            let location = null;
            try {
                client.init_finish(res);
                location = client.get_location();
            } catch (err) {
                settle(() => reject(new Error(`access denied (${err.message})`)));
                return;
            }
            const take = loc => settle(() => resolve({
                latitude: loc.latitude,
                longitude: loc.longitude,
                // GeoClue reports no city; inventing one from the zone
                // (LA for a Daly City fix) would lie in the menu label.
                name: '',
            }));
            if (location)
                take(location);
            else
                client.connect('location-updated', (c, loc) => take(loc));
        });
    });
}

/** ipinfo.io ('loc: "lat,lon"') and ipapi.co (split fields) -> one shape. */
export function fixFromIp(raw) {
    const [lat, lon] = raw.loc
        ? String(raw.loc).split(',').map(Number)
        : [Number(raw.latitude), Number(raw.longitude)];
    if (!Number.isFinite(lat) || !Number.isFinite(lon))
        throw new Error('IP geolocation failed');
    return {latitude: lat, longitude: lon, name: raw.city || raw.country || '',
            countryCode: raw.country_code || raw.countryCode || raw.country || ''};
}

/** Retry window after `failures` consecutive GeoClue failures (locked). */
export function geoRetryDelaySec(failures) {
    return Math.min(GEOCLUE_RETRY_SEC * 4 ** failures, GEOCLUE_RETRY_MAX_SEC);
}

/** BigDataCloud payload: city first, locality only as its fallback. */
export function cityFromReverseGeocode(raw) {
    return raw.city || raw.locality || '';
}

/** Name a coordinate-only fix; the fix stays 'My location' if the
 *  geocoder is down or has no label for the point. */
async function labelFix(fix) {
    if (fix.name)
        return fix;
    try {
        const raw = await get(`${REVERSE_GEOCODE_API}?${buildQueryString({
            latitude: fix.latitude.toFixed(4),
            longitude: fix.longitude.toFixed(4),
            localityLanguage: 'en',
        })}`);
        return {...fix, name: cityFromReverseGeocode(raw),
                countryCode: raw.countryCode || ''};
    } catch (err) {
        return fix; // labeling is cosmetic: never fail a detection over it
    }
}

/* The GNOME consent agent only prompts for apps it can resolve to a
 * desktop file (gnome-shell js/ui/status/location.js looks the id up in
 * its app system, and silently denies unknown ones). Installing this
 * NoDisplay entry while auto-location is on is what turns our GeoClue
 * requests into the standard "Allow location access" dialog. */

export function desktopEntryName() {
    return `${GEOCLUE_DESKTOP_ID}.desktop`;
}

export function desktopEntryText() {
    return ['[Desktop Entry]', 'Type=Application', 'Name=Weatherglass',
            'Comment=Weather for the GNOME panel', 'Icon=weather-overcast',
            'NoDisplay=true', 'Terminal=false',
            'X-Geoclue-Reason=Show the weather for where you are', ''].join('\n');
}

/** Create missing parent dirs (glib removed File.make_parents). */
function makeDirectoryPath(dir) {
    const missing = [];
    for (let d = dir; d && !d.query_exists(null); d = d.get_parent())
        missing.push(d);
    for (const d of missing.reverse())
        d.make_directory(null);
}

/** Where the consent entry lives. */
function desktopEntryFile() {
    return Gio.File.new_for_path(GLib.build_filenamev(
        [GLib.get_user_data_dir(), 'applications', desktopEntryName()]));
}

/** Read the consent stub once for BOTH upkeep siblings (the dedup
 * rule): delivers `{file, text}` where text is null for absent-or-
 * unreadable. NOT_FOUND is the common first-run path and stays silent;
 * other read failures are logged here because neither caller can DO
 * anything better with them. The null outcome's fate is deliberately
 * each caller's own policy: ensure overwrites (recovery), remove
 * no-ops (absence was the goal). */
function readConsentStub(done) {
    const file = desktopEntryFile();
    file.load_contents_async(null, (obj, res) => {
        try {
            const [, bytes] = obj.load_contents_finish(res);
            done({file, text: new TextDecoder().decode(bytes)});
        } catch (err) {
            if (!err.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.NOT_FOUND))
                logError(err, 'Weatherglass: consent entry unreadable');
            done({file, text: null});
        }
    });
}

/** Idempotent: writes only when absent or stale. The read is async
 * (EGO-X-004): a synchronous load would stall the UI thread for a disk
 * round-trip on every enable/toggle. The write is the rare path (only
 * after a miss/stale) and replace_contents is not on the blocked list;
 * callers fire-and-forget -- the entry is consulted later by the
 * consent agent, never by this call stack. */
export function ensureDesktopEntry() {
    readConsentStub(({file, text}) => {
        /* Keep any entry that carries our consent key: the standalone
         * WeatherGlass app historically installed a richer .desktop
         * under the same id and it satisfies the consent agent just as
         * well (Name + X-Geoclue-Reason). Byte-equality here used to
         * bulldoze it. */
        if (text !== null && text.includes('X-Geoclue-Reason'))
            return;
        try {
            makeDirectoryPath(file.get_parent());
            file.replace_contents(desktopEntryText(), null, false,
                Gio.FileCreateFlags.NONE, null);
        } catch (err) {
            // concrete failure mode: unwritable home; the consent
            // prompt then never appears and detection falls back to
            // the IP chain anyway
            logError(err, 'Weatherglass: consent entry not installed');
        }
    });
}

/* Async via readConsentStub (EGO-X-004, shared with ensureDesktopEntry
 * -- no second bespoke read pipeline). Callers fire-and-forget.
 * Concrete failure mode: a remove landing AFTER a re-enable rewrote
 * the stub (disable/enable inside the millisecond callback window)
 * leaves no entry while auto-location stays on -- the consent agent
 * then falls back to the IP chain, and the next ensure()/enable
 * rewrite heals it. */
export function removeDesktopEntry() {
    readConsentStub(({file, text}) => {
        /* Only ever delete OUR stub: a fuller third-party/app entry
         * sharing the id is not ours to remove. */
        if (text === null || !text.includes('NoDisplay=true'))
            return;
        try {
            file.delete(null);
        } catch (err) {
            logError(err, 'Weatherglass: consent entry not removable');
        }
    });
}

/* -- client ---------------------------------------------------------------- */

export class WeatherClient {
    constructor(providerId = 'open-meteo', model = null) {
        this.providerId = providerId;
        this.model = model;
        this._fix = null;       // cached {latitude, longitude, name, at}
        this._geoRetryAt = 0;   // monotonic seconds; 0 = GeoClue eligible now
        this._geoFailures = 0;
        this._detectTimers = new Set(); // live GeoClue probe caps
    }

    /** Drop in-flight detection sources (coordinator owns this call). */
    destroy() {
        for (const id of this._detectTimers)
            GLib.source_remove(id);
        this._detectTimers.clear();
    }

    get provider() {
        return providerFor(this.providerId);
    }

    /**
     * Auto-location (see the auto-location section above): GeoClue while
     * it is usable, public-IP lookup otherwise, coordinate-only fixes
     * named via reverse geocode. The result is cached for
     * DETECT_TTL_SEC; throws only when every source fails.
     */
    async detectLocation() {
        const nowSec = GLib.get_monotonic_time() / 1000000;
        if (this._fix && nowSec - this._fix.at < DETECT_TTL_SEC)
            return this._fix;
        let fix = null;
        if (nowSec >= this._geoRetryAt) {
            try {
                fix = await detectViaGeoClue(this);
                this._geoFailures = 0;
                this._geoRetryAt = 0;
            } catch (err) {
                this._geoRetryAt = nowSec + geoRetryDelaySec(this._geoFailures);
                this._geoFailures++;
                log(`Weatherglass: GeoClue unusable (${err.message}); using IP lookup`);
            }
        }
        if (!fix) {
            try {
                fix = fixFromIp(await get(IPINFO_API));
            } catch {
                fix = fixFromIp(await get(IPAPI_API));
            }
        }
        fix = await labelFix(fix);
        this._fix = {latitude: fix.latitude, longitude: fix.longitude,
                     name: fix.name, at: nowSec};
        return this._fix;
    }

    /**
     * Full forecast for the card + animation engine, via the active
     * provider adapter. auto=true -> coordinates come from the
     * auto-location chain (GeoClue first). Values always come back in
     * canonical metric units (degC, km/h, mm/h); callers convert for
     * display.
     */
    async fetch({latitude, longitude, auto, days = 8, countryCode = '', placeName = ''}) {
        let lat = latitude;
        let lon = longitude;
        let detectedName = null;
        let alertCountry = countryCode;
        let alertPlace = placeName;
        if (auto) {
            const detectedLocation = await this.detectLocation();
            lat = detectedLocation.latitude;
            lon = detectedLocation.longitude;
            detectedName = detectedLocation.name || null;
            alertCountry = detectedLocation.countryCode || alertCountry;
            alertPlace = detectedName || alertPlace;
        }
        const alertCtx = {
            countryCode: alertCountry,
            placeNames: [alertPlace].filter(Boolean),
            nowIso: GLib.DateTime.now_local().format('%Y-%m-%dT%H:%M'),
        };
        const [data, alertData] = await Promise.all([
            this.provider.forecast({latitude: lat, longitude: lon,
                                    days, model: this.model}),
            fetchAlerts(lat, lon, alertCtx),
        ]);
        return {...data, ...alertData, detectedName,
                latitude: lat, longitude: lon};
    }

    /** City search for the preferences dialog. */
    async geocode(query) {
        const raw = await get(`${OPEN_METEO_GEOCODING_API}?${buildQueryString({name: query, count: 6,
                                                                              language: 'en', format: 'json'})}`);
        return (raw.results ?? []).map(result => ({
            name: result.name,
            admin: result.admin1 ?? '',
            country: result.country ?? '',
            countryCode: result.country_code ?? '',
            latitude: result.latitude,
            longitude: result.longitude,
        }));
    }
}
