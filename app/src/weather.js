// weather.js — data layer for WeatherGlass.
// Ported from the WeatherGlass GNOME Shell extension: Open-Meteo forecasts +
// geocoding, WMO 4677 normalization, rolling-24h "today" windowing.
// Canonical units are always metric internally; only display code converts.

import GLib from 'gi://GLib?version=2.0';
import Gio from 'gi://Gio?version=2.0';
import Gdk from 'gi://Gdk?version=4.0';
import Soup from 'gi://Soup?version=3.0';

export const OPEN_METEO_FORECAST_API = 'https://api.open-meteo.com/v1/forecast';
export const OPEN_METEO_GEOCODING_API = 'https://geocoding-api.open-meteo.com/v1/search';
export const NOAA_NWS_API = 'https://api.weather.gov';
export const MET_ALERTS_API = 'https://api.met.no/weatherapi/metalerts/2.0/current.json';
export const USER_AGENT = 'dev.vijaybala.weatherglassapp/1.0 (standalone GJS app)';

// --- brand texture ------------------------------------------------------------
// Loads the generated app icon straight from the checkout's data/icons so
// the window icon and About logo ride a process-owned texture — immune to
// the shell session's icon-theme cache lagging a file install until logout.

const BRAND_ID = 'dev.vijaybala.weatherglassapp';

export function brandTexture(px = 128) {
    try {
        const env = GLib.getenv('WEATHERGLASS_DATADIR');
        const dir = env
            ? Gio.File.new_for_path(env).get_child('icons')
            : Gio.File.new_for_uri(import.meta.url).get_parent() // src/
                .get_parent().get_child('data').get_child('icons');
        const f = dir.get_child(`${BRAND_ID}-${px}.png`);
        return f.query_exists(null) ? Gdk.Texture.from_filename(f.get_path()) : null;
    } catch (e) {
        return null;
    }
}


export const FORECAST_DAYS = 8;
export const HTTP_TIMEOUT_SEC = 15;
export const NOW_BACKFILL_HOURS = 2;

// ---------------------------------------------------------------------------
// HTTP

let _session = null;
function session() {
    if (!_session) {
        _session = new Soup.Session();
        _session.timeout = HTTP_TIMEOUT_SEC;
        _session.user_agent = USER_AGENT;
    }
    return _session;
}

function httpGetText(url) {
    return new Promise((resolve, reject) => {
        const msg = Soup.Message.new('GET', url);
        session().send_and_read_async(msg, GLib.PRIORITY_DEFAULT, null, (_s, res) => {
            try {
                const bytes = session().send_and_read_finish(res);
                if (msg.get_status() !== 200 || bytes === null) {
                    reject(new Error(`HTTP ${msg.get_status()} for ${url.split('?')[0]}`));
                    return;
                }
                resolve(new TextDecoder().decode(bytes.get_data()));
            } catch (e) {
                reject(e);
            }
        });
    });
}

function httpGetJson(url) {
    return httpGetText(url).then(text => JSON.parse(text));
}

function queryString(params) {
    return Object.entries(params)
        .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
        .join('&');
}

// ---------------------------------------------------------------------------
// Forecast fetch + normalization (shape mirrors the extension's WeatherProvider)

export function forecastUrl(lat, lon, days = FORECAST_DAYS) {
    return [
        OPEN_METEO_FORECAST_API, '?latitude=', lat.toString(),
        '&longitude=', lon.toString(),
        '&current=', [
            'temperature_2m', 'relative_humidity_2m', 'apparent_temperature', 'is_day',
            'precipitation', 'weather_code', 'cloud_cover', 'pressure_msl',
            'wind_speed_10m', 'wind_direction_10m', 'wind_gusts_10m',
            'uv_index', 'visibility', 'cape',
        ].join(','),
        '&hourly=', ['temperature_2m', 'precipitation_probability', 'wind_speed_10m',
            'weather_code', 'is_day', 'dew_point_2m'].join(','),
        '&daily=', [
            'weather_code', 'temperature_2m_max', 'temperature_2m_min',
            'apparent_temperature_max', 'apparent_temperature_min',
            'precipitation_probability_max', 'sunrise', 'sunset', 'uv_index_max',
            'wind_speed_10m_max', 'wind_gusts_10m_max',
            'wind_direction_10m_dominant', 'precipitation_sum',
            'precipitation_hours', 'daylight_duration',
        ].join(','),
        '&timezone=auto&forecast_days=', days.toString(),
        '&temperature_unit=celsius&wind_speed_unit=kmh',
    ].join('');
}

