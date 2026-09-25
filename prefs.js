/* prefs.js — preferences dialog. */

import Adw from 'gi://Adw';
import Gtk from 'gi://Gtk';
import Gio from 'gi://Gio';
import GObject from 'gi://GObject';

import {ExtensionPreferences} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

import {WeatherClient} from './weather.js';

const UNITS = ['metric', 'imperial'];

function locationLabel(r) {
    return [r.name, r.admin, r.country].filter(Boolean).join(', ');
}

/* Row that fires a callback when it is clicked. */
const ResultRow = GObject.registerClass(class ResultRow extends Adw.ActionRow {
    _init(title, cb) {
        super._init({title, activatable: true});
        this.add_suffix(new Gtk.Image.from_icon_name('go-next-symbolic'));
        this.connect('activated', () => cb());
    }
});

export default class AnimatedWeatherPrefs extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();
        const client = new WeatherClient();
        window.set_default_size(560, 640);

        window.add(this._locationPage(settings, client));
        window.add(this._displayPage(settings));
    }

    /* ── location ───────────────────────────────────────────────────────── */

    _locationPage(settings, client) {
        const page = new Adw.PreferencesPage({
            title: 'Location',
            icon_name: 'find-location-symbolic',
        });

        const autoGroup = new Adw.PreferencesGroup({
            title: 'Automatic',
            description: 'Coordinates are detected from your public IP address',
        });
        const autoRow = new Adw.SwitchRow({
            title: 'Detect location automatically',
        });
        settings.bind('auto-location', autoRow, 'active',
                      Gio.SettingsBindFlags.DEFAULT);
        autoGroup.add(autoRow);
        page.add(autoGroup);

        // ── search ────────────────────────────────────────────────────────
        const searchGroup = new Adw.PreferencesGroup({title: 'Search a city'});
        const searchEntry = new Adw.EntryRow({
            title: 'City name — press Enter to search',
        });
        searchGroup.add(searchEntry);

        const resultsGroup = new Adw.PreferencesGroup({
            title: 'Results',
            visible: false,
        });

        // this libadwaita has no get_rows()/remove_by_offset(): track rows
        const resultRows = [];
        const clearResults = () => {
            for (const row of resultRows.splice(0)) {
                resultsGroup.remove(row);
                row.destroy();
            }
            resultsGroup.visible = false;
        };

        const choose = r => {
            settings.set_boolean('auto-location', false);
            settings.set_double('location-latitude', r.latitude);
            settings.set_double('location-longitude', r.longitude);
            settings.set_string('location-name', locationLabel(r));
            latEntry.set_text(String(r.latitude));
            lonEntry.set_text(String(r.longitude));
            nameEntry.set_text(locationLabel(r));
            clearResults();
        };

        searchEntry.connect('entry-activated', () => {
            const q = searchEntry.get_text().trim();
            if (q.length < 2)
                return;
            searchEntry.set_spinner(true);
            client.geocode(q).then(results => {
                searchEntry.set_spinner(false);
                clearResults();
                if (results.length === 0) {
                    const none = new Adw.ActionRow({
                        title: 'No matches',
                        sensitive: false,
                    });
                    resultRows.push(none);
                    resultsGroup.add(none);
                    resultsGroup.visible = true;
                    return;
                }
                for (const r of results) {
                    const row = new ResultRow(locationLabel(r), () => choose(r));
                    resultRows.push(row);
                    resultsGroup.add(row);
                }
                resultsGroup.visible = true;
            }).catch(e => {
                searchEntry.set_spinner(false);
                searchEntry.add_css_class('error');
                logError(e, 'Animated Weather prefs geocode');
            });
        });
        searchEntry.connect('changed', () => searchEntry.remove_css_class('error'));

        page.add(searchGroup);
        page.add(resultsGroup);

        // ── manual coordinates ────────────────────────────────────────────
        const manualGroup = new Adw.PreferencesGroup({
            title: 'Manual',
            description: 'Saved when you press Enter in a field',
        });

        const latEntry = new Adw.EntryRow({title: 'Latitude'});
        const lonEntry = new Adw.EntryRow({title: 'Longitude'});
        const nameEntry = new Adw.EntryRow({title: 'Display name'});

        latEntry.set_text(settings.get_double('location-latitude').toFixed(4));
        lonEntry.set_text(settings.get_double('location-longitude').toFixed(4));
        nameEntry.set_text(settings.get_string('location-name'));

        latEntry.connect('entry-activated', () => {
            const v = parseFloat(latEntry.get_text());
            if (Number.isFinite(v) && v >= -90 && v <= 90) {
                settings.set_double('location-latitude', v);
                settings.set_boolean('auto-location', false);
                latEntry.remove_css_class('error');
            } else
                latEntry.add_css_class('error');
        });
        lonEntry.connect('entry-activated', () => {
            const v = parseFloat(lonEntry.get_text());
            if (Number.isFinite(v) && v >= -180 && v <= 180) {
                settings.set_double('location-longitude', v);
                settings.set_boolean('auto-location', false);
                lonEntry.remove_css_class('error');
            } else
                lonEntry.add_css_class('error');
        });
        nameEntry.connect('entry-activated', () => {
            const v = nameEntry.get_text().trim();
            if (v)
                settings.set_string('location-name', v);
        });

        manualGroup.add(latEntry);
        manualGroup.add(lonEntry);
        manualGroup.add(nameEntry);
        page.add(manualGroup);

        return page;
    }

    /* ── display & updates ──────────────────────────────────────────────── */

    _displayPage(settings) {
        const page = new Adw.PreferencesPage({
            title: 'Display',
            icon_name: 'applications-graphics-symbolic',
        });

        const unitsGroup = new Adw.PreferencesGroup({title: 'Units'});
        const unitsRow = new Adw.ComboRow({
            title: 'Measurement system',
            model: new Gtk.StringList({
                strings: ['Metric (°C, km/h)', 'Imperial (°F, mph)'],
            }),
        });
        unitsRow.set_selected(UNITS.indexOf(settings.get_string('units')));
        unitsRow.connect('notify::selected', () =>
            settings.set_string('units', UNITS[unitsRow.get_selected()] ?? 'metric'));
        unitsGroup.add(unitsRow);
        page.add(unitsGroup);

        const lookGroup = new Adw.PreferencesGroup({title: 'Panel indicator'});
        const iconRow = new Adw.SwitchRow({title: 'Show animated icon'});
        const tempRow = new Adw.SwitchRow({title: 'Show temperature'});
        const animRow = new Adw.SwitchRow({
            title: 'Animate the icon',
            subtitle: 'Turn off to save a little battery',
        });
        settings.bind('show-icon', iconRow, 'active', Gio.SettingsBindFlags.DEFAULT);
        settings.bind('show-temperature', tempRow, 'active', Gio.SettingsBindFlags.DEFAULT);
        settings.bind('animate', animRow, 'active', Gio.SettingsBindFlags.DEFAULT);
        lookGroup.add(iconRow);
        lookGroup.add(tempRow);
        lookGroup.add(animRow);
        page.add(lookGroup);

        const updGroup = new Adw.PreferencesGroup({title: 'Updates'});
        const refreshRow = new Adw.SpinRow({
            title: 'Refresh interval (minutes)',
            adjustment: new Gtk.Adjustment({
                lower: 5, upper: 120, step_increment: 5, value: 15,
            }),
        });
        settings.bind('refresh-minutes', refreshRow.get_adjustment(), 'value',
                      Gio.SettingsBindFlags.DEFAULT);

        const windyRow = new Adw.SpinRow({
            title: 'Wind animation threshold (km/h)',
            subtitle: 'Breezier days swap the icon to the wind animation',
            adjustment: new Gtk.Adjustment({
                lower: 0, upper: 120, step_increment: 5, value: 30,
            }),
        });
        settings.bind('windy-threshold', windyRow.get_adjustment(), 'value',
                      Gio.SettingsBindFlags.DEFAULT);
        updGroup.add(refreshRow);
        updGroup.add(windyRow);
        page.add(updGroup);

        return page;
    }
}
