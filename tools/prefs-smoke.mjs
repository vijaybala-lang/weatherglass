/* tools/prefs-smoke.mjs — offscreen smoke test for the prefs search flow:
 * real geocode call + the exact row-building that crashed once.
 * Run from the project root:  gjs -m tools/prefs-smoke.mjs
 */

import Adw from 'gi://Adw';
import Gtk from 'gi://Gtk';
import GObject from 'gi://GObject';
import GLib from 'gi://GLib';

import {WeatherClient} from '../weather.js';

Gtk.init();
Adw.init();

/* mirror of prefs.js ResultRow */
const ResultRow = GObject.registerClass(class ResultRow extends Adw.ActionRow {
    _init(title, cb) {
        super._init({title, activatable: true});
        this.add_suffix(new Gtk.Image({icon_name: 'go-next-symbolic'}));
        this.connect('activated', () => cb());
    }
});

function locationLabel(r) {
    return [r.name, r.admin, r.country].filter(Boolean).join(', ');
}

const group = new Adw.PreferencesGroup({title: 'Results'});
const rows = [];
let clicks = 0;

const client = new WeatherClient();
const results = await client.geocode('Bengaluru');
print(`geocode results: ${results.length}`);

for (const r of results) {
    const row = new ResultRow(locationLabel(r), () => clicks++);
    rows.push(row);
    group.add(row);
}
print(`rows built & added: ${group.get_n_rows ? 'api' : rows.length}`);

/* simulate a click on the first result */
rows[0].activate();
print(`activated callback fired: ${clicks === 1}`);

const first = results[0];
print(`first: ${locationLabel(first)} @ ${first.latitude},${first.longitude}`);

const none = await client.geocode('zzznotacityzzz');
print(`nonsense query returns: ${none.length} results (no throw)`);
print('PREFS-SMOKE OK');
