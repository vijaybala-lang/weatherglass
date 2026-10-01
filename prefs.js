/* prefs.js -- preferences dialog. */

import Adw from 'gi://Adw';
import Gtk from 'gi://Gtk';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Cairo from 'gi://cairo';

import { ExtensionPreferences, gettext as _ } from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

import { WeatherClient } from './weather.js';
import { paintWeather } from './painter.js';
import { createSky, paintSky } from './sky.js';
import { drawText } from './chart.js';

const N_ = s => s;

const UNITS = ['metric', 'imperial'];
const HOURS = ['auto', '12h', '24h'];

let iface24 = null;
const sysClock24 = () => {
    try {
        iface24 ??= new Gio.Settings({ schema_id: 'org.gnome.desktop.interface' });
        const cf = iface24.get_string('clock-format');
        return cf ? cf.includes('24') : null;
    } catch {
        return null;
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
        return new Intl.DateTimeFormat(undefined, { hour: 'numeric' })
            .resolvedOptions().hour12 === false;
    } catch {
        return false;
    }
};

const STYLES = ['animated', 'solid', 'accent'];

const LEGEND = [
    ['sun', 'Clear sky'],
    ['moon', 'Clear night'],
    ['partly', 'Partly cloudy'],
    ['cloud', 'Overcast'],
    ['fog', 'Fog'],
    ['wind', 'Windy'],
    ['rain', 'Rain'],
    ['sleet', 'Sleet / freezing rain'],
    ['snow', 'Snow'],
    ['hail', 'Hail'],
    ['storm', 'Thunderstorm'],
];
const LEGEND_INT = { rain: 6, sleet: 5, snow: 4, hail: 5, storm: 7 };

const COFFEE_URL = 'https://buymeacoffee.com/vbala';

function openUri(parent, uri) {
    try {
        const l = new Gtk.UriLauncher({ uri });
        const p = l.launch(parent, null);
        p?.catch?.(() => { });
    } catch (e) {
        try {
            Gio.AppInfo.launch_default_for_uri(uri, null);
        } catch (e2) { }
    }
}

function locationLabel(r) {
    return [r.name, r.admin, r.country].filter(Boolean).join(', ');
}

const ResultRow = GObject.registerClass(class ResultRow extends Adw.ActionRow {
    _init(title, cb) {
        super._init({ title, activatable: true });
        const img = new Gtk.Image({ pixel_size: 16 });
        (img.setFromIconName ?? img.set_from_icon_name).call(img, 'go-next-symbolic');
        this.add_suffix(img);
        this.connect('activated', () => cb());
    }
});

function drawMockWallpaper(cr, w, h, topBarHeight) {
    const wp = new Cairo.LinearGradient(0, topBarHeight - 4, 0, h + 6);
    wp.addColorStopRGB(0, 0.40, 0.62, 0.86);
    wp.addColorStopRGB(1, 0.82, 0.89, 0.95);
    cr.setSource(wp);
    cr.rectangle(0, topBarHeight - 4, w, h - topBarHeight + 4);
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
}

function drawMockWifi(cr, x, cy, txt) {
    cr.setSourceRGBA(...txt);
    cr.newPath();
    cr.setLineWidth(1.4);
    const wx = x + 9, wy = cy + 3;
    cr.arc(wx, wy, 3.4, Math.PI * 1.25, Math.PI * 1.75);
    cr.stroke();
    cr.arc(wx, wy, 6.4, Math.PI * 1.25, Math.PI * 1.75);
    cr.stroke();
    cr.arc(wx, wy - 1, 1.3, 0, 2 * Math.PI);
    cr.fill();
}

function drawMockSpeaker(cr, x, cy, txt) {
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
}

function drawMockBattery(cr, x, cy, txt) {
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
             { size: 11, rgba: txt, anchor: 'start', vcenter: cy });
}

class PreviewController {
    constructor(settings, onTick) {
        this._settings = settings;
        this._onTick = onTick;
        this._scene = null;
        this._timerId = 0;
        this._stopId = 0;
        this._t0 = 0;
    }

    get scene() {
        return this._scene ?? (this._settings.get_string('live-scene') || 'partly');
    }

