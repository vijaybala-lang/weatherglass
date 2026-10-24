/* tests/guide.test.mjs -- EGO review-guidelines locks: every shipped module
 * is static-checked against the automatable rules of
 * https://gjs.guide/extensions/review-guidelines/best-practices.html so a
 * reviewer never finds one a second time (v6 shipped optional chaining
 * back into code v5 had cleaned). Rules are deliberately stricter than
 * "is this check semantically necessary": a reviewer greps for the token,
 * not the intent, so shipped code stays token-free.
 */
import { file, test, eq, ok, report } from './harness.mjs';
import Gio from 'gi://Gio';

file('guide');

const ROOT = Gio.File.new_for_uri(import.meta.url)
    .get_parent().get_parent().get_path();
const read = path => {
    const [success, bytes] = Gio.File.new_for_path(path).load_contents(null);
    ok(success, `unreadable: ${path}`);
    return new TextDecoder().decode(bytes);
};

// the shipped set: top-level modules, exactly what package.sh zips
const shipped = [];
const dir = Gio.File.new_for_path(ROOT);
const en = dir.enumerate_children('standard::name', Gio.FileQueryInfoFlags.NONE, null);
for (let info = en.next_file(null); info; info = en.next_file(null)) {
    const name = info.get_name();
    if (name.endsWith('.js'))
        shipped.push(name);
}
ok(shipped.length >= 10, `expected the full module set, found ${shipped.join(', ')}`);
const sources = Object.fromEntries(shipped.map(name =>
    [name, read(`${ROOT}/${name}`)]));

/* -- helpers ---------------------------------------------------------- */

// line-numbered regex scan; hits read "file:line: trimmed source"
const scan = (regex, files = shipped) => {
    const hits = [];
    for (const name of files)
        sources[name].split('\n').forEach((line, k) => {
            if (regex.test(line))
                hits.push(`${name}:${k + 1}: ${line.trim().slice(0, 88)}`);
        });
    return hits;
};

const silence = hits => ok(hits.length === 0,
    `${hits.length} violation(s):\n    ${hits.join('\n    ')}`);

// brace-match forward from an opening '{' index; returns the body
const matchedBrace = (src, openIndex) => {
    let depth = 0;
    for (let i = openIndex; i < src.length; i++) {
        if (src[i] === '{')
            depth++;
        else if (src[i] === '}' && --depth === 0)
            return src.slice(openIndex + 1, i);
    }
    throw new Error('unbalanced braces');
};

