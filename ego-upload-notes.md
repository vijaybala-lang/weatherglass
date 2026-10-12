# EGO upload kit -- v8

The release ritual (every command, in order: review, bump, certify,
GitHub release, live gate, captures, publish, README links, upload)
lives in `skills/weatherglass-release/SKILL.md`. This kit holds only
EGO-page material: the artifact identity, the capture list, the
canonical description block, and the standing reviewer answers.

Upload at: https://extensions.gnome.org/upload/
Artifact:  dist/weatherglass@vijaybala.dev.zip  (version 8; rebuilt from
master after every landed change -- its `sha256sum` is recorded in the
GitHub release body, and the EGO-served bytes must match).

v8 ships the contrast fixes (#49) and the Today-morph fix (#50): night
strip/tile glyphs on bright grounds wear ink twins, and the new-moon
ghost is a visible slate disc. The upload imagery is the goldens, so
the v7-era lesson -- live-photo sets that "photograph whatever bugs
shipped then" -- no longer applies: see skill step 5.

## Before uploading (manual verification gate)

The full gate is skill steps 1-6; in short: bump the manifest integer
before the final build, certify the release commit, install the exact
artifact, one logout/login, walk panel + menu in dark/light theme, all
three backdrop styles, hover + selected tiles and prefs, then record
the demo video from this build and rehost it on the v8 GitHub release
-- byte-identical zip verified = zip uploaded. Screenshots need no
reshoot at all: they are the goldens below.

## Screenshots (upload in this order -- the goldens themselves, prefs last)

Upload imagery IS the golden lock (`tools/golden/shell/`, byte-diffed
by CI; rationale in skill step 5). These replace the old live-photo
set entirely -- the one honest exception is the prefs window, which
goldens (cards) cannot photograph:

1. cov-clear-night.png       -- hero: night sky, moon, temperature curve
2. cov-clear-day.png         -- clear day, ink glyphs on the bright foot
3. cov-clear-descent-early.png   --} golden hour as a passage:
4. cov-clear-golden.png          --}  same Berlin evening at four clock
5. cov-clear-descent-afterglow.png --}  readings (night glyphs flip
6. cov-clear-descent-twilight.png  --}  family mid-strip)
7. cov-storm-night.png       -- lightning + glow-family rain at night
8. cov-moon-new-day.png      -- the new moon as a visible dark disc
9.  style-solid-dark.png     --} backdrop styles: solid and accent,
10. style-solid-light.png    --}  each in dark and light themes
11. style-accent-dark.png    --}
12. style-accent-light.png   --}
13. screenshots/05-preferences.png -- prefs window (window-sized)

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
