# shexli 0.2.1: deterministic SIGSEGV analysing any package whose files exceed ~255 comments (blocks EGO auto-review)

**Environment tested:** x86_64 — Fedora (host, python 3.14) and `python:3.12-slim`
containers; `shexli==0.2.1` (only release on PyPI), `tree-sitter==0.26.0`,
`tree-sitter-javascript==0.25.0`.

**Symptom:** `shexli <package>` always exits 139 (SIGSEGV, core dumped) after
~1s when a package contains a JS file with ≥ 255 comment nodes. Fewer comments
→ normal analysis, exit 0/1.

## Minimal repro

Two-file package (`make_repro.sh` in this directory, argument = comment count):

```sh
./make_repro.sh 254 && podman run --rm -v /tmp/shexli-repro:/w:ro,z shexli:1 shexli /w
# shexli: clean (0 findings, 0 errors, 0 warnings)   rc=0

./make_repro.sh 255 && podman run --rm -v /tmp/shexli-repro:/w:ro,z shexli:1 shexli /w
# Segmentation fault (core dumped)                    rc=139
```

`extension.js` is just:

```js
import GLib from 'gi://GLib';
export const a = 1;
// × 255
export const b = 2;
```

The threshold moves slightly with code volume (real-world files with ~40–130
comment nodes segfault too — the limit looks like ~255 **query matches per
file**, comments being the easily-isolated contributor), and `//` vs `/* */`
behaves the same.

## Evidence it's not our files / not the grammar

* tree-sitter alone parses all affected files cleanly (`root_node.has_error
  == False`), so tree-sitter-javascript itself is fine.
* The crash point is a shallow Python stack (faulthandler):

  ```
  Fatal Python error: Segmentation fault
    File "pathlib.py", line 840, in stat
    File "shexli/analyzer/reachability.py", line 55, in resolve_local_import
    File "shexli/analyzer/reachability.py", line 395, in reachable_js_contexts
    File "shexli/analyzer/core.py", line 162, in analyze_path
  ```

  i.e. corruption surfacing wherever execution happens to be — not recursion
  (a 64 MB stack segfaults identically).

## Real-world impact

Our extension (Weatherglass, pending first EGO upload) segfaults the analyzer
on 5 of its 10 JS files; several published extensions surely sit over the
threshold too — and since extensions-web runs shexli on every upload, this
will reject/crash reviews for perfectly fine packages.

Happy to help bisect further — the 254/255 boundary is trivially reproducible.
