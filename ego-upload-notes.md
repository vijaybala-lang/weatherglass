# EGO upload kit -- v8

Upload at: https://extensions.gnome.org/upload/
Artifact:  dist/weatherglass@vijaybala.dev.zip  (version 8; rebuilt from
master after every landed change -- record `sha256sum` at upload time and
verify the identical bytes live; zipcheck PASS is part of the rebuild).

v8 ships the contrast fixes (#49) and the Today-morph fix (#50): night
strip/tile glyphs on bright grounds wear ink twins, and the new-moon
ghost is a visible slate disc. **The v7 screenshot set is stale by
construction** -- its night heroes were captured while the invisible
strip moons were still shipping. Never reuse any pre-v8 capture.

## Before uploading (manual verification gate)

1. Install the exact artifact: `gnome-extensions install --force
   dist/weatherglass@vijaybala.dev.zip`. Since v8 the zip itself carries
   `schemas/gschemas.compiled` (#53), so a runtime enable works without
   recompiling; from a checkout, `./install.sh` remains the normal path.
   (A manual `glib-compile-schemas
   ~/.local/share/gnome-shell/extensions/weatherglass@vijaybala.dev/schemas`
   is a harmless belt-and-braces -- pre-v8 zips shipped XML only and the
   extension died at first `_init` in a live session until the next
   login; that failure mode is closed, and its lesson is why the
   package stage now asserts the compiled file inside the zip.)
2. One logout/login (GJS caches modules per process).
3. Walk the surface: panel + menu in dark and light theme, animated /
   solid / accent menu styles, hover + selected tiles (glow-family
   glyphs), prefs dialog. Spot-check with pixel forensics.
4. Reshoot the upload set + demo GIF from this verified build (see
   file names below); rehost both on the v8 GitHub release.
5. Bump `metadata.json` to version 8 BEFORE the final `bash
   tools/certify.sh` + zip build -- the integer lives in the zip and
   EGO latches on it.

## Screenshots (upload in this order; all ~566x780, prefs is window-sized)

All must be captured from the verified v8 build (see gate 4 above) --
night cards changed with the ink-twin fix, so the v7 files under
ego-ready/ are history, not inputs:

1. ego-ready/01-night-temperature.png  -- hero: night sky, moon, temp curve
2. ego-ready/06-day-sunny.png          -- sunny day, animated sun
3. ego-ready/07-rainy-precip.png       -- rainy day, glow-family raindrops
4. ego-ready/04-light-twilight.png     -- light-theme dusk wash
5. ego-ready/08-themed-dark.png        -- themed style, dark + accent blue
6. ego-ready/09-themed-light.png       -- themed style, light
7. ego-ready/05-preferences.png        -- prefs window, Display tab

Optional card-only extras if EGO accepts more images: the golden suite
(`tools/golden/shell/`, byte-locked by CI) covers every scene day/night/
golden-hour, all eight moon phases, styles and cities -- the same cards
the repo README gallery shows. Prefer the live ego-ready set as the main
row: it shows the panel icon, which goldens crop out.

## Video

Rehost on the GitHub release (tag v8): ~/Videos/Screencasts/ego/
Direct link for the EGO description:
https://github.com/vijaybala-lang/weatherglass/releases/download/v8/weatherglass-demo-card.mp4

## Description text (for the EGO page)

**Canonical source: the `description` field in `metadata.json`.** EGO
renders the extension page from the uploaded zip's manifest, so every
upload replaces the site copy with the manifest's text -- the old
upload-form textarea is gone. Edit the pitch in the manifest (a PR, so
it stays reviewed); the mirror below is generated from the manifest and
must equal it verbatim.

Weather that lives in your top bar.

The panel icon animates with the sky outside - sun, drifting clouds, rain, snow, thunderstorms - beside a live temperature. Open the menu and the whole card is the sky: a live animated backdrop of drifting clouds, twinkling stars and falling precipitation, painted frame by frame.

What's inside:
* Animated menu backdrop with eleven scenes, from clear sun and moon to fog, sleet, hail and lightning
* Hourly chart: switch between temperature, precipitation or wind
* The moon carries the real lunar phase at night; sunrise and sunset bathe the card in golden-hour light
* Eight days of forecast tiles, current conditions at a glance
* 20 languages with full bidirectional support: the entire card mirrors in Arabic, Hebrew, Persian and Urdu
* Metric or imperial units, 12- or 24-hour clock, live scene previews in preferences
* Three backdrop styles: animated sky, solid, or theme background with accent charts

Weather data from Open-Meteo (global), Met.no (ECMWF) and NOAA NWS - choose your favourite forecaster, no API keys needed. Location: detected automatically through GNOME's own location service (IP lookup where none is available), or a city you pick.

No accounts, no tracking, no analytics: weather requests go straight from your machine to the provider you choose. Automatic detection prefers the system location service, with the standard GNOME prompt naming this extension; its IP-lookup and city-label fallbacks each contact one free keyless endpoint and are used only when needed. Nothing is cached on disk.

Demo: https://github.com/vijaybala-lang/weatherglass/releases/download/v8/weatherglass-demo-card.mp4

## Standing answers for the reviewer

- Try/catch: every remaining catch guards a genuinely throwing API
  (network sends, JSON parsing of provider payloads, Intl with odd
  locales, GSettings keys a distro schema may lack, Clutter transforms
  on unlinked actors). Removal is proven fatal by the nested-boot
  gate. The stylesheet load/unload blocks flagged last round are gone.
- Non-ASCII: only inside translatable strings on purpose (degree signs,
  locale typography); all decorative source glyphs are ASCII.
- Sky-painter one-letter names are cairo-loop graphics notation
  (cr, sx/sy, R), mirroring cairo docs idiom.
- Timer warning (EGO-L-004): false positive; the timeout is destroyed
  via the actor's destroy signal handler.
- Schemas: the zip ships both the XML source and the packaged-time
  `gschemas.compiled` (v8+, #53) so runtime enable works on every
  install path; EGO's server-side compile remains compatible.
- Automatic location (new in v7): GeoClue first (system service, standard
  GNOME consent prompt), public-IP lookup fallback with a second endpoint
  on failure, reverse-geocode used only to label coordinate-only fixes.
  One HTTP GET per detection (cached 30 min), all to documented keyless
  endpoints; disclosed in the manifest pitch and README Privacy.
- Desktop-entry registration: while automatic detection is ON, one
  NoDisplay, Exec-less entry ("Weatherglass", with X-Geoclue-Reason) is
  written to XDG data applications so the GNOME consent agent -- which
  only prompts for apps resolvable to a desktop file -- can name this
  extension honestly. Removed on toggle-off and on extension disable.
  No other writes outside the extension directory.
- Known limitation (consent agent): on our test platform (Fedora 44,
  GNOME 50.5, geoclue 2.8.2) the shell's GeoClue consent agent does not
  answer extension-originated requests at all -- not a deny, silence to
  the D-Bus timeout -- even with the desktop entry installed; upstream
  code says resolvable apps get the prompt, so this is a platform bug
  we are reporting, not a workaround. Where the agent does answer, the
  desktop entry yields the standard named prompt; where it does not,
  the attempt is capped at 5 s, falls back to the IP lookup (the
  pre-v7 behavior), and backs off -- never a hang, never a wrong label.

## After approval

- The metadata "url" points at the GitHub repo per the EGO review
  guidelines (must be a GitHub/GitLab project URL) -- keep it there even
  after approval; link the EGO page from the repo README instead.
- Keep integer version bumps for every future upload (next: 9).
