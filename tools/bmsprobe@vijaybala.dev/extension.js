/* bmsprobe — nested-only diagnostic for the blur-my-shell square-menu report.
 * Opens the date menu (a stock Shell popup BMS blurs without any Weatherglass
 * involvement) and, if present, the weatherglass popup; then walks the scene
 * graph for BMS actors and logs what each side believes the corners are. */

import GLib from 'gi://GLib';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

function classes(actor) {
    return actor?.get_style_class_name?.() ?? '';
}

function alloc(actor) {
    const b = actor?.get_paint_bounds?.();
    return b ? `${Math.round(b.x1 - b.x0)}x${Math.round(b.y1 - b.y0)}` : '?';
}

function effects(actor) {
    let list = [];
    try {
        list = actor.get_effects?.() ?? [];
    } catch {
        return 'n/a';
    }
    return list
        .map(e => {
            const cr = e.unscaled_corner_radius ?? e.corner_radius;
            return e.constructor.name + (cr !== undefined ? `(r=${cr})` : '');
        })
        .join(',') || 'none';
}

function walk(actor, depth, out) {
    if (depth > 6 || out.length > 60)
        return;
    const cls = classes(actor);
    if (cls.includes('bms') || cls.includes('popup-menu-content'))
        out.push(`${' '.repeat(depth)}${actor.constructor.name} [${cls}] ${alloc(actor)} inline="${actor.get_style?.() ?? ''}" fx=${effects(actor)}`);
    for (const child of actor.get_children?.() ?? [])
        walk(child, depth + 1, out);
}

export default class BmsProbe extends Extension {
    enable() {
        this._ticks = 0;
        this._id = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 2, () => {
            /* Question BMS asks itself at startup: does the native blur
             * class expose corner-radius? Its answer decides rounded vs
             * square. BMS attaches its popup effects asynchronously, so
             * poll until one exists or patience runs out. */
            let blur = null;
            const visit = a => {
                if (blur)
                    return;
                for (const e of a.get_effects?.() ?? [])
                    if (e.constructor.name === 'NativeDynamicBlurEffect')
                        blur = e;
                for (const c of a.get_children?.() ?? [])
                    visit(c);
            };
            visit(Main.layoutManager.uiGroup);
            if (!blur) {
                if (++this._ticks > 35) {
                    log('bmsprobe: FAIL — no blur effect ever appeared (BMS not attaching?)');
                    this._id = 0;
                    return GLib.SOURCE_REMOVE;
                }
                return GLib.SOURCE_CONTINUE;
            }

            let props = [];
            try {
                props = (blur.constructor?.list_properties?.() ?? blur.list_properties?.() ?? [])
                    .map(p => p.name);
            } catch (e) {
                log(`bmsprobe: list_properties failed: ${e.message}`);
            }
            log(`bmsprobe: live effect class=${blur.constructor.name} base=${Object.getPrototypeOf(blur.constructor).name}`);
            log(`bmsprobe: corner-radius property registered: ${props.includes('corner-radius')}`);
            log(`bmsprobe: blur props=[${props.join(', ')}]`);
            log(`bmsprobe: js r=${blur.unscaled_corner_radius} native cr=${blur.corner_radius}`);

            const dm = Main.panel.statusArea.dateMenu;
            const target = dm?.menu ?? dm?._menu ?? dm;
            target?.open?.();
            log(`bmsprobe: date menu ${target?.isOpen ? 'open' : 'NOT OPEN'} content=[${classes(target?.content ?? target)}] inline="${(target?.content ?? target)?.get_style?.() ?? ''}"`);

            const wg = Main.panel.statusArea['weatherglass@vijaybala.dev'];
            if (wg?.menu) {
                wg.menu.toggle();
                log(`bmsprobe: weatherglass popup ${wg.menu.isOpen ? 'open' : 'closed'}`);
            }

            const out = [];
            walk(Main.layoutManager.uiGroup, 0, out);
            log(`bmsprobe: scene graph (${out.length} nodes)`);
            for (const line of out)
                log('bmsprobe:   ' + line);
            log('bmsprobe: DONE');
            this._id = 0;
            return GLib.SOURCE_REMOVE;
        });
    }

    disable() {
        if (this._id)
            GLib.source_remove(this._id);
    }
}
