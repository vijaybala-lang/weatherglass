import GLib from 'gi://GLib';

const files = ARGV;   // GJS ARGV holds arguments after the script name
let bad = 0;
for (const f of files) {
    const uri = GLib.filename_to_uri(GLib.build_filenamev([GLib.get_current_dir(), f]), null);
    try {
        await import(uri);
        console.log(`OK        ${f}`);
    } catch (e) {
        const s = String(e);
        // Missing GI typelib / resource is EXPECTED outside gnome-shell and
        // still means the file parsed. A SyntaxError is a real bug.
        if (e instanceof SyntaxError || /SyntaxError/.test(s)) {
            console.log(`SYNTAX    ${f}\n            ${s}`);
            bad++;
        } else {
            console.log(`parsed    ${f}  (link/eval: ${s.split('\n')[0]})`);
        }
    }
}
console.log(bad ? `FAILED: ${bad} file(s) with syntax errors` : 'ALL PARSED');
