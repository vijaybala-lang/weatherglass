/* menu.js -- forecast dropdown panel */

import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Pango from 'gi://Pango';
import St from 'gi://St';

import { gettext as _ } from 'resource:///org/gnome/shell/extensions/extension.js';

const N_ = s => s;
import { WeatherIcon } from './animation.js';
import { paintSky, createSky, sampleSky, bodyOf } from './sky.js';
import {
    paintChart, ease, lerp, contrastSafe, lumOf, pickInk, ratio,
    judgeInk, INK_DARK, INK_LIGHT
} from './chart.js';
import { sceneFor, fmtTemp, fmtWind, dayName, daySlice, nowFracIn } from './weather.js';

const FRAME_MS = 50;         // sky: 20 fps is plenty
const STATIC_TIME = 1.1;     // frame that makes static mini icons look lively
const MORPH_MS = 420, MORPH_TICK = 25;

const METRICS = {
    temp: { label: N_('Temperature'), accent: [0.96, 0.65, 0.14] },
    precip: { label: N_('Precipitation'), accent: [0.30, 0.64, 1.00] },
    wind: { label: N_('Wind'), accent: [0.24, 0.81, 0.56] },
};

/* Theme colors and scrim */
const THEME = {
    dark: {
        ink: [0.96, 0.97, 0.98], scrim: null, cls: 'aw-dark',
        scrimSolid: [0.03, 0.045, 0.08, 0.78]
    },
    light: {
        ink: [0.10, 0.13, 0.19], scrim: [1, 1, 1, 0.42], cls: 'aw-light',
        scrimNight: [0.70, 0.78, 1.0, 0.68],
        scrimSolid: [0.97, 0.975, 0.995, 0.80]
    },
};

const FILL = Clutter.ActorAlign.FILL;


const compGlass = (bg, dark) => {
    const g = dark ? [16 / 255, 20 / 255, 28 / 255, 0.45] : [1, 1, 1, 0.68];
    return bg.map((v, k) => v * (1 - g[3]) + g[k] * g[3]);
};
const inkCss = (ink, a = 1) => {
    const c = v => Math.round(v * 255);
    return a < 1
        ? `color: rgba(${c(ink[0])}, ${c(ink[1])}, ${c(ink[2])}, ${a});`
        : `color: rgb(${c(ink[0])}, ${c(ink[1])}, ${c(ink[2])});`;
};


const haloCss = res => !res.emboss ? ''
    : res.ink === INK_DARK
        ? ' text-shadow: 0 0 3px rgba(255,255,255,0.9), 0 0 8px rgba(255,255,255,0.55);'
        : ' text-shadow: 0 0 3px rgba(0,0,12,0.9), 0 0 8px rgba(0,0,12,0.6), 0 1px 2px rgba(0,0,12,0.85);';

function label(text, cls) {
    return new St.Label({ text, style_class: cls, y_align: Clutter.ActorAlign.CENTER });
}

function row(cls) {
    return new St.BoxLayout({
        style_class: cls, x_expand: true,
        y_align: Clutter.ActorAlign.CENTER
    });
}

function column(cls) {
    return new St.BoxLayout({ vertical: true, style_class: cls, x_expand: true });
}

function spacer() {
    return new St.Widget({ x_expand: true, x_align: FILL });
}

/** '2026-09-25T15:00' -> '3PM' (or '15') for the chart axis. */
function hourLabel(iso, h24) {
    const h = +iso.slice(11, 13);
    if (h24)
        return `${h}`;
    return `${h % 12 === 0 ? 12 : h % 12}${h < 12 ? 'AM' : 'PM'}`;
}