export async function fetchForecast(lat, lon, days = FORECAST_DAYS, alertCtx = {}) {
    const t0 = Date.now();
    const json = await httpGetJson(forecastUrl(lat, lon, days));
    if (!json.current || !json.hourly || !json.daily)
        throw new Error('malformed forecast payload');
    const data = normalize(json, t0);
    // advisories ride along but can never fail the forecast (fetchAlerts
    // swallows its own errors into alertsCoverage)
    const alertData = await fetchAlerts(lat, lon, data.cityClockOffsetMs, {
        ...alertCtx, nowIso: data.current.timeIso,
    });
    return { ...data, ...alertData };
}

function arr(a, i) {
    return Array.isArray(a) ? a[i] ?? null : null;
}

export function normalize(j, receivedWallMs = Date.now()) {
    const c = j.current;
    const h = j.hourly;
    const d = j.daily;
    const nDays = Math.min(d.time?.length ?? 0, FORECAST_DAYS);
    // Dew point is hourly-only in Open-Meteo: carry the hour bracketing
    // the current reading so the live tile shows a measured value.
    let dew = null;
    if (Array.isArray(h.time) && Array.isArray(h.dew_point_2m)) {
        const nowMs = naiveMs(c.time);
        for (let i = 0; i < h.time.length; i++) {
            if (naiveMs(h.time[i]) <= nowMs) dew = h.dew_point_2m[i] ?? dew;
            else break;
        }
    }
    return {
        fetchedAtWallMs: receivedWallMs,
        // city clock offset: naive city wall time at fetch minus our wall clock
        cityClockOffsetMs: naiveMs(c.time) - receivedWallMs,
        current: {
            temp: c.temperature_2m,
            feels: c.apparent_temperature,
            code: c.weather_code | 0,
            isDay: !!c.is_day,
            humidity: c.relative_humidity_2m,
            precip: c.precipitation ?? 0,
            cloud: c.cloud_cover ?? null,
            dew,
            wind: c.wind_speed_10m,
            windDeg: c.wind_direction_10m,
            gust: c.wind_gusts_10m ?? null,
            pressure: c.pressure_msl ?? null,
            uv: c.uv_index ?? null,
            visibility: c.visibility ?? null,
            cape: c.cape ?? null,
            timeIso: String(c.time ?? ''),
        },
        daily: Array.from({ length: nDays }, (_, i) => ({
            date: String(arr(d.time, i)),
            code: arr(d.weather_code, i) ?? 0,
            tmax: arr(d.temperature_2m_max, i),
            tmin: arr(d.temperature_2m_min, i),
            feelsMax: arr(d.apparent_temperature_max, i),
            feelsMin: arr(d.apparent_temperature_min, i),
            precipProb: arr(d.precipitation_probability_max, i),
            sunrise: String(arr(d.sunrise, i) ?? ''),
            sunset: String(arr(d.sunset, i) ?? ''),
            uv: arr(d.uv_index_max, i),
            windMax: arr(d.wind_speed_10m_max, i),
            gustMax: arr(d.wind_gusts_10m_max, i),
            windDir: arr(d.wind_direction_10m_dominant, i),
            precipSum: arr(d.precipitation_sum, i),
            precipHours: arr(d.precipitation_hours, i),
            daylightSec: arr(d.daylight_duration, i),
        })),
        hourly: {
            time: (h.time ?? []).map(String),
            temp: h.temperature_2m ?? [],
            precipProb: h.precipitation_probability ?? [],
            wind: h.wind_speed_10m ?? [],
            code: h.weather_code ?? [],
            isDay: h.is_day ?? [],
        },
    };
}

// ---------------------------------------------------------------------------
// Advisories — same normalized shape and rules as the extension's
// advisory layer (weather.js there): sources return alerts active or
// upcoming RIGHT NOW with a validity window; a day view is an overlap
// filter. Native risk colour (MET) wins over the severity word; CAP
// Unknown stays level null. Times are city-local naive ISO; MET's UTC
// stamps convert through the forecast's cityClockOffsetMs.

const SEVERITY_LEVEL = { Minor: 1, Moderate: 2, Severe: 3, Extreme: 3 };
const COLOUR_LEVEL = { yellow: 1, orange: 2, red: 3 };

function cleanAlertText(raw) {
    if (!raw)
        return '';
    return String(raw)
        .replace(/\r\n?/g, '\n')
        .trim()
        .split(/\n\s*\n|\n(?=\s*[*•-]\s)/)
        .map(para => para.replace(/\s*\n\s*/g, ' ').replace(/ {2,}/g, ' ').trim())
        .filter(Boolean)
        .join('\n\n');
}

