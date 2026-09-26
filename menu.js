/* menu.js — the dropdown: an Apple-Weather-style card with an animated sky
 * backdrop, an hourly chart (Temperature / Precipitation / Wind tabs) and
 * eight selectable day tiles.
 *
 * All drawing is delegated to the pure-cairo modules sky.js and chart.js;
 * this file is St glue + selection state. Dark and light themes (tracked
 * from the OS) share the same engines — the theme only swaps ink colors and
 * paints a scrim over the sky in light mode.
 */

import Cairo from 'gi://cairo';
import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import St from 'gi://St';

import {WeatherIcon} from './animation.js';
import {paintSky, createSky} from './sky.js';
import {paintChart, ease, lerp} from './chart.js';
import {sceneFor, fmtTemp, fmtWind, windDir, dayName, fmtTime, daySlice} from './weather.js';

const FRAME_MS = 50;         // sky: 20 fps is plenty
const STATIC_TIME = 1.1;     // frame that makes static mini icons look lively
const MORPH_MS = 420, MORPH_TICK = 25;

const METRICS = {
    temp:   {label: 'Temperature',   accent: [0.96, 0.65, 0.14], underline: 'aw-tab-temp'},
    precip: {label: 'Precipitation', accent: [0.30, 0.64, 1.00], underline: 'aw-tab-precip'},
    wind:   {label: 'Wind',          accent: [0.24, 0.81, 0.56], underline: 'aw-tab-wind'},
};

/* EPA UV bands → [upper bound, dot color, band name] */
const UV_BANDS = [
    [3, '#43a047', 'Low'], [6, '#fbc02d', 'Moderate'], [8, '#fb8c00', 'High'],
    [11, '#e53935', 'Very high'], [Infinity, '#8e24aa', 'Extreme'],
];

/* Theme = label ink + a scrim painted over the sky. Dark keeps the sky as
 * painted (white ink); light washes it pale so dark ink stays legible. */
const THEME = {
    dark:  {ink: [0.96, 0.97, 0.98], scrim: null,            cls: 'aw-dark'},
    light: {ink: [0.10, 0.13, 0.19], scrim: [1, 1, 1, 0.42], cls: 'aw-light'},
};

const FILL = Clutter.ActorAlign.FILL;

function label(text, cls) {
    return new St.Label({text, style_class: cls, y_align: Clutter.ActorAlign.CENTER});
}

function row(cls) {
    return new St.BoxLayout({style_class: cls, x_expand: true,
                             y_align: Clutter.ActorAlign.CENTER});
}

function column(cls) {
    return new St.BoxLayout({vertical: true, style_class: cls, x_expand: true});
}

function spacer() {
    return new St.Widget({x_expand: true, x_align: FILL});
}

/** '2026-09-25T15:00' → '3PM' for the chart axis. */
function hourLabel(iso) {
    const h = +iso.slice(11, 13);
    return `${h % 12 === 0 ? 12 : h % 12}${h < 12 ? 'AM' : 'PM'}`;
}

/* ── animated painting areas ──────────────────────────────────────────────
 * Both scale the cairo context from device px to logical px so HiDPI stays
 * crisp, and both read their options off the panel at repaint time — the
 * allocation is measured per paint, which kills the classic stale-size
 * letterboxing bug (same lesson as the mockup's ResizeObserver).
 */

const SkyArea = GObject.registerClass(
class SkyArea extends St.DrawingArea {
    _init(panel, animate) {
        super._init({x_align: FILL, y_align: FILL, x_expand: true, y_expand: true});
        this._panel = panel;
        this._animate = animate;
        this._time = animate ? Math.random() * 3 : STATIC_TIME;
        this._clockId = 0;
        this.connect('destroy', () => this._stop());
        this._start();
    }

    vfunc_repaint() {
        const [sw, sh] = this.get_surface_size();          // device px
        if (sw <= 0 || sh <= 0)
            return;
        const alloc = this.get_allocation_box();           // logical px
        const lw = alloc.get_width(), lh = alloc.get_height();
        if (lw <= 0 || lh <= 0)
            return;
        const cr = this.get_context();
        cr.setOperator(Cairo.Operator.CLEAR);
        cr.paint();
        cr.setOperator(Cairo.Operator.OVER);
        cr.scale(sw / lw, sh / lh);
        const o = this._panel._skyOpts;
        paintSky(cr, {w: lw, h: lh, time: this._time,
                      scene: o.scene, night: o.night, scrim: o.scrim,
                      sky: o.sky, radius: o.radius ?? 0});
        cr.$dispose();
    }

    /* self-idles while unmapped (menu closed) — GNOME 50 has no map signals */
    _start() {
        if (this._clockId || !this._animate)
            return;
        this._lastUs = GLib.get_monotonic_time();
        this._clockId = GLib.timeout_add(GLib.PRIORITY_LOW, FRAME_MS, () => {
            const now = GLib.get_monotonic_time();
            if (this.mapped ?? true) {
                this._time += Math.min((now - this._lastUs) / 1000000, 0.1);
                this.queue_repaint();
            }
            this._lastUs = now;
            return GLib.SOURCE_CONTINUE;
        });
    }

    _stop() {
        if (this._clockId)
            GLib.source_remove(this._clockId);
        this._clockId = 0;
    }
});

