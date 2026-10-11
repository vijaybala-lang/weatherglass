/* tests/location.test.mjs -- regression locks for the auto-location chain:
 * GeoClue zone labels, IP payload shapes, and the dead-GeoClue backoff.
 */
import { file, test, eq, ok } from './harness.mjs';
import { cityFromTimezone, fixFromIp, geoRetryDelaySec,
         desktopEntryText, desktopEntryName } from '../weather.js';

file('location');

test('a GeoClue label reads the city off its IANA zone', () => {
    eq(cityFromTimezone('Europe/Berlin'), 'Berlin');
    eq(cityFromTimezone('America/Los_Angeles'), 'Los Angeles');
});

test('bare zones and a missing timezone stay label-less', () => {
    eq(cityFromTimezone('UTC'), '');
    eq(cityFromTimezone(''), '');
    eq(cityFromTimezone(null), '');
});

test('ipinfo and ipapi payloads normalize to one fix shape', () => {
    const ipinfo = fixFromIp({loc: '52.5300,13.3800', city: 'Berlin', country: 'DE'});
    const ipapi = fixFromIp({latitude: 52.53, longitude: 13.38, city: 'Berlin'});
    eq(ipinfo.latitude, 52.53);
    eq(ipinfo.longitude, 13.38);
    eq(ipinfo.name, 'Berlin');
    eq(ipapi.latitude, ipinfo.latitude);
    eq(ipapi.longitude, ipinfo.longitude);
    eq(ipapi.name, ipinfo.name);
});

test('an ip payload without coordinates throws instead of fixing at 0,0', () => {
    let threw = false;
    try {
        fixFromIp({loc: '', city: 'Nowhere'});
    } catch (err) {
        threw = /IP geolocation failed/.test(err.message);
    }
    ok(threw, 'missing coordinates must fail the fix, never land on null island');
});

test('a dead GeoClue costs its probe penalty on quadrupling windows, capped daily', () => {
    eq(geoRetryDelaySec(0), 1800);
    eq(geoRetryDelaySec(1), 7200);
    eq(geoRetryDelaySec(2), 28800);
    eq(geoRetryDelaySec(3), 86400);
    eq(geoRetryDelaySec(9), 86400, 'cap:');
});

test('the consent entry names Weatherglass without polluting the app grid', () => {
    const text = desktopEntryText();
    ok(text.includes('Name=Weatherglass'), 'agent dialog reads the app name');
    ok(text.includes('X-Geoclue-Reason'), 'agent dialog reads the reason');
    ok(text.includes('NoDisplay=true'), 'must not surface in the app grid');
    ok(!text.includes('Exec='), 'nothing to launch: an entry the agent resolves, nothing more');
});

test('the consent entry file matches the id GeoClue is asked under', () => {
    eq(desktopEntryName(), 'dev.vijaybala.weatherglass.desktop');
});
