/* weatherglass -- GNOME Shell extension entry point. */

import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import GObject from 'gi://GObject';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

import { Extension, gettext as _ } from 'resource:///org/gnome/shell/extensions/extension.js';

import { WeatherIcon } from './animation.js';
import { ForecastPanel } from './menu.js';
import { WeatherClient, sceneFor, deriveScene, fmtTemp } from './weather.js';
import { moonPhase } from './moon.js';

/* Adwaita accent swatches (org.gnome.desktop.interface accent-color) */
const ACCENTS = {
    blue: [0.208, 0.518, 0.894],   // #3584e4
    teal: [0.129, 0.565, 0.655],   // #2190a7
    green: [0.227, 0.580, 0.290],   // #3a944a
    yellow: [0.784, 0.533, 0.000],   // #c88800
    orange: [0.929, 0.357, 0.000],   // #ed5b00
    red: [0.878, 0.106, 0.141],   // #e01b24
    pink: [0.835, 0.380, 0.600],   // #d56199
    purple: [0.569, 0.255, 0.675],   // #9141ac
    slate: [0.435, 0.514, 0.588],   // #6f8396
    lavender: [0.388, 0.271, 0.812],   // #6345cf
    violet: [0.486, 0.306, 0.635],   // #7c4ea2
    sage: [0.396, 0.569, 0.380],
    rose: [0.925, 0.420, 0.506],
};
const FALLBACK_ACCENT = ACCENTS.blue;

function hexRgb(hexString) {
    const match = /^#([0-9a-f]{3}|[0-9a-f]{6})$/.exec(hexString);
    if (!match)
        return null;
    let hex = match[1];
    if (hex.length === 3)
        hex = hex.split('').map(char => char + char).join('');
    return [0, 2, 4].map(idx => parseInt(hex.slice(idx, idx + 2), 16) / 255);
}

const PANEL_ICON_SIZE = 20;

/**
 * Tracks desktop-wide dark mode, accent colour, and clock preferences
 * from org.gnome.desktop.interface.
 */
class SystemThemeWatcher {
    constructor(onChange) {
        this._onChange = onChange;
        this._iface = null;
        this._changedId = 0;
        this._dark = true;
        this._accent = FALLBACK_ACCENT;

        try {
            this._iface = new Gio.Settings({ schema_id: 'org.gnome.desktop.interface' });
            this._dark = this._readIsDark();
            this._accent = this._readAccentColor();
            this._changedId = this._iface.connect('changed', (settings, key) => {
                if (key === 'color-scheme' || key === 'gtk-application-prefer-dark-theme') {
                    this._dark = this._readIsDark();
                    if (this._onChange)
                        this._onChange({ type: 'dark', isDark: this._dark });
                } else if (key === 'accent-color') {
                    this._accent = this._readAccentColor();
                    if (this._onChange)
                        this._onChange({ type: 'accent', accent: this._accent });
                } else if (key === 'clock-format') {
                    if (this._onChange)
                        this._onChange({ type: 'clock' });
                }
            });
        } catch {
            this._iface = null;
        }
    }

    get isDark() {
        return this._iface ? this._readIsDark() : this._dark;
    }

    get accentColor() {
        return this._iface ? this._readAccentColor() : this._accent;
    }

    _readIsDark() {
        if (!this._iface)
            return this._dark;
        const scheme = this._iface.get_string('color-scheme');
        if (scheme === 'prefer-dark' || scheme === 'force-dark')
            return true;
        if (scheme === 'prefer-light' || scheme === 'force-light')
            return false;
        return this._iface.get_boolean('gtk-application-prefer-dark-theme');
    }

    _readAccentColor() {
        if (!this._iface)
            return this._accent;
        const rawAccentName = (this._iface.get_string('accent-color') ?? '').trim().toLowerCase();
        return ACCENTS[rawAccentName] ?? hexRgb(rawAccentName) ?? FALLBACK_ACCENT;
    }

    resolveHour24(modePreference) {
        if (modePreference === '24h')
            return true;
        if (modePreference === '12h')
            return false;
        if (this._iface) {
            try {
                const format = this._iface.get_string('clock-format');
                if (format)
                    return format.includes('24');
            } catch {
                // older GNOME: enum may be missing -- fall through
            }
        }
        try {
            return new Intl.DateTimeFormat(undefined, { hour: 'numeric' })
                .resolvedOptions().hour12 === false;
        } catch {
            return false;
        }
    }

    destroy() {
        if (this._changedId && this._iface) {
            this._iface.disconnect(this._changedId);
            this._changedId = 0;
        }
        this._iface = null;
        this._onChange = null;
    }
}

