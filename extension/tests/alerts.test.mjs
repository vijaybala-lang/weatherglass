/* tests/alerts.test.mjs -- locks for the advisory parsers.
 * Fixtures are trimmed copies of live api.weather.gov and
 * api.met.no metalerts 2.0 payloads (sampled 2026-10-26); the locks
 * pin the two traps measured there: NWS sends BOTH ends (event over)
 * and expires (message stale) and "until" must read ends; MET's
 * GeoJSON carries onset only inside its title string, and its native
 * riskMatrixColor must win over the severity word.
 */
import { file, test, eq, ok, report } from './harness.mjs';
import { parseNwsAlerts, parseMetAlerts, parseEcccAlerts, parseCapAlerts,
         alertMatchesPoint, pointInPolygon, mergeAlerts, alertsForDay,
         ALERT_SOURCES } from '../weather.js';

file('alerts');

function nwsRaw() {
    return { features: [
        { properties: {
            id: 'urn:nws:1', event: 'Coastal Flood Advisory', headline: 'Coastal Flood Advisory issued...',
            severity: 'Minor', certainty: 'Likely', urgency: 'Expected',
            effective: '2026-10-25T18:12:00-07:00', onset: '2026-10-25T18:12:00-07:00',
            expires: '2026-10-26T10:00:00-07:00', ends: '2026-10-29T13:00:00-07:00',
            status: 'Actual', messageType: 'Update', category: 'Met',
            senderName: 'NWS San Francisco CA', areaDesc: 'San Francisco, CA',
            description: 'Minor coastal flooding...', instruction: 'Do not drive around barricades.',
            language: 'en-US', sent: '2026-10-25T18:12:00-07:00',
        } },
        { properties: {
            id: 'urn:nws:2', event: 'Severe Thunderstorm Warning', headline: 'Severe Thunderstorm Warning issued...',
            severity: 'Severe', certainty: 'Observed', urgency: 'Immediate',
            effective: '2026-10-25T21:06:00-06:00', onset: '2026-10-25T21:06:00-06:00',
            expires: '2026-10-25T21:30:00-06:00', ends: '2026-10-25T21:30:00-06:00',
            status: 'Actual', messageType: 'Alert', category: 'Met',
            senderName: 'NWS El Paso Tx', areaDesc: 'El Paso, TX',
            description: 'A severe thunderstorm...', instruction: 'Move indoors.',
            language: 'en-US', sent: '2026-10-25T21:06:00-06:00',
        } },
        { properties: {
            id: 'urn:nws:3', event: 'Frost Advisory', headline: 'Frost Advisory...',
            severity: 'Unknown', certainty: 'Likely', urgency: 'Expected',
            onset: '2026-10-26T01:00:00-07:00', ends: '2026-10-26T09:00:00-07:00',
            status: 'Actual', messageType: 'Alert', category: 'Met',
            senderName: 'NWS', areaDesc: 'Inland valleys', description: 'Frost...',
        } },
        { properties: {   // a cancellation must never render as an alert
            id: 'urn:nws:4', event: 'Flood Warning', severity: 'Moderate',
            status: 'Actual', messageType: 'Cancel', category: 'Met',
            onset: '2026-10-25T10:00:00-07:00', ends: '2026-10-26T10:00:00-07:00',
        } },
        { properties: {   // non-weather traffic stays out of a weather card
            id: 'urn:nws:5', event: '911 Telephone Outage', severity: 'Minor',
            status: 'Actual', messageType: 'Alert', category: 'Other',
            onset: '2026-10-25T10:00:00-07:00', ends: '2026-10-26T10:00:00-07:00',
        } },
    ] };
}

test('NWS: ends wins over expires for the until time', () => {
    const alerts = parseNwsAlerts(nwsRaw());
    const flood = alerts.find(a => a.id === 'urn:nws:1');
    eq(flood.endsAt, '2026-10-29T13:00');
    eq(flood.startsAt, '2026-10-25T18:12');
    eq(flood.level, 1);
    eq(flood.source, 'NOAA NWS');
    eq(flood.areas[0], 'San Francisco, CA');
});

test('NWS: severity words map to levels, Unknown stays null', () => {
    const alerts = parseNwsAlerts(nwsRaw());
    eq(alerts.find(a => a.id === 'urn:nws:2').level, 3);
    eq(alerts.find(a => a.id === 'urn:nws:3').level, null);
});

test('NWS: cancellations and non-Met alerts are dropped', () => {
    const ids = parseNwsAlerts(nwsRaw()).map(a => a.id);
    eq(ids.length, 3);
    ok(!ids.includes('urn:nws:4') && !ids.includes('urn:nws:5'));
});

function metRaw() {
    return { lang: 'en', features: [ { properties: {
        id: '2.49.0.1.578.0.1', area: 'Maaloey - Stad',
        awareness_level: '2; yellow; Moderate', awareness_type: '1; Wind',
        certainty: 'Likely', severity: 'Severe', riskMatrixColor: 'Yellow',
        status: 'Actual', type: 'Alert', event: 'gale', eventAwarenessName: 'Storm',
        title: 'Storm, yellow level, Maaloey - Stad, 2026-10-26T21:00:00+00:00, 2026-10-27T13:00:00+00:00',
        description: 'From Monday evening south gale force 8...',
        instruction: 'Do not go out in a small boat.',
        geographicDomain: 'marine',
    } } ] };
}