export function parseNwsAlerts(raw) {
    const alerts = [];
    for (const feature of raw?.features ?? []) {
        const p = feature?.properties ?? {};
        if (p.status && p.status !== 'Actual') continue;
        if (p.messageType && p.messageType !== 'Alert' && p.messageType !== 'Update') continue;
        const cats = Array.isArray(p.category) ? p.category : [p.category];
        if (p.category && !cats.includes('Met')) continue;
        const startsAt = String(p.onset ?? p.effective ?? p.sent ?? '').slice(0, 16);
        if (!startsAt) continue;
        alerts.push({
            id: String(p.id ?? startsAt + (p.event ?? '')),
            event: p.event ?? '',
            headline: p.headline ?? null,
            level: SEVERITY_LEVEL[p.severity] ?? null,
            severityLabel: p.severity ?? '',
            certainty: p.certainty ?? null,
            urgency: p.urgency ?? null,
            startsAt,
            // ends (event over) wins over expires (message stale)
            endsAt: String(p.ends ?? p.expires ?? '').slice(0, 16) || null,
            issuedAt: String(p.sent ?? '').slice(0, 16) || null,
            description: cleanAlertText(p.description),
            instruction: cleanAlertText(p.instruction) || null,
            areas: String(p.areaDesc ?? '').split(';').map(s => s.trim()).filter(Boolean),
            sender: p.senderName ?? '',
            source: 'NOAA NWS',
            language: String(p.language ?? 'en').slice(0, 2),
        });
    }
    return alerts;
}

