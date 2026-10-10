/* tests/guide.test.mjs -- EGO review-guidelines locks: every shipped module
 * is static-checked against the automatable rules of
 * https://gjs.guide/extensions/review-guidelines/best-practices.html so a
 * reviewer never finds one a second time (v6 shipped optional chaining
 * back into code v5 had cleaned). Rules are deliberately stricter than
 * "is this check semantically necessary": a reviewer greps for the token,
 * not the intent, so shipped code stays token-free.
 */
import { file, test, ok, report } from './harness.mjs';
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