test('MET: native risk colour wins over the severity word', () => {
    const [a] = parseMetAlerts(metRaw());
    eq(a.level, 1);                    // Yellow, not Severe->3
    eq(a.severityLabel, 'Severe');    // issuer word still carried
    eq(a.event, 'Storm');
    eq(a.source, 'MET Norway');
    eq(a.language, 'en');
});

test('MET: validity window is read from the title ISO pair', () => {
    const [a] = parseMetAlerts(metRaw());
    ok(a.startsAt.startsWith('2026-10-26T') || a.startsAt.startsWith('2026-10-27T'),
       `startsAt should be the title onset in local time, got ${a.startsAt}`);
    ok(a.endsAt > a.startsAt, 'endsAt must be after startsAt');
});

test('merge: dedupes by id, sorts level desc with null last', () => {
    const nws = parseNwsAlerts(nwsRaw());
    const merged = mergeAlerts([nws, nws, parseMetAlerts(metRaw())]);
    eq(merged.length, 4);
    eq(merged[0].id, 'urn:nws:2');            // Severe first
    eq(merged[merged.length - 1].level, null); // Unknown last
});

const DAILY = [{ date: '2026-10-26' }, { date: '2026-10-27' },
               { date: '2026-10-28' }, { date: '2026-10-29' }];

test('day overlap: a Mon->Tue 03:00 alert belongs to both days', () => {
    const a = { startsAt: '2026-10-26T07:00', endsAt: '2026-10-27T03:00' };
    eq(alertsForDay([a], DAILY, 0).length, 1);
    eq(alertsForDay([a], DAILY, 1).length, 1);
    eq(alertsForDay([a], DAILY, 2).length, 0);
});

test('day overlap: ending exactly at midnight does not claim that day', () => {
    const a = { startsAt: '2026-10-26T07:00', endsAt: '2026-10-27T00:00' };
    eq(alertsForDay([a], DAILY, 1).length, 0);
});

test('day overlap: today shows everything upcoming, end-less counts its start day', () => {
    const later = { startsAt: '2026-10-27T09:00', endsAt: null };
    eq(alertsForDay([later], DAILY, 0).length, 1);   // today = active + upcoming
    eq(alertsForDay([later], DAILY, 1).length, 1);
    eq(alertsForDay([later], DAILY, 2).length, 0);
});

test('the adapter registry is the single interface the UI sits on', () => {
    eq(ALERT_SOURCES.map(s => s.id).join(','),
       'noaa-nws,met-norway,eccc-canada,meteoalarm');
    for (const source of ALERT_SOURCES) {
        eq(typeof source.fetch, 'function', `${source.id} fetch:`);
        eq(typeof source.parse, 'function', `${source.id} parse:`);
    }
    // every parser must emit the EXACT same key set: that key set is
    // the contract menu.js/citypage.js render against
    const keys = a => Object.keys(a).sort().join(',');
    eq(keys(parseNwsAlerts(nwsRaw())[0]), keys(parseMetAlerts(metRaw())[0]));
});

/* --- ECCC + CAP (fixtures trimmed from live payloads, 2026-10-26) --- */

const utcPlus1 = iso => iso.slice(0, 16);  // tests assert shape/filtering, not TZ math

function ecccRaw() {
    const square = [[-79.6, 43.5], [-79.1, 43.5], [-79.1, 43.9], [-79.6, 43.9], [-79.6, 43.5]];
    return { type: 'FeatureCollection', features: [
        { geometry: { type: 'Polygon', coordinates: [square] }, properties: {
            id: '123', alert_name_en: 'frost advisory', alert_text_en: 'Frost is expected tonight.',
            alert_type: 'advisory', risk_colour_en: 'yellow', certainty: undefined,
            confidence_en: 'High', status_en: 'continued', display_status: 'visible',
            validity_datetime: '2026-10-27T04:00:00.000Z',
            event_end_datetime: '2026-10-27T14:00:00.000Z',
            publication_datetime: '2026-10-26T20:58:52.000Z',
            feature_name_en: 'Burlington - Oakville',
        } },
        { geometry: { type: 'Polygon', coordinates: [square] }, properties: {
            id: '124', alert_name_en: 'frost advisory', status_en: 'ended',
            validity_datetime: '2026-10-27T04:00:00.000Z',
        } },
    ] };
}

test('ECCC: point-in-polygon keeps only alerts covering the point', () => {
    const at = { latitude: 43.7, longitude: -79.4, utcToLocal: utcPlus1 };
    const inside = parseEcccAlerts(ecccRaw(), at);
    eq(inside.length, 1);
    eq(inside[0].level, 1);
    eq(inside[0].event, 'Frost advisory');
    eq(inside[0].endsAt, '2026-10-27T14:00');
    eq(parseEcccAlerts(ecccRaw(), { ...at, longitude: -75 }).length, 0);
});

