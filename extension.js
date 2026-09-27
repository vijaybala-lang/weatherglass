/* animated-weather — GNOME Shell extension entry point. */

import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import GObject from 'gi://GObject';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';

import {WeatherIcon} from './animation.js';
import {ForecastPanel} from './menu.js';
import {WeatherClient, sceneFor, deriveScene, fmtTemp} from './weather.js';
import {moonPhase} from './moon.js';

/* Adwaita accent swatches (org.gnome.desktop.interface accent-color) */
const ACCENTS = {
    blue:     [0.208, 0.518, 0.894],   // #3584e4
    teal:     [0.129, 0.565, 0.655],   // #2190a7
    green:    [0.227, 0.580, 0.290],   // #3a944a
    yellow:   [0.784, 0.533, 0.000],   // #c88800
    orange:   [0.929, 0.357, 0.000],   // #ed5b00
    red:      [0.878, 0.106, 0.141],   // #e01b24
    pink:     [0.835, 0.380, 0.600],   // #d56199
    purple:   [0.569, 0.255, 0.675],   // #9141ac
    slate:    [0.435, 0.514, 0.588],   // #6f8396
    lavender: [0.388, 0.271, 0.812],   // #6345cf
    violet:   [0.486, 0.306, 0.635],   // #7c4ea2
    sage:     [0.396, 0.569, 0.380],
    rose:     [0.925, 0.420, 0.506],
};
const FALLBACK_ACCENT = ACCENTS.blue;

function hexRgb(s) {
    const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/.exec(s);
    if (!m)
        return null;
    let hex = m[1];
    if (hex.length === 3)
        hex = hex.split('').map(c => c + c).join('');
    return [0, 2, 4].map(i => parseInt(hex.slice(i, i + 2), 16) / 255);
}

const PANEL_ICON_SIZE = 20;