const ChartArea = GObject.registerClass(
class ChartArea extends St.DrawingArea {
    _init(panel) {
        super._init({x_align: FILL, y_expand: true, x_expand: true, height: 150});
        this._panel = panel;
    }

    vfunc_repaint() {
        const [sw, sh] = this.get_surface_size();
        if (sw <= 0 || sh <= 0)
            return;
        const alloc = this.get_allocation_box();
        const lw = alloc.get_width(), lh = alloc.get_height();
        if (lw <= 0 || lh <= 0)
            return;
        const p = this._panel, m = METRICS[p._metric];
        // keep hour labels ~60px apart: wide cards every 3h, narrow ~every 4-5h
        const spacing = (lw - 4) / Math.max(1, p._shown.length - 1);
        const cr = this.get_context();
        cr.setOperator(Cairo.Operator.CLEAR);
        cr.paint();
        cr.setOperator(Cairo.Operator.OVER);
        cr.scale(sw / lw, sh / lh);
        paintChart(cr, {
            w: lw, h: lh,
            values: p._shown,
            fmtValue: p._fmtValue ?? (() => ''),
            fmtHour: p._fmtHour ?? (() => ''),
            accent: m.accent,
            ink: p._theme().ink,
            nowFrac: p._day === 0 ? 0 : null,
            labelEvery: Math.max(2, Math.round(60 / spacing)),
            fontSize: lw < 480 ? 7.5 : 8.5,
        });
        cr.$dispose();
    }
});

/* ── the panel ──────────────────────────────────────────────────────────── */

export class ForecastPanel {
    constructor({animate}) {
        this._animate = animate;
        this._onRefresh = this._onSettings = this._onUnits = null;

        this._day = 0;
        this._metric = 'temp';
        this._dark = true;
        this._state = null;
        this._shown = [];          // currently displayed chart values (morphs)
        this._morphId = 0;
        this._clockId = 0;
        this._cityMs = 0;          // wall time in the city's timezone
        this._cityBaseUs = 0;
        this._desc = '';
        this._fmtValue = null;
        this._fmtHour = null;

        this._sky = createSky();
        // radius 18 matches the shell's polished-popup corner radius
        this._skyOpts = {scene: 'loading', night: false, scrim: THEME.dark.scrim,
                         sky: this._sky, radius: 18};

        // St.Widget with BinLayout = overlay: sky fills, content rides on top
        this.actor = new St.Widget({layout_manager: new Clutter.BinLayout()});
        this._skyArea = new SkyArea(this, animate);
        this.actor.add_child(this._skyArea);

        this._content = new St.BoxLayout({
            vertical: true,
            style_class: 'aw-content',
            x_align: FILL, y_align: FILL,
        });
        this.actor.add_child(this._content);

        this._content.add_child(this._buildPlaceholder());
        this._content.add_child(this._buildMain());
        this._showBody(false);
    }

    /* ── construction ───────────────────────────────────────────────────── */

    _buildPlaceholder() {
        this._placeholderBox = new St.BoxLayout({
            style_class: 'aw-placeholder',
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER,
            x_expand: true, y_expand: true,
        });
        this._placeholderIcon = new WeatherIcon({size: 34, animate: this._animate});
        this._placeholderIcon.setScene('loading');
        this._placeholderText = label('Fetching weather…', 'aw-placeholder-text');
        this._placeholderBox.add_child(this._placeholderIcon);
        this._placeholderBox.add_child(this._placeholderText);
        return this._placeholderBox;
    }