const SkyArea = GObject.registerClass(
    class SkyArea extends St.DrawingArea {
        _init(panel, animate) {
            super._init({ x_align: FILL, y_align: FILL, x_expand: true, y_expand: true });
            this._panel = panel;
            this._animate = animate;
            this._time = animate ? Math.random() * 3 : STATIC_TIME;
            this._animTimerId = 0;
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
                paintSky(cr, {
                    w, h, time: this._time,
                    scene: o.scene, night: o.night, scrim: o.scrim,
                    sky: o.sky, radius: o.radius ?? 0, phase: o.phase ?? null
                });
            // 'accent' style paints NOTHING: the surface stays transparent and
            // the shell theme's own popup background becomes the menu surface --
            // the theme's specified solid colour, any theme, auto-contrast.
            cr.$dispose();
        }

        _start() {
            if (this._animTimerId || !this._animate || this._panel._style === 'accent')
                return;
            this._lastUs = GLib.get_monotonic_time();
            this._animTimerId = GLib.timeout_add(GLib.PRIORITY_LOW, FRAME_MS, () => {
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
            if (this._animTimerId) {
                GLib.source_remove(this._animTimerId);
                this._animTimerId = 0;
            }
        }
    });

const ChartArea = GObject.registerClass(
    class ChartArea extends St.DrawingArea {
        _init(panel) {
            super._init({ x_align: FILL, y_expand: true, x_expand: true, height: 150 });
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
                scenes: p._conditions !== 'off' ? p._strip?.scenes ?? null : null,
                nights: p._conditions !== 'off' ? p._strip?.nights ?? null : null,
                pills: p._conditions === 'pills',
                dark: p._dark,
                // Arabic/Hebrew sessions: the chart mirrors (earliest hour at
                // the right, now-fade covering the RIGHT half). St widgets
                // around this canvas already flip via the toolkit; the painted
                // surface has to be told explicitly.
                rtl: Clutter.get_default_text_direction() === Clutter.TextDirection.RTL,
                stripBottom: p._condPos === 'bottom',
                // over the sky (animated/solid): pills take the day-tile hover
                // glass; the accent style keeps the accent tint on its calm
                // backdrop
                pillGlass: p._style !== 'accent',
                // the "now" value label rides the sky, not the ink theme: hand
                // it a contrast-safe variant of the accent (no-op when the
                // accent already clears ~3:1 against the composited backdrop)
                nowLabel: contrastSafe(accent, p._bgUnderChart()),
                // smart text ink: labels sample the composited sky at their OWN
                // y -- hour text over a bright day-sky foot goes dark, night text
                // stays white. accent style's flat card needs none of this.
                bgFn: p._style === 'accent' ? null : (yPx => {
                    const top = this.get_transformed_position()[1];
                    const cardY = p._content.get_transformed_position()[1];
                    const cardH = p._content.get_size()[1] || 1;
                    return p._bgAt(Math.min(1, Math.max(0,
                        (top + yPx - cardY) / cardH)));
                }),
                // strip icons get a hairline silhouette ring when the backdrop
                // under the chart is mid/bright (overcast days swallow flat icons)
                iconOutline: p._iconOutline(),
                fontSize: w < 480 ? 8 : 8.5,
                // 'Data text' emphasis: values + hours bigger and/or heavier
                textScale: p._textScale,
                textBold: p._textBold,
            });
            cr.$dispose();
            // the card's free-standing labels (header, tabs) sample the same way
            // -- run here so it happens whenever the menu is actually visible
            p._applyTextInk();
        }
    });

