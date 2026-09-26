/* menutest — nested-shell test companion. Toggles the animated-weather
 * popup open/closed ten times, 1s apart, from right after boot: opening the
 * popup is exactly the allocate → synchronous repaint path that once aborted
 * the shell, so this extension turns that crash into a red/green test. */

import GLib from 'gi://GLib';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

const TOGGLES = 10;

export default class MenuTest extends Extension {
    enable() {
        this._n = 0;
        this._id = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 1, () => {
            const b = Main.panel.statusArea['animated-weather@vbala.dev'];
            if (!b?.menu) {
                log('menutest: status button not found');
                return GLib.SOURCE_REMOVE;
            }
            b.menu.toggle();
            this._n++;
            log(`menutest: toggle ${this._n} → ${b.menu.isOpen ? 'open' : 'closed'}`);
            if (this._n >= TOGGLES) {
                log('menutest: DONE, shell survived popup painting');
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