// catch clauses whose body says NOTHING AT ALL: a comment-only body is an
// informed, documented fallback (what reviewers flag is the bare swallow)
function silentCatches(name) {
    const src = sources[name];
    const hits = [];
    const at = index => `${name}:${src.slice(0, index).split('\n').length}`;
    const re = /\bcatch\b\s*(\([^()]*\))?\s*\{/g;
    let match;
    while ((match = re.exec(src))) {
        const body = matchedBrace(src, re.lastIndex - 1);
        if (body.trim() === '')
            hits.push(at(match.index) + ' (empty catch)');
    }
    const promise = /\.catch\(\s*(?:\([^()]*\)|\w+)\s*=>\s*\{\s*\}\s*\)/g;
    while ((match = promise.exec(src)))
        hits.push(at(match.index) + ' (empty .catch)');
    return hits;
}

/* -- avoid unnecessary checks ----------------------------------------- */

// weather.js reads provider JSON (Open-Meteo / Met.no / NOAA) whose fields
// are genuinely absent; the guide bans ?. on guaranteed methods and
// built-in APIs, which is every other module's only use of it
const CHAINING_EXEMPT = ['weather.js'];
test('no optional chaining in shell modules', () => {
    silence(scan(/\?\./, shipped.filter(n => !CHAINING_EXEMPT.includes(n))));
});

test('no runtime function-type checks', () => {
    silence(scan(/typeof\s[\w.$\[\]'"]+\s*[=!]==?\s*['"]function['"]|['"]function['"]\s*[=!]==?\s*typeof/));
});

test('no cross-version feature detection', () => {
    // the call(obj,'setFoo','set_foo') shim species: typeof probes on
    // MEMBERS and 'method' in obj -- the guide's remedy is one targeted
    // Shell version. Data-field !== undefined checks are deliberately
    // NOT flagged: no regex separates provider-JSON fields from API
    // methods, and that half stays the semantic audit's
    silence(scan(/typeof\s+\w+[.\[]|['"][\w.]+['"]\s+in\s+\w/));
});

test('no boolean lifecycle flags', () => {
    silence(scan(/this\._(?:is?)?(?:destroyed|disposed|enabled)\s*=\s*(?:true|false)/));
});

test('no silent catch blocks', () => {
    silence(shipped.flatMap(silentCatches));
});

test('no GtkWidget.destroy in prefs (GTK4 removed it)', () => {
    // prefs.js is the only Gtk4/Adw surface shipped; Gtk.Widget.destroy
    // does not exist there (Clutter actors in the shell modules still
    // have theirs). The call threw AFTER clearResults had spliced its
    // tracking array, orphaning the not-yet-removed search rows so
    // every later city search appended (#89 follow-up, journal-proven:
    // "TypeError: row.destroy is not a function"). Removal unparents;
    // that is the whole GTK4 idiom.
    silence(scan(/\.destroy\s*\(/, ['prefs.js']));
});

/* -- formatting and review hygiene ------------------------------------- */

test('lines stay within 200 characters', () => {
    const hits = [];
    for (const name of shipped)
        sources[name].split('\n').forEach((line, k) => {
            if (line.length > 200)
                hits.push(`${name}:${k + 1} (${line.length} chars)`);
        });
    silence(hits);
});

test('no emoji used as icons', () => {
    silence(scan(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}]/u));
});

/* -- subprocesses and D-Bus -------------------------------------------- */

test('no external process spawning', () => {
    silence(scan(/Gio\.Subprocess|GLib\.spawn|Subprocess\.new/));
});

/* -- settings schema lives in metadata ---------------------------------- */

test('schema id comes from metadata, not call sites', () => {
    const meta = JSON.parse(read(`${ROOT}/metadata.json`));
    ok(meta['settings-schema'], 'metadata.json must declare settings-schema');
    silence(scan(/getSettings\(\s*['"]/));
});

/* EGO renders donations from metadata; named platforms take bare
 * handles (a full URL would double-expand), and both handles have a
 * second home in prefs -- the copies must never drift. */
test('donation handles are bare and mirror prefs', () => {
    const meta = JSON.parse(read(`${ROOT}/metadata.json`));
    const allowed = ['buymeacoffee', 'custom', 'github', 'kofi',
        'liberapay', 'opencollective', 'patreon', 'paypal'];
    ok(meta.donations && typeof meta.donations === 'object',
        'metadata.json must declare donations');
    for (const [key, value] of Object.entries(meta.donations)) {
        ok(allowed.includes(key), `unknown donations key: ${key}`);
        const values = Array.isArray(value) ? value : [value];
        ok(values.length >= 1 && values.length <= 3,
            `donations.${key} must carry 1-3 values`);
        for (const v of values) {
            ok(typeof v === 'string' && v.length > 0,
                `donations.${key} values must be non-empty strings`);
            if (key !== 'custom')
                ok(!v.includes('/') && !v.includes(':'),
                    `donations.${key} must be a bare handle, not a URL`);
        }
    }
    const prefs = read(`${ROOT}/prefs.js`);
    const coffee = prefs.match(/buymeacoffee\.com\/([^'"]+)/);
    ok(coffee, 'prefs must carry the buymeacoffee link');
    eq(meta.donations.buymeacoffee, coffee[1]);
    const paypal = prefs.match(/paypal\.me\/([^'"]+)/);
    ok(paypal, 'prefs must carry the paypal link');
    eq(meta.donations.paypal, paypal[1]);
});

/* The prefs picker, the gschema choices and the gsettings default are
 * three lists the user can desync by touching one: a model id in prefs
 * but not gschema is a write the settings layer rejects (silent no-op),
 * a choice in gschema but not prefs is unreachable. One lock, both
 * directions, plus the label count so the ComboRow can never index a
 * missing row (v9 widened the picker; drift here is invisible until a
 * user hits it). */
test('the forecast-model picker mirrors the schema choices', () => {
    const prefs = read(`${ROOT}/prefs.js`);
    const xml = read(`${ROOT}/schemas/org.gnome.shell.extensions.weatherglass.gschema.xml`);
    const ids = [...prefs.matchAll(/const MODEL_IDS = \[([^\]]+)\]/g)][0][1]
        .split(',').map(s => s.trim().replace(/'/g, ''));
    const choices = [...xml.matchAll(/name="om-model"[\s\S]*?<choices>([\s\S]*?)<\/choices>/g)][0][1]
        .match(/value="([^"]+)"/g).map(m => m.slice(7, -1));
    eq(new Set(ids).size, ids.length);            // prefs list has no dupes
    eq(new Set(choices).size, choices.length);    // schema has no dupes
    for (const id of ids)
        ok(choices.includes(id), `prefs offers ${id} but gschema rejects it`);
    for (const c of choices)
        ok(ids.includes(c), `gschema allows ${c} but the picker hides it`);
    // every id needs a visible label at the same index
    const labels = [...prefs.matchAll(
        /title: _\('Forecast model'\)[\s\S]*?strings: \[([\s\S]*?)\]/g)][0][1]
        .match(/_\('[^']*'\)/g);
    eq(labels.length, ids.length);
    // the wide picker is the v9 feature: these models must be present
    for (const m of ['ecmwf_ifs', 'gem_global', 'jma_seamless',
                     'ukmo_global_deterministic_10km'])
        ok(ids.includes(m), `picker must expose ${m}`);
});

// the site copy is rendered from the manifest at upload time, so the
// kit's human-readable mirror must never drift from it (v6 saw the
// old upload-form text go stale twice, wording included)
test('upload kit mirrors the manifest description', () => {
    const meta = JSON.parse(read(`${ROOT}/metadata.json`));
    ok(typeof meta.description === 'string' && meta.description.length > 80,
        'manifest description must be the full pitch');
    ok(read(`${ROOT}/ego-upload-notes.md`).includes(meta.description),
        'ego-upload-notes.md must contain the manifest description verbatim');
});

// release HOW-TO lives in exactly one place: skills/weatherglass-release.
// AGENTS.md keeps the principles and must point there; the ego kit keeps
// only EGO-page material (description mirror, capture order, reviewer
// answers) -- command lines drift (the stale glib-compile-schemas gate
// outlived the bug that made it), and drift is cheap when one file owns
// them. (The release ritual itself -- GitHub release list + README
// link bump -- is the half an agent skipped at v7: this lock forces the
// ritual text to exist where the commands live.)
test('release ritual: skill owns commands, AGENTS points, kit stays prose', () => {
    const skill = read(`${ROOT}/skills/weatherglass-release/SKILL.md`);
    ok(/gh release create/.test(skill) && /gnome-extensions install/.test(skill) &&
        /extensions\.gnome\.org\/upload/.test(skill),
        'skill must carry the concrete commands (gh release, install, upload URL)');
    ok(/releases\/tag\//.test(skill) && /sha256sum/.test(skill),
        'skill must mandate the release-list/README link bump and the sha record');
    ok(/golden/i.test(skill) && /bless/i.test(skill),
        'skill must own the golden-lock meaning and bless discipline -- ' +
        'a release that blesses away a mismatch ships a visual regression');
    ok(/BEST-PRACTICES\.md/.test(skill) && /git diff --name-only/.test(skill),
        'skill must run the release-vs-release diff against BEST-PRACTICES.md -- ' +
        'the semantic EGO audit is exactly the scope between tags');
    ok(/agent installs/i.test(skill) && /logout\/login/.test(skill),
        'skill must assign the live install to the agent (mechanical) and ' +
        'leave the operator exactly the logout/login + surface walk');
    ok(/tools\/golden\/shell/.test(skill) && /screenshots are the goldens/i.test(skill),
        'upload imagery is the golden lock itself -- a second capture set ' +
        'is a second source of truth, and it rotted at v7');
    ok(/AGENTS\.md/.test(skill), 'AGENTS.md must be in the skill\'s contract');
    const agents = read(`${ROOT}/AGENTS.md`);
    ok(/skills\/weatherglass-release\/SKILL\.md/.test(agents),
        'AGENTS.md must reference the release skill');
    const pre = agents.slice(agents.indexOf('## Pre-upload release review'));
    ok(!/```sh/.test(pre),
        'AGENTS pre-upload section keeps prose principles, not commands (they rot there)');
    const kit = read(`${ROOT}/ego-upload-notes.md`);
    ok(!/```sh|gnome-extensions install|gh release|glib-compile-schemas/.test(kit),
        'ego-upload-notes.md must not carry command lines -- the skill owns those');
});

// Review rounds must not inflate the version counter: fixing reviewer
// findings produces new BYTES (new sha, re-certified, re-attached) but
// the same release. The skill must say so where the bump rule lives.
test('release ritual: addressing review comments never bumps the version', () => {
    const skill = read(`${ROOT}/skills/weatherglass-release/SKILL.md`);
    ok(/reviewer comments[\s\S]{0,400}same version/i.test(skill) ||
       /same version[\s\S]{0,400}reviewer comments/i.test(skill),
        'the version-bump step must state that responding to review ' +
        'comments or findings keeps the version integer unchanged');
});

// v8 resubmit lessons, pinned: the upload artifact must be a named file
// proven by sha (dist/ exists in every tree; a pre-commit rebuild nearly
// shipped as "the newest zip"), and re-canonicalizing goldens publishes
// the EGO screenshots + README gallery -- a human must approve those
// pixels before the bless commit lands.
test('release ritual: one proven artifact to upload, goldens need operator approval', () => {
    const skill = read(`${ROOT}/skills/weatherglass-release/SKILL.md`);
    ok(/release worktree/i.test(skill),
        'the upload step must name the canonical artifact location (the ' +
        'release worktree\'s dist/), not a bare relative dist/ path');
    ok(/operator approval/i.test(skill),
        'bless commits (new goldens = new public imagery) must require ' +
        'operator approval inside the skill');
});

// EGO serves one build per declared Shell major. A metadata slot is a
// promise that the exact shipped bytes were certified on that shell, and
// the harness companions must be loadable everywhere the product is.
test('release ritual: every declared shell owes a certification', () => {
    const expected = ['45', '46', '47', '48', '49', '50'];
    const meta = JSON.parse(read(`${ROOT}/metadata.json`));
    eq(JSON.stringify(meta['shell-version']), JSON.stringify(expected),
        'metadata must declare the certified GNOME Shell majors');
    for (const path of ['tools/harness/probe@vijaybala.dev/metadata.json',
                        'tools/menutest@vijaybala.dev/metadata.json']) {
        const harnessMeta = JSON.parse(read(`${ROOT}/${path}`));
        eq(JSON.stringify(harnessMeta['shell-version']), JSON.stringify(expected),
            `${path} must load on every certified shell`);
    }
    const allShells = read(`${ROOT}/tools/certify-all-shells.sh`);
    ok(/shell-version/.test(allShells) && /tools\/certify\.sh/.test(allShells) &&
        /tools\/qa\/run-old-shell\.sh/.test(allShells),
        'the all-shell gate must derive guest certs from metadata around host certify');
    const skill = read(`${ROOT}/skills/weatherglass-release/SKILL.md`);
    ok(/tools\/certify-all-shells\.sh/.test(skill),
        'the release ritual must run the all-shell certification gate');
    const practices = read(`${ROOT}/BEST-PRACTICES.md`);
    ok(/Support widens through metadata only/.test(practices),
        'the support policy must forbid version-branched product code');
});

// Step 0's audit gates live in the skill as runnable commands, not
// intentions: the dead-code sweep is a maintained tool (the hand-grep
// snippet it replaced covered only declaration-form exports and
// shipped a dead const + unused import for multiple releases), and
// the built artifact is diffed against the zip EGO actually serves.
test('release ritual: dead-code sweep and served-artifact diff are commands', () => {
    const skill = read(`${ROOT}/skills/weatherglass-release/SKILL.md`);
    ok(/tools\/dead-code-sweep\.py/.test(skill),
        'step 0 must run the maintained dead-code sweep tool');
    ok(/download-extension\//.test(skill) && /served/i.test(skill),
        'step 2 must diff the built zip against the served artifact');
    ok(/merge-base --is-ancestor/.test(skill),
        'the audit anchor must be ancestor-verified, never the newest tag blindly');
    const sweep = read(`${ROOT}/tools/dead-code-sweep.py`);
    ok(/export/.test(sweep) && /import/.test(sweep),
        'the sweep tool must exist and judge exports and imports');
});

// The README gallery is public imagery: if it hard-codes another branch,
// the homepage keeps showing that branch's goldens after the current
// ones move. Local assets must be branch-relative so the pixels a reader
// sees are the pixels in the tree they are browsing.
test('public gallery assets are branch-local, not pinned to a retired branch', () => {
    const readme = read(`${ROOT}/README.md`);
    const images = [...readme.matchAll(/<img\s+src="([^"]+)"/g)].map(m => m[1]);
    ok(images.length >= 50, `expected the full README gallery, found ${images.length} images`);
    const pinned = images.filter(src => /^https?:\/\//.test(src));
    ok(pinned.length === 0,
        `README gallery images must be branch-relative, pinned: ${pinned.slice(0, 3).join(', ')}`);
    for (const path of ['CONTRIBUTING.md', 'ego-upload-notes.md',
                        'skills/weatherglass-release/SKILL.md']) {
        ok(!/\bmaster\b/.test(read(`${ROOT}/${path}`)),
            `${path} must not route work through the retired master branch`);
    }
});

/* -- shexli findings from the v8 review (resubmit: same version) -------- */

// EGO-X-004: a synchronous read stalls the UI thread -- one user action
// can block the whole shell behind a disk. The consent-entry read moved
// to load_contents_async; shipped code reads asynchronously or not at all.
test('shipped modules stay off the synchronous file-read path', () => {
    silence(scan(/load_contents\s*\(|GLib\.file_get_contents\s*\(/));
});

// EGO-L-001: module scope must not create shell-side resources -- the
// providers live behind providerFor() as classes, instantiated lazily.
test('providers are constructed lazily, not at module scope', () => {
    silence(scan(/new (?:OpenMeteo|MetNorway|NoaaNws)Provider\s*\(/));
});

// EGO reviewer lock: no vfunc_map, vfunc_unmap, or vfunc_destroy on custom
// actor widgets. Actors react to visibility mapping via notify::mapped and
// implement explicit destroy() methods chained up to super.destroy().
test('no lifecycle virtual function overrides (vfunc_map/unmap/destroy)', () => {
    silence(scan(/\bvfunc_(?:map|unmap|destroy)\s*\(/));
});

/* -- enable/disable stay neighbours in the entry point ------------------ */

test('enable() and disable() are adjacent', () => {
    const src = sources['extension.js'];
    const enables = [...src.matchAll(/^\s+enable\(\)\s*\{/gm)];
    const disables = [...src.matchAll(/^\s+disable\(\)\s*\{/gm)];
    ok(enables.length === 1 && disables.length === 1,
        `entry point must own exactly one enable()/disable() pair, got ${enables.length}/${disables.length}`);
    const [first, second] = enables[0].index < disables[0].index
        ? [enables[0], disables[0]] : [disables[0], enables[0]];
    const between = src.slice(first.index, second.index).split('\n').slice(2);
    const stranger = between.find(line => /^\s{4}[\w#]+\s*\([^)]*\)\s*\{/.test(line));
    ok(!stranger, `method between enable() and disable(): ${stranger?.trim()}`);
});

report('guide');
