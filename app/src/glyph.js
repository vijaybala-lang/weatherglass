/* glyph.js -- the app's consumption layer for the CANONICAL painter.
 * The art itself is byte-identical with the extension (see painter.js /
 * moon.js headers); this file adds only GTK plumbing: one shared 50 ms
 * frame heart (hidden widgets cost nothing, per-widget subscriptions pay
 * only while mapped), a DrawingArea icon factory, and small adapters that
 * preserve the signatures the app's pages already call.
 */
import GLib from 'gi://GLib?version=2.0';
import Gtk from 'gi://Gtk?version=4.0';
import { paintWeather, createParticles, GRID } from './painter.js';
import { paintMoon, moonPhase } from './moon.js';
import { createSky, paintSky } from './sky.js';

// The pose vocabulary (smoke + callers iterate it; painter dispatches).
export const SCENES = ['sun', 'moon', 'partly', 'cloud', 'fog', 'wind',
    'rain', 'sleet', 'snow', 'hail', 'storm'];

export { createParticles };

/** Draw a scene into the CURRENT origin at `size` px, preserving the
 * legacy app contract: opts { scene, night, intensity, seed, phase, pale,
 * timeSec, groundLum }. Static-pose by default (seeded, frozen like the
 * extension's chart strip); animated callers pass animating: true. */
export function drawScene(cr, size, opts = {}) {
    cr.save();
    cr.scale(size / GRID, size / GRID);
    paintWeather(cr, {
        scene: opts.scene ?? 'partly',
        night: !!opts.night,
        intensity: opts.intensity ?? 0,
        variant: opts.variant ?? null,
        phase: opts.phase ?? null,
        pale: !!opts.pale,
        groundLum: opts.groundLum ?? -1,
        time: opts.timeSec ?? 4.1,
        seed: opts.seed ?? 7,
        staticPose: !opts.animating,
        particles: opts.particles,
    });
    cr.restore();
}

/* sky.js calls paintMoonBody(cr, x, y, r, phase, lit) — the canonical
 * moon painter takes a style string; a lit surface is the 'sky' tier. */
export function paintMoonBody(cr, x, y, r, phase, _lit) {
    paintMoon(cr, x, y, r, phase, 'sky');
}

export { moonPhase };

// --- shared animation heart: one 50 ms source drives every animated glyph
// and the sky backdrop (single wakeup, one damage pass per frame). -------
const _subs = new Map();
let _seq = 1;
let _heart = 0;

function _ensureHeart() {
    if (_heart)
        return;
    _heart = GLib.timeout_add(GLib.PRIORITY_LOW, 50, () => {
        for (const fn of _subs.values())
            fn();
        return GLib.SOURCE_CONTINUE;
    });
}

export function addFrameSubscriber(fn) {
    const id = _seq++;
    _subs.set(id, fn);
    _ensureHeart();
    return id;
}

export function removeFrameSubscriber(id) {
    _subs.delete(id);
    if (!_subs.size && _heart) {
        GLib.Source.remove(_heart);
        _heart = 0;
    }
}

/** A weather glyph widget. getOpts() answers { scene, night, intensity,
 * phase, pale, seed } fresh on every draw (callers mutate state freely and
 * queue_draw); animate() gates motion, which runs on the shared heart and
 * only while mapped. */
export function makeWeatherIcon(size, getOpts = null, animate = () => true) {
    const area = new Gtk.DrawingArea();
    area.set_can_target(false); // scenery, like the sky backdrop
    area.set_size_request(size, size);
    area.set_halign(Gtk.Align.CENTER);
    area.set_valign(Gtk.Align.CENTER);
    area.set_content_width(size);
    area.set_content_height(size);

    const t0 = GLib.get_monotonic_time();
    const particles = createParticles();
    let timer = 0;

    area.set_draw_func((_w, cr, w, h) => {
        const o = getOpts ? getOpts() : {};
        const animating = animate();
        const side = Math.min(w, h);
        cr.save();
        cr.translate((w - side) / 2, (h - side) / 2);
        drawScene(cr, side, {
            ...o,
            animating,
            particles,
            timeSec: animating ? (GLib.get_monotonic_time() - t0) / 1e6 : 0,
        });
        cr.restore();
    });

    area.connect('map', () => {
        if (timer || !animate())
            return;
        timer = addFrameSubscriber(() => {
            if (!animate()) {
                removeFrameSubscriber(timer);
                timer = 0;
            }
            area.queue_draw();
        });
    });
    area.connect('unmap', () => {
        if (timer) {
            removeFrameSubscriber(timer);
            timer = 0;
        }
    });
    return area;
}


// ---------------------------------------------------------------------------
// Widget: full-page backdrop, ticking only while mapped AND animated, 20 fps
// like the extension. Sun glow/solar are solved at paint time (per-minute
// cached) from the city's clock, never at fetch time.

export function makeSkyBackdrop(getState, animate = () => true) {
    const area = new Gtk.DrawingArea();
    area.set_can_target(false);
    const sky = createSky();
    const t0 = GLib.get_monotonic_time();
    const tPauseStatic = 42;

    area.set_hexpand(true);
    area.set_vexpand(true);
    area.set_draw_func((_w, cr, w, h) => {
        const st = getState() ?? {};
        let time = (GLib.get_monotonic_time() - t0) / 1e6;
        if (!animate()) time = tPauseStatic;
        const { glow = 0, solar = null } = st;
        paintSky(cr, {
            w, h, time,
            scene: st.scene ?? 'partly',
            night: !!st.night,
            glow, solar,
            phase: st.phase ?? null,
            code: st.code ?? null,
            scrim: st.scrim ?? null,
            sky,
        });
    });

    let tick = 0, lastDrawUs = 0, winActive = true, settled = false;
    let root = null, activeHandler = 0;
    const readActive = () => {
        try {
            return root ? root.get_property('is-active') !== false : true;
        } catch { return true; }
    };
    area.connect('map', () => {
        root = area.get_root();
        winActive = readActive();
        if (root && !activeHandler) {
            try {
                activeHandler = root.connect('notify::is-active', () => {
                    winActive = readActive();
                    if (winActive) area.queue_draw();
                });
            } catch { activeHandler = 0; }
        }
        if (tick) return;
        lastDrawUs = 0;
        settled = !animate();
        tick = area.add_tick_callback((_w, clock) => {
            if (!animate()) {
                if (!settled) {
                    settled = true;
                    area.queue_draw();
                }
                return true;
            }
            settled = false;
            if (!winActive) return true;
            const now = clock.get_frame_time();
            const intervalUs = (sky.frameMs > 12 ? 100 : 50) * 1000;
            if (now - lastDrawUs >= intervalUs) {
                lastDrawUs = now;
                area.queue_draw();
            }
            return true;
        });
    });
    area.connect('unmap', () => {
        if (tick) {
            area.remove_tick_callback(tick);
            tick = 0;
        }
        if (root && activeHandler) {
            root.disconnect(activeHandler);
            activeHandler = 0;
        }
        root = null;
    });
    area.invalidateState = () => area.queue_draw();
    return area;
}