    get isNight() {
        return this._scene ? this._scene === 'moon' : this._settings.get_boolean('live-night');
    }

    get isPreviewing() {
        return this._scene !== null;
    }

    get elapsed() {
        return this._timerId ? (GLib.get_monotonic_time() - this._t0) / 1e6 : 4.1;
    }

    start(scene) {
        this._scene = scene;
        this._t0 = GLib.get_monotonic_time();
        if (!this._timerId)
            this._timerId = GLib.timeout_add(GLib.PRIORITY_LOW, 33, this._onTick);
        if (this._stopId)
            GLib.source_remove(this._stopId);
        this._stopId = GLib.timeout_add_seconds(GLib.PRIORITY_LOW, 12, () => {
            this._stopId = 0;
            this._scene = null;
            if (this._timerId) {
                GLib.source_remove(this._timerId);
                this._timerId = 0;
            }
            this._onTick();
        });
        this._onTick();
    }

    resume() {
        if (this._scene && !this._timerId)
            this._timerId = GLib.timeout_add(GLib.PRIORITY_LOW, 33, this._onTick);
    }

    stop() {
        this._scene = null;
        if (this._timerId)
            GLib.source_remove(this._timerId);
        if (this._stopId)
            GLib.source_remove(this._stopId);
        this._timerId = 0;
        this._stopId = 0;
    }
}