export class ForecastPanel {
    constructor({ animate }) {
        this._animate = animate;
        this._onRefresh = this._onSettings = this._onSky = null;

        this._day = 0;
        this._metric = 'temp';
        this._dark = true;
        this._state = null;
        this._shown = [];          // currently displayed chart values (morphs)
        this._morphId = 0;
        this._cityClockTimerId = 0;
        this._cityMs = 0;          // wall time in the city's timezone
        this._cityBaseUs = 0;
        this._desc = '';
        this._fmtValue = null;
        this._fmtHour = null;
        this._hour24 = false;          // chart hours + city clock (setter drives)
        this._textScale = 1;           // 'data-text' emphasis (setter drives)
        this._textBold = false;

        this._sky = createSky();
        // radius 18 matches the shell's polished-popup corner radius
        this._skyOpts = {
            scene: 'loading', night: false, scrim: THEME.dark.scrim,
            sky: this._sky, radius: 18
        };
        this._nowFrac = null;
        this._style = 'animated';                 // animated | solid | accent
        this._conditions = 'icons';               // chart strip: off | icons | pills
        this._condPos = 'top';                    // strip band: top | bottom
        this._strip = null;                       // {scenes[], nights[]} for the chart
        this._accent = [0.21, 0.52, 0.89];        // GNOME blue fallback
        this._emboss = true;                      // CSS text/icon shadows

        // St.Widget with BinLayout = overlay: sky fills, content rides on top
        this.actor = new St.Widget({ layout_manager: new Clutter.BinLayout() });
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

    _buildPlaceholder() {
        this._placeholderBox = new St.BoxLayout({
            style_class: 'aw-placeholder',
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER,
            x_expand: true, y_expand: true,
        });
        this._placeholderIcon = new WeatherIcon({ size: 34, animate: this._animate });
        this._placeholderIcon.setScene('loading');
        this._placeholderText = label(_('Fetching weather…'), 'aw-placeholder-text');
        this._placeholderBox.add_child(this._placeholderIcon);
        this._placeholderBox.add_child(this._placeholderText);
        return this._placeholderBox;
    }

    _buildMain() {
        const main = column('aw-main');
        this._main = main;

        const header = row('aw-header');

        const leftCol = new St.BoxLayout({
            vertical: true, style_class: 'aw-temp-col',
            y_align: Clutter.ActorAlign.START
        });
        const tempWrap = row('aw-temp-line');
        this._tempLbl = label('', 'aw-current-temp');
        tempWrap.add_child(this._tempLbl);
        leftCol.add_child(tempWrap);

        this._descLbl = label('', 'aw-desc');
        this._descLbl.clutter_text.ellipsize = Pango.EllipsizeMode.END;
        this._descLbl.x_align = Clutter.ActorAlign.START;
        leftCol.add_child(this._descLbl);
        header.add_child(leftCol);

        header.add_child(spacer());

        const right = new St.BoxLayout({
            vertical: true, style_class: 'aw-city-col',
            x_align: Clutter.ActorAlign.END,
            y_align: Clutter.ActorAlign.START
        });
        this._cityLbl = label(_('Weather'), 'aw-city');
        this._cityLbl.clutter_text.ellipsize = Pango.EllipsizeMode.END;
        this._cityLbl.x_align = Clutter.ActorAlign.END;
        right.add_child(this._cityLbl);

        const infoRow = row('aw-info-row');
        infoRow.x_align = Clutter.ActorAlign.END;
        this._clockRow = infoRow;
        this._clockLbl = label('', 'aw-clockline');
        infoRow.add_child(this._clockLbl);
        right.add_child(infoRow);
        const btnRow = row('aw-btn-row');
        btnRow.x_align = Clutter.ActorAlign.END;
        this._refreshBtn = this._iconButton('view-refresh-symbolic', _('Refresh now'),
            () => this._onRefresh?.());
        btnRow.add_child(this._refreshBtn);
        btnRow.add_child(this._iconButton('emblem-system-symbolic', _('Preferences'),
            () => this._onSettings?.(), 18));
        right.add_child(btnRow);
        header.add_child(right);
        main.add_child(header);

        const tabs = row('aw-tabs');
        tabs.x_align = Clutter.ActorAlign.CENTER;
        this._tabBtns = {};
        for (const [key, m] of Object.entries(METRICS)) {
            const btn = new St.Button({
                style_class: 'aw-tab',
                can_focus: true,
                child: label(_(m.label), 'aw-tab-label'),
            });
            btn.set_accessible_name(`${_('Show')} ${_(m.label.toLowerCase())} ${_('chart')}`);
            btn.connect('clicked', () => this._selectMetric(key));
            tabs.add_child(btn);
            this._tabBtns[key] = btn;
        }
        this._tabBtns[this._metric].add_style_class_name('aw-tab-active');
        main.add_child(tabs);

        // chart -- full card width (.aw-content has no horizontal padding,
        // the padded rows above/below make their own 14px insets)
        this._chart = new ChartArea(this);
        main.add_child(this._chart);

        // day tiles: mock's narrow grid = 2 rows x 4 (rebuilt on render)
        this._daysGrid = column('aw-days-grid');
        main.add_child(this._daysGrid);
        this._dayBtns = [];

        return main;
    }

    _iconButton(iconName, name, cb, size = 16) {
        const icon = new St.Icon({
            icon_name: iconName, icon_size: size,
            y_align: Clutter.ActorAlign.CENTER
        });
        const btn = new St.Button({
            style_class: 'aw-icon-btn',
            can_focus: true,
            y_align: Clutter.ActorAlign.CENTER,
            child: icon,
        });
        (this._ghostIcons ??= []).push(icon);   // _applyTextInk samples these
        btn.set_accessible_name(name);   // no tooltips in GNOME 50; name for AT
        btn.connect('clicked', () => cb());
        return btn;
    }

    onRefresh(cb) { this._onRefresh = cb; }
    onSettings(cb) { this._onSettings = cb; }
    /** reports the sky the menu just started painting: (scene, night) */
    onSky(cb) { this._onSky = cb; }

    setPlaceName(name) {
        this._cityLbl.set_text(name || _('Weather'));
    }

    setError(message) {
        this._cityLbl.set_text(_('Weather'));
        this.showPlaceholder(message || _('Could not load the forecast'));
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
        // 'accent' (theme-background) style hands interaction/selection
        // painting to stylesheet.css (the .aw-theme gate): no sky there
        // means no painted glass pills, so the CSS accent washes must
        if (style === 'accent')
            this._content.add_style_class_name('aw-theme');
        else
            this._content.remove_style_class_name('aw-theme');
        this._syncScrim();
        if (style === 'accent')
            this._skyArea._stop();     // no sky to tick: park the clock
        else
            this._skyArea._start();
        this._skyArea.queue_repaint();
        this._chart.queue_repaint();   // pill tint follows the style
        this._chart.queue_repaint();   // chart accent follows the style
        this._applyTileInk();          // accent style hands the tiles back
    }                                       // to plain theme ink

    /** [r, g, b] in 0..1 -- OS accent colour: charts in the 'accent' style. */
    setAccent(rgb) {
        this._accent = rgb;
        this._skyArea.queue_repaint();
        this._chart.queue_repaint();
    }

    /** chart condition strip: 'off' | 'icons' | 'pills' */
    setConditions(mode) {
        this._conditions = ['off', 'icons', 'pills'].includes(mode) ? mode : 'icons';
        this._chart.queue_repaint();
    }

    /** where the strip rides: 'top' of chart | 'bottom' above the hours */
    setCondPos(pos) {
        this._condPos = pos === 'bottom' ? 'bottom' : 'top';
        this._chart.queue_repaint();
    }

    /** 12-hour AM/PM or 24-hour labels on the chart axis + city clock */
    setHourFormat(h24) {
        if (this._hour24 === !!h24)
            return;
        this._hour24 = !!h24;
        this._chart.queue_repaint();
        this._tickClock();
    }

    /** 'Data text' emphasis: normal | bold | large | both -- the metric
     *  values, hour labels and the now label on the chart all at once */
    setTextEmph(mode) {
        const scale = mode === 'large' || mode === 'both' ? 1.18 : 1;
        const bold = mode === 'bold' || mode === 'both';
        if (this._textScale === scale && this._textBold === bold)
            return;
        this._textScale = scale;
        this._textBold = bold;
        this._chart.queue_repaint();
    }

    /** flat ink: drops the CSS emboss shadows (text + ghost buttons) */
    setEmboss(on) {
        this._emboss = on !== false;
        if (this._emboss)
            this._content.remove_style_class_name('aw-flat');
        else
            this._content.add_style_class_name('aw-flat');
    }

    _bgAt(f, pt) {
        if (this._style === 'accent')
            return this._dark ? [0.185, 0.185, 0.19] : [0.96, 0.96, 0.97];
        const c = sampleSky(this._skyOpts.scene, this._skyOpts.night, f);
        const scrim = this._skyOpts.scrim;
        const bg = scrim
            ? c.map((v, i) => v * (1 - scrim[3]) + scrim[i] * scrim[3])
            : c;
        if (pt) {
            const [cw, ch] = this._content.get_size();
            const body = bodyOf(this._skyOpts.scene, this._skyOpts.night,
                cw || 330, ch || 430);
            if (body) {
                const d = Math.hypot(pt.x * (cw || 330) - body.x,
                    pt.f * (ch || 430) - body.y);
                const cov = d <= body.r ? body.max
                    : Math.max(0, body.max * (1 - (d - body.r) / body.soft));
                if (cov > 0.02)
                    return bg.map((v, i) => v + (body.col[i] - v) * cov);
            }
        }
        return bg;
    }

    _bgUnderChart() {
        return this._bgAt(0.62);
    }

    _iconOutline() {
        return lumOf(this._bgUnderChart()) >= 0.38
            ? [0.04, 0.05, 0.09, 0.62] : null;
    }

    /** state = {current, daily, hourly, currentIso, units, windy, effective,
     *           windKmh, updated, dark} */
    render(state) {
        this._state = state;
        if (state.dark !== undefined)
            this._dark = state.dark;
        this._applyTheme();
        this._showBody(true);

        const { current, daily } = state;
        const today = daily[0];
        const { scene, desc } = state.effective ?? sceneFor(current.code, current.isDay);
        const windy = !!state.windy;
        // the big temp + condition line are (re)written by _syncHeader at the
        // end of render, so a selected future day survives refreshes
        this._desc = _(desc);

        // city clock ticks from the API timestamp (city timezone, not ours)
        this._cityMs = state.currentIso ? Date.parse(state.currentIso) : 0;
        this._cityBaseUs = GLib.get_monotonic_time();
        this._tickClock();
        if (!this._cityClockTimerId) {
            this._cityClockTimerId = GLib.timeout_add_seconds(GLib.PRIORITY_LOW, 20, () => {
                this._tickClock();
                return GLib.SOURCE_CONTINUE;
            });
        }

        // the mock has no "updated" row -- keep it as the refresh button's
        // accessible name instead of visible clutter
        if (state.updated)
            this._refreshBtn.set_accessible_name(
                `${_('Refresh forecast — updated')} ${state.updated.format('%H:%M')}`);

        this._buildDayTiles();
        if (this._day >= daily.length)
            this._day = 0;
        this._markTiles();
        this._applySelection();
    }

    destroy() {
        if (this._morphId) {
            GLib.source_remove(this._morphId);
            this._morphId = 0;
        }
        if (this._cityClockTimerId) {
            GLib.source_remove(this._cityClockTimerId);
            this._cityClockTimerId = 0;
        }
        this.actor.destroy();
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
            if (k === key)
                btn.add_style_class_name('aw-tab-active');
            else
                btn.remove_style_class_name('aw-tab-active');
        }
        this._applySelection();
    }