    _buildMain() {
        const main = column('aw-main');
        this._main = main;

        // header: big icon | temp + unit | spacer | city + clock
        const header = row('aw-header');

        this._bigIcon = new WeatherIcon({size: 40, animate: this._animate});
        this._bigIcon.setScene('loading');
        header.add_child(this._bigIcon);

        const tempCol = column('aw-temp-col');
        const tempLine = row('aw-temp-line');
        this._tempLbl = label('', 'aw-current-temp');
        this._unitBtn = this._pillButton('°F', 'Switch units',
                                         () => this._onUnits?.());
        tempLine.add_child(this._tempLbl);
        tempLine.add_child(this._unitBtn);
        tempCol.add_child(tempLine);
        this._feelsLbl = label('', 'aw-feels');
        this._hiloLbl = label('', 'aw-feels');
        tempCol.add_child(this._feelsLbl);
        tempCol.add_child(this._hiloLbl);
        header.add_child(tempCol);

        header.add_child(spacer());

        const right = new St.BoxLayout({vertical: true, style_class: 'aw-city-col',
                                        x_align: Clutter.ActorAlign.END});
        this._cityLbl = label('Weather', 'aw-city');
        this._clockLbl = label('', 'aw-clockline');
        this._clockLbl.set_x_align(Clutter.ActorAlign.END);
        right.add_child(this._cityLbl);
        right.add_child(this._clockLbl);
        header.add_child(right);
        main.add_child(header);

        // details 2×2 — its own full-width block; at 330px the header has no
        // room to squeeze it between the temperature and the city
        const details = column('aw-details');
        const dRow = (a, b) => {
            const r = row('aw-details-line');
            r.add_child(a);
            r.add_child(spacer());
            r.add_child(b);
            return r;
        };
        this._precipLbl = label('', 'aw-detail');
        this._uvDot = label('●', 'aw-uv-dot');
        this._uvLbl = label('', 'aw-detail');
        this._humLbl = label('', 'aw-detail');
        this._windLbl = label('', 'aw-detail');
        const uvLine = row('aw-uv-line');
        uvLine.add_child(this._uvDot);
        uvLine.add_child(this._uvLbl);
        details.add_child(dRow(this._precipLbl, uvLine));
        details.add_child(dRow(this._humLbl, this._windLbl));
        main.add_child(details);

        // metric tabs
        const tabs = row('aw-tabs');
        this._tabBtns = {};
        for (const [key, m] of Object.entries(METRICS)) {
            const btn = new St.Button({
                style_class: 'aw-tab',
                can_focus: true,
                child: label(m.label, 'aw-tab-label'),
            });
            btn.set_accessible_name(`Show ${m.label.toLowerCase()} chart`);
            btn.connect('clicked', () => this._selectMetric(key));
            tabs.add_child(btn);
            this._tabBtns[key] = btn;
        }
        main.add_child(tabs);

        // chart — full bleed to the card edges (negative side margins)
        this._chart = new ChartArea(this);
        this._chart.margin_left = this._chart.margin_right = -14;
        main.add_child(this._chart);

        // day tiles (rebuilt on every render)
        this._daysRow = row('aw-days');
        main.add_child(this._daysRow);
        this._dayBtns = [];

        // footer: updated text + refresh + settings
        const footer = row('aw-footer-row');
        this._updatedLbl = label('', 'aw-footer');
        footer.add_child(this._updatedLbl);
        footer.add_child(spacer());
        footer.add_child(this._iconButton('view-refresh-symbolic', 'Refresh now',
                                          () => this._onRefresh?.()));
        footer.add_child(this._iconButton('emblem-system-symbolic', 'Preferences',
                                          () => this._onSettings?.()));
        main.add_child(footer);

        return main;
    }

    _iconButton(iconName, name, cb) {
        const btn = new St.Button({
            style_class: 'aw-icon-btn',
            can_focus: true,
            child: new St.Icon({icon_name: iconName, icon_size: 16,
                                y_align: Clutter.ActorAlign.CENTER}),
        });
        btn.set_accessible_name(name);   // no tooltips in GNOME 50; name for AT
        btn.connect('clicked', () => cb());
        return btn;
    }

    _pillButton(text, name, cb) {
        const btn = new St.Button({
            style_class: 'aw-unit-btn',
            can_focus: true,
            child: label(text, 'aw-unit-label'),
        });
        btn.set_accessible_name(name);
        btn.connect('clicked', () => cb());
        return btn;
    }

    /* ── public API (used by extension.js) ──────────────────────────────── */

    onRefresh(cb)  { this._onRefresh = cb; }
    onSettings(cb) { this._onSettings = cb; }
    onUnits(cb)    { this._onUnits = cb; }

    setPlaceName(name) {
        this._cityLbl.set_text(name || 'Weather');
    }