const WeatherIndicator = GObject.registerClass(
class WeatherIndicator extends PanelMenu.Button {
    _init(extension) {
        super._init(0.0, 'Weatherglass', false);

        this._ext = extension;
        this._settings = extension.getSettings();
        this._client = new WeatherClient(this._settings.get_string('provider'),
                                         this._settings.get_string('om-model'));
        this._timer = 0;
        this._locTimer = 0;
        this._previewId = 0;
        this._refetch = false;
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
        // remember the live sky so the preferences legend can idle on it
        this._panel.onSky((scene, night) => {
            this._settings.set_string('live-scene', scene);
            this._settings.set_boolean('live-night', night);
        });

        // OS dark-mode + accent tracking: color-scheme wins, legacy bool is
        // the fallback; accent-color feeds the 'accent' menu style
        this._dark = true;
        this._accent = FALLBACK_ACCENT;
        try {
            this._iface = new Gio.Settings({schema_id: 'org.gnome.desktop.interface'});
            this._dark = this._isDark();
            this._accent = this._accentColor();
            this._darkId = this._iface.connect('changed', (s, key) => {
                if (key === 'color-scheme' || key === 'gtk-application-prefer-dark-theme') {
                    this._dark = this._isDark();   // keep the field current:
                    this._panel.setDark(this._dark);  // _syncPanelLook replays it
                } else if (key === 'accent-color')
                    this._panel.setAccent(this._accentColor());
            });
        } catch {
            this._iface = null;   // exotic distro without the interface schema
        }
        this._syncPanelLook();

        const section = new PopupMenu.PopupMenuSection();
        section.actor.add_child(this._panel.actor);
        this.menu.addMenuItem(section);
        this.menu.actor.add_style_class_name('aw-menu');
        this._section = section;

        // The theme's .popup-menu-content padding (~12px) would shrink the
        // 330px card and frame the full-bleed sky in popup grey. Inline styles
        // outrank class CSS whatever the wrapper chain looks like.
        for (let a = this._panel.actor; a; a = a.get_parent()) {
            a.set_style('padding: 0px; margin: 0px; border-width: 0px;');
            if (a === this.menu.actor)
                break;
        }

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

    /** Mirror GNOME's own dark-mode rule: color-scheme preference wins,
     *  falling back to the legacy prefer-dark-theme boolean. */
    _isDark() {
        if (!this._iface)
            return this._dark;   // no interface schema: keep last known state
        try {
            const scheme = this._iface.get_string('color-scheme');
            if (scheme === 'prefer-dark' || scheme === 'force-dark')
                return true;
            if (scheme === 'prefer-light' || scheme === 'force-light')
                return false;
        } catch {
            // older schemas lack color-scheme; fall through to the boolean
        }
        return this._iface.get_boolean('gtk-application-prefer-dark-theme');
    }

    /* ── fetching ───────────────────────────────────────────────────────── */

    _isStale() {
        const interval = this._settings.get_int('refresh-minutes') * 60;
        const now = GLib.get_monotonic_time() / 1000000;
        return this._lastFetch === 0 || (now - this._lastFetch) > interval;
    }

    async _fetch(force) {
        if (this._busy) {
            // a forced request while one is in flight means settings changed
            // mid-fetch — remember it and refetch with the final values
            if (force)
                this._refetch = true;
            return;
        }
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
            });
            if (this._dead)
                return;   // disabled while the fetch was in flight
            this._data = data;
            this._lastFetch = GLib.get_monotonic_time() / 1000000;
            this._panel.setPlaceName(
                (auto && data.detectedName) || this._placeName());
            this._update();
        } catch (e) {
            if (this._dead)
                return;
            logError(e, 'Weatherglass');
            this._icon.setScene('error');
            if (!this._data) {
                this._tempLbl.set_text('');
                this._panel.setError(`Weather unavailable: ${e.message}`);
            }
            this._scheduleRetry();
        } finally {
            this._busy = false;
            if (this._refetch && !this._dead) {
                this._refetch = false;
                this._fetch(true);
            }
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
        // data.current.wind is canonical km/h, threshold is stored in km/h
        return data.current.wind >= threshold;
    }

    _update() {
        const data = this._data;
        if (!data)
            return;

        const units = this._units();
        const {current, daily} = data;
        const effective = deriveScene(current);
        const {scene} = effective;
        const windy = this._windy(data);

        // panel icon: strong wind swaps in the dedicated wind scene when the
        // sky scene has no precipitation of its own
        const panelScene = windy && ['sun', 'moon', 'partly', 'cloud', 'fog'].includes(scene)
            ? 'wind' : scene;
        const phase = moonPhase().phase;   // tonight's real lunar phase
        this._icon.setScene(panelScene, {
            windy: windy && panelScene !== 'wind',
            night: !current.isDay,
            intensity: current.intensity,
            windKmh: current.wind,          // canonical km/h
            phase,
        });

        this._tempLbl.set_text(
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
            windKmh: current.wind,          // canonical km/h
            dark: this._isDark(),   // live read: survives toggles since boot
            phase,                          // tonight's real lunar phase
            updated: GLib.DateTime.new_now_local(),
        });
    }

    /* ── settings changes ───────────────────────────────────────────────── */

    _onSetting(key) {
        switch (key) {
        case 'auto-location':
        case 'location-latitude':
        case 'location-longitude':
        case 'location-name':
        case 'units':
            this._panel.setPlaceName(this._placeName());
            this._scheduleLocationFetch();
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
        case 'provider':
            this._client.providerId = this._settings.get_string('provider');
            this._fetch(true);
            break;
        case 'om-model':
            this._client.model = this._settings.get_string('om-model');
            this._fetch(true);
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
        case 'preview-scene':
            this._previewScene();
            break;
        }
    }

    /**
     * The preferences window writes a scene name to 'preview-scene' to force
     * that animation on the panel icon for a while (so users can watch rare
     * scenes without waiting for the sky). We reset the key when done, which
     * re-fires 'changed' — the empty-string guard below breaks that loop.
     */
    _previewScene() {
        const scene = this._settings.get_string('preview-scene');
        if (!scene)
            return;
        if (this._previewId)
            GLib.source_remove(this._previewId);
        this._icon.setScene(scene, {
            windy: ['sun', 'moon', 'partly', 'cloud', 'fog', 'wind'].includes(scene),
            night: scene === 'moon',
            intensity: 7,
            windKmh: 34,
        });
        this._previewId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 12, () => {
            this._previewId = 0;
            this._settings.set_string('preview-scene', '');
            if (this._data)
                this._update();
            else
                this._icon.setScene('loading');
            return GLib.SOURCE_REMOVE;
        });
    }

    /**
     * Choosing a city writes auto-location=false + lat + lon + name in quick
     * succession; each key fires 'changed'. Coalesce those into one fetch so
     * we never request the weather for a half-updated location.
     */
    _scheduleLocationFetch() {
        if (this._locTimer)
            return;
        this._locTimer = GLib.timeout_add(GLib.PRIORITY_LOW, 250, () => {
            this._locTimer = 0;
            this._fetch(true);
            return GLib.SOURCE_REMOVE;
        });
    }

    _rebuildPanel(animate) {
        // ForecastPanel was built with a fixed animate flag; rebuild it.
        this._section.actor.remove_child(this._panel.actor);
        this._panel.destroy();
        this._panel = new ForecastPanel({animate});
        this._panel.onRefresh(() => this._fetch(true));
        this._panel.onSettings(() => this._ext.openPreferences());
        // remember the live sky so the preferences legend can idle on it
        this._panel.onSky((scene, night) => {
            this._settings.set_string('live-scene', scene);
            this._settings.set_boolean('live-night', night);
        });
        this._syncPanelLook();
        this._panel.setPlaceName(this._placeName());
        this._section.actor.add_child(this._panel.actor);
    }

    /** (re)apply all OS/settings look state a fresh panel needs */
    _syncPanelLook() {
        this._panel.setDark(this._dark);
        this._panel.setAccent(this._accent);
        this._panel.setStyle(this._settings.get_string('menu-style'));
        this._panel.setConditions(this._settings.get_string('condition-strip'));
        this._panel.setCondPos(this._settings.get_string('condition-pos'));
        this._panel.setEmboss(this._settings.get_boolean('text-emboss'));
    }

    /** OS accent colour as [r, g, b] 0..1: Adwaita swatch names or a custom
     *  '#rrggbb'; anything unknown (or no schema) falls back to GNOME blue. */
    _accentColor() {
        const raw = (this._iface.get_string('accent-color') ?? '').trim().toLowerCase();
        return ACCENTS[raw] ?? hexRgb(raw) ?? FALLBACK_ACCENT;
    }

    /* ── teardown ───────────────────────────────────────────────────────── */

    destroy() {
        this._dead = true;   // async _fetch continuations check this
        if (this._timer)
            GLib.source_remove(this._timer);
        if (this._locTimer)
            GLib.source_remove(this._locTimer);
        if (this._previewId)
            GLib.source_remove(this._previewId);
        if (this._settingsId)
            this._settings.disconnect(this._settingsId);
        if (this._darkId && this._iface)
            this._iface.disconnect(this._darkId);
        if (this._openId)
            this.menu.disconnect(this._openId);
        // ForecastPanel is plain JS, not an actor: actor teardown below does
        // NOT reach its city-clock GLib timeout. Without this the timer keeps
        // ticking set_text() on disposed labels after every disable
        // (observed: disposed-label storm → SIGSEGV on theme reload).
        this._panel?.destroy();
        this._panel = null;
        super.destroy();
    }
});

export default class AnimatedWeatherExtension extends Extension {
    enable() {
        // build stamp: journalctl --user -o cat | grep "Weatherglass v"
        // shows which on-disk code the long-lived shell process is running
        // (GJS caches extension modules; code edits need a session restart)
        console.log('Weatherglass v5.6 (provider adapters: Open-Meteo + MET Norway + NOAA NWS)');
        this._indicator = new WeatherIndicator(this);
        Main.panel.addToStatusArea(this.uuid, this._indicator);
    }

    disable() {
        this._indicator?.destroy();
        this._indicator = null;
    }
}
