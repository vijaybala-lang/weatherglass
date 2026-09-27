/* prefs.js — preferences dialog. */

import Adw from 'gi://Adw';
import Gtk from 'gi://Gtk';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Cairo from 'gi://cairo';

import {ExtensionPreferences} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

import {WeatherClient} from './weather.js';
import {paintWeather} from './painter.js';
import {createSky, paintSky} from './sky.js';
import {drawText} from './chart.js';

import {initI18n, _, N_} from './i18n.js';

const UNITS = ['metric', 'imperial'];
const HOURS = ['auto', '12h', '24h'];

/* 12/24-hour resolution, mirroring extension.js: explicit wins, else GNOME's
 * clock-format, else the locale's hour12 convention. */
let iface24 = null;
const sysClock24 = () => {
    try {
        iface24 ??= new Gio.Settings({schema_id: 'org.gnome.desktop.interface'});
        const cf = iface24.get_string('clock-format');
        return cf ? cf.includes('24') : null;
    } catch {
        return null;   // exotic distro or pre-48 GNOME without the key
    }
};
const hour24For = settings => {
    const mode = settings.get_string('hour-format');
    if (mode === '24h')
        return true;
    if (mode === '12h')
        return false;
    const sys = sysClock24();
    if (sys !== null)
        return sys;
    try {
        return new Intl.DateTimeFormat(undefined, {hour: 'numeric'})
            .resolvedOptions().hour12 === false;
    } catch {
        return false;
    }
};
const STYLES = ['animated', 'solid', 'accent'];

/* Every scene the menu can draw — drives the Preview page's scene
 * dropdown and its live sky preview. */
