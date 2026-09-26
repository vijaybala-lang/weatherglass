/* prefs.js — preferences dialog. */

import Adw from 'gi://Adw';
import Gtk from 'gi://Gtk';
import Gio from 'gi://Gio';
import GObject from 'gi://GObject';

import {ExtensionPreferences} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

import {WeatherClient} from './weather.js';

const UNITS = ['metric', 'imperial'];
const STYLES = ['animated', 'solid', 'accent'];

function locationLabel(r) {
    return [r.name, r.admin, r.country].filter(Boolean).join(', ');
}

/* Row that fires a callback when it is clicked. */
const ResultRow = GObject.registerClass(class ResultRow extends Adw.ActionRow {
    _init(title, cb) {
        super._init({title, activatable: true});
        // GTK4 Gtk.Image has no from_icon_name constructor — use the setter
        const img = new Gtk.Image({pixel_size: 16});
        (img.setFromIconName ?? img.set_from_icon_name).call(img, 'go-next-symbolic');
        this.add_suffix(img);
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
            // the menu header has no room for "city, state, country" —
            // store the bare city; the results list above still carries
            // the full label so the choice stays unambiguous
            settings.set_string('location-name', r.name);
            latEntry.set_text(String(r.latitude));
            lonEntry.set_text(String(r.longitude));
            nameEntry.set_text(r.name);
            clearResults();
        };

        searchEntry.connect('entry-activated', () => {
            const q = searchEntry.get_text().trim();
            if (q.length < 2)
                return;
            client.geocode(q).then(results => {
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

        const bgGroup = new Adw.PreferencesGroup({title: 'Menu background'});
        const styleRow = new Adw.ComboRow({
            title: 'Background style',
            subtitle: 'How the dropdown fills itself behind the forecast',
            model: new Gtk.StringList({
                strings: [
                    'Animated sky (translucent)',
                    'Solid (sky dimmed under a wash)',
                    'Theme background, accent charts',
                ],
            }),
        });
        styleRow.set_selected(STYLES.indexOf(settings.get_string('menu-style')));
        styleRow.connect('notify::selected', () =>
            settings.set_string('menu-style', STYLES[styleRow.get_selected()] ?? 'animated'));
        bgGroup.add(styleRow);
        const COND = ['off', 'icons', 'pills'];
        const condRow = new Adw.ComboRow({
            title: 'Hourly conditions',
            subtitle: 'Off, loose icons, or grouped pills along the chart top',
            model: new Gtk.StringList({
                strings: ['Off', 'Icons', 'Grouped pills'],
            }),
        });
        const ci = COND.indexOf(settings.get_string('condition-strip'));
        condRow.set_selected(ci < 0 ? 1 : ci);
        condRow.connect('notify::selected', () =>
            settings.set_string('condition-strip', COND[condRow.get_selected()] ?? 'icons'));
        bgGroup.add(condRow);
        const POS = ['top', 'bottom'];
        const posRow = new Adw.ComboRow({
            title: 'Condition band position',
            subtitle: 'Along the chart top, or above the hour labels',
            model: new Gtk.StringList({
                strings: ['Chart top', 'Above hours'],
            }),
        });
        const pi = POS.indexOf(settings.get_string('condition-pos'));
        posRow.set_selected(pi < 0 ? 0 : pi);
        posRow.connect('notify::selected', () =>
            settings.set_string('condition-pos', POS[posRow.get_selected()] ?? 'top'));
        bgGroup.add(posRow);
        page.add(bgGroup);

        const dataGroup = new Adw.PreferencesGroup({title: 'Data source'});
        const provRow = new Adw.ComboRow({
            title: 'Weather provider',
            subtitle: 'MET Norway data licensed CC BY-SA 4.0 · Norwegian Meteorological Institute',
            model: new Gtk.StringList({
                strings: [
                    'Open-Meteo (default)',
                    'MET Norway (api.met.no)',
                ],
            }),
        });
        const provIds = ['open-meteo', 'met-norway'];
        const sel = provIds.indexOf(settings.get_string('provider'));
        provRow.set_selected(sel < 0 ? 0 : sel);
        provRow.connect('notify::selected', () =>
            settings.set_string('provider', provIds[provRow.get_selected()] ?? 'open-meteo'));
        dataGroup.add(provRow);
        page.add(dataGroup);

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

        // ── animation previews ────────────────────────────────────────────
        const previewGroup = new Adw.PreferencesGroup({
            title: 'Preview animations',
            description: 'Play an animation on the panel icon for ~12 seconds — ' +
                         'handy for scenes your sky rarely shows (hail, storm, fog)',
        });
        const SCENE_PREVIEWS = [
            ['sun',    'Clear sky'],
            ['moon',   'Clear night'],
            ['partly', 'Partly cloudy'],
            ['cloud',  'Overcast'],
            ['fog',    'Fog'],
            ['wind',   'Windy'],
            ['rain',   'Rain'],
            ['sleet',  'Sleet / freezing rain'],
            ['snow',   'Snow'],
            ['hail',   'Hail'],
            ['storm',  'Thunderstorm'],
        ];
        for (const [scene, label] of SCENE_PREVIEWS) {
            const row = new Adw.ActionRow({
                title: label,
                activatable: true,
            });
            row.add_suffix(new Gtk.Image({icon_name: 'media-playback-start-symbolic'}));
            row.connect('activated', () =>
                settings.set_string('preview-scene', scene));
            previewGroup.add(row);
        }
        page.add(previewGroup);

        return page;
    }
}