    setError(message) {
        this._cityLbl.set_text('Weather');
        this.showPlaceholder(message || 'Could not load the forecast');
    }

    showPlaceholder(text) {
        this._placeholderText.set_text(text);
        this._showBody(false);
    }

    setDark(on) {
        this._dark = on;
        this._applyTheme();
    }

    /** state = {current, daily, hourly, currentIso, units, windy, effective,
     *           windKmh, updated, dark} */
    render(state) {
        this._state = state;
        if (state.dark !== undefined)
            this._dark = state.dark;
        this._applyTheme();
        this._showBody(true);

        const {current, daily, units} = state;
        const today = daily[0];
        const {scene, desc} = state.effective ?? sceneFor(current.code, current.isDay);
        const windy = !!state.windy;
        this._desc = desc;

        this._bigIcon.setScene(scene, {windy, night: !current.isDay,
                                       intensity: current.intensity,
                                       windKmh: state.windKmh});

        this._tempLbl.set_text(fmtTemp(current.temp, units));
        this._unitBtn.get_child().set_text(units === 'imperial' ? '°C' : '°F');
        this._feelsLbl.set_text(`Feels like ${fmtTemp(current.feels, units)}`);
        if (today)
            this._hiloLbl.set_text(`H ${fmtTemp(today.tmax, units)}   ` +
                                   `L ${fmtTemp(today.tmin, units)}`);

        if (today) {
            this._precipLbl.set_text(`Precipitation  ${today.precipProb}%`);
            const uv = current.uv ?? today.uv ?? 0;
            const band = UV_BANDS.find(b => uv < b[0]) ?? UV_BANDS.at(-1);
            // St.Label has no markup API in GNOME 50 — dot is its own label
            this._uvDot.set_style(`color: ${band[1]};`);
            this._uvLbl.set_text(`UV Index  ${Math.round(uv)} ${band[2]}`);
            this._humLbl.set_text(`Humidity  ${current.humidity}%`);
            this._windLbl.set_text(
                `Wind  ${fmtWind(current.wind, units)} ${windDir(current.windDeg)}`);
        }

        // city clock ticks from the API timestamp (city timezone, not ours)
        this._cityMs = state.currentIso ? Date.parse(state.currentIso) : 0;
        this._cityBaseUs = GLib.get_monotonic_time();
        this._tickClock();
        if (!this._clockId) {
            this._clockId = GLib.timeout_add_seconds(GLib.PRIORITY_LOW, 20, () => {
                this._tickClock();
                return GLib.SOURCE_CONTINUE;
            });
        }

        if (state.updated)
            this._updatedLbl.set_text(
                `Updated ${state.updated.format('%H:%M')} · Open-Meteo`);

        this._buildDayTiles();
        if (this._day >= daily.length)
            this._day = 0;
        this._markTiles();
        this._applySelection();
    }

    destroy() {
        if (this._morphId)
            GLib.source_remove(this._morphId);
        if (this._clockId)
            GLib.source_remove(this._clockId);
        this.actor.destroy();
    }

    /* ── selection logic ────────────────────────────────────────────────── */

    _selectDay(i) {
        if (i === this._day)
            return;
        this._day = i;
        this._markTiles();
        this._applySelection();
    }

    _selectMetric(key) {
        if (key === this._metric)
            return;
        this._metric = key;
        for (const [k, btn] of Object.entries(this._tabBtns)) {
            btn.remove_style_class_name('aw-tab-active');
            btn.remove_style_class_name(METRICS[k].underline);
            if (k === key) {
                btn.add_style_class_name('aw-tab-active');
                btn.add_style_class_name(METRICS[key].underline);
            }
        }
        this._applySelection();
    }

    /** Recompute chart series + sky for the current day/metric. */
    _applySelection() {
        const s = this._state;
        if (!s)
            return;
        this._morphTo(this._chartValues());
        this._updateSky();
        this._chart.queue_repaint();
    }

    _chartValues() {
        const s = this._state;
        const field = {temp: 'temp', precip: 'precipProb', wind: 'wind'}[this._metric];
        const idx = s.hourly ? daySlice(s.hourly, s.daily, this._day, s.currentIso) : [];
        const units = s.units;
        this._fmtValue = this._metric === 'temp'
            ? (i, v) => fmtTemp(v, units)
            : this._metric === 'precip'
                ? (i, v) => `${Math.round(v)}%`
                : (i, v) => fmtWind(v, units);
        const times = s.hourly ? idx.map(i => s.hourly.time[i]) : [];
        this._fmtHour = i => hourLabel(times[i] ?? 'T00');
        return idx.map(i => s.hourly[field][i] ?? 0);
    }

