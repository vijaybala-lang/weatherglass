# EGO upload kit -- v6

Upload at: https://extensions.gnome.org/upload/
Artifact:  dist/weatherglass@vijaybala.dev.zip  (version 6; rebuilt from
master after every landed change -- record `sha256sum` at upload time and
verify the identical bytes live; zipcheck PASS is part of the rebuild).

## Before uploading (manual verification gate)

1. Install the exact artifact: `gnome-extensions install --force
   dist/weatherglass@vijaybala.dev.zip`, then compile the shipped
   schema: `glib-compile-schemas
   ~/.local/share/gnome-shell/extensions/weatherglass@vijaybala.dev/schemas`
   -- EGO compiles server-side, but a local zip ships only the XML and
   the extension dies at first `_init` with `GLib.FileError:
   gschemas.compiled: No such file or directory` (and the ERROR state
   latches until the next session). From a checkout, `./install.sh`
   already does this step.
2. One logout/login (GJS caches modules per process).
3. Walk the surface: panel + menu in dark and light theme, animated /
   solid / accent menu styles, hover + selected tiles (glow-family
   glyphs), prefs dialog. Spot-check with pixel forensics.
4. Reshoot the upload set + demo GIF from this verified build (see
   file names below); rehost both on the v6 GitHub release.

## Screenshots (upload in this order; all ~566x780, prefs is window-sized)

1. ego-ready/01-night-temperature.png  -- hero: night sky, moon, temp curve
2. ego-ready/06-day-sunny.png          -- sunny day, animated sun
3. ego-ready/07-rainy-precip.png       -- rainy day, glow-family raindrops
4. ego-ready/04-light-twilight.png     -- light-theme dusk wash
5. ego-ready/08-themed-dark.png        -- themed style, dark + accent blue
6. ego-ready/09-themed-light.png       -- themed style, light
7. ego-ready/05-preferences.png        -- prefs window, Display tab

## Video

Rehost on the GitHub release (tag v6): ~/Videos/Screencasts/ego/
Direct link for the EGO description:
https://github.com/vijaybala-lang/weatherglass/releases/download/v6/weatherglass-demo-card.mp4

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

Weather data from Open-Meteo (global), Met.no (ECMWF) and NOAA NWS - choose your favourite forecaster, no API keys needed. Location is automatic or a city you pick.

No accounts, no tracking, no analytics: requests go straight from your machine to the weather provider, and nothing is cached on disk.

Demo: https://github.com/vijaybala-lang/weatherglass/releases/download/v6/weatherglass-demo-card.mp4

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
- Schemas ship as XML only; gnome-extensions install compiles them.

## After approval

- The metadata "url" points at the GitHub repo per the EGO review
  guidelines (must be a GitHub/GitLab project URL) -- keep it there even
  after approval; link the EGO page from the repo README instead.
- Keep integer version bumps for every future upload (next: 7).
