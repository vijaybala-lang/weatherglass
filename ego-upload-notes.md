# EGO upload kit -- v6

Upload at: https://extensions.gnome.org/upload/
Artifact:  dist/weatherglass@vijaybala.dev.zip  (version 6, ~184K, zipcheck PASS)

## Before uploading (manual verification gate)

1. Install the exact artifact: `gnome-extensions install --force
   dist/weatherglass@vijaybala.dev.zip`
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

Weatherglass puts a live forecast in the top panel. The panel icon animates
with the current conditions, and the dropdown shows an animated sky, an
hourly chart of temperature, precipitation or wind, and a seven-day outlook
with per-day weather. Forecasts come from NOAA NWS, Met.no or Open-Meteo;
no API key or account is needed. Location is taken from GeoClue or set by
hand.

The menu follows the system light/dark style, adapts its ink and glyph
glow to the background for readability, and supports metric or imperial
units, 12/24 hour clocks and 20 languages.

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
