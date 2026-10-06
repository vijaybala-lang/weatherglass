/* tools/syntax-check.mjs -- parse every project module. With no arguments
 * it checks all top-level *.js (the shipped set); pass files explicitly to
 * check a subset. Import failures from missing GI typelib/resource modules
 * are EXPECTED outside gnome-shell and still mean the file parsed; a
 * SyntaxError or a missing file is a hard failure. */

import GLib from 'gi://GLib';
import Gio from 'gi://Gio';

let files = ARGV.slice();
if (files.length === 0) {
    const dir = Gio.File.new_for_path(GLib.get_current_dir());
    const en = dir.enumerate_children('standard::name', Gio.FileQueryInfoFlags.NONE, null);
    for (let info = en.next_file(null); info; info = en.next_file(null)) {
        const name = info.get_name();
        if (name.endsWith('.js'))
            files.push(name);
    }
    files.sort();
}
if (files.length === 0) {
    console.log('FAILED: no files to check (run from the project root)');
}
let bad = 0;
for (const f of files) {
    const uri = GLib.filename_to_uri(GLib.build_filenamev([GLib.get_current_dir(), f]), null);
    try {
        await import(uri);
        console.log(`OK        ${f}`);
    } catch (e) {
        const s = String(e);
        if (e instanceof SyntaxError || /SyntaxError/.test(s)) {
            console.log(`SYNTAX    ${f}\n            ${s}`);
            bad++;
        } else if (s.includes(uri)) {
            // the message names the checked URI itself: it could not be read
            console.log(`MISSING   ${f}`);
            bad++;
        } else {
            console.log(`parsed    ${f}  (link/eval: ${s.split('\n')[0]})`);
        }
    }
}
console.log(bad ? `FAILED: ${bad} file(s) with syntax errors` : `ALL PARSED (${files.length})`);
