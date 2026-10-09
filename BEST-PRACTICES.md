# Weatherglass — GJS & EGO Best Practices

Distilled from the official [EGO Review Guidelines][rg] and [Extension
Best Practices][bp] — the two documents extensions.gnome.org reviewers
apply. Read the originals when anything here is unclear; this file is
the working checklist, not a replacement.

[rg]: https://gjs.guide/extensions/review-guidelines/review-guidelines.html
[bp]: https://gjs.guide/extensions/review-guidelines/best-practices.html

## Lifecycle (the three review rules)

1. Nothing happens before `enable()`: module top-level may only hold
   static data (plain JS objects, `Map`, regexes) — no GObjects, no
   signals, no sources, no shell modification at import time.
2. `enable()` creates objects, connects signals, adds main-loop
   sources. `disable()` undoes **everything** enable() did: destroy
   every object, disconnect every signal, remove every source — even
   ones whose callback would eventually return `SOURCE_REMOVE`.
3. Each class cleans up its own resources (soup session, cancellable,
   timers, signals). Cleanup initialized in one class and performed in
   another is a review red flag.

Mechanics:

- `enable()` and `disable()` stay adjacent in the class so reviewers
  can diff them at a glance.
- Keep timer removal adjacent to timer creation: remove the previous
  source id immediately before creating a new one.
- No `this._destroyed`-style boolean guards; after `destroy()` the
  reference is nulled and never used again.
- Custom `destroy()` order: remove sources → disconnect signals →
  release children → `super.destroy()` last.
- No `GObject.Object.run_dispose()` unless truly unavoidable (and then
  with a comment proving why).

## Process isolation

- Shell process (`extension.js` and its modules): never import `Gtk`,
  `Gdk`, or `Adw`.
- Preferences (`prefs.js`): never import `St`, `Clutter`, `Meta`,
  `Shell`.
- Modules shared between both (e.g. `weather.js` utilities) must
  import none of the above.
- prefs-only UI belongs in clearly separated code so reviewers see it.

## Modern GJS

- ES6 classes, `async`/`await`, `GObject.registerClass`.
- No deprecated modules: `ByteArray` → `TextDecoder`/`TextEncoder`;
  `Lang` → classes + `bind()`; `Mainloop` → `GLib.timeout_*`.
- Target one GNOME series cleanly (we target 50) — no version-spanning
  feature detection.

## Clean, reviewable code

- No unnecessary `try`/`catch`: `destroy()`, `connect()`,
  `disconnect()`, `GLib.Source.remove()`, `abort()` do not throw.
  Wrap only genuine throwers (network, JSON parse, file I/O) — and
  only the statement that throws. GSettings `get_*` is also a real
  thrower: a key missing from the resolved schema raises a GError,
  so the theme-watcher guards around `org.gnome.desktop.interface`
  stay (zipcheck proved removal crashes extension load).
- No `fn?.()` optional calls or `typeof x === 'function'` guards on
  guaranteed APIs. The one legal `?.`: optional FIELDS of external
  provider JSON (`weather.js` reads Open-Meteo/Met.no/NOAA payloads
  that genuinely omit keys) — never "clean" those away, and never use
  `?.` on shell objects or our own modules (the `guide` lock enforces
  the allowlist).
- No copy-pasted blocks: equal or near-equal logic in two places
  becomes a helper function.
- Comments explain *why*, never narrate syntax; self-explanatory
  names over line-by-line translation comments.
- Max line length 200; consistent indentation and style throughout.
- No logging in paint/tick paths; logs are for important errors only.
- No minification/obfuscation; no placeholder stubs; no imaginary API
  usage — every call must be explainable to a reviewer (EGO rejects
  what smells like unreviewed AI output).

## Settings & metadata

- Schema id `org.gnome.shell.extensions.<name>`, path
  `/org/gnome/shell/extensions/<name>`; the `<schema-id>.gschema.xml`
  file ships in the ZIP.
- `"settings-schema"` lives in `metadata.json`; entry point calls
  `this.getSettings()` with no arguments — no schema-id constants
  repeated across files.
- `metadata.json` carries no unnecessary keys; `shell-version` lists
  stable releases (plus at most one development release); `url` points
  at the public repo; `uuid` is `id@namespace` of letters, digits,
  `.`, `_`, `-`.

## ZIP contents

Ship exactly what runs: `extension.js`, peer modules, `prefs.js`,
`stylesheet.css`, `metadata.json`, schema XML (+ its `gschemas.compiled`),
`locale/` binaries. Never ship: `.po`/`.pot`, `tools/`, `dist/`
scratch, build scripts, screenshots/GIFs, unused icons or media.

## Forbidden by policy

- Telemetry or any user tracking shared online.
- External binaries/scripts (GJS only; prefer D-Bus over spawning);
  privileged subprocesses via anything but `pkexec`, never on a
  user-writable script.
- Clipboard access without declaring it in the description.
- Copyrighted/trademarked assets (brand names, logos, art) without
  written permission.
- Interfering with the extension system / other extensions
  (case-by-case rejection).
- `unlock-dialog` session mode without necessity + a comment in
  `disable()`.
