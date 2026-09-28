/* hoverprobe — ground truth for hover styling inside a real (headless)
 * Shell 50 session. Grabs weatherglass' own tab/day buttons off the panel
 * object (St 18 style classes turned out to be write-only CSS hooks), then
 * prints each button's resolved theme node at rest and under set_hover:
 * which background-color actually lands tells us whether any theme rule
 * paints our custom controls at all — and after our own stylesheet loads,
 * whether -st-accent-color resolves. */
import GLib from 'gi://GLib';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

export default class extends Extension {
    enable() {
        this._n = 0;
        this._id = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 1, () => {
            const b = Main.panel.statusArea['weatherglass@vijaybala.dev'];
            // the card is built after the first forecast lands — poll like
            // menutest does rather than assume an 8 s world is ready
            const panel = b?._panel ?? null;
            const tab = panel?._tabBtns
                ? Object.values(panel._tabBtns)[0] : null;
            const day = panel?._dayBtns?.[0] ?? null;
            if (!tab || !day) {
                if (b?.menu && !b.menu.isOpen)
                    b.menu.open();
                if (++this._n > 30) {
                    const btn = panel?._tabBtns?.temp ?? null;
                    const chain = [];
                    for (let a = btn; a && chain.length < 9; a = a.get_parent())
                        chain.push(`${a.type()}[${(a.get_style_classes?.() ?? [])
                            .join('+')}]`);
                    log(`hoverprobe: not found panel=${!!panel} ` +
                        `tabBtn=${!!btn} chain: ${chain.join(' <- ')}`);
                    this._id = 0;
                    return GLib.SOURCE_REMOVE;
                }
                return GLib.SOURCE_CONTINUE;
            }
            this._id = 0;
            const fmt = c => {
                if (c === null || c === undefined)
                    return String(c);
                if (c.to_string)
                    return c.to_string();
                const [r, g, b, a] = [c.red ?? c.red8, c.green, c.blue, c.alpha];
                return r === undefined ? String(c)
                    : `rgba(${Math.round(r * 255)},${Math.round(g * 255)},` +
                      `${Math.round(b * 255)},${a.toFixed(2)})`;
            };
            const dump = (tag, a) => {
                const n = a.get_theme_node();
                let bg = 'n/a';
                try {
                    const c = n.get_background_color();
                    bg = fmt(c[1] ?? c);
                } catch (e) { bg = `err ${e.message.slice(0, 40)}`; }
                const hov = a.get_hover ? a.get_hover() : '?';
                log(`hoverprobe: ${tag}: hover=${hov} bg=${bg}`);
            };
            log(`hoverprobe: tab classes: ` +
                `[${(tab.get_style_classes?.() ?? []).join(' ')}]`);
            const g = panel._content.get_layout_manager ?
                panel._content.get_paint_volume() : null;
            const [cx, cy] = panel._content.get_size();
            const [tw, th] = tab.get_size();
            log(`hoverprobe: card=${Math.round(cx)}x${Math.round(cy)} ` +
                `tab=${Math.round(tw)}x${Math.round(th)} vol=${!!g}`);
            dump('tab/plain', tab);
            dump('day/plain', day);
            tab.set_hover(true);
            day.set_hover(true);
            GLib.timeout_add(GLib.PRIORITY_DEFAULT, 400, () => {
                dump('tab/HOVER', tab);
                dump('day/HOVER', day);
                log('hoverprobe: DONE');
                return GLib.SOURCE_REMOVE;
            });
            return GLib.SOURCE_REMOVE;
        });
    }
    disable() {
        if (this._id)
            GLib.source_remove(this._id);
    }
}
