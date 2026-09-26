/* menu.js — the dropdown: an Apple-Weather-style card with an animated sky
 * backdrop, an hourly chart (Temperature / Precipitation / Wind tabs) and
 * eight selectable day tiles in a 4×2 grid.
 *
 * This file mirrors the mockup's narrow (≤560px) breakpoint, which is the
 * card's actual size (330×430): no big header icon and no details grid (the
 * chart beats them for space there), flat tabs over a hairline rule, a plain
 * °F | °C text toggle, hi/lo on one line, "Today" labels the first tile.
 *
 * All drawing is delegated to the pure-cairo modules sky.js and chart.js;
 * this file is St glue + selection state. Dark and light themes (tracked
 * from the OS) share the same engines — the theme only swaps ink colors and
 * paints a scrim over the sky in light mode.
 */

import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Pango from 'gi://Pango';
import St from 'gi://St';

import {WeatherIcon} from './animation.js';
import {paintSky, createSky} from './sky.js';
import {paintChart, ease, lerp} from './chart.js';
import {sceneFor, fmtTemp, fmtWind, dayName, daySlice, nowFracIn} from './weather.js';

const FRAME_MS = 50;         // sky: 20 fps is plenty
const STATIC_TIME = 1.1;     // frame that makes static mini icons look lively
const MORPH_MS = 420, MORPH_TICK = 25;

const METRICS = {
    temp:   {label: 'Temperature',   accent: [0.96, 0.65, 0.14], underline: 'aw-tab-temp'},
    precip: {label: 'Precipitation', accent: [0.30, 0.64, 1.00], underline: 'aw-tab-precip'},
    wind:   {label: 'Wind',          accent: [0.24, 0.81, 0.56], underline: 'aw-tab-wind'},
};

/* Theme = label ink + a scrim painted over the sky. Dark keeps the sky as
 * painted (white ink); light washes it pale so dark ink stays legible. */
