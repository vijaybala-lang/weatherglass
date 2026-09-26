/* tools/imports-check.mjs — smoke-import every module that does not need
 * shell resources (resource:///) to prove they at least parse and link.
 * From the project root:  gjs -m tools/imports-check.mjs
 */

for (const m of ['weather', 'chart', 'sky', 'painter', 'menu']) {
    import(`../${m}.js`)
        .then(() => print(`${m}: ok`))
        .catch(e => print(`${m}: FAIL ${e.message}`));
}
