/* hoverprobe -- ground truth for ink/hover styling inside a real (headless)
 * Shell 50 session. Grabs weatherglass' own tab/day buttons off the panel
 * object (St 18 style classes turned out to be write-only CSS hooks), then
 * prints:
 *   ink ...    what the live per-pixel referee decided per header element,
 *              with the backdrop samples it judged (luminance + raw rgb)
 *   tab/HOVER  resolved background under set_hover (stylesheet proof)
 * Retries until the popup is laid out; DONE is logged only when the ink
 * dump has actually settled -- the harness kills the shell on DONE. */
import GLib from 'gi://GLib';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

export default class extends Extension {
    enable() {
        this._n = 0;
        this._id = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 1, () => {
            const b = Main.panel.statusArea['weatherglass@vijaybala.dev'];
            // the card is built after the first forecast lands -- poll like
            // menutest does rather than assume an 8 s world is ready
            const panel = b?._panel ?? null;
            const tab = panel?._tabBtns
                ? Object.values(panel._tabBtns)[0] : null;
            const day = panel?._dayBtns?.[0] ?? null;
            if (!tab || !day) {
                if (b?.menu && !b.menu.isOpen)
                    b.menu.open();
                if (++this._n > 30) {
                    log(`hoverprobe: not found btn=${!!b} panel=${!!panel}`);
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
                const [r, g, bl, a] = [c.red, c.green, c.blue, c.alpha];
                return r === undefined ? String(c)
                    : `rgba(${Math.round(r * 255)},${Math.round(g * 255)},` +
                      `${Math.round(bl * 255)},${a.toFixed(2)})`;
            };
            const dump = (tag, a) => {
                let bg = 'n/a';
                try {
                    const c = a.get_theme_node().get_background_color();
                    bg = fmt(c[1] ?? c);
                } catch (e) { bg = `err ${e.message.slice(0, 40)}`; }
                log(`hoverprobe: ${tag}: hover=${a.get_hover?.() ?? '?'} bg=${bg}`);
            };
            const lum = px => {
                const s = px.map(v => v <= 0.03928
                    ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
                return (0.2126 * s[0] + 0.7152 * s[1] + 0.0722 * s[2])
                    .toFixed(2);
            };

            tab.set_hover(true);
            day.set_hover(true);

            // ink dump: retry until the popup is laid out AND the referee
            // has painted (_awInk set); finish() then emits the hover dumps
            // and DONE -- DONE must be LAST or the harness kills too early
            let tries = 0;
            const dumpInk = finish => {
                if (!b.menu.isOpen)
                    b.menu.open();
                const bgsOf = a => panel._bgsOf(a);
                const any = Object.values(panel._tabBtns ?? {})
                    .some(btn => bgsOf(btn).length);
                const inked = tab._awInk !== undefined;
                if ((!any || !inked) && ++tries < 15) {
                    GLib.timeout_add(GLib.PRIORITY_DEFAULT, 400, () => {
                        dumpInk(finish);
                        return GLib.SOURCE_REMOVE;
                    });
                    return;
                }
                log(`hoverprobe: settled tries=${tries} ` +
                    `open=${b.menu.isOpen} inked=${inked}`);
                for (const [k, btn] of Object.entries(panel._tabBtns ?? {})) {
                    const bgs = bgsOf(btn);
                    log(`hoverprobe: ink tab ${k}: ` +
                        `css=[${btn._awInk ?? 'n/a'}] n=${bgs.length} ` +
                        `lum=[${bgs.map(lum).join(',')}] ` +
                        `raw=${JSON.stringify(bgs[0] ?? null)}`);
                }
                for (const [n, a] of [['clock', panel._clockLbl],
                                      ['city', panel._cityLbl],
                                      ['temp', panel._tempLbl]])
                    log(`hoverprobe: ink ${n}: ` +
                        `css=[${a?._awInk ?? 'n/a'}] ` +
                        `lum=[${(bgsOf(a) ?? []).map(lum).join(',')}]`);
                (panel._ghostIcons ?? []).forEach((ic, i) =>
                    log(`hoverprobe: ink ghost${i}: ` +
                        `css=[${ic._awInk ?? 'n/a'}] ` +
                        `lum=[${bgsOf(ic).map(lum).join(',')}]`));
                finish();
            };

            GLib.timeout_add(GLib.PRIORITY_DEFAULT, 400, () => {
                dumpInk(() => {
                    dump('tab/HOVER', tab);
                    dump('day/HOVER', day);
                    log('hoverprobe: DONE');
                });
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
