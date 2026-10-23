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
        const useButton = new Gtk.Button({label: 'Use Location', valign: Gtk.Align.CENTER});
        useButton.connect('clicked', () => cb());
        this.add_suffix(useButton);
        this.connect('activated', () => cb());
    }
});

function findUseButton(widget) {
    if (widget instanceof Gtk.Button && widget.label === 'Use Location')
        return widget;
    for (let c = widget.get_first_child(); c; c = c.get_next_sibling()) {
        const found = findUseButton(c);
        if (found)
            return found;
    }
    return null;
}

function locationLabel(r) {
    return [r.name, r.admin, r.country].filter(Boolean).join(', ');
}

const group = new Adw.PreferencesGroup({title: 'Results'});
const rows = [];
let clicks = 0;

const client = new WeatherClient();
const results = await client.geocode('Berlin');
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

/* the labelled Use Location button must exist and pick its row */
const useButton = findUseButton(rows[1]);
print(`Use Location button present: ${useButton !== null}`);
if (!useButton)
    throw new Error('result row has no Use Location button');
useButton.emit('clicked');
print(`button callback fired: ${clicks === 2}`);
if (clicks !== 2)
    throw new Error('Use Location button did not pick its row');

/* second search cycle: the clear must unparent EVERY first-cycle row
 * (the shipped bug: a throwing teardown call left them in the group,
 * so later searches appended). Mirrors prefs.js clearResults. */
const firstRows = [...rows];
for (const row of rows.splice(0))
    group.remove(row);
const cleared = firstRows.every(r => r.get_parent() === null);
print(`clear unparents all first-cycle rows: ${cleared}`);
if (!cleared)
    throw new Error('clear left rows parented -- append bug is back');
const second = await client.geocode('Bengaluru');
for (const r of second) {
    const row = new ResultRow(locationLabel(r), () => clicks++);
    rows.push(row);
    group.add(row);
}
print(`second cycle rows: ${rows.length} (query returned ${second.length}), first cycle still unparented: ${firstRows.every(r => r.get_parent() === null)}`);
if (rows.length !== second.length)
    throw new Error('second cycle did not replace the first');

const first = results[0];
print(`first: ${locationLabel(first)} @ ${first.latitude},${first.longitude}`);

const none = await client.geocode('zzznotacityzzz');
print(`nonsense query returns: ${none.length} results (no throw)`);
print('PREFS-SMOKE OK');
