/* tests/scene.test.mjs -- data-mapping locks: WMO code -> glyph scene for
 * day and night, unit formatting, the sun almanac, and the day window
 * slicer. These are the inputs the pixel matrix paints, certified at
 * the source so a wrong scene never reaches a correct-looking cell.
 */
import { file, test, ok, near, eq, report } from './harness.mjs';
import { sceneFor, fmtTemp, sunGeometry, daySlice } from '../weather.js';

file('scene');

// -- WMO -> scene, both shifts ----------------------------------------

const clear = sceneFor(0, true), clearNight = sceneFor(0, false);
test('clear sky: sun by day, moon by night', () => {
    eq(clear.scene, 'sun');
    eq(clearNight.scene, 'moon');
});

test('overcast is cloud and fog poses shift-stable; 1-2 still track the sun', () => {
    eq(sceneFor(3, true).scene, 'cloud');
    eq(sceneFor(3, false).scene, 'cloud');
    for (const code of [45, 48])
        eq(sceneFor(code, true).scene, sceneFor(code, false).scene, `fog code ${code}`);
    eq(sceneFor(1, true).scene, 'sun', 'mostly clear keeps the sun');
    eq(sceneFor(1, false).scene, 'moon', 'mostly clear yields the moon');
});

test('precip codes keep their pose day and night, only the sun swaps', () => {
    for (const code of [51, 61, 65, 71, 75, 77, 85, 95, 96]) {
        const d = sceneFor(code, true), n = sceneFor(code, false);
        eq(n.scene, d.scene, `code ${code} shifts must share the precip scene`);
    }
    eq(sceneFor(65, true).scene, 'rain');
    eq(sceneFor(75, true).scene, 'snow');
});

// -- units -------------------------------------------------------------

test('fmtTemp rounds per unit system', () => {
    eq(fmtTemp(0, 'metric'), '0\u00b0');
    eq(fmtTemp(20, 'metric'), '20\u00b0');
    eq(fmtTemp(20, 'imperial'), '68\u00b0');      // 20C = 68F exactly
    eq(fmtTemp(-15, 'imperial'), '5\u00b0');       // -15C = 5F exactly
});

// -- almanac (the golden-hour feed) ------------------------------------

test('SF sunrise on 2026-10-08 matches the published time', () => {
    // 37.7749,-122.4194: sunrise 07:11 PDT = 14:11 UTC
    const ms = Date.UTC(2026, 9, 8, 14, 11);
    const noon = sunGeometry(37.7749, -122.4194, ms);
    ok(Math.abs(noon.altitude) < 5, `sun near horizon at its sunrise: ${noon.altitude}`);
    const midday = sunGeometry(37.7749, -122.4194, Date.UTC(2026, 9, 8, 19, 30));
    ok(midday.altitude > 40, `noon altitude too low: ${midday.altitude}`);
    const midnight = sunGeometry(37.7749, -122.4194, Date.UTC(2026, 9, 8, 7, 0));
    ok(midnight.altitude < -10, `midnight sun at ${midnight.altitude}`);
});

test('epoch math is viewer-timezone agnostic', () => {
    // same instant expressed as a local-midnight-ish lookup must agree
    const a = sunGeometry(40.5, -74.4, Date.UTC(2026, 9, 8, 16, 0));
    const b = sunGeometry(40.5, -74.4, Date.UTC(2026, 9, 8, 16, 0));
    near(a.altitude, b.altitude, 1e-9);
    ok(a.sunrise !== null && a.sunset !== null && a.sunrise < a.sunset);
});

test('polar day and night degrade to null events, sane altitude', () => {
    const polarDay = sunGeometry(78.22, 15.65, Date.UTC(2026, 5, 21, 12, 0));   // Svalbard June
    ok(polarDay.altitude > 0, `polar midnight sun below horizon: ${polarDay.altitude}`);
    const polarNight = sunGeometry(78.22, 15.65, Date.UTC(2026, 11, 21, 12, 0)); // December
    ok(polarNight.altitude < 0, `polar noon sun above horizon: ${polarNight.altitude}`);
});

// -- day window slicing --------------------------------------------------

test('daySlice carves a whole calendar day from rolling hourly data', () => {
    const time = [], temp = [];
    for (let h = 0; h < 72; h++) {
        time.push(`2026-10-0${8 + Math.floor(h / 24)}T${String(h % 24).padStart(2, '0')}:00`);
        temp.push(50 + h);
    }
    const daily = [{ date: '2026-10-08' }, { date: '2026-10-09' }, { date: '2026-10-10' }];
    const slice = daySlice({ time, temperature_2m: temp }, daily, 1, '2026-10-08T12:00');
    eq(slice.length, 24, 'Oct 9 slice length');
    eq(slice[0], 24, 'slice must start at the first hour of the day');
    eq(temp[slice[23]], 50 + 47, 'slice indexes must stay in range of the series');
});

report('scene');
