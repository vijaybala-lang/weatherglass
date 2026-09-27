/* menutest — nested-shell test companion. Toggles the animated-weather
 * popup open/closed ten times, 1s apart, from right after boot: opening the
 * popup is exactly the allocate → synchronous repaint path that once aborted
 * the shell, so this extension turns that crash into a red/green test. */

import GLib from 'gi://GLib';
import Clutter from 'gi://Clutter';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

const TOGGLES = 10;
/* Our extension's import chain (i18n probing, Clutter/Shell typelibs) can
 * activate ~1-2 s after this one, so wait for the button instead of
 * declaring failure at the first second. Only a button that never shows
 * across the whole patience window counts as missing. */
const PATIENCE = 20;

export default class MenuTest extends Extension {
    enable() {
        this._n = 0;
        this._waited = 0;
        this._probed = false;
        this._id = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 1, () => {
            const b = Main.panel.statusArea['animated-weather@vbala.dev'];
            if (!b?.menu) {
                this._waited++;
                if (this._waited < PATIENCE)
                    return GLib.SOURCE_CONTINUE;
                log('menutest: status button not found');
                this._id = 0;
                return GLib.SOURCE_REMOVE;
            }
            b.menu.toggle();
            this._n++;
            log(`menutest: toggle ${this._n} → ${b.menu.isOpen ? 'open' : 'closed'}`);
            if (!this._probed && b.menu.isOpen && this._n >= 6) {
                /* RTL probe: which direction signal does a real Arabic
                 * session actually carry? Clutter looks at LANG (not
                 * LANGUAGE), St 18 dropped the query, GTK's varies by how
                 * the shell loaded it — so log GLib's language pick, the
                 * Clutter answer, and the truth (tile x order). */
                const panel = b._panel;
                let lang = 'n/a';
                try {
                    lang = GLib.get_application_language?.() ?? 'no-api';
                } catch (e) {
                    lang = `err:${e.message.slice(0, 30)}`;
                }
                const rtl = Clutter.get_default_text_direction() === Clutter.TextDirection.RTL;
                const row = panel?._daysGrid?.get_children()[0];
                const tiles = row ? row.get_children() : [];
                if (tiles.length >= 2) {
                    this._probed = true;
                    const [fx0] = tiles[0].get_transformed_position();
                    const [lx0] = tiles[tiles.length - 1].get_transformed_position();
                    const fx = Math.round(fx0);
                    const lx = Math.round(lx0);
                    const tdir = tiles[0].get_text_direction();
                    const dirName = tdir === Clutter.TextDirection.RTL ? 'RTL'
                        : tdir === Clutter.TextDirection.LTR ? 'LTR' : String(tdir);
                    log(`menutest: lang=${lang} clutterRtl=${rtl} tileDir=${dirName} ` +
                        `first-tile.x=${fx} last-tile.x=${lx} ` +
                        `mirrored=${tdir === Clutter.TextDirection.RTL ? lx < fx : fx < lx}`);
                } else if (this._n >= TOGGLES - 1) {
                    this._probed = true;
                    log(`menutest: lang=${lang} clutterRtl=${rtl} ` +
                        `(tiles never built: ${tiles.length}, panel=${!!panel})`);
                }
            }
            if (this._n >= TOGGLES) {
                log('menutest: DONE, shell survived popup painting');
                this._id = 0;
                return GLib.SOURCE_REMOVE;
            }
            return GLib.SOURCE_CONTINUE;
        });
    }

    disable() {
        if (this._id)
            GLib.source_remove(this._id);
    }
}