const LEGEND = [
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
const LEGEND_INT = {rain: 6, sleet: 5, snow: 4, hail: 5, storm: 7};

const COFFEE_URL = 'https://buymeacoffee.com/vbala';

function openUri(parent, uri) {
    try {
        const l = new Gtk.UriLauncher({uri});
        const p = l.launch(parent, null);
        p?.catch?.(() => {});            // fire-and-forget; GTK logs failures
    } catch (e) {
        try {
            Gio.AppInfo.launch_default_for_uri(uri, null);
        } catch (e2) { /* nothing usable to open URLs with */ }
    }
}

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
        // prefs runs in its own process — bind the domain before building UI
        initI18n(this.uuid, this.dir.get_path());
        const settings = this.getSettings();
        const client = new WeatherClient();
        window.set_default_size(560, 640);

        window.add(this._aboutPage());
        window.add(this._previewPage(settings));
        window.add(this._locationPage(settings, client));
        window.add(this._displayPage(settings));
        window.add(this._dataPage(settings));
    }

    /* ── location ───────────────────────────────────────────────────────── */

    _locationPage(settings, client) {
        const page = new Adw.PreferencesPage({
            title: _('Location'),
            icon_name: 'find-location-symbolic',
        });

        const autoGroup = new Adw.PreferencesGroup({
            title: _('Automatic'),
            description: _('Coordinates are detected from your public IP address'),
        });
        const autoRow = new Adw.SwitchRow({
            title: _('Detect location automatically'),
        });
        settings.bind('auto-location', autoRow, 'active',
                      Gio.SettingsBindFlags.DEFAULT);
        autoGroup.add(autoRow);
        page.add(autoGroup);

        // ── search ────────────────────────────────────────────────────────
        const searchGroup = new Adw.PreferencesGroup({title: _('Search a city')});
        const searchEntry = new Adw.EntryRow({
            title: _('City name — press Enter to search'),
        });
        searchGroup.add(searchEntry);

        const resultsGroup = new Adw.PreferencesGroup({
            title: _('Results'),
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
                        title: _('No matches'),
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
                logError(e, 'Weatherglass prefs geocode');
            });
        });
        searchEntry.connect('changed', () => searchEntry.remove_css_class('error'));

        page.add(searchGroup);
        page.add(resultsGroup);

        // ── manual coordinates ────────────────────────────────────────────
        const manualGroup = new Adw.PreferencesGroup({
            title: _('Manual'),
            description: _('Saved when you press Enter in a field'),
        });

        const latEntry = new Adw.EntryRow({title: _('Latitude')});
        const lonEntry = new Adw.EntryRow({title: _('Longitude')});
        const nameEntry = new Adw.EntryRow({title: _('Display name')});

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
            title: _('Display'),
            icon_name: 'applications-graphics-symbolic',
        });

        const unitsGroup = new Adw.PreferencesGroup({title: _('Units')});
        const unitsRow = new Adw.ComboRow({
            title: _('Measurement system'),
            model: new Gtk.StringList({
                strings: [_('Metric (°C, km/h)'), _('Imperial (°F, mph)')],
            }),
        });
        unitsRow.set_selected(UNITS.indexOf(settings.get_string('units')));
        unitsRow.connect('notify::selected', () =>
            settings.set_string('units', UNITS[unitsRow.get_selected()] ?? 'metric'));
        unitsGroup.add(unitsRow);
        const hoursRow = new Adw.ComboRow({
            title: _('Hour format'),
            subtitle: _('Clock style for chart hours and the preview clock'),
            model: new Gtk.StringList({
                strings: [_('Automatic (system)'), _('12-hour'), _('24-hour')],
            }),
        });
        hoursRow.set_selected(HOURS.indexOf(settings.get_string('hour-format')));
        hoursRow.connect('notify::selected', () =>
            settings.set_string('hour-format', HOURS[hoursRow.get_selected()] ?? 'auto'));
        unitsGroup.add(hoursRow);
        page.add(unitsGroup);

        const lookGroup = new Adw.PreferencesGroup({title: _('Panel indicator')});
        const iconRow = new Adw.SwitchRow({title: _('Show animated icon')});
        const tempRow = new Adw.SwitchRow({title: _('Show temperature')});
        const animRow = new Adw.SwitchRow({
            title: _('Animate the icon'),
            subtitle: _('Turn off to save a little battery'),
        });
        settings.bind('show-icon', iconRow, 'active', Gio.SettingsBindFlags.DEFAULT);
        settings.bind('show-temperature', tempRow, 'active', Gio.SettingsBindFlags.DEFAULT);
        settings.bind('animate', animRow, 'active', Gio.SettingsBindFlags.DEFAULT);
        lookGroup.add(iconRow);
        lookGroup.add(tempRow);
        lookGroup.add(animRow);
        page.add(lookGroup);

        const bgGroup = new Adw.PreferencesGroup({title: _('Menu background')});
        const styleRow = new Adw.ComboRow({
            title: _('Background style'),
            subtitle: _('How the dropdown fills itself behind the forecast'),
            model: new Gtk.StringList({
                strings: [
                    _('Animated sky (translucent)'),
                    _('Solid (sky dimmed under a wash)'),
                    _('Theme background, accent charts'),
                ],
            }),
        });
        styleRow.set_selected(STYLES.indexOf(settings.get_string('menu-style')));
        styleRow.connect('notify::selected', () =>
            settings.set_string('menu-style', STYLES[styleRow.get_selected()] ?? 'animated'));
        bgGroup.add(styleRow);
        const embossRow = new Adw.SwitchRow({
            title: _('Text emboss'),
            subtitle: _('Soft shadow under card text and icons over the sky'),
        });
        settings.bind('text-emboss', embossRow, 'active', Gio.SettingsBindFlags.DEFAULT);
        bgGroup.add(embossRow);
        const COND = ['off', 'icons', 'pills'];
        const condRow = new Adw.ComboRow({
            title: _('Weather conditions'),
            subtitle: _('How hourly conditions ride the chart'),
            model: new Gtk.StringList({
                strings: [_('Off'), _('Hourly icons'), _('Grouped pills')],
            }),
        });
        const ci = COND.indexOf(settings.get_string('condition-strip'));
        condRow.set_selected(ci < 0 ? 1 : ci);
        condRow.connect('notify::selected', () =>
            settings.set_string('condition-strip', COND[condRow.get_selected()] ?? 'icons'));
        bgGroup.add(condRow);
        const POS = ['top', 'bottom'];
        const posRow = new Adw.ComboRow({
            title: _('Condition band position'),
            subtitle: _('Along the chart top, or above the hour labels'),
            model: new Gtk.StringList({
                strings: [_('Chart top'), _('Above hours')],
            }),
        });
        const pi = POS.indexOf(settings.get_string('condition-pos'));
        posRow.set_selected(pi < 0 ? 1 : pi);
        posRow.connect('notify::selected', () =>
            settings.set_string('condition-pos', POS[posRow.get_selected()] ?? 'bottom'));
        bgGroup.add(posRow);
        const EMPH = ['normal', 'bold', 'large', 'both'];
        const emphRow = new Adw.ComboRow({
            title: _('Data text'),
            subtitle: _('Bolder or larger metric values and chart hours'),
            model: new Gtk.StringList({
                strings: [_('Normal'), _('Bold'), _('Large'), _('Bold & large')],
            }),
        });
        const ei = EMPH.indexOf(settings.get_string('text-emphasis'));
        emphRow.set_selected(ei < 0 ? 0 : ei);
        emphRow.connect('notify::selected', () =>
            settings.set_string('text-emphasis', EMPH[emphRow.get_selected()] ?? 'normal'));
        bgGroup.add(emphRow);
        page.add(bgGroup);

        return page;
    }

    /* ── data: provider + update rhythm ──────────────────────────────────── */

    _dataPage(settings) {
        const page = new Adw.PreferencesPage({
            title: _('Data'),
            icon_name: 'network-wireless-symbolic',
        });

        const dataGroup = new Adw.PreferencesGroup({title: _('Data source')});
        const provRow = new Adw.ComboRow({
            title: _('Weather provider'),
            subtitle: _('All keyless · MET Norway data licensed CC BY-SA 4.0'),
            model: new Gtk.StringList({
                strings: [
                    _('Open-Meteo (default)'),
                    _('MET Norway (api.met.no)'),
                    _('NOAA NWS (US locations only)'),
                ],
            }),
        });
        const provIds = ['open-meteo', 'met-norway', 'noaa-nws'];
        const sel = provIds.indexOf(settings.get_string('provider'));
        provRow.set_selected(sel < 0 ? 0 : sel);
        provRow.connect('notify::selected', () =>
            settings.set_string('provider', provIds[provRow.get_selected()] ?? 'open-meteo'));
        dataGroup.add(provRow);

        // Open-Meteo routes to different weather models, and the models
        // genuinely disagree beyond ~5 days (a US GFS run over San Francisco
        // once promised 86°F where ECMWF promised 69°F — the GFS notorious-
        // ly over-forecasts coastal heat). Default: ECMWF IFS.
        const modelRow = new Adw.ComboRow({
            title: _('Forecast model'),
            subtitle: _('Open-Meteo only · out to a week models disagree — if the weekend looks off, try another'),
            model: new Gtk.StringList({
                strings: [
                    _('Best match (Open-Meteo regional pick; US → GFS)'),
                    _('ECMWF IFS (recommended)'),
                    _('DWD ICON (shorter range)'),
                    _('NOAA GFS'),
                ],
            }),
        });
        const modelIds = ['best_match', 'ecmwf_ifs025', 'icon_seamless', 'gfs_seamless'];
        const msel = modelIds.indexOf(settings.get_string('om-model'));
        modelRow.set_selected(msel < 0 ? 1 : msel);
        modelRow.connect('notify::selected', () =>
            settings.set_string('om-model', modelIds[modelRow.get_selected()] ?? 'best_match'));
        const syncModelRow = () =>
            modelRow.set_visible(provRow.get_selected() === 0);
        provRow.connect('notify::selected', syncModelRow);
        syncModelRow();
        dataGroup.add(modelRow);
        page.add(dataGroup);

        const updGroup = new Adw.PreferencesGroup({title: _('Updates')});
        const refreshRow = new Adw.SpinRow({
            title: _('Refresh interval (minutes)'),
            adjustment: new Gtk.Adjustment({
                lower: 5, upper: 120, step_increment: 5, value: 15,
            }),
        });
        settings.bind('refresh-minutes', refreshRow.get_adjustment(), 'value',
                      Gio.SettingsBindFlags.DEFAULT);

        const windyRow = new Adw.SpinRow({
            title: _('Wind animation threshold (km/h)'),
            subtitle: _('Breezier days swap the icon to the wind animation'),
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

    /* ── preview: dropdown + fake panel + live sky, all self-contained ──── */

    _previewPage(settings) {
        const page = new Adw.PreferencesPage({
            title: _('Preview'),
            icon_name: 'media-playback-start-symbolic',
        });
        const sm = Adw.StyleManager.get_default();

        /* Everything animates together on one clock while a preview runs,
         * then eases back to the menu's REAL current sky after 12 s — all
         * inside this window: the actual panel icon is never touched. */
        let previewScene = null, timerId = 0, stopId = 0, t0 = 0;
        let skyPool = null;
        const liveScene = () =>
            settings.get_string('live-scene') || 'partly';
        const liveNight = () => settings.get_boolean('live-night');
        const sceneNow = () => previewScene ?? liveScene();
        const nightNow = () =>
            previewScene ? previewScene === 'moon' : liveNight();
        const tick = () => {
            skyArea.queue_draw();
            barArea.queue_draw();
            glyph.queue_draw();
            return GLib.SOURCE_CONTINUE;
        };
        const startPrev = scene => {
            previewScene = scene;
            t0 = GLib.get_monotonic_time();
            if (!timerId)
                timerId = GLib.timeout_add(GLib.PRIORITY_LOW, 33, tick);
            if (stopId)
                GLib.source_remove(stopId);
            stopId = GLib.timeout_add_seconds(GLib.PRIORITY_LOW, 12, () => {
                stopId = 0;
                previewScene = null;
                GLib.source_remove(timerId);
                timerId = 0;
                tick();
            });
            tick();
        };
        const stopAll = () => {
            previewScene = null;
            if (timerId)
                GLib.source_remove(timerId);
            timerId = stopId = 0;
        };

        // ── scene dropdown: one row replaces the old 11-row list ─────────
        const sceneRow = new Adw.ComboRow({
            title: _('Preview scene'),
            subtitle: _('Loops right here for ~12 s — your real panel stays put'),
            model: new Gtk.StringList({strings: LEGEND.map(([, l]) => _(l))}),
        });
        // the picked scene's glyph, painted by the real menu painter —
        // rides in the row and animates with the preview
        const glyph = new Gtk.DrawingArea();
        glyph.set_size_request(30, 30);
        glyph.set_valign(Gtk.Align.CENTER);
        glyph.set_draw_func((a, cr, w, h) => {
            const [scene] = LEGEND[sceneRow.get_selected()] ?? LEGEND[2];
            cr.save();
            const s = Math.min(w, h) / 24;
            cr.scale(s, s);
            paintWeather(cr, {scene,
                              time: timerId
                                  ? (GLib.get_monotonic_time() - t0) / 1e6
                                  : 4.1,
                              dark: sm.dark,
                              night: scene === 'moon',
                              intensity: LEGEND_INT[scene] ?? 0});
            cr.restore();
        });
        sceneRow.add_prefix(glyph);
        let armed = false;          // wiring-time set_selected must not preview
        sceneRow.connect('notify::selected', () => {
            if (!armed)
                return;
            const [scene] = LEGEND[sceneRow.get_selected()] ?? LEGEND[2];
            startPrev(scene);
        });
        sceneRow.set_selected(2);   // neutral opener: 'partly cloudy'
        armed = true;
        const sceneGroup = new Adw.PreferencesGroup({title: _('Scene')});
        sceneGroup.add(sceneRow);
        page.add(sceneGroup);

        /* Fake top bar: a mock of the real panel button — bar strip,
         * button pill, the same icon widget animation.js drives, and the
         * temperature suffix only if show-temperature is on. The number
         * is a prop (scale follows the units key); the icon is the truth. */
        const barArea = new Gtk.DrawingArea();
        barArea.set_size_request(-1, 58);
        barArea.set_draw_func((a, cr, w, h) => {
            const dark = sm.dark;
            const BH = 34;                 // real top-bar height
            /* wallpaper band under the bar, so the translucent bar composites
             * over a scene exactly like it does on a real desktop */
            const wp = new Cairo.LinearGradient(0, BH - 4, 0, h + 6);
            wp.addColorStopRGB(0, 0.40, 0.62, 0.86);
            wp.addColorStopRGB(1, 0.82, 0.89, 0.95);
            cr.setSource(wp);
            cr.rectangle(0, BH - 4, w, h - BH + 4);
            cr.fill();
            for (const [cxr, cyr, r] of [[w * 0.22, h + 2, 26],
                                         [w * 0.58, h + 8, 30],
                                         [w * 0.85, h + 1, 22]]) {
                const g = new Cairo.RadialGradient(cxr, cyr, 2, cxr, cyr, r);
                g.addColorStopRGBA(0, 1, 1, 1, 0.65);
                g.addColorStopRGBA(1, 1, 1, 1, 0);
                cr.setSource(g);
                cr.arc(cxr, cyr, r, 0, 2 * Math.PI);
                cr.fill();
            }

            const txt = dark ? [1, 1, 1, 1] : [0.13, 0.13, 0.16, 1];
            /* the bar itself — translucent over the wallpaper, hairline edge */
            cr.setSourceRGBA(...(dark ? [0.05, 0.06, 0.08, 0.62]
                : [1, 1, 1, 0.55]));
            cr.rectangle(0, 0, w, BH);
            cr.fill();
            cr.setSourceRGBA(0, 0, 0, 0.22);
            cr.rectangle(0, BH - 1, w, 1);
            cr.fill();

            /* RTL sessions: the bar mirrors — clock to the right, status
             * cluster to the left — same flip the real panel performs */
            const rtl = Gtk.get_locale_direction() === Gtk.TextDirection.RTL;
            const cy = BH / 2;

            // live clock, GNOME-style: "Sep 27  10:39 AM"
            const now = GLib.DateTime.new_now_local();
            const clock = now.format('%b %e').replace(/\s+/g, ' ') + '  ' +
                (hour24For(settings)
                    ? now.format('%H:%M')
                    : now.format('%I:%M %p').replace(/^0/, ''));
            drawText(cr, clock, rtl ? w - 16 : 16, cy,
                     {size: 11, bold: true, rgba: txt, vcenter: cy,
                      anchor: rtl ? 'end' : 'start'});

            // status cluster, logical order: our indicator, then system trio
            const scene = sceneNow();
            const tempTxt = settings.get_boolean('show-temperature')
                ? (settings.get_string('units') === 'metric'
                    ? '20°' : '68°') : '';
            const items = [];
            if (settings.get_boolean('show-icon'))
                items.push({w: 24, draw: x => {
                    cr.save();
                    cr.translate(x + 2, cy - 10);
                    cr.scale(20 / 24, 20 / 24);
                    paintWeather(cr, {
                        scene,
                        time: timerId
                            ? (GLib.get_monotonic_time() - t0) / 1e6 : 4.1,
                        dark,
                        night: nightNow(),
                        windy: ['sun', 'moon', 'partly', 'cloud', 'fog', 'wind']
                            .includes(scene),
                        windKmh: 34,
                        intensity: previewScene ? 7 : (LEGEND_INT[scene] ?? 0),
                    });
                    cr.restore();
                }});
            if (tempTxt)
                items.push({w: 34, draw: x =>
                    drawText(cr, tempTxt, x + 17, cy,
                             {size: 11, rgba: txt, vcenter: cy})});
            items.push({w: 18, gapBefore: true, draw: x => {      // wifi
                cr.setSourceRGBA(...txt);
                cr.newPath();          // drawText left a pen position; arc()
                                       // would stroke a connector from it
                cr.setLineWidth(1.4);
                const wx = x + 9, wy = cy + 3;
                cr.arc(wx, wy, 3.4, Math.PI * 1.25, Math.PI * 1.75);
                cr.stroke();
                cr.arc(wx, wy, 6.4, Math.PI * 1.25, Math.PI * 1.75);
                cr.stroke();
                cr.arc(wx, wy - 1, 1.3, 0, 2 * Math.PI);
                cr.fill();
            }});
            items.push({w: 18, draw: x => {                        // speaker
                cr.setSourceRGBA(...txt);
                cr.moveTo(x + 2.5, cy - 2.2);
                cr.lineTo(x + 5.2, cy - 2.2);
                cr.lineTo(x + 8.8, cy - 5.8);
                cr.lineTo(x + 8.8, cy + 5.8);
                cr.lineTo(x + 5.2, cy + 2.2);
                cr.lineTo(x + 2.5, cy + 2.2);
                cr.closePath();
                cr.fill();
                cr.setLineWidth(1.2);
                cr.arc(x + 6.8, cy, 4.6, -0.85, 0.85);
                cr.stroke();
            }});
            items.push({w: 52, draw: x => {                        // battery
                cr.setSourceRGBA(...txt);
                cr.setLineWidth(1.2);
                const bw = 19, bh = 10, bx = x, by = cy - bh / 2;
                const rr = 2.4;
                cr.newPath();
                cr.arc(bx + bw - rr, by + rr, rr, -Math.PI / 2, 0);
                cr.arc(bx + bw - rr, by + bh - rr, rr, 0, Math.PI / 2);
                cr.arc(bx + rr, by + bh - rr, rr, Math.PI / 2, Math.PI);
                cr.arc(bx + rr, by + rr, rr, Math.PI, 1.5 * Math.PI);
                cr.closePath();
                cr.stroke();
                cr.rectangle(bx + bw + 1.4, cy - 2, 1.7, 4);
                cr.fill();
                cr.rectangle(bx + 2.4, by + 2.4, (bw - 4.8) * 0.72, bh - 4.8);
                cr.fill();
                drawText(cr, '72%', bx + bw + 6, cy,
                         {size: 11, rgba: txt, anchor: 'start', vcenter: cy});
            }});

            const GAP = 8, BIGGAP = 16;
            const total = items.reduce((s, it, k) =>
                s + it.w + (k && it.gapBefore ? BIGGAP : k ? GAP : 0), 0);
            if (rtl)
                items.reverse();
            let x = rtl ? 16 : w - 16 - total;
            items.forEach((it, k) => {
                if (k)
                    x += it.gapBefore ? BIGGAP : GAP;
                it.draw(x);
                x += it.w;
            });
        });

        // the mock bar's clock follows the format combo without a reopen
        settings.connect('changed::hour-format', () => barArea.queue_draw());

        // ── live dropdown backdrop ───────────────────────────────────────
        const skyArea = new Gtk.DrawingArea();
        skyArea.set_size_request(-1, 170);
        skyArea.set_draw_func((a, cr, w, h) => {
            skyPool ??= createSky();
            const t = timerId ? (GLib.get_monotonic_time() - t0) / 1e6 : 4.1;
            paintSky(cr, {
                w, h, time: t,
                scene: sceneNow(),
                night: nightNow(),
                sky: skyPool,
                radius: 14,
                scrim: sm.dark ? null : [1, 1, 1, 0.42],
            });
        });

        const panelGroup = new Adw.PreferencesGroup({
            title: _('Panel preview'),
            description: _('How the panel button looks for this scene — mock temperature, real icon animation'),
        });
        panelGroup.add(barArea);
        page.add(panelGroup);

        const skyGroup = new Adw.PreferencesGroup({
            title: _('Menu backdrop preview'),
            description: _('Your menu\'s current sky, live — pick a condition above to animate it here'),
        });
        skyGroup.add(skyArea);
        page.add(skyGroup);

        // the tab is the preview's stage: hide it, stop the clock; come
        // back with a preview still running, it picks up again
        barArea.connect('unrealize', stopAll);
        barArea.connect('realize', () => {
            if (previewScene && !timerId)
                timerId = GLib.timeout_add(GLib.PRIORITY_LOW, 33, tick);
        });
        // the menu's real sky changed while idle: reflect it
        const liveSync = () => {
            skyArea.queue_draw();
            barArea.queue_draw();
        };
        settings.connect('changed::live-scene', liveSync);
        settings.connect('changed::live-night', liveSync);
        sm.connect('notify::dark-mode', () => {
            skyArea.queue_draw();
            barArea.queue_draw();
            glyph.queue_draw();
        });
        return page;
    }

    /* ── about: what it is, coffee ───────────────────────────────────────── */

    _aboutPage() {
        const page = new Adw.PreferencesPage({
            title: _('About'),
            icon_name: 'help-about-symbolic',
        });

        const md = this.metadata;
        const infoGroup = new Adw.PreferencesGroup({title: _('Weatherglass')});
        infoGroup.add(new Adw.ActionRow({
            title: _('Version'),
            subtitle: String(md?.version ?? 'dev'),
        }));
        infoGroup.add(new Adw.ActionRow({
            title: _('Contact'),
            subtitle: 'vijaybala-lang@users.noreply.github.com',
        }));
        infoGroup.add(new Adw.ActionRow({
            title: _('Free and open source'),
            subtitle: _('No ads, no accounts, no data collection — the sky should just work'),
        }));
        page.add(infoGroup);

        const loveGroup = new Adw.PreferencesGroup({
            title: _('Support the development'),
            description: _('Weatherglass is free forever. If it makes your desktop nicer, a coffee keeps the pixels falling.'),
        });
        const coffeeRow = new Adw.ActionRow({
            title: _('Buy me a coffee'),
            subtitle: COFFEE_URL,
            activatable: true,
        });
        coffeeRow.add_suffix(new Gtk.Image({icon_name: 'emblem-symbolic-link'}));
        coffeeRow.connect('activated', () => openUri(
            coffeeRow.get_root() ?? null, COFFEE_URL));
        loveGroup.add(coffeeRow);
        page.add(loveGroup);

        return page;
    }
}
