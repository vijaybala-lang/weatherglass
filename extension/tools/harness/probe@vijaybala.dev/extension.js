/* probe extension -- DEV ONLY, never packaged.
 *
 * The nested-shell harness needs one thing to exist before any of the rest is
 * worth writing: a way to get a real gnome-shell frame into a PNG from a
 * non-interacting session. GNOME 50 locks the doors shut from the outside --
 * org.gnome.Shell.Eval returns (false,'') and the Screenshot service answers
 * external callers with AccessDenied -- so the only remaining caller is the
 * shell itself. This probe runs in-process and reports, then tries.
 *
 * Writes JSON to $WG_PROBE_OUT; on a successful capture the frame lands in
 * $WG_PROBE_PNG. It never throws out of enable(): a broken probe must still
 * leave a report behind, because the report IS the deliverable. */

import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import St from 'gi://St';
import Shell from 'gi://Shell';
import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';

const OUT = GLib.getenv('WG_PROBE_OUT') ?? '/tmp/wg-probe.json';
const PNG = GLib.getenv('WG_PROBE_PNG') ?? '/tmp/wg-probe.png';

function report(probe, {final = false} = {}) {
    try {
        const json = JSON.stringify(probe, null, 2);
        GLib.file_set_contents(OUT, json);
        if (final)
            GLib.file_set_contents(`${OUT}.final`, json);
        log(`[wg-probe] wrote ${OUT}${final ? ' (+final)' : ''}`);
    } catch (e) {
        logError(e, '[wg-probe] report write failed');
    }
}

function capabilities() {
    const caps = {};

    // 1. Clutter/GDK readback primitives that need no portal.
    try {
        caps.gdkSnapshot = typeof imports.gi.Gdk.Snapshot;
    } catch (e) {
        caps.gdkSnapshot = `absent (${e.message})`;
    }

    // 2. Capture routes, filled in by tryCaptureChain():
    //    - selfScreenshot: DBus, denied for external callers; hypothesis
    //      was the shell may answer itself.
    //    - giCapture: the C methods behind the DBus gate, called directly
    //      from the process (Shell.Screenshot is in-process GI).
    caps.selfScreenshot = 'pending';
    caps.giCapture = 'pending';
    return caps;
}

function probeEsmScreenshot() {
    // The legacy imports.ui.X shim cannot load GNOME 50's ESM modules.
    // The module itself may still exist behind resource:// -- dynamic
    // import is the only way an ESM extension can find out.
    return import('resource:///org/gnome/shell/ui/screenshot.js')
        .then(m => `present: ${Object.keys(m).join(' ')}`)
        .catch(e => `absent (${e.message})`);
}

/* The GI capture core: stage -> content texture -> PNG bytes -> file.
 * These are the methods ui/screenshot.js itself wraps; they carry no
 * policy check of their own (the DBus gate lives above them). rect =
 * [x, y, w, h] in buffer pixels, or null for the whole stage. Shared by
 * the stage self-test, card-mode's actor-region capture and film-mode's
 * frame loop. NO waits here: film mode captures at ~30 ms cadence and
 * cannot pay a priming pause per frame -- giCaptureTo() owns the wait. */
async function giCaptureCore(pngPath, rect) {
    const S = Shell.Screenshot;
    if (!S)
        return {result: 'no-Shell-namespace'};
    // ui/screenshot.js promisifies exactly these names; mirror it.
    Gio._promisify(S.prototype, 'screenshot_stage_to_content');
    Gio._promisify(S, 'composite_to_stream');

    const shooter = new S();
    const [content] = await shooter.screenshot_stage_to_content();
    const texture = content.get_texture();
    // Meta.ShaderScreenshot lost get_size() in 50; the texture
    // itself reports what was captured.
    const [fullW, fullH] = texture.get_size?.() ??
        [texture.get_width(), texture.get_height()];
    const [x, y, w, h] = rect ?? [0, 0, fullW, fullH];
    const stream = Gio.MemoryOutputStream.new_resizable();
    // Not the (-1,-1) "whole texture" sentinel: in-process it
    // composites to 0x0. Explicit buffer dimensions work.
    let pixbuf = null;
    try {
        pixbuf = await S.composite_to_stream(
            texture, x, y, w, h, 1, null, 0, 0, 1, stream);
    } catch (e) {
        return {result: `composite-failed: ${e.message}`, stageRect: [x, y, w, h]};
    }
    stream.close(null);
    if (!pixbuf)
        return {result: 'composite-null'};
    const bytes = stream.steal_as_bytes();
    let ok = false;
    try {
        ok = GLib.file_set_contents(pngPath, bytes.get_data());
    } catch (e) {
        // Older GJS wants a plain string for the raw PNG bytes.
        ok = GLib.file_set_contents(
            pngPath, new TextDecoder('latin1').decode(bytes.get_data()));
    }
    return {
        result: ok && GLib.file_test(pngPath, GLib.FileTest.EXISTS)
            ? 'ok' : 'write-failed',
        stageRect: [x, y, w, h],
        bytes: GLib.file_get_contents(pngPath)[1].length,
    };
}

