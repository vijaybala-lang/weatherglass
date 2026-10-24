// window.js — AdwApplicationWindow with a city sidebar (split view):
// per-city rows (glyph · name · local clock · temperature); Organize
// Cities owns move/remove, header menu owns units / refresh / motion.

import GLib from 'gi://GLib?version=2.0';
import Gio from 'gi://Gio?version=2.0';
import GObject from 'gi://GObject?version=2.0';
import Gdk from 'gi://Gdk?version=4.0';
import Gtk from 'gi://Gtk?version=4.0';
import Adw from 'gi://Adw?version=1';
import { CityPage } from './citypage.js';
import { AddCityDialog } from './addcity.js';
import { makeWeatherIcon, makeSkyBackdrop } from './glyph.js';
import { fmtTemp, cityWallMs, fmtClock, sceneFor, brandTexture } from './weather.js';

const CityRow = GObject.registerClass({ gTypeName: 'WCityRow' },
class CityRow extends Gtk.ListBoxRow {
    city;

    #bus;
    #organize;
    #glyphState = { scene: 'partly', night: false };
    #nameLabel; #tempLabel; #timeLabel; #revealer;
    #handleLabel; #removePill;
    #dragInert = true;
    #dragLastY = 0;
    #ticker = 0;

    constructor(bus, city, organize = null) {
        super();
        this.city = city;
        this.#bus = bus;
        this.#organize = organize;

        const outer = new Gtk.Box({ orientation: Gtk.Orientation.VERTICAL });

        const row = new Gtk.Box({
            orientation: Gtk.Orientation.HORIZONTAL,
            spacing: 10,
            margin_top: 6, margin_bottom: 6,
            margin_start: 8, margin_end: 12,
        });

        // Organize mode only: the grip says "drag from anywhere on the
        // row"; it stays dead to the pointer so the row gesture owns it.
        this.#handleLabel = new Gtk.Label({
            label: '‖',
            valign: Gtk.Align.CENTER,
            css_classes: ['city-organize-handle'],
            can_target: false,
            visible: false,
        });
        row.append(this.#handleLabel);

        const glyph = makeWeatherIcon(26, () => this.#glyphState,
            () => bus.config.animate);
        row.append(glyph);

        const text = new Gtk.Box({
            orientation: Gtk.Orientation.VERTICAL,
            valign: Gtk.Align.CENTER,
            hexpand: true,
        });
        this.#nameLabel = new Gtk.Label({ label: city.name, xalign: 0 });
        this.#nameLabel.set_ellipsize(3);
        this.#nameLabel.set_can_target(false);
        text.append(this.#nameLabel);
        const subtitle = [city.admin1, city.countryCode].filter(Boolean).join(' · ');
        if (subtitle) {
            const sub = new Gtk.Label({ label: subtitle, xalign: 0, css_classes: ['dim-label', 'caption'] });
            sub.set_ellipsize(3);
            sub.set_can_target(false);
            text.append(sub);
        }
        row.append(text);

        const trailing = new Gtk.Box({
            orientation: Gtk.Orientation.VERTICAL,
            valign: Gtk.Align.CENTER,
        });
        this.#tempLabel = new Gtk.Label({ label: '', css_classes: ['city-temp'] });
        this.#timeLabel = new Gtk.Label({ label: '', css_classes: ['dim-label', 'caption'] });
        this.#tempLabel.set_can_target(false);
        this.#timeLabel.set_can_target(false);
        trailing.append(this.#tempLabel);
        trailing.append(this.#timeLabel);
        row.append(trailing);

        const trashImage = new Gtk.Image({ icon_name: 'user-trash-symbolic' });
        trashImage.set_pixel_size(16);
        this.#removePill = new Gtk.Button({
            child: trashImage,
            valign: Gtk.Align.CENTER,
            tooltip_text: `Remove ${city.name}`,
            css_classes: ['city-remove-pill'],
            visible: false,
        });
        try {
            this.#removePill.set_cursor(Gdk.Cursor.new_from_name('pointer', null));
        } catch { /* themed cursors are polish */ }
        this.#removePill.connect('clicked', () =>
            this.#revealer.set_reveal_child(true));
        row.append(this.#removePill);

        outer.append(row);

        // inline confirm-before-delete
        this.#revealer = new Gtk.Revealer({
            transition_type: Gtk.RevealerTransitionType.SLIDE_DOWN,
        });
        const confirmBox = new Gtk.Box({
            orientation: Gtk.Orientation.HORIZONTAL,
            spacing: 8,
            margin_start: 12, margin_end: 12, margin_bottom: 8,
        });
        const del = new Gtk.Button({ label: 'Confirm Remove', hexpand: true });
        del.add_css_class('destructive-action');
        del.connect('clicked', () => bus.emit('remove-city', city.id));
        const cancel = new Gtk.Button({ label: 'Keep' });
        cancel.connect('clicked', () => this.#revealer.set_reveal_child(false));
        confirmBox.append(del);
        confirmBox.append(cancel);
        this.#revealer.set_child(confirmBox);
        outer.append(this.#revealer);

        this.set_child(outer);

        // One client-side vertical drag, claimed only in Organize mode.
        // Like TickerGlass, avoid GtkDragSource: the row tree is never
        // reparented under the live grab; a data-level move lands on release.
        const drag = new Gtk.GestureDrag();
        drag.connect('drag-begin', (_g, _x, _y, seq) => {
            this.#dragLastY = 0;
            this.#dragInert = !this.#organize?.isEnabled();
            if (this.#dragInert) return;
            const sequence = seq ?? drag.get_last_updated_sequence();
            if (sequence)
                drag.set_sequence_state(sequence, Gtk.EventSequenceState.CLAIMED);
            this.#organize.begin(this);
        });
        drag.connect('drag-update', (_g, _x, y) => {
            if (this.#dragInert) return;
            this.#dragLastY = y;
            this.#organize.update(this, y);
        });
        drag.connect('drag-end', (_g, _x, y) => {
            if (this.#dragInert) return;
            this.#dragInert = true;
            this.#organize.end(this, y ?? this.#dragLastY);
        });
        this.add_controller(drag);

        const motion = new Gtk.EventControllerMotion();
        motion.connect('enter', () => {
            try {
                if (this.#organize?.isEnabled())
                    this.set_cursor(Gdk.Cursor.new_from_name('all-scroll', null));
            } catch { /* cursor is polish, not function */ }
        });
        motion.connect('leave', () => {
            try { this.set_cursor(null); } catch { /* ditto */ }
        });
        this.add_controller(motion);

        bus.on('forecast-updated', (id, data) => {
            if (id !== city.id) return;
            this.#hydrate(data);
        });
        bus.on('units-changed', () => this.#relabel());
        bus.on('locale-props', () => this.#refreshTime());
        bus.on('config-changed', kind => { if (kind === 'animate') glyph.queue_draw(); });

        const cached = bus.forecasts?.getState(city.id);
        if (cached?.data) this.#hydrate(cached.data);
    }

    setOrganizeMode(on) {
        this.#handleLabel.set_visible(on);
        this.#removePill.set_visible(on);
        if (!on) {
            this.#revealer.set_reveal_child(false);
            this.setDragging(false);
        }
        try {
            this.set_cursor(on
                ? Gdk.Cursor.new_from_name('all-scroll', null)
                : null);
        } catch { /* cursor is polish */ }
    }

    setDragging(on) {
        this.set_opacity(on ? 0.35 : 1);
    }

    dragLabel() {
        const temp = this.#tempLabel.label;
        return temp ? `${this.city.name}  ${temp}` : this.city.name;
    }

    #hydrate(data) {
        const s = sceneFor(data.current.code, data.current.isDay);
        this.#glyphState = { scene: s.scene, night: s.night, variant: s.variant ?? null };
        this.#relabel();
    }

    #relabel() {
        const state = this.#bus.forecasts?.getState(this.city.id);
        if (state?.data)
            this.#tempLabel.label = fmtTemp(state.data.current.temp, this.#bus.config.units);
        this.#refreshTime();
    }

    #refreshTime() {
        const state = this.#bus.forecasts?.getState(this.city.id);
        this.#timeLabel.label = state?.data
            ? fmtClock(cityWallMs(state.data), this.#bus.locale.h12)
            : '';
    }

    vfunc_map() {
        super.vfunc_map();
        if (!this.#ticker) {
            this.#ticker = GLib.timeout_add_seconds(GLib.PRIORITY_LOW, 20, () => {
                this.#refreshTime();
                return GLib.SOURCE_CONTINUE;
            });
            this.#refreshTime();
        }
    }

    vfunc_unmap() {
        if (this.#ticker) {
            GLib.Source.remove(this.#ticker);
            this.#ticker = 0;
        }
        super.vfunc_unmap();
    }
});

export const MainWindow = GObject.registerClass({ gTypeName: 'WMainWindow' },
class MainWindow extends Adw.ApplicationWindow {
    #bus;
    #sidebarList; #contentStack; #navPage; #emptyNavPage; #split;
    #windowSky;
    #listOverlay; #dropBar; #ghost; #ghostLabel; #appMenuButton;
    #organizeAction = null;
    #organizeMode = false;
    #dragState = null;
    #rows = new Map();
    #pages = new Map();
    #suspendSelectionSignal = false;

    constructor(app) {
        super({ application: app, default_width: 1040, default_height: 740 });
        this.#bus = app.bus;

        this.#contentStack = new Gtk.Stack({ vhomogeneous: false });
        this.#navPage = new Adw.NavigationPage({
            title: 'WeatherGlass',
            child: this.#contentStack,
        });

        const emptyBox = new Gtk.Box({
            orientation: Gtk.Orientation.VERTICAL,
            spacing: 12,
            valign: Gtk.Align.CENTER,
            halign: Gtk.Align.CENTER,
        });
        emptyBox.append(makeWeatherIcon(84, () => ({ scene: 'partly' }),
            () => this.#bus.config.animate));
        emptyBox.append(new Gtk.Label({
            label: 'No cities yet.\nAdd a city or region to see its forecast here.',
            justify: Gtk.Justification.CENTER,
            css_classes: ['dim-label'],
        }));
        const emptyAdd = new Gtk.Button({ label: 'Add a City', halign: Gtk.Align.CENTER });
        emptyAdd.add_css_class('suggested-action');
        emptyAdd.connect('clicked', () => this.offerAddCity());
        emptyBox.append(emptyAdd);
        this.#emptyNavPage = new Adw.NavigationPage({ title: 'WeatherGlass', child: emptyBox });

        // sidebar
        this.#sidebarList = new Gtk.ListBox({ vexpand: true });
        this.#sidebarList.set_selection_mode(Gtk.SelectionMode.SINGLE);
        this.#sidebarList.add_css_class('navigation-sidebar');
        this.#sidebarList.connect('row-selected', (_l, row) => {
            if (!row?.city || this.#suspendSelectionSignal) return;
            this.#bus.config.setActiveCity(row.city.id);
        });

        const sidebarBottom = new Gtk.Box({
            orientation: Gtk.Orientation.HORIZONTAL,
            spacing: 6,
            margin_top: 6, margin_bottom: 8,
            margin_start: 8, margin_end: 8,
        });
        const addBtn = new Gtk.Button({ label: 'Add City', hexpand: true });
        addBtn.add_css_class('flat');
        addBtn.add_css_class('sidebar-add');
        addBtn.connect('clicked', () => this.offerAddCity());
        sidebarBottom.append(addBtn);

        const sidebarToolbar = new Adw.HeaderBar({ css_classes: ['sidebar-toolbar'] });
        this.#appMenuButton = new Gtk.MenuButton({
            icon_name: 'open-menu-symbolic',
            tooltip_text: 'WeatherGlass menu · organize cities',
        });
        this.#appMenuButton.set_menu_model(this.#buildAppMenu());
        sidebarToolbar.pack_end(this.#appMenuButton);
        sidebarToolbar.set_title_widget(new Gtk.Label({
            label: 'WeatherGlass',
            css_classes: ['title'],
        }));

        const sidebarBox = new Gtk.Box({
            orientation: Gtk.Orientation.VERTICAL,
            css_classes: ['sidebar-shell'],
        });
        sidebarBox.append(sidebarToolbar);
        const listScroll = new Gtk.ScrolledWindow({ vexpand: true });
        listScroll.set_policy(Gtk.PolicyType.NEVER, Gtk.PolicyType.AUTOMATIC);
        listScroll.set_child(this.#sidebarList);

        // Organize drag rides an overlay OUTSIDE the scroller, like
        // TickerGlass: the ghost/drop bar float over the viewport while
        // the real row tree remains untouched under the pointer grab.
        this.#listOverlay = new Gtk.Overlay({ vexpand: true });
        this.#listOverlay.set_child(listScroll);
        this.#dropBar = new Gtk.Box({
            css_classes: ['city-dropbar'],
            halign: Gtk.Align.FILL,
            valign: Gtk.Align.START,
            height_request: 2,
            can_target: false,
            visible: false,
        });
        this.#listOverlay.add_overlay(this.#dropBar);
        this.#ghost = new Gtk.Box({
            css_classes: ['city-drag-ghost'],
            halign: Gtk.Align.START,
            valign: Gtk.Align.START,
            can_target: false,
            visible: false,
        });
        this.#ghostLabel = new Gtk.Label({ label: '', valign: Gtk.Align.CENTER });
        this.#ghost.append(this.#ghostLabel);
        this.#listOverlay.add_overlay(this.#ghost);
        sidebarBox.append(this.#listOverlay);
        sidebarBox.append(sidebarBottom);

        this.#split = new Adw.NavigationSplitView({
            sidebar: new Adw.NavigationPage({ title: 'Cities', child: sidebarBox }),
            content: this.#navPage,
            collapsed: false,
        });
        this.#split.add_css_class('sky-split');
        // One sky behind the WHOLE window: the split view floats over it,
        // with the sidebar darkened by its tinted-glass shell in CSS. The
        // backdrop paints whichever scene the active city page reports.
        this.#windowSky = makeSkyBackdrop(
            () => this.#activeSkyView(),
            () => this.#bus.config.animate);
        // Permanent ✕ furniture, top-right. Doctrine says chrome over the
        // animated sky is ALWAYS dark glass with white ink (menu.js
        // THEME_CONFIG), so unlike the day tiles this one needs no .sky-on
        // variant: the plate itself carries the contrast on any ground.
        const rootOverlay = new Gtk.Overlay();
        rootOverlay.set_child(this.#windowSky);
        rootOverlay.add_overlay(this.#split);
        rootOverlay.set_measure_overlay(this.#split, true);
        const closeButton = new Gtk.Button({
            iconName: 'window-close-symbolic',
            valign: Gtk.Align.START,
            halign: Gtk.Align.END,
            marginTop: 7,
            marginEnd: 7,
            tooltipText: 'Close (Ctrl+W)',
            cssClasses: ['win-close'],
        });
        closeButton.connect('clicked', () => this.close());
        rootOverlay.add_overlay(closeButton);
        this.set_content(rootOverlay);
        this.#applyWindowSkyMode();

        this.#registerActions(app);
        this.#installOrganizeEscape();

        this.application.set_accels_for_action('win.close', ['<Primary>W']);
        this.application.set_accels_for_action('win.refresh', ['<Primary>R']);
        this.application.set_accels_for_action('win.add-city', ['<Primary>N']);

        this.#hookBus();
        this.sync();
    }

    #activeSkyView() {
        const cities = this.#bus.config.cities;
        const activeId = cities.some(c => c.id === this.#bus.config.activeCityId)
            ? this.#bus.config.activeCityId : cities[0]?.id;
        return this.#pages.get(activeId)?.skyView()
            ?? { scene: 'partly', night: false, phase: 0.62, glow: 0, solar: null };
    }

    #applyWindowSkyMode() {
        const on = this.#bus.config.sky;
        if (on) this.add_css_class('sky-window');
        else this.remove_css_class('sky-window');
        this.#windowSky?.set_visible(on);
        if (on) this.#invalidateWindowSky();
    }

    #invalidateWindowSky() {
        if (this.#bus.config.sky) this.#windowSky?.invalidateState?.();
    }

    #buildAppMenu() {
        const menu = new Gio.Menu();
        const cities = new Gio.Menu();
        cities.append('Organize Cities', 'win.organize');
        menu.append_section(null, cities);

        const units = new Gio.Menu();
        units.append('Metric (°C · km/h)', 'win.units::metric');
        units.append('Imperial (°F · mph)', 'win.units::imperial');
        menu.append_submenu('Units', units);

        const refresh = new Gio.Menu();
        for (const m of this.#bus.config.refreshChoices)
            refresh.append(`${m} min`, `win.interval::${m}`);
        menu.append_submenu('Refresh every', refresh);

        const misc = new Gio.Menu();
        misc.append('Sky Background', 'win.sky');
        misc.append('Animated Icons', 'win.animate');
        misc.append('Keyboard Shortcuts', 'win.shortcuts');
        misc.append('About WeatherGlass', 'win.about');
        menu.append_section(null, misc);
        return menu;
    }

    #registerActions(app) {
        const cfg = this.#bus.config;

        const unitsAct = new Gio.SimpleAction({
            name: 'units',
            parameter_type: new GLib.VariantType('s'),
            state: new GLib.Variant('s', cfg.units),
        });
        unitsAct.connect('change-state', (a, v) => {
            cfg.setUnits(v.get_string()[0]);
            a.state = v;
        });
        this.add_action(unitsAct);

        const intervalAct = new Gio.SimpleAction({
            name: 'interval',
            parameter_type: new GLib.VariantType('s'),
            state: new GLib.Variant('s', String(cfg.refreshMinutes)),
        });
        intervalAct.connect('change-state', (a, v) => {
            cfg.setRefreshMinutes(parseInt(v.get_string()[0], 10));
            a.state = v;
        });
        this.add_action(intervalAct);

        const animateAct = new Gio.SimpleAction({
            name: 'animate',
            state: new GLib.Variant('b', cfg.animate),
        });
        animateAct.connect('activate', a => {
            const on = !a.state.get_boolean();
            cfg.setAnimate(on);
            a.state = new GLib.Variant('b', on);
            this.#bus.emit('config-changed', 'animate');
        });
        this.add_action(animateAct);

        const skyAct = new Gio.SimpleAction({
            name: 'sky',
            state: new GLib.Variant('b', cfg.sky),
        });
        skyAct.connect('activate', a => {
            const on = !a.state.get_boolean();
            cfg.setSky(on); // emits config-changed 'sky'; pages react
            a.state = new GLib.Variant('b', on);
        });
        this.add_action(skyAct);

        this.#organizeAction = new Gio.SimpleAction({
            name: 'organize',
            state: new GLib.Variant('b', false),
        });
        this.#organizeAction.connect('activate', a =>
            this.#setOrganizeMode(!a.state.get_boolean()));
        this.add_action(this.#organizeAction);

        const simple = (name, cb) => {
            const a = new Gio.SimpleAction({ name });
            a.connect('activate', cb);
            this.add_action(a);
        };
        simple('close', () => this.close());
        simple('refresh',
            () => this.#bus.forecasts.kick(this.#bus.config.activeCityId, true));
        simple('add-city', () => this.offerAddCity());
        simple('about', () => showAbout(this));
        simple('shortcuts', () => showShortcuts(this));
    }

    #hookBus() {
        const bus = this.#bus;
        bus.on('config-changed', kind => {
            if (kind === 'active-city' || kind === 'units') this.sync();
            if (kind === 'sky' || kind === 'animate') this.#applyWindowSkyMode();
            if (kind === 'active-city') this.#invalidateWindowSky();
        });
        bus.on('cities-changed', () => this.sync());
        bus.on('sky-invalidated', id => {
            if (id === bus.config.activeCityId) this.#invalidateWindowSky();
        });
        bus.on('remove-city', id => bus.config.removeCity(id));
        bus.on('move-city', (id, delta) => bus.config.moveCity(id, delta));
        bus.on('move-city-to', (id, to) => bus.config.moveCityTo(id, to));
        bus.on('request-refresh', id => bus.forecasts.kick(id, true));

        Adw.StyleManager.get_default().connect('notify::dark', sm => {
            for (const page of this.#pages.values())
                page.dark = sm.dark;
        });
    }

    #rowIndexOf(row) {
        let i = 0;
        for (let c = this.#sidebarList.get_first_child(); c; c = c.get_next_sibling()) {
            if (c === row) return i;
            i++;
        }
        return -1;
    }

    #installOrganizeEscape() {
        const keys = new Gtk.EventControllerKey();
        keys.set_propagation_phase(Gtk.PropagationPhase.CAPTURE);
        keys.connect('key-pressed', (_c, keyval) => {
            if (keyval === Gdk.KEY_Escape && this.#organizeMode) {
                this.#setOrganizeMode(false);
                return true;
            }
            return false;
        });
        this.add_controller(keys);
    }

    #setOrganizeMode(on) {
        on = !!on;
        this.#organizeMode = on;
        if (this.#organizeAction
            && this.#organizeAction.state.get_boolean() !== on)
            this.#organizeAction.state = new GLib.Variant('b', on);
        if (this.#appMenuButton) {
            if (on) this.#appMenuButton.add_css_class('organize-active');
            else this.#appMenuButton.remove_css_class('organize-active');
        }
        if (!on) {
            this.#ghost?.set_visible(false);
            this.#dropBar?.set_visible(false);
            this.#dragState?.row.setDragging(false);
            this.#dragState = null;
        }
        for (const row of this.#rows.values())
            row.setOrganizeMode(on);
    }

    #organizeController() {
        return {
            isEnabled: () => this.#organizeMode,
            begin: row => this.#beginCityDrag(row),
            update: (row, dy) => this.#updateCityDrag(row, dy),
            end: (row, dy) => this.#endCityDrag(row, dy),
        };
    }

    #beginCityDrag(row) {
        if (!this.#organizeMode) return;
        const cities = this.#bus.config.cities;
        const from = cities.findIndex(c => c.id === row.city.id);
        if (from < 0) return;
        const rowH = row.get_height() >= 24 ? row.get_height() : 48;
        const translated = row.translate_coordinates(this.#listOverlay, 0, 0);
        const startY = translated?.[0] ? translated[2] : from * rowH;
        this.#dragState = { row, from, to: from, rowH, startY };
        row.setDragging(true);
        this.#ghostLabel.label = row.dragLabel();
        this.#ghost.set_size_request(-1, Math.max(rowH - 6, 24));
        this.#ghost.set_margin_top(Math.max(0, Math.round(startY)));
        this.#ghost.set_visible(true);
        this.#positionDropBar(from, from);
    }

    #dragTarget(dy) {
        const state = this.#dragState;
        const count = this.#bus.config.cities.length;
        const steps = Math.sign(dy) * Math.floor(Math.abs(dy) / state.rowH);
        return Math.max(0, Math.min(count - 1, state.from + steps));
    }

    #positionDropBar(from, to) {
        const cities = this.#bus.config.cities;
        const target = this.#rows.get(cities[to]?.id);
        if (!target) {
            this.#dropBar.set_visible(false);
            return;
        }
        const translated = target.translate_coordinates(this.#listOverlay, 0, 0);
        if (!translated?.[0]) {
            this.#dropBar.set_visible(false);
            return;
        }
        this.#dropBar.set_margin_top(Math.round(
            translated[2] + (to > from ? target.get_height() : 0)));
        this.#dropBar.set_visible(true);
    }

    #updateCityDrag(row, dy) {
        const state = this.#dragState;
        if (!state || state.row !== row) return;
        state.to = this.#dragTarget(dy);
        this.#ghost.set_margin_top(Math.max(0,
            Math.round(state.startY + dy - state.rowH / 3)));
        this.#positionDropBar(state.from, state.to);
    }

    #endCityDrag(row, dy) {
        const state = this.#dragState;
        this.#ghost.set_visible(false);
        this.#dropBar.set_visible(false);
        row.setDragging(false);
        this.#dragState = null;
        if (!state || state.row !== row) return;
        const to = Math.max(0, Math.min(
            this.#bus.config.cities.length - 1,
            state.from + Math.sign(dy) * Math.floor(Math.abs(dy) / state.rowH)));
        if (to !== state.from)
            this.#bus.emit('move-city-to', row.city.id, to);
    }

    offerAddCity() {
        const dlg = new AddCityDialog(loc => this.#bus.config.addCity(loc));
        this.present_dialog(null, null, dlg, () => {});
    }

    sync() {
        const bus = this.#bus;
        const cities = bus.config.cities;

        for (const city of cities) {
            if (!this.#rows.has(city.id)) {
                const row = new CityRow(bus, city, this.#organizeController());
                this.#sidebarList.append(row);
                this.#rows.set(city.id, row);
            }
            if (!this.#pages.has(city.id)) {
                const page = new CityPage(bus, city);
                page.dark = Adw.StyleManager.get_default().dark;
                this.#contentStack.add_named(page, city.id);
                this.#pages.set(city.id, page);
            }
        }
        for (const [id, row] of [...this.#rows]) {
            if (cities.some(c => c.id === id)) continue;
            row.parent?.remove(row);
            this.#rows.delete(id);
            const pg = this.#pages.get(id);
            if (pg) {
                this.#contentStack.remove(pg);
                this.#pages.delete(id);
            }
        }
        cities.forEach((c, i) => {
            const row = this.#rows.get(c.id);
            if (row && this.#rowIndexOf(row) !== i) {
                // Reinsert from unparented: insert() on a live row reorders
                // siblings but leaves its old allocation behind as whitespace.
                this.#sidebarList.remove(row);
                this.#sidebarList.insert(row, i);
            }
        });
        for (const row of this.#rows.values())
            row.setOrganizeMode(this.#organizeMode);
        this.#organizeAction?.set_enabled(cities.length > 0);
        if (!cities.length && this.#organizeMode)
            this.#setOrganizeMode(false);

        if (!cities.length) {
            this.#split.set_content(this.#emptyNavPage);
            return;
        }
        this.#split.set_content(this.#navPage);
        const activeId = cities.some(c => c.id === bus.config.activeCityId)
            ? bus.config.activeCityId : cities[0].id;
        this.#contentStack.set_visible_child_name(activeId);
        this.#invalidateWindowSky();
        this.#suspendSelectionSignal = true;
        this.#sidebarList.select_row(this.#rows.get(activeId) ?? null);
        this.#suspendSelectionSignal = false;

        const city = cities.find(c => c.id === activeId);
        if (city) {
            this.#navPage.title = city.name;
            this.title = `${city.name} — WeatherGlass`;
        }
    }
});

function showAbout(window) {
    const about = new Adw.AboutDialog({
        application_name: 'WeatherGlass',
        application_icon: 'dev.vijaybala.weatherglassapp',
        version: '0.1.0',
        developer_name: 'vijaybala',
        license: Gtk.License.GPL_3_0,
        website: 'https://github.com/vsbala/weatherglass',
        comments: 'A standalone weather app for GNOME — multiple cities, '
            + 'procedural animated icons, powered by Open-Meteo. '
            + 'Companion to the WeatherGlass GNOME Shell extension.',
        copyright: '© 2026 vijaybala',
    });
    const brand = brandTexture(256);
    if (brand)
        about.set_logo(brand);
    about.present(window);
}

function buildShortcutsGroup(title, keys) {
    const grp = new Gtk.ShortcutsGroup({ visible: true, title });
    for (const [accel, text] of keys)
        grp.append(new Gtk.ShortcutsShortcut({ visible: true, accelerator: accel, title: text }));
    return grp;
}

function showShortcuts(window) {
    const win = new Gtk.ShortcutsWindow({ title: 'Keyboard Shortcuts', modal: true });
    const section = new Gtk.ShortcutsSection({
        visible: true,
        section_name: 'shortcuts',
        max_height: 10,
    });
    section.append(buildShortcutsGroup('WeatherGlass', [
        ['<ctrl>R', 'Refresh forecast'],
        ['<ctrl>N', 'Add a city'],
        ['<ctrl>Q', 'Quit'],
    ]));
    win.append(section);
    win.present(window);
}