const MA_ATOM = `<?xml version="1.0"?><feed>
  <entry><cap:geocode><valueName>EMMA_ID</valueName><value>DE030</value></cap:geocode>
    <cap:areaDesc>Kreis Cuxhaven - Binnenland</cap:areaDesc>
    <cap:event>heavy thunderstorms</cap:event><cap:sent>2026-10-25T23:38:00+00:00</cap:sent>
    <cap:expires>2026-10-26T00:30:00+00:00</cap:expires><cap:onset>2026-10-25T23:38:00+00:00</cap:onset>
    <cap:certainty>Likely</cap:certainty><cap:severity>Moderate</cap:severity>
    <cap:urgency>Immediate</cap:urgency><cap:message_type>Alert</cap:message_type>
    <cap:status>Actual</cap:status><cap:identifier>w1</cap:identifier>
    <link type="application/cap+xml" href="https://feeds.meteoalarm.org/api/v1/warnings/feeds-germany/w1"/>
    <title>Orange Thunderstorm Warning issued for Germany - Kreis Cuxhaven</title></entry>
  <entry><cap:geocode><valueName>EMMA_ID</valueName><value>DE900</value></cap:geocode>
    <cap:areaDesc>Berlin</cap:areaDesc>
    <cap:event>heavy thunderstorms</cap:event><cap:sent>2026-10-25T23:38:00+00:00</cap:sent>
    <cap:expires>2026-10-26T00:30:00+00:00</cap:expires><cap:onset>2026-10-25T23:38:00+00:00</cap:onset>
    <cap:certainty>Likely</cap:certainty><cap:severity>Moderate</cap:severity>
    <cap:urgency>Immediate</cap:urgency><cap:message_type>Alert</cap:message_type>
    <cap:status>Actual</cap:status><cap:identifier>w1</cap:identifier>
    <link type="application/cap+xml" href="https://feeds.meteoalarm.org/api/v1/warnings/feeds-germany/w1"/>
    <title>Orange Thunderstorm Warning issued for Germany - Berlin</title></entry></feed>`;

test('CAP Atom: per-area entries group into one warning, title colour wins', () => {
    const cands = parseCapAlerts(MA_ATOM, { utcToLocal: utcPlus1 });
    eq(cands.length, 1);
    eq(cands[0].level, 2);
    eq(cands[0].areas.length, 2);
    eq(cands[0]._capLink.endsWith('/w1'), true);
    eq(cands[0]._geocodes.join(','), 'DE030,DE900');
});

test('CAP match: district-name match when the feed carries no geometry', () => {
    const [cand] = parseCapAlerts(MA_ATOM, { utcToLocal: utcPlus1 });
    eq(alertMatchesPoint(cand, { placeNames: ['Berlin'] }), true);
    eq(alertMatchesPoint(cand, { placeNames: ['Munich'] }), false);
});

const CAP_DOC = `<alert xmlns="urn:oasis:names:tc:emergency:cap:1.2">
  <identifier>c1</identifier><sender>x@y</sender><sent>2026-10-26T00:00:00+01:00</sent>
  <status>Actual</status><msgType>Alert</msgType>
  <info><language>de-DE</language><category>Met</category><event>STURM</event>
    <urgency>Immediate</urgency><severity>Severe</severity><certainty>Likely</certainty>
    <onset>2026-10-26T01:00:00+01:00</onset><expires>2026-10-26T09:00:00+01:00</expires>
    <senderName>DWD</senderName><headline>WARNUNG</headline>
    <description>Beschreibung &lt;80 km/h</description><instruction>Handeln</instruction>
    <area><areaDesc>Berlin</areaDesc>
      <polygon>52.40,13.30 52.40,13.60 52.60,13.60 52.60,13.30 52.40,13.30</polygon></area></info>
  <info><language>en</language><category>Met</category><event>STORM</event>
    <urgency>Immediate</urgency><severity>Severe</severity><certainty>Likely</certainty>
    <onset>2026-10-26T01:00:00+01:00</onset><expires>2026-10-26T09:00:00+01:00</expires>
    <senderName>DWD</senderName><headline>WARNING</headline>
    <description>English text</description><instruction>Act</instruction>
    <area><areaDesc>Berlin</areaDesc>
      <polygon>52.40,13.30 52.40,13.60 52.60,13.60 52.60,13.30 52.40,13.30</polygon></area></info></alert>`;

test('CAP doc: English info wins, polygon decides the match', () => {
    const [cand] = parseCapAlerts(CAP_DOC, { utcToLocal: utcPlus1 });
    eq(cand.event, 'STORM');
    eq(cand.description, 'English text');
    eq(alertMatchesPoint(cand, { latitude: 52.52, longitude: 13.405 }), true);
    eq(alertMatchesPoint(cand, { latitude: 48.14, longitude: 11.58 }), false);
    eq(pointInPolygon(52.52, 13.405, cand._polygons[0]), true);
});

report('alerts');
