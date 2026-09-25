/* animated-weather — GNOME Shell extension entry point. */

import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';

import {WeatherIcon} from './animation.js';
import {ForecastPanel} from './menu.js';
import {WeatherClient, sceneFor, fmtTemp} from './weather.js';

const PANEL_ICON_SIZE = 20;

const WeatherIndicator = GObject.registerClass(
class WeatherIndicator extends PanelMenu.Button {
    _init(extension) {
        super._init(0.0, 'Animated Weather', false);

        this._ext = extension;
        this._settings = extension.getSettings();
        this._client = new WeatherClient();
        this._timer = 0;
        this._lastFetch = 0;        // GLib DateTime seconds, 0 = never
        this._data = null;
        this._busy = false;

        // ── panel button contents ─────────────────────────────────────────
        const box = new St.BoxLayout({
            style_class: 'aw-panel-box',
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._icon = new WeatherIcon({size: PANEL_ICON_SIZE,
                                      animate: this._settings.get_boolean('animate')});
        this._tempLbl = new St.Label({text: '', style_class: 'aw-temp',
                                      y_align: Clutter.ActorAlign.CENTER});
        box.add_child(this._icon);
        box.add_child(this._tempLbl);
        this._icon.visible = this._settings.get_boolean('show-icon');
        this.add_child(box);

        // ── dropdown ──────────────────────────────────────────────────────
        this._panel = new ForecastPanel({animate: this._settings.get_boolean('animate')});
        this._panel.onRefresh(() => this._fetch(true));
        this._panel.onSettings(() => this._ext.openPreferences());

        const section = new PopupMenu.PopupMenuSection();
        section.actor.add_child(this._panel.actor);
        this.menu.addMenuItem(section);
        this.menu.actor.add_style_class_name('aw-menu');
        this._section = section;

        this._panel.setPlaceName(this._placeName());

        // ── signals ───────────────────────────────────────────────────────
        this._openId = this.menu.connect('open-state-changed', (menu, open) => {
            if (open && this._isStale())
                this._fetch(false);
        });

        this._settingsId = this._settings.connect('changed', (s, key) =>
            this._onSetting(key));

        this._fetch(true);
        this._restartTimer();
    }

    /* ── location / units ───────────────────────────────────────────────── */

    _placeName() {
        if (this._settings.get_boolean('auto-location'))
            return 'My location';
        return this._settings.get_string('location-name') || 'Custom location';
    }

    _units() {
        return this._settings.get_string('units');
    }

    /* ── fetching ───────────────────────────────────────────────────────── */

    _isStale() {
        const interval = this._settings.get_int('refresh-minutes') * 60;
        const now = GLib.get_monotonic_time() / 1000000;
        return this._lastFetch === 0 || (now - this._lastFetch) > interval;
    }

    async _fetch(force) {
        if (this._busy || (!force && !this._isStale()))
            return;
        this._busy = true;

        this._icon.setScene('loading');
        if (!this._data)
            this._panel.showPlaceholder('Fetching weather…');

        try {
            const auto = this._settings.get_boolean('auto-location');
            const data = await this._client.fetch({
                auto,
                latitude: this._settings.get_double('location-latitude'),
                longitude: this._settings.get_double('location-longitude'),
                units: this._units(),
            });
            this._data = data;
            this._lastFetch = GLib.get_monotonic_time() / 1000000;
            this._panel.setPlaceName(
                (auto && data.detectedName) || this._placeName());
            this._update();
        } catch (e) {
            logError(e, 'Animated Weather');
            this._icon.setScene('error');
            if (!this._data) {
                this._tempLbl.set_text('');
                this._panel.setError(`Weather unavailable: ${e.message}`);
            }
            this._scheduleRetry();
        } finally {
            this._busy = false;
        }
    }

    _scheduleRetry() {
        // Back off for 60 s but keep the old data visible.
        if (this._timer)
            GLib.source_remove(this._timer);
        this._timer = GLib.timeout_add_seconds(GLib.PRIORITY_LOW, 60, () => {
            this._timer = 0;
            this._fetch(true);
            return GLib.SOURCE_REMOVE;
        });
    }

    _restartTimer() {
        if (this._timer) {
            GLib.source_remove(this._timer);
            this._timer = 0;
        }
        const mins = this._settings.get_int('refresh-minutes');
        this._timer = GLib.timeout_add_seconds(GLib.PRIORITY_LOW, mins * 60, () => {
            this._timer = 0;
            this._fetch(true);
            return GLib.SOURCE_REMOVE;
        });
    }

    /* ── painting ───────────────────────────────────────────────────────── */

    _windy(data) {
        const threshold = this._settings.get_int('windy-threshold');
        if (threshold === 0)
            return false;
        const kmh = this._units() === 'imperial'
            ? data.current.wind * 1.60934
            : data.current.wind;
        return kmh >= threshold;
    }

    _update() {
        const data = this._data;
        if (!data)
            return;

        const units = this._units();
        const {current, daily} = data;
        const {scene} = sceneFor(current.code, current.isDay);
        const windy = this._windy(data);

        // panel icon: strong wind swaps in the dedicated wind scene when the
        // sky scene has no precipitation of its own
        const panelScene = windy && ['sun', 'moon', 'partly', 'cloud', 'fog'].includes(scene)
            ? 'wind' : scene;
        this._icon.setScene(panelScene, {
            windy: windy && panelScene !== 'wind',
            night: !current.isDay,
            intensity: current.intensity,
            windKmh: units === 'imperial' ? current.wind * 1.60934 : current.wind,
        });

        this._tempLbl.set_text(
            this._settings.get_boolean('show-temperature')
                ? fmtTemp(current.temp, units) : '');

        this._panel.render({
            current,
            daily,
            units,
            windy,
            windKmh: units === 'imperial' ? current.wind * 1.60934 : current.wind,
            updated: GLib.DateTime.new_now_local(),
        });
    }

    /* ── settings changes ───────────────────────────────────────────────── */

    _onSetting(key) {
        switch (key) {
        case 'auto-location':
        case 'location-latitude':
        case 'location-longitude':
        case 'units':
            this._panel.setPlaceName(this._placeName());
            this._fetch(true);
            break;
        case 'refresh-minutes':
            this._restartTimer();
            break;
        case 'animate': {
            const on = this._settings.get_boolean('animate');
            this._icon.setAnimate(on);
            this._panel.destroy();
            this._rebuildPanel(on);
            if (this._data)
                this._update();
            break;
        }
        case 'show-icon':
            this._icon.visible = this._settings.get_boolean('show-icon');
            break;
        case 'show-temperature':
        case 'windy-threshold':
            if (this._data)
                this._update();
            break;
        }
    }

    _rebuildPanel(animate) {
        // ForecastPanel was built with a fixed animate flag; rebuild it.
        this._section.actor.remove_child(this._panel.actor);
        this._panel.destroy();
        this._panel = new ForecastPanel({animate});
        this._panel.onRefresh(() => this._fetch(true));
        this._panel.onSettings(() => this._ext.openPreferences());
        this._panel.setPlaceName(this._placeName());
        this._section.actor.add_child(this._panel.actor);
    }

    /* ── teardown ───────────────────────────────────────────────────────── */

    destroy() {
        if (this._timer)
            GLib.source_remove(this._timer);
        if (this._settingsId)
            this._settings.disconnect(this._settingsId);
        if (this._openId)
            this.menu.disconnect(this._openId);
        super.destroy();
    }
});

export default class AnimatedWeatherExtension extends Extension {
    enable() {
        this._indicator = new WeatherIndicator(this);
        Main.panel.addToStatusArea(this.uuid, this._indicator);
    }

    disable() {
        this._indicator?.destroy();
        this._indicator = null;
    }
}
