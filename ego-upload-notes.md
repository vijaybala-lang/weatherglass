# EGO upload kit -- v5

Upload at: https://extensions.gnome.org/upload/
Artifact:  dist/weatherglass@vijaybala.dev.zip  (version 5, ~188K, zipcheck PASS)

## Screenshots (upload in this order; all ~566x780, prefs is window-sized)

1. ego-ready/01-night-temperature.png  -- hero: night sky, moon, temp curve
2. ego-ready/04-light-twilight.png     -- light-theme dusk wash (shows theme care)
3. ego-ready/02-night-precipitation.png
4. ego-ready/03-night-wind.png         -- new two-way labels (post-fix)
5. ego-ready/05-preferences.png        -- prefs window, Display tab

## Video

~/Videos/Screencasts/ego/weatherglass-demo-card.mp4  (5.7 s, 124 KB, card-cropped)
EGO does not host video: host it yourself (e.g. GitHub repo release or any
file host) and paste the link at the bottom of the description ("Demo:").

## Description text (for the EGO page)

Weatherglass puts a live forecast in the top panel. The panel icon animates
with the current conditions, and the dropdown shows an animated sky, an
hourly chart of temperature, precipitation or wind, and a seven-day outlook
with per-day weather. Forecasts come from Open-Meteo or NOAA NWS; no API
key or account is needed. Location is taken from GeoClue or set by hand.

The menu follows the system light/dark style, adapts its ink to the
background for readability, and supports metric or imperial units, 12/24
hour clocks and 20 languages.

Demo: <video link>

## Reply to reviewer (paste in the review thread)

Thanks for the review -- addressed as follows:

- Unnecessary try/catch: the two blocks around load_stylesheet/unload_-
  stylesheet are gone (those calls don't throw). The remaining catches each
  guard a genuinely throwing API (DBus/portal calls, texture loading, JSON
  parsing of provider payloads, GLib.File operations on stale paths) where
  an uncaught exception would kill the paint loop or leak a stuck spinner.
- Mojibake: all decorative non-ASCII (box-drawing, arrows, em-dashes) in
  code comments, README and LICENSE were replaced with ASCII equivalents.
  The non-ASCII that remains is inside translatable strings on purpose
  (degree signs in C/F, ellipsis, dashes in prose). Those are gettext
  catalog keys used by 20 language translations; ASCII-fying them would
  invalidate every published translation and downgrade the typography in
  the UI itself.
- Sky painter identifier style: the one-letter names there are graphics
  notation local to a cairo hot loop (cr for the context, sx/sy for sampled
  curve points, R for the scene radius), mirroring cairo docs idiom rather
  than hiding meaning.
- The timer warning (EGO-L-004) is a false positive: the timeout is
  destroyed via a signal handler connected to the actor's destroy; it does
  not leak across disable().
- Schemas ship as XML only; gnome-extensions install compiles them.

## After approval

- The metadata "url" points at the GitHub repo per the EGO review
  guidelines (must be a GitHub/GitLab project URL) -- keep it there even
  after approval; link the EGO page from the repo README instead.
- Keep integer version bumps for every future upload (v6 next upload).
