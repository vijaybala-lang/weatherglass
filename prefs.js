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

let interfaceSettings = null;
const systemClockIs24 = () => {
    try {
        interfaceSettings ??= new Gio.Settings({ schema_id: 'org.gnome.desktop.interface' });
        const clockFormat = interfaceSettings.get_string('clock-format');
        return clockFormat ? clockFormat.includes('24') : null;
    } catch {
        return null;
    }
};

const is24HourFor = settings => {
    const mode = settings.get_string('hour-format');
    if (mode === '24h')
        return true;
    if (mode === '12h')
        return false;
    const systemFormat = systemClockIs24();
    if (systemFormat !== null)
        return systemFormat;
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
const LEGEND_PRECIP_INTENSITY = { rain: 6, sleet: 5, snow: 4, hail: 5, storm: 7 };

const COFFEE_URL = 'https://buymeacoffee.com/vbala';

function openUri(parent, uri) {
    try {
        const launcher = new Gtk.UriLauncher({ uri });
        const launchPromise = launcher.launch(parent, null);
        launchPromise.catch(() => { });
    } catch (err) {
        try {
            Gio.AppInfo.launch_default_for_uri(uri, null);
        } catch (fallbackErr) { }
    }
}

function locationLabel(result) {
    return [result.name, result.admin, result.country].filter(Boolean).join(', ');
}

const ResultRow = GObject.registerClass(class ResultRow extends Adw.ActionRow {
    _init(title, onActivated) {
        super._init({ title, activatable: true });
        const iconImage = new Gtk.Image({ pixel_size: 16 });
        (iconImage.setFromIconName ?? iconImage.set_from_icon_name).call(iconImage, 'go-next-symbolic');
        this.add_suffix(iconImage);
        this.connect('activated', () => onActivated());
    }
});

function drawMockWallpaper(cr, width, height, topBarHeight) {
    const wallpaperGradient = new Cairo.LinearGradient(0, topBarHeight - 4, 0, height + 6);
    wallpaperGradient.addColorStopRGB(0, 0.40, 0.62, 0.86);
    wallpaperGradient.addColorStopRGB(1, 0.82, 0.89, 0.95);
    cr.setSource(wallpaperGradient);
    cr.rectangle(0, topBarHeight - 4, width, height - topBarHeight + 4);
    cr.fill();
    for (const [centerX, centerY, radius] of [[width * 0.22, height + 2, 26],
                                             [width * 0.58, height + 8, 30],
                                             [width * 0.85, height + 1, 22]]) {
        const bubble = new Cairo.RadialGradient(centerX, centerY, 2, centerX, centerY, radius);
        bubble.addColorStopRGBA(0, 1, 1, 1, 0.65);
        bubble.addColorStopRGBA(1, 1, 1, 1, 0);
        cr.setSource(bubble);
        cr.arc(centerX, centerY, radius, 0, 2 * Math.PI);
        cr.fill();
    }
}

function drawMockWifi(cr, x, centerY, textColor) {
    cr.setSourceRGBA(...textColor);
    cr.newPath();
    cr.setLineWidth(1.4);
    const wifiX = x + 9, wifiY = centerY + 3;
    cr.arc(wifiX, wifiY, 3.4, Math.PI * 1.25, Math.PI * 1.75);
    cr.stroke();
    cr.arc(wifiX, wifiY, 6.4, Math.PI * 1.25, Math.PI * 1.75);
    cr.stroke();
    cr.arc(wifiX, wifiY - 1, 1.3, 0, 2 * Math.PI);
    cr.fill();
}

function drawMockSpeaker(cr, x, centerY, textColor) {
    cr.setSourceRGBA(...textColor);
    cr.moveTo(x + 2.5, centerY - 2.2);
    cr.lineTo(x + 5.2, centerY - 2.2);
    cr.lineTo(x + 8.8, centerY - 5.8);
    cr.lineTo(x + 8.8, centerY + 5.8);
    cr.lineTo(x + 5.2, centerY + 2.2);
    cr.lineTo(x + 2.5, centerY + 2.2);
    cr.closePath();
    cr.fill();
    cr.setLineWidth(1.2);
    cr.arc(x + 6.8, centerY, 4.6, -0.85, 0.85);
    cr.stroke();
}

function drawMockBattery(cr, x, centerY, textColor) {
    cr.setSourceRGBA(...textColor);
    cr.setLineWidth(1.2);
    const batteryWidth = 19, batteryHeight = 10, batteryX = x, batteryY = centerY - batteryHeight / 2;
    const cornerRadius = 2.4;
    cr.newPath();
    cr.arc(batteryX + batteryWidth - cornerRadius, batteryY + cornerRadius, cornerRadius, -Math.PI / 2, 0);
    cr.arc(batteryX + batteryWidth - cornerRadius, batteryY + batteryHeight - cornerRadius, cornerRadius, 0, Math.PI / 2);
    cr.arc(batteryX + cornerRadius, batteryY + batteryHeight - cornerRadius, cornerRadius, Math.PI / 2, Math.PI);
    cr.arc(batteryX + cornerRadius, batteryY + cornerRadius, cornerRadius, Math.PI, 1.5 * Math.PI);
    cr.closePath();
    cr.stroke();
    cr.rectangle(batteryX + batteryWidth + 1.4, centerY - 2, 1.7, 4);
    cr.fill();
    cr.rectangle(batteryX + 2.4, batteryY + 2.4, (batteryWidth - 4.8) * 0.72, batteryHeight - 4.8);
    cr.fill();
    drawText(cr, '72%', batteryX + batteryWidth + 6, centerY,
             { size: 11, rgba: textColor, anchor: 'start', vcenter: centerY });
}

class PreviewController {
    constructor(settings, onTick) {
        this._settings = settings;
        this._onTick = onTick;
        this._scene = null;
        this._tickTimerId = 0;
        this._stopTimeoutId = 0;
        this._startTimestampUs = 0;
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
        return this._tickTimerId ? (GLib.get_monotonic_time() - this._startTimestampUs) / 1e6 : 4.1;
    }

    start(scene) {
        this._scene = scene;
        this._startTimestampUs = GLib.get_monotonic_time();
        if (!this._tickTimerId)
            this._tickTimerId = GLib.timeout_add(GLib.PRIORITY_LOW, 33, this._onTick);
        if (this._stopTimeoutId)
            GLib.source_remove(this._stopTimeoutId);
        this._stopTimeoutId = GLib.timeout_add_seconds(GLib.PRIORITY_LOW, 12, () => {
            this._stopTimeoutId = 0;
            this._scene = null;
            if (this._tickTimerId) {
                GLib.source_remove(this._tickTimerId);
                this._tickTimerId = 0;
            }
            this._onTick();
        });
        this._onTick();
    }

    resume() {
        if (this._scene && !this._tickTimerId)
            this._tickTimerId = GLib.timeout_add(GLib.PRIORITY_LOW, 33, this._onTick);
    }

    stop() {
        this._scene = null;
        if (this._tickTimerId)
            GLib.source_remove(this._tickTimerId);
        if (this._stopTimeoutId)
            GLib.source_remove(this._stopTimeoutId);
        this._tickTimerId = 0;
        this._stopTimeoutId = 0;
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
        const searchGroups = this._buildSearchLocationGroup(settings, client, selectedResult => {
            manual.setLocation(selectedResult.latitude, selectedResult.longitude, selectedResult.name);
        });

        page.add(this._buildAutoLocationGroup(settings));
        searchGroups.forEach(group => page.add(group));
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

        const choose = result => {
            settings.set_boolean('auto-location', false);
            settings.set_double('location-latitude', result.latitude);
            settings.set_double('location-longitude', result.longitude);
            settings.set_string('location-name', result.name);
            onSelect(result);
            clearResults();
        };

        searchEntry.connect('entry-activated', () => {
            const query = searchEntry.get_text().trim();
            if (query.length < 2)
                return;
            client.geocode(query).then(results => {
                clearResults();
                if (results.length === 0) {
                    const noneRow = new Adw.ActionRow({
                        title: _('No matches'),
                        sensitive: false,
                    });
                    resultRows.push(noneRow);
                    resultsGroup.add(noneRow);
                    resultsGroup.visible = true;
                    return;
                }
                for (const result of results) {
                    const row = new ResultRow(locationLabel(result), () => choose(result));
                    resultRows.push(row);
                    resultsGroup.add(row);
                }
                resultsGroup.visible = true;
            }).catch(err => {
                searchEntry.add_css_class('error');
                logError(err, 'Weatherglass prefs geocode');
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
            const val = parseFloat(latEntry.get_text());
            if (Number.isFinite(val) && val >= -90 && val <= 90) {
                settings.set_double('location-latitude', val);
                settings.set_boolean('auto-location', false);
                latEntry.remove_css_class('error');
            } else
                latEntry.add_css_class('error');
        });
        lonEntry.connect('entry-activated', () => {
            const val = parseFloat(lonEntry.get_text());
            if (Number.isFinite(val) && val >= -180 && val <= 180) {
                settings.set_double('location-longitude', val);
                settings.set_boolean('auto-location', false);
                lonEntry.remove_css_class('error');
            } else
                lonEntry.add_css_class('error');
        });
        nameEntry.connect('entry-activated', () => {
            const val = nameEntry.get_text().trim();
            if (val)
                settings.set_string('location-name', val);
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

        const CONDITION_MODES = ['off', 'icons', 'pills'];
        const condRow = new Adw.ComboRow({
            title: _('Weather conditions'),
            subtitle: _('How hourly conditions ride the chart'),
            model: new Gtk.StringList({
                strings: [_('Off'), _('Hourly icons'), _('Grouped pills')],
            }),
        });
        const conditionIndex = CONDITION_MODES.indexOf(settings.get_string('condition-strip'));
        condRow.set_selected(conditionIndex < 0 ? 1 : conditionIndex);
        condRow.connect('notify::selected', () =>
            settings.set_string('condition-strip', CONDITION_MODES[condRow.get_selected()] ?? 'icons'));
        bgGroup.add(condRow);

        const CONDITION_POSITIONS = ['top', 'bottom'];
        const posRow = new Adw.ComboRow({
            title: _('Condition band position'),
            subtitle: _('Along the chart top, or above the hour labels'),
            model: new Gtk.StringList({
                strings: [_('Chart top'), _('Above hours')],
            }),
        });
        const positionIndex = CONDITION_POSITIONS.indexOf(settings.get_string('condition-pos'));
        posRow.set_selected(positionIndex < 0 ? 1 : positionIndex);
        posRow.connect('notify::selected', () =>
            settings.set_string('condition-pos', CONDITION_POSITIONS[posRow.get_selected()] ?? 'bottom'));
        bgGroup.add(posRow);

        const EMPHASIS_MODES = ['normal', 'bold', 'large', 'both'];
        const emphRow = new Adw.ComboRow({
            title: _('Data text'),
            subtitle: _('Bolder or larger metric values and chart hours'),
            model: new Gtk.StringList({
                strings: [_('Normal'), _('Bold'), _('Large'), _('Bold & large')],
            }),
        });
        const emphasisIndex = EMPHASIS_MODES.indexOf(settings.get_string('text-emphasis'));
        emphRow.set_selected(emphasisIndex < 0 ? 0 : emphasisIndex);
        emphRow.connect('notify::selected', () =>
            settings.set_string('text-emphasis', EMPHASIS_MODES[emphRow.get_selected()] ?? 'normal'));
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
        const PROVIDER_IDS = ['open-meteo', 'met-norway', 'noaa-nws'];
        const selectedProviderIndex = PROVIDER_IDS.indexOf(settings.get_string('provider'));
        provRow.set_selected(selectedProviderIndex < 0 ? 0 : selectedProviderIndex);
        provRow.connect('notify::selected', () =>
            settings.set_string('provider', PROVIDER_IDS[provRow.get_selected()] ?? 'open-meteo'));
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
        const MODEL_IDS = ['best_match', 'ecmwf_ifs025', 'icon_seamless', 'gfs_seamless'];
        const selectedModelIndex = MODEL_IDS.indexOf(settings.get_string('om-model'));
        modelRow.set_selected(Math.max(selectedModelIndex, 0));
        modelRow.connect('notify::selected', () =>
            settings.set_string('om-model', MODEL_IDS[modelRow.get_selected()] ?? 'best_match'));
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
        const styleManager = Adw.StyleManager.get_default();

        let barArea, skyArea, glyphArea;
        const tick = () => {
            skyArea?.queue_draw();
            barArea?.queue_draw();
            glyphArea?.queue_draw();
            return GLib.SOURCE_CONTINUE;
        };

        const previewController = new PreviewController(settings, tick);

        const { sceneGroup, glyphArea: previewGlyphArea } = this._buildPreviewSceneGroup(previewController, styleManager);
        glyphArea = previewGlyphArea;
        barArea = this._buildMockBar(settings, previewController, styleManager);
        skyArea = this._buildLiveSky(previewController, styleManager);

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

        barArea.connect('unrealize', () => previewController.stop());
        barArea.connect('realize', () => previewController.resume());
        settings.connect('changed::hour-format', () => barArea.queue_draw());
        const liveSync = () => {
            skyArea.queue_draw();
            barArea.queue_draw();
        };
        settings.connect('changed::live-scene', liveSync);
        settings.connect('changed::live-night', liveSync);
        styleManager.connect('notify::dark-mode', () => {
            skyArea.queue_draw();
            barArea.queue_draw();
            glyphArea.queue_draw();
        });
        return page;
    }

    _buildPreviewSceneGroup(previewController, styleManager) {
        const sceneRow = new Adw.ComboRow({
            title: _('Preview scene'),
            subtitle: _('Loops right here for ~12 s — your real panel stays put'),
            model: new Gtk.StringList({ strings: LEGEND.map(([, labelStr]) => _(labelStr)) }),
        });
        const glyphArea = new Gtk.DrawingArea();
        glyphArea.set_size_request(30, 30);
        glyphArea.set_valign(Gtk.Align.CENTER);
        glyphArea.set_draw_func((widget, cr, width, height) => {
            const [scene] = LEGEND[sceneRow.get_selected()] ?? LEGEND[2];
            cr.save();
            const scaleFactor = Math.min(width, height) / 24;
            cr.scale(scaleFactor, scaleFactor);
            paintWeather(cr, {
                scene,
                time: previewController.elapsed,
                dark: styleManager.dark,
                night: scene === 'moon',
                intensity: LEGEND_PRECIP_INTENSITY[scene] ?? 0,
            });
            cr.restore();
        });
        sceneRow.add_prefix(glyphArea);

        let armed = false;
        sceneRow.connect('notify::selected', () => {
            if (!armed)
                return;
            const [scene] = LEGEND[sceneRow.get_selected()] ?? LEGEND[2];
            previewController.start(scene);
        });
        sceneRow.set_selected(2);
        armed = true;

        const sceneGroup = new Adw.PreferencesGroup({ title: _('Scene') });
        sceneGroup.add(sceneRow);
        return { sceneGroup, glyphArea };
    }

    _buildMockBar(settings, previewController, styleManager) {
        const barArea = new Gtk.DrawingArea();
        barArea.set_size_request(-1, 58);
        barArea.set_draw_func((widget, cr, width, height) => {
            const dark = styleManager.dark;
            const BAR_HEIGHT = 34;
            drawMockWallpaper(cr, width, height, BAR_HEIGHT);

            const textColor = dark ? [1, 1, 1, 1] : [0.13, 0.13, 0.16, 1];
            cr.setSourceRGBA(...(dark ? [0.05, 0.06, 0.08, 0.62] : [1, 1, 1, 0.55]));
            cr.rectangle(0, 0, width, BAR_HEIGHT);
            cr.fill();
            cr.setSourceRGBA(0, 0, 0, 0.22);
            cr.rectangle(0, BAR_HEIGHT - 1, width, 1);
            cr.fill();

            const isRtl = Gtk.get_locale_direction() === Gtk.TextDirection.RTL;
            const centerY = BAR_HEIGHT / 2;

            const now = GLib.DateTime.new_now_local();
            const clock = now.format('%b %e').replace(/\s+/g, ' ') + '  ' +
                (is24HourFor(settings)
                    ? now.format('%H:%M')
                    : now.format('%I:%M %p').replace(/^0/, ''));
            drawText(cr, clock, isRtl ? width - 16 : 16, centerY, {
                size: 11, bold: true, rgba: textColor, vcenter: centerY,
                anchor: isRtl ? 'end' : 'start',
            });

            const scene = previewController.scene;
            const tempTxt = settings.get_boolean('show-temperature')
                ? (settings.get_string('units') === 'metric' ? '20°' : '68°') : '';
            const items = [];
            if (settings.get_boolean('show-icon')) {
                items.push({
                    width: 24,
                    draw: x => {
                        cr.save();
                        cr.translate(x + 2, centerY - 10);
                        cr.scale(20 / 24, 20 / 24);
                        paintWeather(cr, {
                            scene,
                            time: previewController.elapsed,
                            dark,
                            night: previewController.isNight,
                            windy: ['sun', 'moon', 'partly', 'cloud', 'fog', 'wind'].includes(scene),
                            windKmh: 34,
                            intensity: previewController.isPreviewing ? 7 : (LEGEND_PRECIP_INTENSITY[scene] ?? 0),
                        });
                        cr.restore();
                    },
                });
            }
            if (tempTxt) {
                items.push({
                    width: 34,
                    draw: x => drawText(cr, tempTxt, x + 17, centerY, { size: 11, rgba: textColor, vcenter: centerY }),
                });
            }
            items.push({ width: 18, gapBefore: true, draw: x => drawMockWifi(cr, x, centerY, textColor) });
            items.push({ width: 18, draw: x => drawMockSpeaker(cr, x, centerY, textColor) });
            items.push({ width: 52, draw: x => drawMockBattery(cr, x, centerY, textColor) });

            const GAP = 8, BIGGAP = 16;
            const total = items.reduce((sum, item, idx) =>
                sum + item.width + (idx && item.gapBefore ? BIGGAP : idx ? GAP : 0), 0);
            if (isRtl)
                items.reverse();
            let x = isRtl ? 16 : width - 16 - total;
            items.forEach((item, idx) => {
                if (idx)
                    x += item.gapBefore ? BIGGAP : GAP;
                item.draw(x);
                x += item.width;
            });
        });
        return barArea;
    }

    _buildLiveSky(previewController, styleManager) {
        let skyPool = null;
        const skyArea = new Gtk.DrawingArea();
        skyArea.set_size_request(-1, 170);
        skyArea.set_draw_func((widget, cr, width, height) => {
            skyPool ??= createSky();
            paintSky(cr, {
                w: width, h: height, time: previewController.elapsed,
                scene: previewController.scene,
                night: previewController.isNight,
                sky: skyPool,
                radius: 14,
                scrim: styleManager.dark ? null : [1, 1, 1, 0.42],
            });
        });
        return skyArea;
    }

    _aboutPage() {
        const page = new Adw.PreferencesPage({
            title: _('About'),
            icon_name: 'help-about-symbolic',
        });

        const metadata = this.metadata;
        const infoGroup = new Adw.PreferencesGroup({ title: _('Weatherglass') });
        infoGroup.add(new Adw.ActionRow({
            title: _('Version'),
            subtitle: String(metadata?.version ?? 'dev'),
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
