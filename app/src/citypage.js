// citypage.js — per-city Sky-first panel over the window-wide animated
// sky: temperature hero, 8-day selector, hourly chart, selected-day
// details, then live conditions — all wearing ADAPTIVE INK, judged
// worst-of-five-samples against the composited ground (gradient +
// sun/moon disc + glass), so a passing disc flips whole label families
// exactly like the extension popup.

import GLib from 'gi://GLib?version=2.0';
import Gtk from 'gi://Gtk?version=4.0';
import GObject from 'gi://GObject?version=2.0';
import Adw from 'gi://Adw?version=1';
import { makeWeatherIcon } from './glyph.js';
import { sampleSky, bodyOf } from './sky.js';
import { HourlyChart, CHART_SERIES } from './chart.js';
import { judgeBoxes, judgeInk, lineInk, applyInk, lumOf } from './ink.js';
import {
    effectiveScene, precipIntensity, sceneFor, moonPhase, daySlice, cityWallMs,
    sunShade, dayName, fmtTemp, fmtWind, fmtPressure, fmtVisibility, fmtPrecipRate,
    fmtPrecipTotal, fmtDuration, fmtClock, fmtDayStamp, fmtLocalIso, compass,
    uvBand, relTime, locationLabel,
} from './weather.js';

const METRIC_KEYS = ['temp', 'precip', 'wind'];

// ANIMATED-SKY FURNITURE DOCTRINE (extension menu.js THEME_CONFIG): "the
// animated sky carries its own contrast — the ink judge reads the painted
// pixels — so it ALWAYS presents the dark treatment regardless of the
// system theme; only the solid style needs a per-theme wash." Slabs, chips,
// tab pills and card glass under .sky-on are fixed dark glass in
// data/style.css; NO canvas mirroring is needed because no furniture ground
// feeds a verdict anymore. scripts/check-design-parity.py pins the literals.

function statTile(title) {
    const titleLbl = new Gtk.Label({ label: title, xalign: 0, css_classes: ['stat-title'] });
    const valueLbl = new Gtk.Label({ label: '—', css_classes: ['stat-value'] });
    valueLbl.set_wrap(true);
    valueLbl.set_xalign(0);
    const box = new Gtk.Box({
        orientation: Gtk.Orientation.VERTICAL,
        spacing: 2,
        css_classes: ['card', 'stat-tile'],
    });
    box.append(titleLbl);
    box.append(valueLbl);
    return { box, valueLbl };
}

function caption(text) {
    return new Gtk.Label({ label: text, xalign: 0, css_classes: ['dim-label', 'caption'] });
}

function sectionHeading(title, note) {
    const box = new Gtk.Box({
        orientation: Gtk.Orientation.HORIZONTAL,
        spacing: 8,
        css_classes: ['section-heading'],
    });
    const titleLbl = new Gtk.Label({ label: title, xalign: 0, css_classes: ['section-title'] });
    box.append(titleLbl);
    if (note)
        box.append(new Gtk.Label({ label: note, xalign: 0, css_classes: ['section-note'] }));
    return { box, titleLbl };
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function dateParts(iso) {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso ?? '');
    return m ? { month: Number(m[2]), day: Number(m[3]) } : null;
}

function forecastRangeLabel(daily) {
    const first = dateParts(daily?.[0]?.date);
    const last = dateParts(daily?.at(-1)?.date);
    if (!first || !last) return '';
    return first.month === last.month
        ? `${first.day}–${last.day} ${MONTHS[first.month - 1]}`
        : `${first.day} ${MONTHS[first.month - 1]}–${last.day} ${MONTHS[last.month - 1]}`;
}

function preciseLocationLabel(city) {
    const region = locationLabel(city);
    const lat = `${Math.abs(city.latitude).toFixed(2)}°${city.latitude >= 0 ? 'N' : 'S'}`;
    const lon = `${Math.abs(city.longitude).toFixed(2)}°${city.longitude >= 0 ? 'E' : 'W'}`;
    return [region, `${lat}, ${lon}`].filter(Boolean).join(' · ');
}