    /** Recompute chart series + sky for the current day/metric. */
    _applySelection() {
        const s = this._state;
        if (!s)
            return;
        this._syncHeader();
        this._morphTo(this._chartValues());
        this._updateSky();
        this._applyTileInk();          // day switch moves the glass tile and
        this._chart.queue_repaint();   // can swap the sampled sky
    }

    /** Big temp + condition text follow the selected day tile: Today shows
     *  the live observation ("Now: Sunny"), a future day shows that day's
     *  high and its general condition phrase ("Sun: Cloudy"). */
    _syncHeader() {
        const s = this._state;
        if (!s)
            return;
        if (this._day === 0) {
            this._tempLbl.set_text(fmtTemp(s.current.temp, s.units));
            this._descLbl.set_text(`${_('Now')}: ${this._desc}`);
        } else {
            const d = s.daily[Math.min(this._day, s.daily.length - 1)];
            this._tempLbl.set_text(fmtTemp(d.tmax, s.units));
            this._descLbl.set_text(
                `${_(dayName(d.date))}: ${_(sceneFor(d.code, true).desc)}`);
        }
        this._clockRow.visible = this._day === 0;
    }

    _chartValues() {
        const s = this._state;
        const field = { temp: 'temp', precip: 'precipProb', wind: 'wind' }[this._metric];
        const idx = s.hourly ? daySlice(s.hourly, s.daily, this._day, s.currentIso) : [];
        const units = s.units;
        this._fmtValue = this._metric === 'temp'
            ? (i, v) => fmtTemp(v, units)
            : this._metric === 'precip'
                ? (i, v) => `${Math.round(v)}%`
                : (i, v) => fmtWind(v, units);
        const times = s.hourly ? idx.map(i => s.hourly.time[i]) : [];
        this._fmtHour = i => hourLabel(times[i] ?? 'T00', this._hour24);
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
        if (this._skyOpts.night !== night) {
            this._skyOpts.night = night;
            // the light wash is night-aware: day->dusk flip changes it
            this._syncScrim();
        }
        this._skyOpts.phase = Number.isFinite(s.phase) ? s.phase : null;
        if (this._day === 0)
            this._onSky?.(scene, night);
        this._skyArea.queue_repaint();
    }

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