/* One composited frame must exist before the readback has anything to
 * show; only the FIRST capture pays that priming pause. */
async function giCaptureTo(pngPath, rect) {
    await new Promise(r => GLib.timeout_add(GLib.PRIORITY_DEFAULT, 300,
        () => (r(), GLib.SOURCE_REMOVE)));
    return giCaptureCore(pngPath, rect);
}

/* The whole reason for stage 1: can we get pixels at all?
 *
 * Route A (DBus): rejected. GNOME 50 gates org.gnome.Shell.Screenshot with
 *   a DBusSenderChecker allowlist (ui/screenshot.js: only
 *   org.gnome.SettingsDaemon.MediaKeys -- the PrintScreen key handler --
 *   and the GNOME portal implementation may call it). Verified
 *   empirically: AccessDenied even when the shell asks itself in-process.
 *   Signatures, for the record (gnome-shell-dbus-interfaces.gresource):
 *     Screenshot     (include_cursor b, flash b, filename s) -> (b, s)
 *     ScreenshotArea (x i, y i, w i, h i, flash b, filename s) -> (b, s)
 *
 * Route B (GI): the gate lives in ui/screenshot.js, NOT in the C methods it
 *   wraps. gi://Shell exposes Shell.Screenshot directly:
 *     screenshot_stage_to_content()  -> content holding a stage texture
 *     composite_to_stream(...)       -> PNG bytes (async, promisified)
 *   which is exactly the path ScreenshotUI uses to save a shot. No DBus, no
 *   portal, no policy check. That is the harness's capture primitive. */
function tryCaptureChain() {
    // Fire from a timeout so the session bus is fully up.
    GLib.timeout_add(GLib.PRIORITY_DEFAULT, 2500, () => {
        const bus = Gio.DBus.session;
        const call = (method, params) =>
            new Promise((resolve, reject) => {
                try {
                    bus.call(
                        'org.gnome.Shell.Screenshot',
                        '/org/gnome/Shell/Screenshot',
                        'org.gnome.Shell.Screenshot',
                        method, params, null,
                        Gio.DBusCallFlags.NONE, -1, null, (c, res) => {
                            try {
                                resolve(c.call_finish(res).deep_unpack());
                            } catch (e) {
                                reject(e);
                            }
                        });
                } catch (e) {
                    reject(e);
                }
            });

        const classify = e => {
            const m = e.message ?? `${e}`;
            return /AccessDenied|not allowed/i.test(m)
                ? `denied: ${m}` : `error: ${m}`;
        };

        // Route B: in-process GI capture (see giCaptureTo).
        const giCapture = () => giCaptureTo(PNG, null);

        Promise.all([
            probeEsmScreenshot(),
            call('Screenshot',
                new GLib.Variant('(bbs)', [false, false, PNG]))
                .then(([success]) => success
                    ? (GLib.file_test(PNG, GLib.FileTest.EXISTS)
                        ? 'ok' : 'success-but-no-file')
                    : 'returned-false')
                .catch(classify),
            giCapture().catch(e => ({result: `error: ${e.message ?? e}`})),
        ]).then(([esm, shot, gi]) => {
            const caps = capabilities();
            caps.esmScreenshot = esm;
            caps.selfScreenshot = shot;
            caps.giCapture = gi.result;
            report({ ...globalProbe, caps,
                stageRect: gi.stageRect ?? null,
                png: PNG,
                pngBytes: gi.bytes ?? null,
                pngExists: GLib.file_test(PNG, GLib.FileTest.EXISTS) },
            {final: true});
        });
        return GLib.SOURCE_REMOVE;
    });
    return GLib.SOURCE_REMOVE;
}

const globalProbe = {
    imported: true,
    sessionType: GLib.getenv('XDG_SESSION_TYPE') ?? null,
    nested: GLib.getenv('MUTTER_NESTED') ?? GLib.getenv('WAYLAND_DISPLAY') ?? null,
    stageSize: null,
    timestamp: new Date().toISOString(),
};

function giDiag() {
    // What the capture actually needs: a monitor. Meta backend/manager
    // internals are not GI-exported to extensions; Meta.Display is enough.
    const diag = {};
    const T = (name, fn) => {
        try { diag[name] = fn(); } catch (e) { diag[name] = `ERR ${e.message}`; }
    };
    T('displayMonitors', () => global.display.get_n_monitors());
    T('primaryMonitorGeom', () => {
        const r = global.display.get_monitor_geometry(
            global.display.get_primary_monitor());
        return [r.x, r.y, r.width, r.height];
    });
    return diag;
}