export default class AnimatedWeatherPrefs extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();
        const client = new WeatherClient();
        window.set_default_size(560, 640);

        window.add(this._aboutPage());
        window.add(this._previewPage(settings));
        window.add(this._locationPage(settings, client));
        window.add(this._displayPage(settings));
        window.add(this._dataPage(settings));
    }

    _locationPage(settings, client) {
        const page = new Adw.PreferencesPage({
            title: _('Location'),
            icon_name: 'find-location-symbolic',
        });
        const manual = this._buildManualLocationGroup(settings);
        const searchGroups = this._buildSearchLocationGroup(settings, client, r => {
            manual.setLocation(r.latitude, r.longitude, r.name);
        });

        page.add(this._buildAutoLocationGroup(settings));
        searchGroups.forEach(g => page.add(g));
        page.add(manual.group);
        return page;
    }

    _buildAutoLocationGroup(settings) {
        const autoGroup = new Adw.PreferencesGroup({
            title: _('Automatic'),
            description: _('Coordinates are detected from your public IP address'),
        });
        const autoRow = new Adw.SwitchRow({
            title: _('Detect location automatically'),
        });
        settings.bind('auto-location', autoRow, 'active', Gio.SettingsBindFlags.DEFAULT);
        autoGroup.add(autoRow);
        return autoGroup;
    }

    _buildSearchLocationGroup(settings, client, onSelect) {
        const searchGroup = new Adw.PreferencesGroup({ title: _('Search a city') });
        const searchEntry = new Adw.EntryRow({
            title: _('City name — press Enter to search'),
        });
        searchGroup.add(searchEntry);

        const resultsGroup = new Adw.PreferencesGroup({
            title: _('Results'),
            visible: false,
        });

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
            settings.set_string('location-name', r.name);
            onSelect(r);
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

        return [searchGroup, resultsGroup];
    }

    _buildManualLocationGroup(settings) {
        const manualGroup = new Adw.PreferencesGroup({
            title: _('Manual'),
            description: _('Saved when you press Enter in a field'),
        });

        const latEntry = new Adw.EntryRow({ title: _('Latitude') });
        const lonEntry = new Adw.EntryRow({ title: _('Longitude') });
        const nameEntry = new Adw.EntryRow({ title: _('Display name') });

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

        return {
            group: manualGroup,
            setLocation(lat, lon, name) {
                latEntry.set_text(String(lat));
                lonEntry.set_text(String(lon));
                nameEntry.set_text(name);
            },
        };
    }

    _displayPage(settings) {
        const page = new Adw.PreferencesPage({
            title: _('Display'),
            icon_name: 'applications-graphics-symbolic',
        });
        page.add(this._buildUnitsGroup(settings));
        page.add(this._buildIndicatorGroup(settings));
        page.add(this._buildBackgroundGroup(settings));
        return page;
    }

    _buildUnitsGroup(settings) {
        const unitsGroup = new Adw.PreferencesGroup({ title: _('Units') });
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
        return unitsGroup;
    }

    _buildIndicatorGroup(settings) {
        const lookGroup = new Adw.PreferencesGroup({ title: _('Panel indicator') });
        const iconRow = new Adw.SwitchRow({ title: _('Show animated icon') });
        const tempRow = new Adw.SwitchRow({ title: _('Show temperature') });
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
        return lookGroup;
    }

    _buildBackgroundGroup(settings) {
        const bgGroup = new Adw.PreferencesGroup({ title: _('Menu background') });
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
        return bgGroup;
    }

    _dataPage(settings) {
        const page = new Adw.PreferencesPage({
            title: _('Data'),
            icon_name: 'network-wireless-symbolic',
        });
        page.add(this._buildProviderGroup(settings));
        page.add(this._buildUpdatesGroup(settings));
        return page;
    }

    _buildProviderGroup(settings) {
        const dataGroup = new Adw.PreferencesGroup({ title: _('Data source') });
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
        return dataGroup;
    }

    _buildUpdatesGroup(settings) {
        const updGroup = new Adw.PreferencesGroup({ title: _('Updates') });
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
        return updGroup;
    }

    _previewPage(settings) {
        const page = new Adw.PreferencesPage({
            title: _('Preview'),
            icon_name: 'media-playback-start-symbolic',
        });
        const sm = Adw.StyleManager.get_default();

        let barArea, skyArea, glyph;
        const tick = () => {
            skyArea?.queue_draw();
            barArea?.queue_draw();
            glyph?.queue_draw();
            return GLib.SOURCE_CONTINUE;
        };

        const ctrl = new PreviewController(settings, tick);

        const { sceneGroup, glyphArea } = this._buildPreviewSceneGroup(ctrl, sm);
        glyph = glyphArea;
        barArea = this._buildMockBar(settings, ctrl, sm);
        skyArea = this._buildLiveSky(ctrl, sm);

        const panelGroup = new Adw.PreferencesGroup({
            title: _('Panel preview'),
            description: _('How the panel button looks for this scene — mock temperature, real icon animation'),
        });
        panelGroup.add(barArea);

        const skyGroup = new Adw.PreferencesGroup({
            title: _('Menu backdrop preview'),
            description: _('Your menu\'s current sky, live — pick a condition above to animate it here'),
        });
        skyGroup.add(skyArea);

        page.add(sceneGroup);
        page.add(panelGroup);
        page.add(skyGroup);

        barArea.connect('unrealize', () => ctrl.stop());
        barArea.connect('realize', () => ctrl.resume());
        settings.connect('changed::hour-format', () => barArea.queue_draw());
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

    _buildPreviewSceneGroup(ctrl, sm) {
        const sceneRow = new Adw.ComboRow({
            title: _('Preview scene'),
            subtitle: _('Loops right here for ~12 s — your real panel stays put'),
            model: new Gtk.StringList({ strings: LEGEND.map(([, l]) => _(l)) }),
        });
        const glyphArea = new Gtk.DrawingArea();
        glyphArea.set_size_request(30, 30);
        glyphArea.set_valign(Gtk.Align.CENTER);
        glyphArea.set_draw_func((a, cr, w, h) => {
            const [scene] = LEGEND[sceneRow.get_selected()] ?? LEGEND[2];
            cr.save();
            const s = Math.min(w, h) / 24;
            cr.scale(s, s);
            paintWeather(cr, {
                scene,
                time: ctrl.elapsed,
                dark: sm.dark,
                night: scene === 'moon',
                intensity: LEGEND_INT[scene] ?? 0,
            });
            cr.restore();
        });
        sceneRow.add_prefix(glyphArea);

        let armed = false;
        sceneRow.connect('notify::selected', () => {
            if (!armed)
                return;
            const [scene] = LEGEND[sceneRow.get_selected()] ?? LEGEND[2];
            ctrl.start(scene);
        });
        sceneRow.set_selected(2);
        armed = true;

        const sceneGroup = new Adw.PreferencesGroup({ title: _('Scene') });
        sceneGroup.add(sceneRow);
        return { sceneGroup, glyphArea };
    }

    _buildMockBar(settings, ctrl, sm) {
        const barArea = new Gtk.DrawingArea();
        barArea.set_size_request(-1, 58);
        barArea.set_draw_func((a, cr, w, h) => {
            const dark = sm.dark;
            const BH = 34;
            drawMockWallpaper(cr, w, h, BH);

            const txt = dark ? [1, 1, 1, 1] : [0.13, 0.13, 0.16, 1];
            cr.setSourceRGBA(...(dark ? [0.05, 0.06, 0.08, 0.62] : [1, 1, 1, 0.55]));
            cr.rectangle(0, 0, w, BH);
            cr.fill();
            cr.setSourceRGBA(0, 0, 0, 0.22);
            cr.rectangle(0, BH - 1, w, 1);
            cr.fill();

            const rtl = Gtk.get_locale_direction() === Gtk.TextDirection.RTL;
            const cy = BH / 2;

            const now = GLib.DateTime.new_now_local();
            const clock = now.format('%b %e').replace(/\s+/g, ' ') + '  ' +
                (hour24For(settings)
                    ? now.format('%H:%M')
                    : now.format('%I:%M %p').replace(/^0/, ''));
            drawText(cr, clock, rtl ? w - 16 : 16, cy, {
                size: 11, bold: true, rgba: txt, vcenter: cy,
                anchor: rtl ? 'end' : 'start',
            });

            const scene = ctrl.scene;
            const tempTxt = settings.get_boolean('show-temperature')
                ? (settings.get_string('units') === 'metric' ? '20°' : '68°') : '';
            const items = [];
            if (settings.get_boolean('show-icon')) {
                items.push({
                    w: 24,
                    draw: x => {
                        cr.save();
                        cr.translate(x + 2, cy - 10);
                        cr.scale(20 / 24, 20 / 24);
                        paintWeather(cr, {
                            scene,
                            time: ctrl.elapsed,
                            dark,
                            night: ctrl.isNight,
                            windy: ['sun', 'moon', 'partly', 'cloud', 'fog', 'wind'].includes(scene),
                            windKmh: 34,
                            intensity: ctrl.isPreviewing ? 7 : (LEGEND_INT[scene] ?? 0),
                        });
                        cr.restore();
                    },
                });
            }
            if (tempTxt) {
                items.push({
                    w: 34,
                    draw: x => drawText(cr, tempTxt, x + 17, cy, { size: 11, rgba: txt, vcenter: cy }),
                });
            }
            items.push({ w: 18, gapBefore: true, draw: x => drawMockWifi(cr, x, cy, txt) });
            items.push({ w: 18, draw: x => drawMockSpeaker(cr, x, cy, txt) });
            items.push({ w: 52, draw: x => drawMockBattery(cr, x, cy, txt) });

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
        return barArea;
    }

    _buildLiveSky(ctrl, sm) {
        let skyPool = null;
        const skyArea = new Gtk.DrawingArea();
        skyArea.set_size_request(-1, 170);
        skyArea.set_draw_func((a, cr, w, h) => {
            skyPool ??= createSky();
            paintSky(cr, {
                w, h, time: ctrl.elapsed,
                scene: ctrl.scene,
                night: ctrl.isNight,
                sky: skyPool,
                radius: 14,
                scrim: sm.dark ? null : [1, 1, 1, 0.42],
            });
        });
        return skyArea;
    }

    _aboutPage() {
        const page = new Adw.PreferencesPage({
            title: _('About'),
            icon_name: 'help-about-symbolic',
        });

        const md = this.metadata;
        const infoGroup = new Adw.PreferencesGroup({ title: _('Weatherglass') });
        infoGroup.add(new Adw.ActionRow({
            title: _('Version'),
            subtitle: String(md?.version ?? 'dev'),
        }));
        infoGroup.add(new Adw.ActionRow({
            title: _('Contact'),
            subtitle: 'https://github.com/vijaybala-lang/weatherglass/issues',
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
        coffeeRow.add_suffix(new Gtk.Image({ icon_name: 'emblem-symbolic-link' }));
        coffeeRow.connect('activated', () => openUri(
            coffeeRow.get_root() ?? null, COFFEE_URL));
        loveGroup.add(coffeeRow);
        page.add(loveGroup);

        return page;
    }
}