export function parseMetAlerts(raw, cityOffsetMs = 0) {
    const alerts = [];
    const isoRe = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?(?:Z|[+-]\d{2}:\d{2})/g;
    const toCity = iso => wallNaiveStamp(Date.parse(iso) + cityOffsetMs);
    for (const feature of raw?.features ?? []) {
        const p = feature?.properties ?? {};
        if (p.status && p.status !== 'Actual') continue;
        if (p.type && p.type !== 'Alert' && p.type !== 'Update') continue;
        const titleTimes = String(p.title ?? '').match(isoRe) ?? [];
        const onsetUtc = titleTimes[0] ?? '';
        const endsUtc = p.eventEndingTime ?? titleTimes[1] ?? '';
        if (!onsetUtc) continue;
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
            startsAt: toCity(onsetUtc),
            endsAt: endsUtc ? toCity(endsUtc) : null,
            issuedAt: null,
            description: cleanAlertText(p.description),
            instruction: cleanAlertText(p.instruction) || null,
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
    const utcToLocal = ctx.utcToLocal ?? (iso => iso.slice(0, 16));
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
            description: cleanAlertText(p[`alert_text_${lang}`]),
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
    const utcToLocal = ctx.utcToLocal ?? (iso => iso.slice(0, 16));
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
                description: cleanAlertText(xmlTag(info, 'description')),
                instruction: cleanAlertText(xmlTag(info, 'instruction')) || null,
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

export function mergeAlerts(lists) {
    const byId = new Map();
    for (const list of lists)
        for (const alert of list ?? [])
            if (!byId.has(alert.id)) byId.set(alert.id, alert);
    return [...byId.values()].sort((a, b) =>
        ((b.level ?? 0) - (a.level ?? 0)) ||
        (a.startsAt < b.startsAt ? -1 : a.startsAt > b.startsAt ? 1 : 0));
}

export function alertOverlapsDay(alert, date) {
    if (alert.startsAt.slice(0, 10) > date) return false;
    if (!alert.endsAt) return alert.startsAt.slice(0, 10) === date;
    if (alert.endsAt.slice(0, 10) < date) return false;
    return !(alert.endsAt.slice(0, 10) === date && alert.endsAt.slice(11, 16) === '00:00');
}

export function alertsForDay(alerts, daily, dayIndex) {
    if (dayIndex === 0) return alerts ?? [];
    const date = daily?.[dayIndex]?.date ?? '';
    if (!date) return [];
    return (alerts ?? []).filter(a => alertOverlapsDay(a, date));
}

export function alertUrl(alert, coords = null) {
    const lat = Array.isArray(coords) ? coords[0] : coords?.latitude;
    const lon = Array.isArray(coords) ? coords[1] : coords?.longitude;
    const hasCoords = Number.isFinite(lat) && Number.isFinite(lon);
    const src = alert?.source ?? '';
    if (src === 'NOAA NWS') {
        return hasCoords
            ? `https://forecast.weather.gov/MapClick.php?lat=${lat.toFixed(4)}&lon=${lon.toFixed(4)}`
            : 'https://www.weather.gov/alerts';
    }
    if (src === 'MET Norway') {
        return hasCoords
            ? `https://www.yr.no/en/forecast/daily-table/${lat.toFixed(4)},${lon.toFixed(4)}`
            : 'https://www.yr.no/en';
    }
    if (src === 'ECCC GeoMet') {
        return hasCoords
            ? `https://weather.gc.ca/?layers=alert&center=${lat.toFixed(4)},${lon.toFixed(4)}&zoom=9`
            : 'https://weather.gc.ca/';
    }
    return 'https://meteoalarm.org/en/live/';
}

// One adapter per advisory source, same contract as the extension:
// fetch(lat, lon, ctx) -> {alerts, outcome: 'ok'|'none'|'failed'},
// plus a pure parse(raw, ctx). Adding a source is one adapter plus
// one ALERT_SOURCES entry; the UI only sees the normalized shape.
const nwsAlertSource = {
    id: 'noaa-nws',
    parse: parseNwsAlerts,
    async fetch(lat, lon) {
        const point = `${Number(lat).toFixed(4)},${Number(lon).toFixed(4)}`;
        try {
            const raw = await httpGetJson(`${NOAA_NWS_API}/alerts/active?point=${point}`);
            return { alerts: parseNwsAlerts(raw), outcome: 'ok' };
        } catch (err) {
            return { alerts: [], outcome: /HTTP 400/.test(err.message) ? 'none' : 'failed' };
        }
    },
};

const metAlertSource = {
    id: 'met-norway',
    parse: parseMetAlerts,
    async fetch(lat, lon, cityOffsetMs = 0) {
        const locale = GLib.get_language_names()[0] ?? '';
        const lang = /^(nb|nn|no)/.test(locale) ? 'no' : 'en';
        try {
            const raw = await httpGetJson(`${MET_ALERTS_API}?lat=${Number(lat).toFixed(4)}`
                + `&lon=${Number(lon).toFixed(4)}&lang=${lang}`);
            const alerts = parseMetAlerts(raw, cityOffsetMs);
            const inNorway = lat >= 57.5 && lat <= 71.5 && lon >= 4 && lon <= 32;
            return { alerts, outcome: alerts.length || inNorway ? 'ok' : 'none' };
        } catch {
            return { alerts: [], outcome: 'failed' };
        }
    },
};

const ecccAlertSource = {
    id: 'eccc-canada',
    parse: parseEcccAlerts,
    async fetch(lat, lon, cityOffsetMs = 0) {
        if (!(lat >= 41 && lat <= 85 && lon >= -142 && lon <= -52))
            return { alerts: [], outcome: 'none' };
        const locale = GLib.get_language_names()[0] ?? '';
        const dLat = 50 / 111;
        const dLon = 50 / (111 * Math.cos(lat * Math.PI / 180));
        const url = `https://geo.weather.gc.ca/geomet?${queryString({
            SERVICE: 'WFS', VERSION: '2.0.0', REQUEST: 'GetFeature',
            TYPENAMES: 'Current-Alerts', outputFormat: 'application/json',
            BBOX: `${(lat - dLat).toFixed(4)},${(lon - dLon).toFixed(4)},`
                + `${(lat + dLat).toFixed(4)},${(lon + dLon).toFixed(4)},EPSG:4326`,
        })}`;
        try {
            const raw = await httpGetJson(url);
            return {
                alerts: parseEcccAlerts(raw, {
                    latitude: lat, longitude: lon,
                    language: locale.startsWith('fr') ? 'fr' : 'en',
                    utcToLocal: iso => wallNaiveStamp(Date.parse(iso) + cityOffsetMs),
                }),
                outcome: 'ok',
            };
        } catch {
            return { alerts: [], outcome: 'failed' };
        }
    },
};

// kept in sync with the extension table (same public legacy feeds)
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
    async fetch(lat, lon, cityOffsetMs = 0, ctx = {}) {
        const slug = METEOALARM_FEEDS[(ctx.countryCode ?? '').toUpperCase()];
        if (!slug) return { alerts: [], outcome: 'none' };
        const utcToLocal = iso => wallNaiveStamp(Date.parse(iso) + cityOffsetMs);
        try {
            const xml = await httpGetText(
                `https://feeds.meteoalarm.org/feeds/meteoalarm-legacy-atom-${slug}`);
            const matchCtx = { latitude: lat, longitude: lon, placeNames: ctx.placeNames ?? [] };
            const matched = parseCapAlerts(xml, { utcToLocal })
                .filter(cand => alertMatchesPoint(cand, matchCtx))
                .filter(cand => !ctx.nowIso || !cand.endsAt || cand.endsAt >= ctx.nowIso);
            const alerts = await Promise.all(matched.slice(0, 5).map(async cand => {
                if (!cand._capLink) return stripPrivate(cand);
                try {
                    const [full] = parseCapAlerts(await httpGetText(cand._capLink), { utcToLocal });
                    if (!full) return stripPrivate(cand);
                    if (full._polygons.length && !alertMatchesPoint(full, matchCtx)) return null;
                    return stripPrivate({
                        ...cand,
                        description: full.description || cand.description,
                        instruction: full.instruction,
                        headline: full.headline ?? cand.headline,
                        sender: full.sender || cand.sender,
                        language: full.language || cand.language,
                    });
                } catch { return stripPrivate(cand); }
            }));
            return { alerts: alerts.filter(Boolean), outcome: 'ok' };
        } catch { return { alerts: [], outcome: 'failed' }; }
    },
};

export const ALERT_SOURCES = [nwsAlertSource, metAlertSource,
    ecccAlertSource, meteoalarmAlertSource];

async function fetchAlerts(lat, lon, cityOffsetMs = 0, alertCtx = {}) {
    const results = await Promise.all(
        ALERT_SOURCES.map(source => source.fetch(lat, lon, cityOffsetMs, alertCtx)));
    let alertsCoverage = 'none';
    if (results.some(r => r.outcome === 'ok')) alertsCoverage = 'ok';
    else if (results.some(r => r.outcome === 'failed')) alertsCoverage = 'failed';
    return { alerts: mergeAlerts(results.map(r => r.alerts)), alertsCoverage };
}

// ---------------------------------------------------------------------------
// Geocoding

export async function geocode(query) {
    const url = `${OPEN_METEO_GEOCODING_API}?name=${encodeURIComponent(query)}`
        + '&count=6&language=en&format=json';
    const json = await httpGetJson(url);
    return (json.results ?? []).map(r => ({
        name: r.name,
        admin1: r.admin1 ?? '',
        country: r.country ?? '',
        countryCode: r.country_code ?? '',
        latitude: r.latitude,
        longitude: r.longitude,
    }));
}

export function locationLabel(loc) {
    const bits = [];
    if (loc.admin1 && loc.admin1 !== loc.name) bits.push(loc.admin1);
    if (loc.country) bits.push(loc.country);
    return bits.join(', ');
}

// ---------------------------------------------------------------------------
// WMO 4677 → description + scene vocabulary
// scene ∈ sun moon partly cloud fog wind rain sleet snow hail storm

const W = (desc, scene) => ({ desc, scene });

export const WMO = {
    0: W('Clear sky', 'sun'),
    1: W('Mainly clear', 'sun'),
    2: W('Partly cloudy', 'partly'),
    3: W('Overcast', 'cloud'),
    45: W('Fog', 'fog'),
    48: W('Depositing rime fog', 'fog'),
    51: W('Light drizzle', 'rain'),
    53: W('Drizzle', 'rain'),
    55: W('Dense drizzle', 'rain'),
    56: W('Light freezing drizzle', 'sleet'),
    57: W('Dense freezing drizzle', 'sleet'),
    61: W('Light rain', 'rain'),
    63: W('Rain', 'rain'),
    65: W('Heavy rain', 'rain'),
    66: W('Light freezing rain', 'sleet'),
    67: W('Heavy freezing rain', 'sleet'),
    71: W('Light snow', 'snow'),
    73: W('Snow', 'snow'),
    75: W('Heavy snow', 'snow'),
    77: W('Snow grains', 'snow'),
    80: W('Light showers', 'rain'),
    81: W('Showers', 'rain'),
    82: W('Violent showers', 'rain'),
    85: W('Snow showers', 'snow'),
    86: W('Heavy snow showers', 'snow'),
    95: W('Thunderstorm', 'storm'),
    96: W('Thunderstorm with hail', 'hail'),
    99: W('Thunderstorm with heavy hail', 'hail'),
};

// Precipitation severity tiers (particle density for the painter).
const CODE_PRECIP_INTENSITY = {
    51: 1, 53: 2, 55: 3, 56: 3, 57: 4, 61: 1, 63: 2, 65: 3, 66: 3, 67: 4,
    71: 1, 73: 2, 75: 3, 77: 1, 80: 1, 81: 2, 82: 3, 85: 2, 86: 3, 95: 5, 96: 6, 99: 6,
};

export function wmoInfo(code) {
    return WMO[code] ?? { desc: 'Unknown', scene: 'cloud' };
}

// Per-code glyph variants: family art WITHIN a scene, mirroring the
// per-code coverage matrix -- drizzle's
// sparser count, showers' peeking sun/moon, grains instead of flakes, the
// bolt beside hailstones. Kept in lockstep with the extension's
// variantForCode (weather.js there); the painter consumes the names.
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

export function sceneFor(code, isDay) {
    const { desc, scene } = wmoInfo(code);
    const night = !isDay;
    const variant = variantForCode(code);
    if (scene === 'sun' && night) return { desc, scene: 'moon', night: true, variant };
    return { desc, scene, night, variant };
}

// Open-Meteo rarely emits 45/48/95/96/99 — raw physics wins, as in the
// extension's deriveScene: CAPE + liquid precip imply storms/hail; poor
// visibility implies fog.
export function deriveScene(current) {
    const { code, cape, visibility, precip } = current;
    const liquid = code >= 51 && code <= 82 && ![56, 57, 66, 67].includes(code);
    if (code === 96 || code === 99 || ((cape ?? 0) >= 2500 && liquid))
        return {
            desc: 'Thunderstorm with hail', scene: 'hail', night: !current.isDay,
            variant: code === 99 ? 'stormhailheavy' : 'stormhail',
        };
    if (code === 95 || ((cape ?? 0) >= 1200 && liquid))
        return { desc: 'Thunderstorm', scene: 'storm', night: !current.isDay, variant: null };
    if ((visibility ?? Infinity) < 1000 && !(precip > 0))
        return { desc: 'Fog', scene: 'fog', night: !current.isDay, variant: null };
    return sceneFor(code, current.isDay);
}

export function precipIntensity(code) {
    return CODE_PRECIP_INTENSITY[code] ?? 0;
}

// Calm scenes give way to the windy scene above this wind speed.
export const WINDY_THRESHOLD_KMH = 30;
const CALM_SCENES = new Set(['sun', 'moon', 'partly', 'cloud', 'fog']);

export function effectiveScene(current, windyKmh = WINDY_THRESHOLD_KMH) {
    const s = deriveScene(current);
    if (windyKmh > 0 && (current.wind ?? 0) >= windyKmh && CALM_SCENES.has(s.scene))
        return { ...s, scene: 'wind' };
    return s;
}

// ---------------------------------------------------------------------------
// Hourly windowing (daySlice): today = rolling 24 h from now with backfill,
// future days = exact calendar slices. All math uses the provider's own
// local date stamps so the viewer's timezone never tips a boundary.

function naiveMs(iso) {
    // 'YYYY-MM-DDTHH(:mm:ss)' → ms treating it as UTC, purely for comparisons.
    const m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?/.exec(iso || '');
    if (!m) return NaN;
    return Date.UTC(+m[1], +m[2] - 1, +m[3], +(m[4] ?? 0), +(m[5] ?? 0));
}

export function cityWallMs(data, realNowMs = Date.now()) {
    return realNowMs + (data?.cityClockOffsetMs ?? 0);
}

function sliceFrom(hourly, idxs) {
    const pick = a => idxs.map(i => a[i] ?? null);
    return {
        time: pick(hourly.time),
        temp: pick(hourly.temp),
        precipProb: pick(hourly.precipProb),
        wind: pick(hourly.wind),
        code: pick(hourly.code),
        isDay: pick(hourly.isDay),
    };
}

// dayIndex 0 = today (rolling), 1..n = upcoming calendar days.
// `cityWallMs` must be city wall time (see cityWallMs()): reading it through
// the UTC getters below yields the city's naive clock stamp in any viewer TZ.
export function daySlice(hourly, daily, dayIndex, cityWall) {
    const times = hourly.time;
    let idxs = [];
    if (dayIndex === 0) {
        const nowNaive = naiveMs(wallNaiveStamp(cityWall));
        const back = nowNaive - NOW_BACKFILL_HOURS * 3600e3;
        const end = nowNaive + 23.5 * 3600e3;
        for (let i = 0; i < times.length; i++) {
            const t = naiveMs(times[i]);
            if (t >= back && t <= end) idxs.push(i);
        }
        if (idxs.length < 3 && times.length) idxs = [...Array(Math.min(times.length, 24))].map((_, i) => i);
    } else {
        const day = daily[Math.min(dayIndex, daily.length - 1)];
        for (let i = 0; i < times.length; i++)
            if (times[i].startsWith(day.date)) idxs.push(i);
    }
    const slice = sliceFrom(hourly, idxs);
    slice.dayIndex = dayIndex;
    slice.nowFrac = 0;
    if (dayIndex === 0 && idxs.length > 1) {
        const first = naiveMs(slice.time[0]);
        const last = naiveMs(slice.time[idxs.length - 1]);
        const now = naiveMs(wallNaiveStamp(cityWall));
        slice.nowFrac = last > first ? Math.min(1, Math.max(0, (now - first) / (last - first))) : 0;
    }
    return slice;
}

// hour stamp (naive, 'YYYY-MM-DDTHH:mm') for city-wall milliseconds —
// reading the number through UTC getters yields the city's local reading.
function wallNaiveStamp(cityWall) {
    const d = new Date(cityWall);
    const p = n => String(n).padStart(2, '0');
    return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}T${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`;
}

// ---------------------------------------------------------------------------
// Formatting — display converts from canonical metric

export function fmtTemp(c, units) {
    if (c == null || Number.isNaN(c)) return '—';
    return `${Math.round(units === 'imperial' ? c * 9 / 5 + 32 : c)}°`;
}

export function fmtWind(kmh, units) {
    if (kmh == null) return '—';
    const v = units === 'imperial' ? kmh * 0.621371 : kmh;
    return `${Math.round(v)} ${units === 'imperial' ? 'mph' : 'km/h'}`;
}

export function fmtPressure(hpa, units) {
    if (hpa == null) return '—';
    return units === 'imperial'
        ? `${(hpa * 0.02953).toFixed(2)} inHg`
        : `${Math.round(hpa)} hPa`;
}

export function fmtVisibility(meters, units) {
    if (meters == null) return '—';
    return units === 'imperial'
        ? `${(meters / 1609.34).toFixed(1)} mi`
        : `${(meters / 1000).toFixed(meters >= 10000 ? 0 : 1)} km`;
}

export function fmtPrecipRate(mmPerH, units) {
    if (mmPerH == null) return '—';
    return units === 'imperial'
        ? `${(mmPerH / 25.4).toFixed(2)} in/h`
        : `${mmPerH.toFixed(1)} mm/h`;
}

export function fmtPrecipTotal(mm, units) {
    if (mm == null) return '—';
    return units === 'imperial'
        ? `${(mm / 25.4).toFixed(2)} in`
        : `${mm.toFixed(1)} mm`;
}

export function fmtDuration(seconds) {
    if (seconds == null || Number.isNaN(seconds)) return '—';
    const mins = Math.round(seconds / 60);
    return `${Math.floor(mins / 60)}h ${String(mins % 60).padStart(2, '0')}m`;
}

const COMPASS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE',
    'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];

// Bearing the wind is blowing FROM, as a compass label.
export function compass(deg) {
    if (deg == null) return '';
    return COMPASS[Math.round(((deg % 360) + 360) % 360 / 22.5) % 16];
}

export function uvBand(uv) {
    if (uv == null) return { label: '', key: 'muted' };
    if (uv < 3) return { label: 'Low', key: 'good' };
    if (uv < 6) return { label: 'Moderate', key: 'warn' };
    if (uv < 8) return { label: 'High', key: 'hot' };
    return { label: 'Very high', key: 'hot' };
}

export function fmtClock(naiveWallMs, h12) {
    const d = new Date(naiveWallMs);
    let h = d.getUTCHours();
    const mi = String(d.getUTCMinutes()).padStart(2, '0');
    if (!h12) return `${String(h).padStart(2, '0')}:${mi}`;
    const ap = h >= 12 ? 'PM' : 'AM';
    h = h % 12 || 12;
    return `${String(h).padStart(2, '0')}:${mi} ${ap}`;
}

export function fmtDayStamp(naiveWallMs) {
    const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const d = new Date(naiveWallMs);
    return `${days[d.getUTCDay()]}, ${months[d.getUTCMonth()]} ${d.getUTCDate()}`;
}

// ISO 'YYYY-MM-DDTHH:mm' → display per 12/24 h preference (naive, city-local)
export function fmtLocalIso(iso, h12) {
    if (!iso) return '—';
    return fmtClock(naiveMs(iso), h12);
}

export function shortHourLabel(iso, h12) {
    // 'HH:00' or '3a' style, compact enough for chart axes.
    const m = /[T ](\d{2}):/.exec(iso || '');
    if (!m) return '';
    let h = +m[1];
    if (!h12) return `${String(h).padStart(2, '0')}`;
    const ap = h >= 12 ? 'p' : 'a';
    h = h % 12 || 12;
    return `${h}${ap}`;
}

export function dayName(dateIso) {
    const t = naiveMs(dateIso);
    if (Number.isNaN(t)) return '';
    return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][new Date(t).getUTCDay()];
}

// ---------------------------------------------------------------------------
// Sun almanac (ported from the extension's weather.js): low-precision NOAA
// — Julian century → equation of time → declination → hour angle at zenith
// 90.833°. Gives every provider one continuous solar path. Feed it CITY WALL
// time so the "civil timeline" lines up with the city's clock.

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
    const varY = Math.tan((eps * rad) / 2) ** 2;
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
    const hourAngle = (solarTimeMin / 4 - 180) * rad;          // cos is 360-deg periodic
    const altitude = Math.asin(Math.sin(lat * rad) * Math.sin(decl) +
        Math.cos(lat * rad) * Math.cos(decl) * Math.cos(hourAngle)) / rad;
    return {altitude, sunrise, sunset};
}

/** Live sun shading (menu.js `_sunShade` port): altitude from the almanac →
 * glow peaks at the horizon crossing (±12° smoothstep), solar is the 0..1
 * climb from sunrise through noon. Computed at paint time, cached per
 * minute. `wallMs` must be CITY WALL time. */
const _shadeCache = new Map(); // key -> {minute, glow, solar}
export function sunShade(key, lat, lon, wallMs) {
    const minute = Math.floor(wallMs / 60000);
    const hit = _shadeCache.get(key);
    if (hit && hit.minute === minute)
        return { glow: hit.glow, solar: hit.solar };
    const sun = sunGeometry(lat, lon, minute * 60000);
    let glow = 0;
    let solar = null;
    if (sun.altitude > -12 && sun.altitude < 12) {
        const near = 1 - Math.abs(sun.altitude) / 12; // ±12 deg golden band
        glow = near * near * (3 - 2 * near);
    }
    if (sun.sunrise !== null && sun.altitude > 0) {
        const f = (minute * 60000 - sun.sunrise) / (sun.sunset - sun.sunrise);
        solar = Math.sin(Math.PI * Math.min(1, Math.max(0, f)));
    }
    _shadeCache.set(key, { minute, glow, solar });
    return { glow, solar };
}

// ---------------------------------------------------------------------------
// Moon phase (synodic model, as in the extension's moon.js)

export const SYNODIC_MONTH_DAYS = 29.530588853;
export const NEW_MOON_EPOCH = Date.UTC(2000, 0, 6, 18, 14);

export function moonPhase(dateMs = Date.now()) {
    let f = (((dateMs - NEW_MOON_EPOCH) / 86400000) % SYNODIC_MONTH_DAYS) / SYNODIC_MONTH_DAYS;
    if (f < 0) f += 1;
    const illum = (1 - Math.cos(2 * Math.PI * f)) / 2;
    let name;
    if (f < 0.03 || f > 0.97) name = 'New moon';
    else if (f < 0.22) name = 'Waxing crescent';
    else if (f < 0.28) name = 'First quarter';
    else if (f < 0.47) name = 'Waxing gibbous';
    else if (f < 0.53) name = 'Full moon';
    else if (f < 0.72) name = 'Waning gibbous';
    else if (f < 0.78) name = 'Last quarter';
    else name = 'Waning crescent';
    return { phase: f, illum, name };
}

// ---------------------------------------------------------------------------
// Misc helpers shared across UI

export function relTime(fromWallMs, nowMs = Date.now()) {
    const mins = Math.max(0, Math.round((nowMs - fromWallMs) / 60000));
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins} min ago`;
    const h = Math.floor(mins / 60);
    return h === 1 ? '1 hour ago' : `${h} hours ago`;
}

export function sleepSeconds(sec) {
    return new Promise(resolve => {
        GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, Math.max(1, Math.round(sec)), () => {
            resolve();
            return GLib.SOURCE_REMOVE;
        });
    });
}

// Module-mode replacements for the legacy script globals log/print/logError.
export function logw(msg) {
    printerr(`WeatherGlass: ${msg}`);
}

export function logerr(e, label = 'error') {
    const msg = e?.message ?? e;
    printerr(`WeatherGlass: ${label}: ${e?.name}: ${msg}\n${e?.stack ?? ''}`);
}

// Minimal event bus (pages subscribe filtered by city id).
export class Bus {
    #handlers = new Map();

    on(event, fn) {
        if (!this.#handlers.has(event)) this.#handlers.set(event, new Set());
        this.#handlers.get(event).add(fn);
        return () => this.off(event, fn);
    }

    off(event, fn) {
        this.#handlers.get(event)?.delete(fn);
    }

    emit(event, ...args) {
        for (const fn of this.#handlers.get(event) ?? []) {
            try {
                fn(...args);
            } catch (e) {
                logerr(e, `bus handler for "${event}"`);
            }
        }
    }
}