// The shell process has its JS registered as gresources. If the ESM
// screenshot module is real, this gets us its source to study offline.
function dumpShellSource() {
    const src = GLib.getenv('WG_PROBE_SRC') ?? '/tmp/wg-shell-src';
    GLib.mkdir_with_parents(src, 0o755);
    const list = [];
    try {
        for (const dir of ['/org/gnome/shell/ui', '/org/gnome/shell/misc']) {
            for (const f of Gio.resources_enumerate_children(dir, Gio.ResourceLookupFlags.NONE))
                list.push(`${dir}/${f}`);
        }
    } catch (e) {
        list.push(`enumerate-failed: ${e.message}`);
    }
    GLib.file_set_contents(`${src}/index.txt`, list.join('\n'));
    for (const p of ['/org/gnome/shell/ui/screenshot.js',
        '/org/gnome/shell/misc/screenshotUtils.js',
        '/org/gnome/shell/ui/main.js']) {
        try {
            // GLib.file_set_bytes does not exist in GJS; decode + contents.
            const bytes = Gio.resources_lookup_data(p, Gio.ResourceLookupFlags.NONE);
            GLib.file_set_contents(`${src}/${p.split('/').pop()}`,
                new TextDecoder().decode(bytes.get_data()));
        } catch (e) {
            GLib.file_set_contents(`${src}/${p.split('/').pop()}.absent`, e.message);
        }
    }
}

// Import-time heartbeat: if this file parses but the report never appears,
// the extension loader itself failed us, not our code.
try {
    dumpShellSource();
    report({ ...globalProbe, phase: 'import' });
} catch (e) {
    globalProbe.importFatal = `${e.message}`;
}

// GNOME 50's ESM loader only activates class-based extensions; a legacy
// init/enable pair loads to INITIALIZED and silently never enables.
export default class WgProbe extends Extension {
    enable() {
        const run = async () => {
            const stage = global.stage;
            globalProbe.stageSize = stage
                ? [stage.get_width(), stage.get_height()] : null;
            globalProbe.diag = giDiag();

            const cardSlugs = GLib.getenv('WG_PROBE_CARD');
            if (cardSlugs) {
                // stage 2: render fixture panels, capture each rect
                const slugs = cardSlugs.split(',').filter(Boolean);
                const pngDir = PNG;   // card mode: PNG names a directory
                const probe = { ...globalProbe, phase: 'cards', slugs };
                report(probe);
                const {renderCards} = await import('./card-mode.js');
                const cssPath = GLib.getenv('WG_PROBE_CSS');
                GLib.mkdir_with_parents(pngDir, 0o755);
                const out = await renderCards(slugs, cssPath,
                    slug => `${pngDir}/${slug}.png`,
                    (rect, pngPath) => giCaptureTo(pngPath, rect));
                report({ ...globalProbe, phase: 'cards-done', slugs,
                    css: out.css, cards: out.cards, pngDir },
                {final: true});
                return;
            }

            const filmBeats = GLib.getenv('WG_PROBE_FILM');
            if (filmBeats) {
                // stage 3: shoot the demo film -- one PNG per ~33 ms while
                // the scripted beats fire on the shell's own clock
                const beats = JSON.parse(filmBeats);
                if (!Array.isArray(beats) || beats.length === 0)
                    throw new Error('film mode: beat sheet is empty');
                const fixture = GLib.getenv('WG_PROBE_FILM_FIXTURE')
                    ?? 'cov-clear-night';
                const pngDir = PNG;   // film mode: PNG names a directory
                report({ ...globalProbe, phase: 'film', fixture,
                    beats: beats.length });
                const {shootFilm} = await import('./film-mode.js');
                GLib.mkdir_with_parents(pngDir, 0o755);
                const out = await shootFilm({
                    fixture, beats,
                    cssPath: GLib.getenv('WG_PROBE_CSS'),
                    pngFor: f => `${pngDir}/frame_${String(f).padStart(3, '0')}.png`,
                    captureRegion: (rect, pngPath) => giCaptureCore(pngPath, rect),
                });
                report({ ...globalProbe, phase: 'film-done', css: out.css,
                    fixture, rect: out.rect, endMs: out.endMs,
                    frames: out.frames, wallMs: out.wallMs, pngDir },
                {final: true});
                return;
            }

            const probe = { ...globalProbe, phase: 'enable', caps: capabilities() };
            report(probe);                          // report first: cheap insurance
            tryCaptureChain();                      // may overwrite with the result
        };
        run().catch(e => {
            logError(e, '[wg-probe] run failed');
            globalProbe.fatal = `${e.message}`;
            report({ ...globalProbe, phase: 'fatal' }, {final: true});
        });
    }

    gettext(str) {
        return globalThis.__wgPoDict?.[str] || super.gettext(str);
    }

    disable() {
        report({ ...globalProbe, phase: 'disable', disabled: true });
    }
}