const THEME = {
    dark:  {ink: [0.96, 0.97, 0.98], scrim: null,            cls: 'aw-dark',
            scrimSolid: [0.03, 0.045, 0.08, 0.78]},
    light: {ink: [0.10, 0.13, 0.19], scrim: [1, 1, 1, 0.42], cls: 'aw-light',
            scrimSolid: [0.97, 0.975, 0.995, 0.80]},
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
 * GNOME 50's St.DrawingArea emits repaint SYNCHRONOUSLY from allocate and
 * style-changed. Querying allocation/theme inside repaint re-enters that
 * machinery, frees the mapped Cogl buffer underfoot and aborts the shell
 * (observed live: cogl_buffer_dispose MAPPED assert → null cairo context →
 * SIGABRT). So repaint handlers touch get_surface_size() + get_context()
 * and NOTHING else — the surface size is already logical px and the context
 * arrives device-scaled and pre-cleared.
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
        const [w, h] = this.get_surface_size();
        if (w <= 0 || h <= 0)
            return;
        const cr = this.get_context();
        const o = this._panel._skyOpts;
        if (this._panel._style !== 'accent')
            paintSky(cr, {w, h, time: this._time,
                          scene: o.scene, night: o.night, scrim: o.scrim,
                          sky: o.sky, radius: o.radius ?? 0, phase: o.phase ?? null});
        // 'accent' style paints NOTHING: the surface stays transparent and
        // the shell theme's own popup background becomes the menu surface —
        // the theme's specified solid colour, any theme, auto-contrast.
        cr.$dispose();
    }

    /* self-idles while unmapped (menu closed) — GNOME 50 has no map signals;
     * stays parked in 'accent' style too: no sky to animate there. */
    _start() {
        if (this._clockId || !this._animate || this._panel._style === 'accent')
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
        const [w, h] = this.get_surface_size();
        if (w <= 0 || h <= 0)
            return;
        const p = this._panel, m = METRICS[p._metric];
        // 'accent' style unifies the data in the OS accent colour; sky
        // modes keep the mock's per-metric palette
        const accent = p._style === 'accent' ? p._accent : m.accent;
        // full card width: .aw-content has no horizontal padding (rows pad
        // themselves), so the fill bleeds to the edges like the mockup; the
        // mock's narrow chart labels every 3rd hour, ink-dim, 8pt
        const cr = this.get_context();
        paintChart(cr, {
            w, h,
            values: p._shown,
            fmtValue: p._fmtValue ?? (() => ''),
            fmtHour: p._fmtHour ?? (() => ''),
            accent,
            ink: p._theme().ink,
            nowFrac: p._day === 0 ? (p._nowFrac ?? 0) : null,
            scenes: p._conditions ? p._strip?.scenes ?? null : null,
            nights: p._conditions ? p._strip?.nights ?? null : null,
            fontSize: w < 480 ? 8 : 8.5,
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
        this._nowFrac = null;
        this._style = 'animated';                 // animated | solid | accent
        this._conditions = true;                  // hourly icon strip on the chart
        this._strip = null;                       // {scenes[], nights[]} for the chart
        this._accent = [0.21, 0.52, 0.89];        // GNOME blue fallback

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

        // header (mockup narrow breakpoint): huge temp + °F | °C text toggle,
        // then city / clock+actions pushed right. No big icon, no details —
        // the mock hides both at this width; the chart earns the space.
        const header = row('aw-header');

        const tempWrap = row('aw-temp-line');
        this._tempLbl = label('', 'aw-current-temp');
        tempWrap.add_child(this._tempLbl);

        const unitBox = row('aw-unit-toggle');
        this._unitBtns = {
            imperial: this._unitButton('°F', () => this._pickUnit('imperial')),
            metric:   this._unitButton('°C', () => this._pickUnit('metric')),
        };
        unitBox.add_child(this._unitBtns.imperial);
        unitBox.add_child(label('|', 'aw-unit-bar'));
        unitBox.add_child(this._unitBtns.metric);
        tempWrap.add_child(unitBox);
        header.add_child(tempWrap);

        header.add_child(spacer());

        const right = new St.BoxLayout({vertical: true, style_class: 'aw-city-col',
                                        x_align: Clutter.ActorAlign.END,
                                        y_align: Clutter.ActorAlign.START});
        this._cityLbl = label('Weather', 'aw-city');
        // long city names must never crowd the temperature side
        this._cityLbl.clutter_text.ellipsize = Pango.EllipsizeMode.END;
        right.add_child(this._cityLbl);

        // mock keeps the clock alone at this width (no condition line);
        // refresh/settings get their own row under the clock — inline they
        // collided with the time text and the moon behind it
        const infoRow = row('aw-info-row');
        this._clockLbl = label('', 'aw-clockline');
        infoRow.add_child(this._clockLbl);
        right.add_child(infoRow);
        const btnRow = row('aw-btn-row');
        this._refreshBtn = this._iconButton('view-refresh-symbolic', 'Refresh now',
                                            () => this._onRefresh?.());
        btnRow.add_child(this._refreshBtn);
        btnRow.add_child(this._iconButton('emblem-system-symbolic', 'Preferences',
                                          () => this._onSettings?.()));
        right.add_child(btnRow);
        header.add_child(right);
        main.add_child(header);

        // flat text tabs (mock): dim inactive, ink + 3px accent underline
        // active — then the mock's glass hairline across the card
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
        this._tabBtns[this._metric].add_style_class_name('aw-tab-active');
        this._tabBtns[this._metric].add_style_class_name(METRICS[this._metric].underline);
        main.add_child(tabs);

        main.add_child(new St.Widget({style_class: 'aw-rule',
                                      y_align: Clutter.ActorAlign.START}));

        // chart — full card width (.aw-content has no horizontal padding,
        // the padded rows above/below make their own 14px insets)
        this._chart = new ChartArea(this);
        main.add_child(this._chart);

        // day tiles: mock's narrow grid = 2 rows × 4 (rebuilt on render)
        this._daysGrid = column('aw-days-grid');
        main.add_child(this._daysGrid);
        this._dayBtns = [];

        return main;
    }

    _iconButton(iconName, name, cb) {
        const btn = new St.Button({
            style_class: 'aw-icon-btn',
            can_focus: true,
            y_align: Clutter.ActorAlign.CENTER,
            child: new St.Icon({icon_name: iconName, icon_size: 16,
                                y_align: Clutter.ActorAlign.CENTER}),
        });
        btn.set_accessible_name(name);   // no tooltips in GNOME 50; name for AT
        btn.connect('clicked', () => cb());
        return btn;
    }

    _unitButton(text, cb) {
        const btn = new St.Button({
            style_class: 'aw-unit-btn',
            can_focus: true,
            y_align: Clutter.ActorAlign.START,
            child: label(text, 'aw-unit-label'),
        });
        btn.set_accessible_name(`Show temperatures in ${text}`);
        btn.connect('clicked', cb);
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

    /** Menu background treatment: 'animated' | 'solid' | 'accent'. */
    setStyle(style) {
        this._style = style;
        this._syncScrim();
        if (style === 'accent')
            this._skyArea._stop();     // no sky to tick: park the clock
        else
            this._skyArea._start();
        this._skyArea.queue_repaint();
        this._chart.queue_repaint();   // chart accent follows the style
    }

    /** [r, g, b] in 0..1 — OS accent colour: charts in the 'accent' style. */
    setAccent(rgb) {
        this._accent = rgb;
        this._skyArea.queue_repaint();
        this._chart.queue_repaint();
    }

    /** hourly condition-icon strip along the chart top */
    setConditions(on) {
        this._conditions = !!on;
        this._chart.queue_repaint();
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

        this._tempLbl.set_text(fmtTemp(current.temp, units));
        for (const [u, btn] of Object.entries(this._unitBtns)) {
            btn.remove_style_class_name('aw-unit-on');
            btn.remove_style_class_name('aw-unit-off');
            btn.add_style_class_name(u === units ? 'aw-unit-on' : 'aw-unit-off');
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

        // the mock has no "updated" row — keep it as the refresh button's
        // accessible name instead of visible clutter
        if (state.updated)
            this._refreshBtn.set_accessible_name(
                `Refresh forecast — updated ${state.updated.format('%H:%M')}`);

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

    _pickUnit(units) {
        if (this._state && this._state.units === units)
            return;                      // already showing that unit
        this._onUnits?.();               // extension flips the gsetting
    }

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
        // hourly condition-icon strip (the chart only draws it if the panel
        // setting is on). Day/night comes from the provider's own is_day per
        // hour when present — real sunset, not a wall-clock guess.
        this._strip = null;
        if (s.hourly && idx.length) {
            const days = times.map((t, k) => s.hourly.isDay?.[idx[k]] ?? (() => {
                const h = Number(t.slice(11, 13)) || 0;
                return h >= 6 && h < 21;
            })());
            this._strip = {
                scenes: idx.map((i, k) => sceneFor(s.hourly.code[i], days[k]).scene),
                nights: days.map(d => !d),
            };
        }
        // today's window starts 2 h early: the now marker sits that far in
        this._nowFrac = this._day === 0 ? nowFracIn(s.hourly, idx, s.currentIso) : null;
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
        this._skyOpts.phase = Number.isFinite(s.phase) ? s.phase : null;
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
        this._daysGrid.destroy_all_children();
        this._dayBtns = [];
        const n = Math.min(daily.length, 8);
        for (let r = 0; r < n; r += 4) {
            const rowTiles = row('aw-days');
            for (let i = r; i < Math.min(r + 4, n); i++) {
                const d = daily[i];
                const {scene} = sceneFor(d.code, true);
                const btn = new St.Button({
                    style_class: 'aw-day',
                    can_focus: true,
                    x_expand: true,
                });
                const col = new St.BoxLayout({vertical: true, style_class: 'aw-day-col',
                                              x_align: FILL});
                col.add_child(new St.Label({text: i === 0 ? 'Today' : dayName(d.date),
                                            style_class: 'aw-day-name',
                                            x_align: Clutter.ActorAlign.CENTER}));
                const icon = new WeatherIcon({size: 26, animate: false,
                                              time: STATIC_TIME + i * 0.2});
                icon.setScene(scene, {intensity: d.precipProb / 25, windKmh: d.windMax});
                col.add_child(icon);
                // hi + lo share one line (mock .hl); hierarchy by weight,
                // never opacity — lows must survive sun-bright skies
                const hl = new St.BoxLayout({style_class: 'aw-day-hl',
                                             x_align: Clutter.ActorAlign.CENTER});
                hl.add_child(new St.Label({text: fmtTemp(d.tmax, units),
                                           style_class: 'aw-day-hi'}));
                hl.add_child(new St.Label({text: fmtTemp(d.tmin, units),
                                           style_class: 'aw-day-lo'}));
                col.add_child(hl);
                btn.set_child(col);
                btn.connect('clicked', () => this._selectDay(i));
                rowTiles.add_child(btn);
                this._dayBtns.push(btn);
            }
            this._daysGrid.add_child(rowTiles);
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
        this._syncScrim();
        this._skyArea.queue_repaint();
        this._chart.queue_repaint();
    }

    /* which wash rides over the background for the current menu style */
    _syncScrim() {
        const t = this._theme();
        this._skyOpts.scrim = this._style === 'solid' ? t.scrimSolid
                            : this._style === 'accent' ? null : t.scrim;
    }

    _showBody(haveData) {
        this._main.visible = haveData;
        this._placeholderBox.visible = !haveData;
    }

    _tickClock() {
        if (!this._cityMs) {
            this._clockLbl.set_text('');
            return;
        }
        const ms = this._cityMs +
                   Math.round((GLib.get_monotonic_time() - this._cityBaseUs) / 1000);
        const d = new Date(ms);   // parsed+rendered in machine TZ: cancels out
        const h12 = d.getHours() % 12 || 12;
        this._clockLbl.set_text(
            `${h12}:${String(d.getMinutes()).padStart(2, '0')} ` +
            `${d.getHours() < 12 ? 'AM' : 'PM'}`);
    }
}