    _updateSky() {
        const s = this._state;
        if (!s)
            return;
        let scene, night;
        if (this._day === 0) {
            scene = (s.effective ?? sceneFor(s.current.code, s.current.isDay)).scene;
            night = !s.current.isDay;
        } else {
            scene = sceneFor(s.daily[this._day].code, true).scene;
            night = false;
        }
        this._skyOpts.scene = scene;
        this._skyOpts.night = night;
        this._skyArea.queue_repaint();
    }

    /* 420 ms ease-out morph between series (mockup behaviour). */
    _morphTo(target) {
        if (this._morphId) {
            GLib.source_remove(this._morphId);
            this._morphId = 0;
        }
        const from = this._shown;
        if (!this._animate || from.length !== target.length) {
            this._shown = target.slice();
            return;
        }
        const t0 = GLib.get_monotonic_time();
        this._morphId = GLib.timeout_add(GLib.PRIORITY_LOW, MORPH_TICK, () => {
            const k = Math.min(1, (GLib.get_monotonic_time() - t0) / (MORPH_MS * 1000));
            this._shown = lerp(from, target, ease(k));
            this._chart.queue_repaint();
            if (k >= 1) {
                this._morphId = 0;
                return GLib.SOURCE_REMOVE;
            }
            return GLib.SOURCE_CONTINUE;
        });
    }

    /* ── day tiles ──────────────────────────────────────────────────────── */

    _buildDayTiles() {
        const {daily, units} = this._state;
        this._daysRow.destroy_all_children();
        this._dayBtns = [];
        for (let i = 0; i < Math.min(daily.length, 8); i++) {
            const d = daily[i];
            const {scene} = sceneFor(d.code, true);
            const btn = new St.Button({
                style_class: 'aw-day',
                can_focus: true,
                x_expand: true,
            });
            const col = new St.BoxLayout({vertical: true, style_class: 'aw-day-col',
                                          x_align: FILL});
            col.add_child(new St.Label({text: dayName(d.date),
                                        style_class: 'aw-day-name',
                                        x_align: Clutter.ActorAlign.CENTER}));
            const icon = new WeatherIcon({size: 22, animate: false,
                                          time: STATIC_TIME + i * 0.2});
            icon.setScene(scene, {intensity: d.precipProb / 25, windKmh: d.windMax});
            col.add_child(icon);
            col.add_child(new St.Label({text: fmtTemp(d.tmax, units),
                                        style_class: 'aw-day-hi',
                                        x_align: Clutter.ActorAlign.CENTER}));
            // low uses font WEIGHT, never opacity — stays readable on sun-bright skies
            col.add_child(new St.Label({text: fmtTemp(d.tmin, units),
                                        style_class: 'aw-day-lo',
                                        x_align: Clutter.ActorAlign.CENTER}));
            btn.set_child(col);
            btn.connect('clicked', () => this._selectDay(i));
            this._daysRow.add_child(btn);
            this._dayBtns.push(btn);
        }
    }

    _markTiles() {
        this._dayBtns.forEach((btn, i) => {
            if (i === this._day)
                btn.add_style_class_name('aw-day-sel');
            else
                btn.remove_style_class_name('aw-day-sel');
        });
    }

    /* ── misc ───────────────────────────────────────────────────────────── */

    _theme() {
        return this._dark ? THEME.dark : THEME.light;
    }

    _applyTheme() {
        this._content.remove_style_class_name(THEME.dark.cls);
        this._content.remove_style_class_name(THEME.light.cls);
        this._content.add_style_class_name(this._theme().cls);
        this._skyOpts.scrim = this._theme().scrim;
        this._skyArea.queue_repaint();
        this._chart.queue_repaint();
    }

    _showBody(haveData) {
        this._main.visible = haveData;
        this._placeholderBox.visible = !haveData;
    }

    _tickClock() {
        if (!this._cityMs) {
            this._clockLbl.set_text(this._desc);
            return;
        }
        const ms = this._cityMs +
                   Math.round((GLib.get_monotonic_time() - this._cityBaseUs) / 1000);
        const d = new Date(ms);   // parsed+rendered in machine TZ: cancels out
        const p = n => String(n).padStart(2, '0');
        this._clockLbl.set_text(
            this._desc ? `${p(d.getHours())}:${p(d.getMinutes())} · ${this._desc}`
                       : `${p(d.getHours())}:${p(d.getMinutes())}`);
    }
}