// GJS freezes vfuncs at registration — the registerClass wrapper is mandatory.
export const CityPage = GObject.registerClass({ gTypeName: 'WCityPage' },
class CityPage extends Gtk.Box {
    city;

    #bus;
    #data = null;
    #dayIndex = 0;
    #h12 = false;
    #ticker = 0;
    #rejudgePending = false;
    #rejudgeDebounce = 0;

    #glyphState = { scene: 'partly', night: false, phase: 0.62 };
    #moonIconState = { scene: 'moon', phase: 0.62, night: true };
    #skyScene = 'loading';
    #skyNight = false;
    #moonPhase = 0.62;

    #stack; #overlay; #vadj;
    #errorBanner; #errorBannerLabel; #coldErrorLabel;
    #tempLabel; #cityLabel; #locLabel; #condLabel; #nowBadge;
    #clockLabel; #dateLabel; #updatedLabel; #heroSpinner;
    #chart; #daySummary; #segBox;
    #forecastHead; #forecastRange; #tilesFlow; #dayTiles = []; #metricBtns = [];
    #detailsHead; #detailsHeading; #detailsFlow; #detailsTiles = {};
    #detailsToggle; #detailsExpanded = false; #detailsOrder = [];
    #currentHead; #currentStrip; #currentStripLabel;
    #tiles = {};
    #heroLeft; #heroRight; #statFlow;

    constructor(bus, city) {
        super({ orientation: Gtk.Orientation.VERTICAL });
        this.city = city;
        this.#bus = bus;

        this.#stack = new Gtk.Stack({ vexpand: true, hexpand: true });
        const scroll = new Gtk.ScrolledWindow();
        scroll.set_policy(Gtk.PolicyType.NEVER, Gtk.PolicyType.AUTOMATIC);
        this.#vadj = scroll.get_vadjustment();
        scroll.set_child(this.#buildReady());
        this.#stack.add_named(scroll, 'ready');
        this.#stack.add_named(this.#buildBusy(), 'loading');
        this.#stack.add_named(this.#buildColdError(), 'error');

        // The animated sky is window-owned (MainWindow) so the sidebar and
        // panel share one continuous ground; this page is transparent
        // content over it and only reports its scene via skyView().
        this.#overlay = new Gtk.Overlay();
        this.#overlay.set_child(this.#stack);

        this.append(this.#overlay);

        // ---- subscriptions ----------------------------------------------------
        bus.on('forecast-updated', (id, data) => { if (id === city.id) this.apply(data); });
        bus.on('forecast-failed', (id, err) => { if (id === city.id) this.#showFailure(err); });
        bus.on('forecast-status', (id, fetching) => {
            if (id === city.id) {
                this.#heroSpinner.visible = fetching;
                if (fetching) this.#heroSpinner.start();
                else this.#heroSpinner.stop();
            }
        });
        bus.on('units-changed', () => { if (this.#data) this.apply(this.#data, true); });
        bus.on('locale-props', p => this.setLocale(p));
        bus.on('config-changed', kind => {
            if (kind === 'sky' || kind === 'animate') {
                this.#applySkyMode();
                this.#invalidateSky();
            }
        });

        // re-judge ink on scroll / growth (debounced 80 ms, one pass)
        this.#vadj.connect('value-changed', () => this.#scheduleRejudge());
        this.#overlay.connect('notify::default-width', () => this.#scheduleRejudge());

        this.connect('map', () => {
            if (!this.#ticker) {
                this.#ticker = GLib.timeout_add_seconds(GLib.PRIORITY_LOW, 20, () => {
                    this.#tickClock();
                    this.#invalidateSky();
                    return GLib.SOURCE_CONTINUE;
                });
                this.#tickClock();
            }
            this.#scheduleRejudge();
        });
        this.connect('unmap', () => {
            if (this.#ticker) {
                GLib.Source.remove(this.#ticker);
                this.#ticker = 0;
            }
        });

        this.#applySkyMode();

        const cached = bus.forecasts?.getState(city.id);
        if (cached?.data)
            this.apply(cached.data);
        else
            this.#goLoading();
    }

    // ---- sky state ---------------------------------------------------------------

    get #skyOn() { return this.#bus.config.sky; }

    #skyView() {
        const wall = this.#data ? cityWallMs(this.#data) : Date.now();
        const { glow, solar } = sunShade(this.city.id, this.city.latitude,
            this.city.longitude, wall);
        return {
            scene: this.#skyScene,
            night: this.#skyNight,
            code: this.#skyCode,
            phase: this.#moonPhase,
            glow, solar,
        };
    }

    /** Scene for MainWindow's shared whole-window sky backdrop. */
    skyView() {
        return this.#skyView();
    }

    #invalidateSky() {
        if (this.#skyOn) this.#bus.emit('sky-invalidated', this.city.id);
    }

    /** Composited ground rgb at page-space px (sky + celestial disc). */
    #groundAtPx(x, y, W, H) {
        const v = this.#skyView();
        let rgb = sampleSky(v.scene, v.night, y / Math.max(1, H), v.glow, v.solar);
        const body = bodyOf(v.scene, v.night, W, H, v.glow, v.solar, v.phase);
        if (body) {
            const d = Math.hypot(x - body.x, y - body.y);
            if (d < body.r + body.soft) {
                const fall = 1 - Math.max(0, d - body.r) / body.soft;
                rgb = rgb.map((c, i) => c + (body.col[i] - c) * fall * body.max);
            }
        }
        return rgb;
    }

    /** Window-space box [x,y,w,h] of a widget, accumulated up to the
     * root so samples line up with MainWindow's whole-window sky. */
    #boxOf(widget) {
        const root = this.get_root();
        if (!root) return null;
        let x = 0, y = 0;
        let w = widget;
        while (w && w !== root) {
            const a = w.get_allocation();
            x += a.x; y += a.y;
            w = w.get_parent();
        }
        if (w !== root) return null; // unmapped / not in window
        const a = widget.get_allocation();
        if (a.width <= 1 || a.height <= 1) return null;
        return [x, y, a.width, a.height];
    }

    #scheduleRejudge(debounceMs = 80) {
        if (this.#rejudgeDebounce) return;
        this.#rejudgeDebounce = GLib.timeout_add(GLib.PRIORITY_LOW, debounceMs, () => {
            this.#rejudgeDebounce = 0;
            this.#rejudge();
            return GLib.SOURCE_REMOVE;
        });
    }

    #rejudge() {
        if (!this.#skyOn || !this.get_mapped()) return;
        const frame = this.get_root() ?? this.#overlay;
        const W = frame.get_width(), H = frame.get_height();
        if (W < 50 || H < 50) return;
        const bgPoint = (fx, fy) => this.#groundAtPx(fx * W, fy * H, W, H);
        const judge = (widgets, comp) => {
            const boxes = widgets.map(w => this.#boxOf(w)).filter(Boolean);
            if (!boxes.length) return null;
            return judgeBoxes(boxes, W, H, bgPoint, comp);
        };
        const raw = rgb => rgb;
        const on = true;

        applyInk(this.#heroLeft, judge([this.#heroLeft], raw), on);
        applyInk(this.#heroRight, judge([this.#heroRight], raw), on);
        applyInk(this.#forecastHead, judge([this.#forecastHead], raw), on);
        applyInk(this.#detailsHead, judge([this.#detailsHead], raw), on);
        applyInk(this.#currentHead, judge([this.#currentHead], raw), on);
        // Stat cards: fixed dark-glass furniture (extension _paintDark
        // doctrine) — strip verdict classes; the static .sky-on card
        // rules in style.css own their ink.
        applyInk(this.#statFlow, null, false);
        applyInk(this.#detailsFlow, null, false);
        applyInk(this.#currentStrip, null, false);

        // Day tiles NEVER re-ink: transparent / dark-slab / dark-pill states
        // are static CSS furniture with white ink + emboss, exactly like the
        // extension's un-judged .aw-day row.

        // full-bleed chart zone sits on the OPEN sky — no glass comp
        applyInk(this.#daySummary, judge([this.#daySummary], raw), on);
        applyInk(this.#segBox, judge([this.#segBox], raw), on);

        // chart internals: the plot crosses many grounds — one ink family
        // survives the WORST sample of the grid; series lines get walked
        // away from the average ground until they clear 3.1:1.
        const chartBox = this.#boxOf(this.#chart);
        if (chartBox) {
            const [bx, by, bw, bh] = chartBox;
            const bgs = [];
            for (let fy = 0.08; fy <= 0.95; fy += 0.145)
                for (let fx = 0.08; fx <= 0.95; fx += 0.145)
                    bgs.push(raw(this.#groundAtPx(bx + fx * bw, by + fy * bh, W, H)));
            const series = {};
            for (const k of Object.keys(CHART_SERIES))
                series[k] = lineInk(CHART_SERIES[k].rgb, bgs);
            this.#chart.setJudgedInk(judgeInk(bgs).ink, series);
        }
    }

    /** (chart-local px,py) -> composited sky luminance, for the strip's
     * per-glyph pale verdict. Null when the sky is off (fallback palettes). */
    #chartGroundLum(px, py) {
        if (!this.#skyOn) return null;
        const box = this.#boxOf(this.#chart);
        const frame = this.get_root() ?? this.#overlay;
        const W = frame.get_width(), H = frame.get_height();
        if (!box || W < 50 || H < 50) return null;
        return lumOf(this.#groundAtPx(box[0] + px, box[1] + py, W, H));
    }

    // ---- construction -------------------------------------------------------------

    #buildReady() {
        const clamp = new Adw.Clamp({ maximum_size: 780, tightening_threshold: 620 });
        // THREE bands: a padded top column, the FULL-BLEED chart zone (GTK
        // forbids negative margins, so the bleed is structural — the middle
        // band simply carries no side gutters), and a padded bottom column.
        const outer = new Gtk.Box({ orientation: Gtk.Orientation.VERTICAL, spacing: 0 });
        const top = new Gtk.Box({
            orientation: Gtk.Orientation.VERTICAL,
            spacing: 0,
            margin_top: 30, margin_start: 22, margin_end: 58,
        });
        const bottom = new Gtk.Box({
            orientation: Gtk.Orientation.VERTICAL,
            spacing: 0,
            margin_top: 30, margin_bottom: 14,
            margin_start: 22, margin_end: 22,
        });
        outer.append(top);
        clamp.set_child(outer);

        // hero --------------------------------------------------------------------
        const hero = new Gtk.Box({ orientation: Gtk.Orientation.HORIZONTAL, spacing: 10 });
        this.#heroLeft = new Gtk.Box({
            orientation: Gtk.Orientation.VERTICAL,
            valign: Gtk.Align.START,
        });
        this.#tempLabel = new Gtk.Label({ label: '—', xalign: 0, css_classes: ['hero-temp'] });
        this.#cityLabel = new Gtk.Label({
            label: this.city.name, xalign: 0, css_classes: ['hero-city'],
        });
        this.#cityLabel.set_ellipsize(3);
        this.#locLabel = new Gtk.Label({
            label: preciseLocationLabel(this.city),
            xalign: 0, css_classes: ['hero-loc'],
        });
        this.#locLabel.set_ellipsize(3);
        const condRow = new Gtk.Box({
            orientation: Gtk.Orientation.HORIZONTAL,
            spacing: 6,
            margin_top: 6,
        });
        this.#nowBadge = new Gtk.Label({
            label: 'NOW', css_classes: ['now-badge'], visible: false,
            valign: Gtk.Align.CENTER,
        });
        this.#condLabel = new Gtk.Label({
            xalign: 0, css_classes: ['hero-cond'],
        });
        condRow.append(this.#nowBadge);
        condRow.append(this.#condLabel);
        this.#heroLeft.append(this.#tempLabel);
        this.#heroLeft.append(this.#cityLabel);
        this.#heroLeft.append(this.#locLabel);
        this.#heroLeft.append(condRow);
        hero.append(this.#heroLeft);

        hero.append(new Gtk.Box({ hexpand: true }));

        this.#heroRight = new Gtk.Box({
            orientation: Gtk.Orientation.VERTICAL,
            valign: Gtk.Align.START,
            halign: Gtk.Align.END,
            spacing: 2,
        });
        this.#clockLabel = new Gtk.Label({ label: '--:--', xalign: 1, css_classes: ['hero-clock'] });
        this.#dateLabel = new Gtk.Label({ label: '', xalign: 1, css_classes: ['hero-date'] });
        const updatedRow = new Gtk.Box({
            orientation: Gtk.Orientation.HORIZONTAL,
            spacing: 6,
            halign: Gtk.Align.END,
            margin_top: 6,
        });
        this.#heroSpinner = new Gtk.Spinner({ visible: false });
        this.#updatedLabel = new Gtk.Label({ label: '', css_classes: ['hero-updated'] });
        updatedRow.append(this.#heroSpinner);
        updatedRow.append(this.#updatedLabel);
        this.#heroRight.append(this.#clockLabel);
        this.#heroRight.append(this.#dateLabel);
        this.#heroRight.append(updatedRow);
        hero.append(this.#heroRight);
        top.append(hero);

        // error banner (refresh failed, stale data shown) ---------------------------
        this.#errorBanner = new Gtk.Box({
            orientation: Gtk.Orientation.HORIZONTAL,
            spacing: 8,
            margin_top: 14,
            css_classes: ['card', 'warning-banner'],
            visible: false,
        });
        this.#errorBanner.append(new Gtk.Image({ icon_name: 'dialog-warning-symbolic' }));
        this.#errorBannerLabel = new Gtk.Label({ label: '', xalign: 0, wrap: true });
        this.#errorBanner.append(this.#errorBannerLabel);
        top.append(this.#errorBanner);

        // 8-day selector ------------------------------------------------------------
        const forecastSection = new Gtk.Box({
            orientation: Gtk.Orientation.VERTICAL,
            spacing: 8,
            margin_top: 32,
            css_classes: ['forecast-section'],
        });
        const forecastHeading = sectionHeading('8-day forecast',
            'Select a day to preview its sky and hours');
        this.#forecastHead = forecastHeading.box;
        this.#forecastRange = new Gtk.Label({
            label: '', xalign: 1, hexpand: true, css_classes: ['section-note', 'forecast-range'],
        });
        this.#forecastHead.append(this.#forecastRange);
        forecastSection.append(this.#forecastHead);
        this.#tilesFlow = new Gtk.FlowBox();
        this.#tilesFlow.set_selection_mode(Gtk.SelectionMode.NONE);
        this.#tilesFlow.set_homogeneous(true);
        this.#tilesFlow.set_max_children_per_line(8);
        this.#tilesFlow.set_row_spacing(4);
        this.#tilesFlow.set_column_spacing(5);
        forecastSection.append(this.#tilesFlow);
        top.append(forecastSection);

        // FULL-BLEED chart zone, like the extension popup: the curve, the
        // condition strip and the hour rail lie straight on the sky with no
        // card behind them, bleeding to the page edges.
        const chartCard = new Gtk.Box({
            orientation: Gtk.Orientation.VERTICAL,
            spacing: 4,
            margin_top: 14,
            css_classes: ['chart-zone'],
        });
        this.#segBox = new Gtk.Box({
            css_classes: ['metric-tabs'],
            spacing: 8,
            halign: Gtk.Align.CENTER,
        });
        {
            const btns = [];
            for (let i = 0; i < METRIC_KEYS.length; i++) {
                const key = METRIC_KEYS[i];
                const btn = new Gtk.ToggleButton({
                    label: CHART_SERIES[key].label.split(' ')[0],
                    tooltip_text: CHART_SERIES[key].label,
                    css_classes: ['metric-tab'],
                });
                if (i === 0) btn.set_active(true);
                else btn.set_group(btns[i - 1]);
                btn.connect('toggled', () => {
                    if (!btn.active) return;
                    this.#chart.metric = key;
                    this.#scheduleRejudge(0);
                });
                btns.push(btn);
            }
            this.#metricBtns = btns;
            for (const b of this.#metricBtns) this.#segBox.append(b);
        }
        chartCard.append(this.#segBox);
        this.#daySummary = new Gtk.Label({ label: '', css_classes: ['day-summary'] });
        chartCard.append(this.#daySummary);
        this.#chart = new HourlyChart();
        chartCard.append(this.#chart);
        outer.append(chartCard);
        outer.append(bottom);

        // selected-day details ---------------------------------------------------------
        const detailsHeading = sectionHeading("Today's details", 'Daily forecast');
        this.#detailsHead = detailsHeading.box;
        this.#detailsHeading = detailsHeading.titleLbl;
        bottom.append(this.#detailsHead);
        this.#detailsFlow = new Gtk.FlowBox({ margin_top: 8 });
        this.#detailsFlow.set_selection_mode(Gtk.SelectionMode.NONE);
        this.#detailsFlow.set_homogeneous(true);
        this.#detailsFlow.set_max_children_per_line(2);
        this.#detailsFlow.set_row_spacing(10);
        this.#detailsFlow.set_column_spacing(10);
        this.#detailsFlow.set_sort_func((a, b) =>
            this.#detailRank(a) - this.#detailRank(b));
        for (const [key, title] of [
            ['feels', 'Feels-like high / low'],
            ['precipTotal', 'Precipitation total'],
            ['windMax', 'Wind max · gusts'],
            ['uvMax', 'UV max'],
            ['daylight', 'Daylight · sun'],
            ['moon', 'Moon'],
        ]) {
            const t = statTile(title);
            this.#detailsTiles[key] = t;
            this.#detailsFlow.insert(t.box, -1);
        }
        bottom.append(this.#detailsFlow);
        this.#detailsToggle = new Gtk.Button({
            label: 'More details',
            halign: Gtk.Align.START,
            margin_top: 10,
            css_classes: ['details-toggle'],
        });
        this.#detailsToggle.connect('clicked', () => {
            this.#detailsExpanded = !this.#detailsExpanded;
            this.#detailsToggle.label = this.#detailsExpanded
                ? 'Fewer details' : 'More details';
            this.#updateDetailsVisibility();
            this.#scheduleRejudge();
        });
        bottom.append(this.#detailsToggle);

        // current conditions -------------------------------------------------------------
        const currentHeading = sectionHeading('Current conditions', 'Live conditions');
        this.#currentHead = currentHeading.box;
        this.#currentHead.set_margin_top(24);
        bottom.append(this.#currentHead);
        this.#currentStripLabel = new Gtk.Label({
            label: '', xalign: 0, wrap: true, css_classes: ['current-strip-label'],
        });
        this.#currentStrip = new Gtk.Box({
            orientation: Gtk.Orientation.VERTICAL,
            margin_top: 8,
            css_classes: ['card', 'current-strip'],
            visible: false,
        });
        this.#currentStrip.append(this.#currentStripLabel);
        bottom.append(this.#currentStrip);
        this.#statFlow = new Gtk.FlowBox({ margin_top: 8, css_classes: ['current-grid'] });
        this.#statFlow.set_selection_mode(Gtk.SelectionMode.NONE);
        this.#statFlow.set_homogeneous(true);
        this.#statFlow.set_max_children_per_line(4);
        this.#statFlow.set_row_spacing(10);
        this.#statFlow.set_column_spacing(10);
        for (const [key, title] of [['wind', 'Wind · gusts'], ['humidity', 'Humidity'],
            ['pressure', 'Pressure'], ['uv', 'UV index'], ['visibility', 'Visibility'],
            ['precip', 'Precipitation'], ['dew', 'Dew point'], ['cloud', 'Cloud cover']]) {
            const t = statTile(title);
            this.#statFlow.insert(t.box, -1);
            this.#tiles[key] = t.valueLbl;
        }
        bottom.append(this.#statFlow);

        const footer = new Gtk.LinkButton({
            uri: 'https://open-meteo.com/',
            label: 'Weather data by Open-Meteo.com',
            css_classes: ['flat', 'caption'],
            halign: Gtk.Align.CENTER,
            margin_top: 24,
        });
        bottom.append(footer);
        return clamp;
    }

    #buildBusy() {
        const box = new Gtk.Box({
            orientation: Gtk.Orientation.VERTICAL,
            spacing: 12,
            valign: Gtk.Align.CENTER,
            halign: Gtk.Align.CENTER,
        });
        box.set_name('busy-page');
        const sp = new Gtk.Spinner();
        sp.start();
        box.append(sp);
        box.append(new Gtk.Label({ label: 'Fetching the forecast…', css_classes: ['ink-light', 'emboss-light'] }));
        return box;
    }

    #buildColdError() {
        const box = new Gtk.Box({
            orientation: Gtk.Orientation.VERTICAL,
            spacing: 12,
            valign: Gtk.Align.CENTER,
            halign: Gtk.Align.CENTER,
        });
        box.append(makeWeatherIcon(64, () => ({ scene: 'error' }), () => false));
        this.#coldErrorLabel = new Gtk.Label({
            label: 'Could not reach the weather service.',
            css_classes: ['ink-light', 'emboss-light'],
            justify: Gtk.Justification.CENTER,
        });
        box.append(this.#coldErrorLabel);
        const retry = new Gtk.Button({ label: 'Try Again', halign: Gtk.Align.CENTER });
        retry.add_css_class('suggested-action');
        retry.connect('clicked', () => this.#bus.emit('request-refresh', this.city.id));
        box.append(retry);
        return box;
    }

    // ---- sky mode on/off -----------------------------------------------------------

    #applySkyMode() {
        const on = this.#skyOn;
        if (on) {
            this.add_css_class('sky-on');
            this.#chart.setGroundSampler((x, y) => this.#chartGroundLum(x, y));
        } else {
            this.remove_css_class('sky-on');
            for (const w of [this.#heroLeft, this.#heroRight,
                this.#forecastHead, this.#detailsHead, this.#currentHead,
                this.#statFlow, this.#detailsFlow, this.#currentStrip,
                this.#daySummary, this.#segBox])
                applyInk(w, null, false);
            for (const t of this.#dayTiles) {
                applyInk(t.btn, null, false);
                if (t.glyphState.pale) {
                    t.glyphState.pale = false;
                    t.icon.queue_draw();
                }
            }
            this.#chart.setJudgedInk(null, null);
            this.#chart.setGroundSampler(null);
        }
    }

    // ---- state updates ----------------------------------------------------------------

    setLocale({ h12 }) {
        this.#h12 = !!h12;
        this.#chart.h12 = this.#h12;
        this.#tickClock();
    }

    set dark(v) {
        this.#chart.dark = v;
        this.#scheduleRejudge(0);
    }

    /** The backdrop WEARS the selected day: picking Wednesday's storm puts
     * Wednesday's clouds and drops behind everything (day-of-week scenes
     * are daytime codes, so the sun and its glow stay truthful). Today
     * rides live conditions. */
    #syncSkyScene() {
        if (!this.#data) return;
        if (this.#dayIndex > 0 && this.#data.daily[this.#dayIndex]) {
            const code = this.#data.daily[this.#dayIndex].code;
            const info = sceneFor(code, true);
            this.#skyScene = info.scene;
            this.#skyNight = false;
            this.#skyCode = code;
        } else {
            const eff = effectiveScene(this.#data.current);
            this.#skyScene = eff.scene;
            this.#skyNight = eff.night;
            this.#skyCode = this.#data.current.code;
        }
    }

    #goLoading() {
        this.#skyScene = 'loading';
        this.#skyNight = false;
        this.#stack.visible_child_name = 'loading';
        this.#invalidateSky();
    }

    apply(data, silent = false) {
        this.#data = data;
        const c = data.current;
        const units = this.#bus.config.units;
        const scene = effectiveScene(c);
        const mp = moonPhase();
        this.#moonPhase = mp.phase;
        this.#glyphState = {
            scene: scene.scene,
            night: scene.night,
            intensity: precipIntensity(c.code),
            variant: scene.variant ?? null,
            phase: mp.phase,
        };
        this.#syncSkyScene();

        this.#tempLabel.label = fmtTemp(c.temp, units);
        this.#cityLabel.label = this.city.name;
        this.#locLabel.label = preciseLocationLabel(this.city);
        this.#condLabel.label = `${scene.desc} · Feels like ${fmtTemp(c.feels, units)}`;
        this.#forecastRange.label = forecastRangeLabel(data.daily);

        const windText = `${fmtWind(c.wind, units)} ${compass(c.windDeg)}`.trim();
        this.#tiles.wind.label = c.gust != null
            ? `${windText}\ngusts ${fmtWind(c.gust, units)}`
            : windText;
        this.#tiles.humidity.label = c.humidity != null ? `${Math.round(c.humidity)}%` : '—';
        this.#tiles.pressure.label = fmtPressure(c.pressure, units);
        this.#tiles.visibility.label = fmtVisibility(c.visibility, units);
        this.#tiles.precip.label = fmtPrecipRate(c.precip, units);
        this.#tiles.dew.label = fmtTemp(c.dew, units);
        this.#tiles.cloud.label = c.cloud != null ? `${Math.round(c.cloud)}%` : '—';
        this.#tiles.uv.label = c.uv != null
            ? `${Math.round(c.uv)} · ${uvBand(c.uv).label}`
            : '—';
        this.#moonIconState = { scene: 'moon', phase: mp.phase, night: true };
        this.#refreshCurrentStrip();

        this.#errorBanner.visible = false;
        this.#buildDayTiles();
        this.#stack.visible_child_name = 'ready';
        this.#updatedLabel.label = relTime(data.fetchedAtWallMs);
        if (!silent) this.#tickClock();
        this.#invalidateSky();
        this.#scheduleRejudge(0);
    }

    #showFailure(error) {
        const state = this.#bus.forecasts?.getState(this.city.id);
        if (state?.data) {
            this.#errorBannerLabel.label =
                `Refresh failed — showing data from ${relTime(state.at)}. (${error.message})`;
            this.#errorBanner.visible = true;
        } else {
            this.#coldErrorLabel.label =
                `Could not reach the weather service.\n${error.message}`;
            this.#stack.visible_child_name = 'error';
            this.#skyScene = 'error';
            this.#invalidateSky();
        }
    }

    #refreshCurrentStrip() {
        if (!this.#data || !this.#currentStripLabel) return;
        const c = this.#data.current;
        const units = this.#bus.config.units;
        const scene = effectiveScene(c);
        const bits = [
            `Now in ${this.city.name} · ${fmtTemp(c.temp, units)}`,
            scene.desc,
            `Wind ${fmtWind(c.wind, units)} ${compass(c.windDeg)}`.trim(),
        ];
        if (c.humidity != null) bits.push(`Humidity ${Math.round(c.humidity)}%`);
        bits.push(`Updated ${relTime(this.#data.fetchedAtWallMs)}`);
        this.#currentStripLabel.label = bits.join(' · ');
    }

    #detailRank(flowChild) {
        const box = flowChild?.get_child?.();
        const key = Object.keys(this.#detailsTiles)
            .find(k => this.#detailsTiles[k].box === box);
        const rank = key ? this.#detailsOrder.indexOf(key) : -1;
        return rank >= 0 ? rank : 99;
    }

    #detailPriority(day) {
        if ((day.precipProb ?? 0) >= 50 || (day.precipSum ?? 0) >= 1)
            return ['precipTotal', 'windMax', 'feels', 'daylight', 'uvMax', 'moon'];
        if ((day.uv ?? 0) >= 6)
            return ['feels', 'uvMax', 'daylight', 'windMax', 'precipTotal', 'moon'];
        if ((day.precipProb ?? 0) >= 20 || (day.precipSum ?? 0) > 0)
            return ['feels', 'windMax', 'daylight', 'precipTotal', 'uvMax', 'moon'];
        return ['feels', 'windMax', 'uvMax', 'daylight', 'precipTotal', 'moon'];
    }

    #updateDetailsVisibility() {
        this.#detailsOrder.forEach((key, rank) => {
            const tile = this.#detailsTiles[key];
            if (tile) tile.box.visible = this.#detailsExpanded || rank < 4;
        });
    }

    #updateDayDetails(day, units) {
        if (!day) return;
        this.#detailsHeading.label = this.#dayIndex === 0
            ? "Today's details" : `${dayName(day.date)}'s details`;
        this.#detailsTiles.feels.valueLbl.label =
            `${fmtTemp(day.feelsMax ?? day.tmax, units)} / ${fmtTemp(day.feelsMin ?? day.tmin, units)}`;
        this.#detailsTiles.precipTotal.valueLbl.label =
            fmtPrecipTotal(day.precipSum, units)
            + (day.precipHours != null ? ` · ${Math.round(day.precipHours)} h` : '');
        this.#detailsTiles.windMax.valueLbl.label =
            `${fmtWind(day.windMax, units)} ${compass(day.windDir)}`.trim()
            + (day.gustMax != null ? ` · gusts ${fmtWind(day.gustMax, units)}` : '');
        this.#detailsTiles.uvMax.valueLbl.label = day.uv != null
            ? `${Math.round(day.uv)} · ${uvBand(day.uv).label}` : '—';
        let daylight = fmtDuration(day.daylightSec);
        if (day.daylightSec == null && day.sunrise && day.sunset) {
            const mins = iso => {
                const m = /T(\d{2}):(\d{2})/.exec(iso);
                return m ? Number(m[1]) * 60 + Number(m[2]) : null;
            };
            const rise = mins(day.sunrise), set = mins(day.sunset);
            if (rise != null && set != null && set > rise)
                daylight = fmtDuration((set - rise) * 60);
        }
        this.#detailsTiles.daylight.valueLbl.label =
            `${daylight} · ${fmtLocalIso(day.sunrise, this.#h12)}–${fmtLocalIso(day.sunset, this.#h12)}`;
        const dm = /^(\d{4})-(\d{2})-(\d{2})/.exec(day.date ?? '');
        const mp = dm
            ? moonPhase(Date.UTC(Number(dm[1]), Number(dm[2]) - 1, Number(dm[3]), 12))
            : moonPhase();
        this.#detailsTiles.moon.valueLbl.label =
            `${mp.name} · ${Math.round(mp.illum * 100)}% lit`;

        this.#detailsOrder = this.#detailPriority(day);
        this.#detailsFlow.invalidate_sort();
        this.#updateDetailsVisibility();
    }

    #buildDayTiles() {
        // extension tile anatomy: name · 26px code-pose glyph · hi/lo pair,
        // hierarchy by WEIGHT (lo is never faded away, only lighter)
        this.#tilesFlow.remove_all();
        this.#dayTiles = [];
        const units = this.#bus.config.units;
        this.#data.daily.forEach((day, i) => {
            const info = sceneFor(day.code, true);
            const btn = new Gtk.ToggleButton({ css_classes: ['day-tile'] });
            if (i === this.#dayIndex) btn.set_active(true);
            if (i > 0) btn.set_group(this.#dayTiles[i - 1].btn);

            const col = new Gtk.Box({
                orientation: Gtk.Orientation.VERTICAL,
                spacing: 2,
                margin_top: 10, margin_bottom: 9,
            });
            const dateNum = dateParts(day.date)?.day;
            col.append(new Gtk.Label({
                label: `${i === 0 ? 'Today' : dayName(day.date)}${dateNum ? ` ${dateNum}` : ''}`,
                css_classes: ['day-name'],
            }));
            const glyphState = {
                scene: info.scene,
                night: false,
                intensity: precipIntensity(day.code),
                variant: info.variant ?? null,
                seed: i * 13 + 5,
                pale: false,
            };
            const icon = makeWeatherIcon(26, () => glyphState, () => false);
            col.append(icon);
            const hl = new Gtk.Box({
                orientation: Gtk.Orientation.HORIZONTAL,
                spacing: 5,
                halign: Gtk.Align.CENTER,
            });
            hl.append(new Gtk.Label({
                label: fmtTemp(day.tmax, units), css_classes: ['day-hi'],
            }));
            hl.append(new Gtk.Label({
                label: fmtTemp(day.tmin, units), css_classes: ['day-lo'],
            }));
            col.append(hl);
            btn.set_child(col);
            btn.connect('toggled', () => {
                if (!btn.active) return;
                this.#dayIndex = i;
                this.#detailsExpanded = false;
                if (this.#detailsToggle) this.#detailsToggle.label = 'More details';
                this.#rerender();
            });
            this.#tilesFlow.insert(btn, -1);
            this.#dayTiles.push({ btn, glyphState, icon });
        });
        this.#rerender();
    }

    #rerender() {
        if (!this.#data) return;
        this.#syncSkyScene();
        this.#invalidateSky();
        const units = this.#bus.config.units;
        const slice = daySlice(this.#data.hourly, this.#data.daily, this.#dayIndex,
            cityWallMs(this.#data));
        this.#chart.setData(slice);

        const future = this.#dayIndex > 0;
        this.#nowBadge.visible = future;
        this.#currentStrip.visible = future;
        this.#statFlow.visible = !future;
        this.#refreshCurrentStrip();
        const day = this.#data.daily[Math.min(this.#dayIndex, this.#data.daily.length - 1)];
        if (day) {
            const info = sceneFor(day.code, true);
            const extras = [];
            if (day.precipProb != null) extras.push(`${Math.round(day.precipProb)}% precip chance`);
            if (day.windMax != null) extras.push(`up to ${fmtWind(day.windMax, units)}`);
            this.#daySummary.label =
                `${this.#dayIndex === 0 ? 'Today' : dayName(day.date)} · ${info.desc} · `
                + `H ${fmtTemp(day.tmax, units)} L ${fmtTemp(day.tmin, units)}`
                + (extras.length ? ` · ${extras.join(' · ')}` : '');
            this.#updateDayDetails(day, units);
        }
        this.#scheduleRejudge(0);
    }

    #tickClock() {
        if (!this.#data) return;
        const wall = cityWallMs(this.#data);
        this.#clockLabel.label = fmtClock(wall, this.#h12);
        this.#dateLabel.label = fmtDayStamp(wall);
        this.#updatedLabel.label = relTime(this.#data.fetchedAtWallMs);
        this.#refreshCurrentStrip();
    }

});