/**
 * Coordinates background weather fetches, debounce delays, periodic refresh
 * timers, and retry backoffs without touching UI actors.
 */
class WeatherCoordinator {
    constructor(settings) {
        this._settings = settings;
        this._client = new WeatherClient(
            this._settings.get_string('provider'),
            this._settings.get_string('om-model')
        );

        this._refreshTimerId = 0;
        this._locationTimerId = 0;
        this._lastFetch = 0;
        this._data = null;
        this._busy = false;
        this._refetchPending = false;

        this._onLoading = null;
        this._onData = null;
        this._onError = null;
    }

    get data() {
        return this._data;
    }

    onLoading(callback) { this._onLoading = callback; }
    onData(callback) { this._onData = callback; }
    onError(callback) { this._onError = callback; }

    setProvider(providerId) {
        this._client.providerId = providerId;
        this.fetch(true);
    }

    setModel(model) {
        this._client.model = model;
        this.fetch(true);
    }

    isStale() {
        const intervalSec = this._settings.get_int('refresh-minutes') * 60;
        const nowSec = GLib.get_monotonic_time() / 1000000;
        return this._lastFetch === 0 || (nowSec - this._lastFetch) > intervalSec;
    }

    async fetch(force = false) {
        if (this._busy) {
            if (force)
                this._refetchPending = true;
            return;
        }
        this._busy = true;
        if (this._onLoading)
            this._onLoading();

        try {
            const isAutoLocation = this._settings.get_boolean('auto-location');
            const data = await this._client.fetch({
                auto: isAutoLocation,
                latitude: this._settings.get_double('location-latitude'),
                longitude: this._settings.get_double('location-longitude'),
            });
            this._data = data;
            this._lastFetch = GLib.get_monotonic_time() / 1000000;
            if (this._onData)
                this._onData(data, isAutoLocation);
        } catch (err) {
            logError(err, 'Weatherglass');
            if (this._onError)
                this._onError(err);
            this.scheduleRetry();
        } finally {
            this._busy = false;
            if (this._refetchPending) {
                this._refetchPending = false;
                this.fetch(true);
            }
        }
    }

    scheduleRetry() {
        if (this._refreshTimerId)
            GLib.source_remove(this._refreshTimerId);
        this._refreshTimerId = GLib.timeout_add_seconds(GLib.PRIORITY_LOW, 60, () => {
            this._refreshTimerId = 0;
            this.fetch(true);
            return GLib.SOURCE_REMOVE;
        });
    }

    restartTimer() {
        if (this._refreshTimerId) {
            GLib.source_remove(this._refreshTimerId);
            this._refreshTimerId = 0;
        }
        const refreshMinutes = this._settings.get_int('refresh-minutes');
        this._refreshTimerId = GLib.timeout_add_seconds(GLib.PRIORITY_LOW, refreshMinutes * 60, () => {
            this._refreshTimerId = 0;
            this.fetch(true);
            return GLib.SOURCE_REMOVE;
        });
    }

    scheduleLocationFetch() {
        if (this._locationTimerId)
            return;
        this._locationTimerId = GLib.timeout_add(GLib.PRIORITY_LOW, 250, () => {
            this._locationTimerId = 0;
            this.fetch(true);
            return GLib.SOURCE_REMOVE;
        });
    }

    destroy() {
        if (this._refreshTimerId) {
            GLib.source_remove(this._refreshTimerId);
            this._refreshTimerId = 0;
        }
        if (this._locationTimerId) {
            GLib.source_remove(this._locationTimerId);
            this._locationTimerId = 0;
        }
        this._onLoading = null;
        this._onData = null;
        this._onError = null;
    }
}

/**
 * Shell top-panel indicator button with weather icon and dropdown forecast menu.
 */
