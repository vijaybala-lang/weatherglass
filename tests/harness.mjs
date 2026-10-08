/* tests/harness.mjs -- micro test runner for plain-gjs unit tests.
 * No shell, no St, no browser: the modules under test (chart, painter,
 * sky, weather) are pure gi://cairo/gi://gio, so `gjs -m tests/x.test.mjs`
 * runs them directly. Exits non-zero on any failure so certify.sh can
 * gate a release on it.
 */

const failures = [];
let passed = 0;
let currentFile = 'unit';

export const file = name => { currentFile = name; };

export function test(name, fn) {
    try {
        fn();
        passed++;
        console.log(`  ok  ${currentFile}/${name}`);
    } catch (err) {
        failures.push(`${currentFile}/${name}: ${err.message}`);
        console.log(`  FAIL ${currentFile}/${name}: ${err.message}`);
    }
}

export function ok(cond, msg = 'assertion failed') {
    if (!cond)
        throw new Error(msg);
}

export function eq(actual, expected, msg = '') {
    if (actual !== expected)
        throw new Error(`${msg} expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

export function near(actual, expected, tol, msg = '') {
    if (!(Math.abs(actual - expected) <= tol))
        throw new Error(`${msg} expected ${expected}±${tol}, got ${actual}`);
}

export function report(label) {
    console.log(`${label}: ${passed} passed, ${failures.length} failed`);
    if (failures.length) {
        for (const f of failures)
            console.log(`  ✗ ${f}`);
        // uncaught throw -> gjs exits non-zero, which is what certify reads
        throw new Error(`${failures.length} test failure(s)`);
    }
}

/* WCAG (gamma-corrected) luminance -- intentionally a local re-implementation:
 * tests must not trust the code under test to check its own space */
export const lumOfPlain = rgb =>
    0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2];
