/* menu.js — dropdown content: today's forecast plus the next 6 days. */

import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import St from 'gi://St';

import {WeatherIcon} from './animation.js';
import {sceneFor, fmtTemp, fmtWind, windDir, dayName, fmtTime} from './weather.js';

const STATIC_TIME = 1.1;   // frame chosen so static mini icons look lively

function label(text, cls) {
    return new St.Label({text, style_class: cls, y_align: Clutter.ActorAlign.CENTER});
}

function row(cls) {
    return new St.BoxLayout({
        style_class: cls,
        x_expand: true,
        y_align: Clutter.ActorAlign.CENTER,
    });
}

function column(cls) {
    return new St.BoxLayout({vertical: true, style_class: cls, x_expand: true});
}

export class ForecastPanel {
    constructor({animate}) {
        this._animate = animate;
        this._onRefresh = null;
        this._onSettings = null;
        this._miniIcons = [];

        this.actor = column('aw-panel');

        // ── header ────────────────────────────────────────────────────────
        const header = row('aw-header');
        this._placeLbl = label('Loading…', 'aw-location');
        header.add_child(this._placeLbl);
        header.add_child(this._spacer());

        this._refreshBtn = this._button('view-refresh-symbolic', 'Refresh',
                                        () => this._onRefresh?.());
        this._settingsBtn = this._button('emblem-system-symbolic', 'Preferences',
                                         () => this._onSettings?.());
        header.add_child(this._refreshBtn);
        header.add_child(this._settingsBtn);
        this.actor.add_child(header);

        this.actor.add_child(this._separator());

        // ── scrollable body (today + 6 days can get tall) ────────────────
        this._scroll = new St.ScrollView({
            x_expand: true,
            y_expand: true,
            overlay_scrollbars: true,
            style_class: 'aw-scroll',
        });
        this._body = column('aw-body');
        this._scroll.set_child(this._body);
        this.actor.add_child(this._scroll);

        this._renderPlaceholder('Fetching weather…');
    }

    onRefresh(cb) { this._onRefresh = cb; }
    onSettings(cb) { this._onSettings = cb; }

    setPlaceName(name) {
        this._placeLbl.set_text(name || 'Weather');
    }

    setError(message) {
        this._placeLbl.set_text('Weather');
        this.showPlaceholder(message || 'Could not load the forecast');
    }

    showPlaceholder(text) {
        this._renderPlaceholder(text);
    }

    /** state = {current, daily, units, updated} */
    render(state) {
        const {current, daily, units} = state;
        this._body.destroy_all_children();
        this._miniIcons = [];

        const today = daily[0];
        const {scene, desc} = state.effective ?? sceneFor(current.code, current.isDay);
        const windy = !!state.windy;

        // ── today ─────────────────────────────────────────────────────────
        const now = row('aw-today');

        const bigIcon = new WeatherIcon({size: 44, animate: this._animate});
        bigIcon.setScene(scene, {windy, night: !current.isDay,
                                 intensity: current.intensity,
                                 windKmh: state.windKmh});
        now.add_child(bigIcon);

        const mid = column('aw-today-main');
        mid.add_child(label(`${fmtTemp(current.temp, units)}`, 'aw-current-temp'));
        mid.add_child(label(desc, 'aw-desc'));
        mid.add_child(label(`Feels like ${fmtTemp(current.feels, units)}`, 'aw-feels'));
        now.add_child(mid);

        const side = column('aw-today-side');
        if (today) {
            side.add_child(label(`H ${fmtTemp(today.tmax, units)}`, 'aw-hilo'));
            side.add_child(label(`L ${fmtTemp(today.tmin, units)}`, 'aw-hilo'));
        }
        now.add_child(side);
        this._body.add_child(now);

        // ── details grid ──────────────────────────────────────────────────
        if (today) {
            const grid = new St.BoxLayout({
                style_class: 'aw-details',
                x_expand: true,
            });
            const left = column('aw-details-col');
            const right = column('aw-details-col');
            const wind = label(`Wind ${fmtWind(current.wind, units)} ${windDir(current.windDeg)}`,
                               'aw-detail');
            const humidity = label(`Humidity ${current.humidity}%`, 'aw-detail');
            const precip = label(`Rain chance ${today.precipProb}%`, 'aw-detail');
            const uv = label(`UV index ${Math.round(today.uv)}`, 'aw-detail');
            const sunrise = label(`Sunrise ${fmtTime(today.sunrise)}`, 'aw-detail');
            const sunset = label(`Sunset ${fmtTime(today.sunset)}`, 'aw-detail');
            left.add_child(wind);
            left.add_child(humidity);
            left.add_child(precip);
            right.add_child(uv);
            right.add_child(sunrise);
            right.add_child(sunset);
            grid.add_child(left);
            grid.add_child(right);
            this._body.add_child(grid);
        }

        // ── next 6 days ───────────────────────────────────────────────────
        this._body.add_child(this._separator());
        this._body.add_child(label('Next 6 days', 'aw-section-title'));

        for (let i = 1; i < Math.min(daily.length, 7); i++) {
            const d = daily[i];
            const s = sceneFor(d.code, true);
            const line = row('aw-day');

            line.add_child(label(dayName(d.date), 'aw-day-name'));

            const mini = new WeatherIcon({size: 20, animate: false, time: STATIC_TIME});
            mini.setScene(s.scene, {intensity: d.precipProb / 20, windKmh: d.windMax});
            line.add_child(mini);
            this._miniIcons.push(mini);

            line.add_child(label(s.desc, 'aw-day-desc'));
            line.add_child(label(`${d.precipProb}%`, 'aw-day-rain'));
            line.add_child(label(
                `${fmtTemp(d.tmin, units)}  ${fmtTemp(d.tmax, units)}`,
                'aw-day-temps'));
            this._body.add_child(line);
        }

        // ── footer ────────────────────────────────────────────────────────
        if (state.updated) {
            this._body.add_child(this._separator());
            this._body.add_child(label(
                `Updated ${state.updated.format('%H:%M')} · Open-Meteo`,
                'aw-footer'));
        }
    }

    /* ── helpers ────────────────────────────────────────────────────────── */

    _renderPlaceholder(text) {
        this._body.destroy_all_children();
        this._miniIcons = [];
        const busy = new WeatherIcon({size: 34, animate: this._animate});
        busy.setScene('loading');
        const box = new St.BoxLayout({
            style_class: 'aw-placeholder',
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER,
            x_expand: true,
        });
        box.add_child(busy);
        box.add_child(label(text, 'aw-placeholder-text'));
        this._body.add_child(box);
    }

    _separator() {
        const s = new St.Widget({
            style_class: 'aw-sep',
            x_expand: true,
            height: 1,
        });
        return s;
    }

    _spacer() {
        return new St.Widget({x_expand: true, x_align: Clutter.ActorAlign.FILL});
    }

    _button(iconName, name, cb) {
        const btn = new St.Button({
            style_class: 'aw-icon-btn',
            can_focus: true,
            reactive: true,
            child: new St.Icon({
                icon_name: iconName,
                icon_size: 16,
                y_align: Clutter.ActorAlign.CENTER,
            }),
        });
        // St.Button has no tooltips in GNOME 50; name it for AT instead
        btn.set_accessible_name(name);
        btn.connect('clicked', () => cb());
        return btn;
    }

    destroy() {
        this._miniIcons = [];
        this.actor.destroy();
    }
}