const WeatherIndicator = GObject.registerClass(
    class WeatherIndicator extends PanelMenu.Button {
        _init(extension) {
            super._init(0.0, _('Weatherglass'), false);

            this._ext = extension;
            this._settings = extension.getSettings();
            this._previewTimeoutId = 0;

            this._themeWatcher = new SystemThemeWatcher(event => {
                if (event.type === 'dark')
                    this._panel.setDark(this._themeWatcher.isDark);
                else if (event.type === 'accent')
                    this._panel.setAccent(this._themeWatcher.accentColor);
                else if (event.type === 'clock')
                    this._panel.setHourFormat(this._resolveHour24());
            });

            this._coordinator = new WeatherCoordinator(this._settings);
            this._coordinator.onLoading(() => {
                this._icon.setScene('loading');
                if (!this._coordinator.data)
                    this._panel.showPlaceholder(_('Fetching weather…'));
            });
            this._coordinator.onData((data, isAutoLocation) => {
                this._panel.setPlaceName(
                    (isAutoLocation && data.detectedName) || this._placeName());
                this._update(data);
            });
            this._coordinator.onError(err => {
                this._icon.setScene('error');
                if (!this._coordinator.data) {
                    this._temperatureLabel.set_text('');
                    this._panel.setError(`Weather unavailable: ${err.message}`);
                }
            });

            const panelButtonBox = new St.BoxLayout({
                style_class: 'aw-panel-box',
                y_align: Clutter.ActorAlign.CENTER,
            });
            this._icon = new WeatherIcon({
                size: PANEL_ICON_SIZE,
                animate: this._settings.get_boolean('animate'),
            });
            this._temperatureLabel = new St.Label({
                text: '', style_class: 'aw-temp',
                y_align: Clutter.ActorAlign.CENTER,
            });
            panelButtonBox.add_child(this._icon);
            panelButtonBox.add_child(this._temperatureLabel);
            this._icon.visible = this._settings.get_boolean('show-icon');
            this.add_child(panelButtonBox);

            this._panel = new ForecastPanel({ animate: this._settings.get_boolean('animate') });
            this._panel.onRefresh(() => this._coordinator.fetch(true));
            this._panel.onSettings(() => this._ext.openPreferences());
            this._panel.onSky((scene, night) => {
                this._settings.set_string('live-scene', scene);
                this._settings.set_boolean('live-night', night);
            });

            this._syncPanelLook();

            const section = new PopupMenu.PopupMenuSection();
            section.actor.add_child(this._panel.actor);
            this.menu.addMenuItem(section);
            this.menu.actor.add_style_class_name('aw-menu');
            this._section = section;

            for (let ancestor = this._panel.actor; ancestor; ancestor = ancestor.get_parent()) {
                ancestor.set_style('padding: 0px; margin: 0px; border-width: 0px;');
                if (ancestor === this.menu.actor)
                    break;
            }

            this._panel.setPlaceName(this._placeName());

            this._menuOpenChangedId = this.menu.connect('open-state-changed', (menu, open) => {
                if (open && this._coordinator.isStale())
                    this._coordinator.fetch(false);
            });

            this._settingsChangedId = this._settings.connect('changed', (settings, key) =>
                this._onSetting(key));

            this._coordinator.fetch(true);
            this._coordinator.restartTimer();
        }

        _placeName() {
            if (this._settings.get_boolean('auto-location'))
                return _('My location');
            return this._settings.get_string('location-name') || _('Custom location');
        }

        _resolveHour24() {
            return this._themeWatcher.resolveHour24(this._settings.get_string('hour-format'));
        }

        _syncPanelLook() {
            this._panel.setDark(this._themeWatcher.isDark);
            this._panel.setAccent(this._themeWatcher.accentColor);
            this._panel.setHourFormat(this._resolveHour24());
            this._panel.setTextEmph(this._settings.get_string('text-emphasis'));
            this._panel.setStyle(this._settings.get_string('menu-style'));
            this._panel.setConditions(this._settings.get_string('condition-strip'));
            this._panel.setCondPos(this._settings.get_string('condition-pos'));
            this._panel.setEmboss(this._settings.get_boolean('text-emboss'));
        }

        _windy(data) {
            const threshold = this._settings.get_int('windy-threshold');
            if (threshold === 0)
                return false;
            return data.current.wind >= threshold;
        }

        _update(data = this._coordinator.data) {
            if (!data)
                return;

            const units = this._settings.get_string('units');
            const { current, daily } = data;
            const effective = deriveScene(current);
            const { scene } = effective;
            const windy = this._windy(data);

            const panelScene = windy && ['sun', 'moon', 'partly', 'cloud', 'fog'].includes(scene)
                ? 'wind' : scene;
            const phase = moonPhase().phase;
            this._icon.setScene(panelScene, {
                windy: windy && panelScene !== 'wind',
                night: !current.isDay,
                intensity: current.intensity,
                windKmh: current.wind,
                phase,
            });

            this._temperatureLabel.set_text(
                this._settings.get_boolean('show-temperature')
                    ? fmtTemp(current.temp, units) : '');

            this._panel.render({
                current,
                daily,
                hourly: data.hourly,
                currentIso: current.timeIso,
                units,
                windy,
                effective,
                windKmh: current.wind,
                dark: this._themeWatcher.isDark,
                phase,
                updated: GLib.DateTime.new_now_local(),
            });
        }

        _onSetting(key) {
            switch (key) {
                case 'auto-location':
                case 'location-latitude':
                case 'location-longitude':
                case 'location-name':
                case 'units':
                    this._panel.setPlaceName(this._placeName());
                    this._coordinator.scheduleLocationFetch();
                    break;
                case 'refresh-minutes':
                    this._coordinator.restartTimer();
                    break;
                case 'animate': {
                    const isAnimated = this._settings.get_boolean('animate');
                    this._icon.setAnimate(isAnimated);
                    this._panel.destroy();
                    this._rebuildPanel(isAnimated);
                    if (this._coordinator.data)
                        this._update();
                    break;
                }
                case 'show-icon':
                    this._icon.visible = this._settings.get_boolean('show-icon');
                    break;
                case 'show-temperature':
                case 'windy-threshold':
                    if (this._coordinator.data)
                        this._update();
                    break;
                case 'provider':
                    this._coordinator.setProvider(this._settings.get_string('provider'));
                    break;
                case 'om-model':
                    this._coordinator.setModel(this._settings.get_string('om-model'));
                    break;
                case 'menu-style':
                    this._panel.setStyle(this._settings.get_string('menu-style'));
                    break;
                case 'condition-strip':
                    this._panel.setConditions(this._settings.get_string('condition-strip'));
                    break;
                case 'condition-pos':
                    this._panel.setCondPos(this._settings.get_string('condition-pos'));
                    break;
                case 'text-emboss':
                    this._panel.setEmboss(this._settings.get_boolean('text-emboss'));
                    break;
                case 'hour-format':
                    this._panel.setHourFormat(this._resolveHour24());
                    break;
                case 'text-emphasis':
                    this._panel.setTextEmph(this._settings.get_string('text-emphasis'));
                    break;
                case 'preview-scene':
                    this._previewScene();
                    break;
            }
        }

        _previewScene() {
            const scene = this._settings.get_string('preview-scene');
            if (!scene)
                return;
            if (this._previewTimeoutId)
                GLib.source_remove(this._previewTimeoutId);
            this._icon.setScene(scene, {
                windy: ['sun', 'moon', 'partly', 'cloud', 'fog', 'wind'].includes(scene),
                night: scene === 'moon',
                intensity: 7,
                windKmh: 34,
            });
            this._previewTimeoutId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 12, () => {
                this._previewTimeoutId = 0;
                this._settings.set_string('preview-scene', '');
                if (this._coordinator.data)
                    this._update();
                else
                    this._icon.setScene('loading');
                return GLib.SOURCE_REMOVE;
            });
        }

        _rebuildPanel(animate) {
            this._section.actor.remove_child(this._panel.actor);
            this._panel.destroy();
            this._panel = new ForecastPanel({ animate });
            this._panel.onRefresh(() => this._coordinator.fetch(true));
            this._panel.onSettings(() => this._ext.openPreferences());
            this._panel.onSky((scene, night) => {
                this._settings.set_string('live-scene', scene);
                this._settings.set_boolean('live-night', night);
            });
            this._syncPanelLook();
            this._panel.setPlaceName(this._placeName());
            this._section.actor.add_child(this._panel.actor);
        }

        destroy() {
            if (this._previewTimeoutId) {
                GLib.source_remove(this._previewTimeoutId);
                this._previewTimeoutId = 0;
            }
            if (this._settingsChangedId) {
                this._settings.disconnect(this._settingsChangedId);
                this._settingsChangedId = 0;
            }
            if (this._menuOpenChangedId) {
                this.menu.disconnect(this._menuOpenChangedId);
                this._menuOpenChangedId = 0;
            }
            this._coordinator?.destroy();
            this._coordinator = null;
            this._themeWatcher?.destroy();
            this._themeWatcher = null;
            this._panel?.destroy();
            this._panel = null;
            super.destroy();
        }
    });

export default class AnimatedWeatherExtension extends Extension {
    enable() {
        console.log(`Weatherglass enabled from ${this.dir.get_path()}`);
        this._indicator = new WeatherIndicator(this);
        Main.panel.addToStatusArea(this.uuid, this._indicator);
        this._sheet = this.dir.get_child('stylesheet.css');
        St.ThemeContext.get_for_stage(global.stage)
            .get_theme().load_stylesheet(this._sheet);
    }

    disable() {
        if (this._sheet) {
            St.ThemeContext.get_for_stage(global.stage)
                .get_theme().unload_stylesheet(this._sheet);
            this._sheet = null;
        }
        this._indicator?.destroy();
        this._indicator = null;
    }
}
