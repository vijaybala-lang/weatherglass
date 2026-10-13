/* tests/provider.test.mjs -- regression locks for the provider parse()
 * path. parse() is the seam between a vendor's JSON and the one shape
 * the UI consumes; these locks pin what happens when a model's data
 * ENDS EARLY (3-hourly models return nulls past their horizon) or
 * SKIPs a variable -- silent nulls are how a chart starts drawing
 * honest-looking lies (Math.min coerces null to 0, so one null point
 * fakes a 0-degree cliff and skews the whole y-window).
 */
import { file, test, eq, ok } from './harness.mjs';
import { WeatherClient } from '../weather.js';

file('provider');

const openMeteo = new WeatherClient('open-meteo').provider;

/* A raw response exactly as forecast() requests it. nullsFrom: the hour
 * index at which the hourly core fields go null, mimicking a 3-hourly
 * model whose run ends early (nulls arrive as a SUFFIX, like the API
 * actually sends them). */
function rawResponse(hours, {nullsFrom = Infinity} = {}) {
    const time = [], temp = [], wind = [], code = [], isDay = [], prob = [];
    for (let i = 0; i < hours; i++) {
        const day = Math.floor(i / 24), hour = i % 24;
        time.push(`2026-11-${String(day + 1).padStart(2, '0')}T` +
                  `${String(hour).padStart(2, '0')}:00`);
        const gone = i >= nullsFrom;
        temp.push(gone ? null : 10 + (hour % 5));
        wind.push(gone ? null : 12);
        code.push(gone ? null : 1);
        isDay.push(gone ? null : (hour >= 7 && hour <= 17 ? 1 : 0));
        prob.push(gone ? null : 20);
    }
    const dailyN = Math.ceil(hours / 24);
    const dTime = [], dCode = [], dMax = [], dMin = [], dSun = [];
    for (let d = 0; d < dailyN; d++) {
        const gone = (d + 1) * 24 > nullsFrom;
        dTime.push(`2026-11-${String(d + 1).padStart(2, '0')}`);
        dCode.push(gone ? null : 1);
        dMax.push(gone ? null : 15);
        dMin.push(gone ? null : 5);
        dSun.push(`${dTime[d]}T07:00`);
    }
    return {
        current: {time: '2026-11-01T13:00', temperature_2m: 11,
                  relative_humidity_2m: 60, apparent_temperature: 10, is_day: 1,
                  precipitation: 0, weather_code: 1, cloud_cover: 40,
                  wind_speed_10m: 12, wind_direction_10m: 180, uv_index: 1,
                  visibility: 20000, cape: 10},
        hourly: {time, temperature_2m: temp, precipitation_probability: prob,
                 wind_speed_10m: wind, weather_code: code, is_day: isDay},
        daily: {time: dTime, weather_code: dCode, temperature_2m_max: dMax,
                temperature_2m_min: dMin, precipitation_probability_max: [],
                uv_index_max: [], wind_speed_10m_max: [],
                sunrise: dSun,
                sunset: dSun.map(s => s.replace('T07', 'T17'))},
    };
}

const noNulls = arr => !arr.some(v => v === null || v === undefined);

test('a complete response survives parse untouched', () => {
    const {hourly, daily} = openMeteo.parse(rawResponse(48), {days: 2});
    eq(hourly.temp.length, 48);
    eq(hourly.time.length, 48);
    eq(daily.length, 2);
    ok(noNulls(hourly.temp) && noNulls(hourly.wind) && noNulls(hourly.code));
});

test('the horizon stops every hourly array where data stops', () => {
    // a model that ends its run at hour 36: hours 36-47 arrive as nulls
    const {hourly, daily} = openMeteo.parse(rawResponse(48, {nullsFrom: 36}),
                                            {days: 2});
    eq(hourly.temp.length, 36);
    eq(hourly.time.length, 36);
    eq(hourly.wind.length, 36);
    eq(hourly.code.length, 36);
    eq(hourly.isDay.length, 36);
    eq(hourly.precipProb.length, 36);
    ok(noNulls(hourly.temp) && noNulls(hourly.wind) && noNulls(hourly.code) &&
       noNulls(hourly.isDay), 'returned arrays must be null-free');
    // day 2 has no data at all: it is honestly absent, not half-null
    eq(daily.length, 1);
    ok(noNulls(daily.map(d => d.code)));
});

test('a gap before the suffix still cuts the series at the gap', () => {
    // policy: no interpolation, no fabrication -- the first missing core
    // sample ends the series; a shorter card is honest, a made-up point
    // is not
    const raw = rawResponse(48);
    raw.hourly.wind_speed_10m[10] = null;
    const {hourly} = openMeteo.parse(raw, {days: 2});
    eq(hourly.temp.length, 10);
    eq(hourly.code.length, 10);
});