    _buildDayTiles() {
        const { daily, units } = this._state;
        this._daysGrid.destroy_all_children();
        this._dayBtns = [];
        this._dayLoLbls = [];
        this._tileIcons = [];
        const n = Math.min(daily.length, 8);
        for (let r = 0; r < n; r += 4) {
            const rowTiles = row('aw-days');
            for (let i = r; i < Math.min(r + 4, n); i++) {
                const d = daily[i];
                const { scene } = sceneFor(d.code, true);
                const btn = new St.Button({
                    style_class: 'aw-day',
                    can_focus: true,
                    x_expand: true,
                });
                const col = new St.BoxLayout({
                    vertical: true, style_class: 'aw-day-col',
                    x_align: FILL
                });
                col.add_child(new St.Label({
                    text: i === 0 ? _('Today') : _(dayName(d.date)),
                    style_class: 'aw-day-name',
                    x_align: Clutter.ActorAlign.CENTER
                }));
                const icon = new WeatherIcon({
                    size: 26, animate: false,
                    time: STATIC_TIME + i * 0.2,
                    dark: this._dark
                });
                this._tileIcons.push(icon);
                icon.setScene(scene, { intensity: d.precipProb / 25, windKmh: d.windMax });
                col.add_child(icon);
                const hl = new St.BoxLayout({
                    style_class: 'aw-day-hl',
                    x_align: Clutter.ActorAlign.CENTER
                });
                hl.add_child(new St.Label({
                    text: fmtTemp(d.tmax, units),
                    style_class: 'aw-day-hi'
                }));
                const loLbl = new St.Label({
                    text: fmtTemp(d.tmin, units),
                    style_class: 'aw-day-lo'
                });
                this._dayLoLbls.push(loLbl);   // smart ink dims it slightly
                hl.add_child(loLbl);
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
        this._applyTileInk();
    }

    _applyTileInk() {
        for (const [i, btn] of (this._dayBtns ?? []).entries()) {
            const lo = this._dayLoLbls?.[i];
            if (this._style === 'accent' || !this._state) {
                btn.set_style('');
                lo?.set_style('');
                continue;
            }
            let bg = this._bgAt(0.9);              // tiles live at card foot
            if (i === this._day)                   // selected: + tile glass
                bg = compGlass(bg, this._dark);
            const ink = pickInk(bg);
            btn.set_style(inkCss(ink));
            lo?.set_style(inkCss(ink, 0.82));
        }
    }

    _applyTextInk() {
        const plain = this._style === 'accent' || !this._state;
        const set = (a, css) => {
            if (a && a._awInk !== css) {
                a._awInk = css;
                a.set_style(css);
            }
        };
        if (plain) {
            for (const a of [this._tempLbl, this._descLbl, this._cityLbl,
            this._clockLbl])
                set(a, '');
            for (const ic of this._ghostIcons ?? [])
                set(ic, '');
            for (const btn of Object.values(this._tabBtns ?? {}))
                set(btn, '');
            return;
        }
        const halo = res => this._emboss ? haloCss(res) : '';
        const inkGroup = actors => {
            const list = actors ?? [];
            const res = judgeInk([].concat(...list.map(a => this._bgsOf(a))));
            const css = inkCss(res.ink) + halo(res);
            for (const a of list)
                set(a, css);
        };
        inkGroup([this._tempLbl, this._descLbl]);   // left column pair
        inkGroup([this._cityLbl, this._clockLbl]);
        const g = judgeInk(
            [].concat(...(this._ghostIcons ?? []).map(ic => this._bgsOf(ic))));
        const glow = !this._emboss ? ''
            : g.ink === INK_DARK
                ? ' icon-shadow: 0 1px 3px rgba(255,255,255,0.7);'
                : ' icon-shadow: 0 1px 4px rgba(0,0,10,0.7);';
        for (const ic of this._ghostIcons ?? [])
            set(ic, inkCss(g.ink) + glow);
        const row = [];
        for (const [key, btn] of Object.entries(this._tabBtns ?? {})) {
            const list = this._bgsOf(btn);
            if (key === this._metric) {
                const res = judgeInk(list.map(bg => compGlass(bg, this._dark)));
                set(btn, inkCss(res.ink) + halo(res));
            } else
                row.push(...list);
        }
        if (row.length) {
            const res = judgeInk(row);
            const css = inkCss(res.ink) + halo(res);
            for (const [key, btn] of Object.entries(this._tabBtns ?? {}))
                if (key !== this._metric)
                    set(btn, css);
        }
    }

    _groupInk(bgs) {
        if (!bgs.length)
            return { ink: pickInk(this._bgUnderChart()), emboss: false };
        return judgeInk(bgs);
    }

    _bgsOf(actor) {
        const out = [];
        try {
            const [cardX, cardY] = this._content.get_transformed_position();
            const [cw, ch] = this._content.get_size();
            const [ax, ay] = actor.get_transformed_position();
            const [aw, ah] = actor.get_size();
            if (!cw || !ch || !aw || !ah ||
                !Number.isFinite(ax + ay + cardX + cardY))
                return out;   // unmapped/NaN allocation: nothing to judge
            for (const [ux, uy] of [[0.5, 0.5], [0.15, 0.5], [0.85, 0.5],
            [0.5, 0.25], [0.5, 0.75]]) {
                const fc = Math.min(1, Math.max(0,
                    (ay + ah * uy - cardY) / ch));
                const xc = (ax + aw * ux - cardX) / cw;
                if (Number.isFinite(fc + xc))
                    out.push(this._bgAt(fc, { f: fc, x: xc }));
            }
        } catch {
            // stale allocation between relayouts: judge with what we have
        }
        return out;
    }

    _theme() {
        return this._dark ? THEME.dark : THEME.light;
    }

    _applyTheme() {
        this._content.remove_style_class_name(THEME.dark.cls);
        this._content.remove_style_class_name(THEME.light.cls);
        this._content.add_style_class_name(this._theme().cls);
        this._syncScrim();
        // day-tile + placeholder icons paint their own weather scenes; tell
        // them the new background so pale glyphs (moon/snow/fog) stay visible
        for (const icon of this._tileIcons ?? [])
            icon.setDark(this._dark);
        this._placeholderIcon?.setDark(this._dark);
        this._applyTileInk();          // selected-tile glass differs per theme
        this._skyArea.queue_repaint();
        this._chart.queue_repaint();
    }

    /* which wash rides over the background for the current menu style */
    _syncScrim() {
        const t = this._theme();
        const wash = this._skyOpts.night && t.scrimNight ? t.scrimNight
            : t.scrim;
        this._skyOpts.scrim = this._style === 'solid' ? t.scrimSolid
            : this._style === 'accent' ? null : wash;
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
        const mm = String(d.getMinutes()).padStart(2, '0');
        this._clockLbl.set_text(this._hour24
            ? `${d.getHours()}:${mm}`
            : `${d.getHours() % 12 || 12}:${mm} ${d.getHours() < 12 ? 'AM' : 'PM'}`);
    }
}
