# Weatherglass — animated weather for GNOME Shell

A little window onto the sky. A small cairo-animated scene (sun, moon,
partly, cloud, fog, wind, rain, sleet, snow, hail, storm…) lives next to
the current temperature in your panel; clicking it opens a forecast card
with a live animated sky, an hourly chart (temperature, precipitation or
wind), and eight days of tiles.

- **Data models:** Open-Meteo (global), MET Norway (ECMWF AIFS) and NOAA
  NWS — pick your favourite forecaster in prefs; no API key for any of them
- **Location:** automatic (GeoClue or IP-based) or city search / manual
  coordinates
- **20 languages** including RTL (Arabic, Hebrew, Persian, Urdu); the whole
  card mirrors in RTL sessions
- 12- or 24-hour clock, bolder/larger chart text, panel-icon toggles,
  live scene previews in preferences
- Animations drawn with cairo on `St.DrawingArea` (~20 fps, pauses when
  unmapped), HiDPI aware, adaptive ink for legibility over any sky
- GNOME Shell **50** (ES modules)

## Install

The easiest way is the Extensions app (or https://extensions.gnome.org):
toggle Weatherglass on and you're done. From a checkout:

```sh
./install.sh
```

Then tweak it from the panel icon → ⚙ (or
`gnome-extensions prefs weatherglass@vijaybala.dev`).

## Uninstall

```sh
gnome-extensions disable weatherglass@vijaybala.dev
rm -rf ~/.local/share/gnome-shell/extensions/weatherglass@vijaybala.dev
```

## Layout

| file | role |
|---|---|
| `painter.js` | pure cairo scene painter (all icon animation logic) |
| `sky.js` | the animated menu sky (drift, particles, aurora, lightning) |
| `chart.js` | hourly curve, labels and condition strip |
| `animation.js` | panel-icon `St.DrawingArea` frame driver |
| `weather.js` | provider adapters (Open-Meteo / MET Norway / NOAA), WMO → scenes, formatting |
| `menu.js` | the dropdown card |
| `extension.js` | panel button, timers, settings glue |
| `prefs.js` | Adw preferences window |
| `moon.js` | moon phases |
| `tools/preview.mjs` | renders every scene to PNG outside the shell (`gjs -m tools/preview.mjs`) |

## Editing the code? Restart the shell session

GNOME Shell 50 caches an extension's ES modules inside the long-lived
`gnome-shell` process. `gnome-extensions disable/enable` (and even the
Extensions app's toggle) re-run `enable()` on the **already-imported** module
objects — they do **not** re-read `weather.js`, `menu.js`, etc. from disk. So
after editing any file, **log out and back in** (Wayland can't Alt-F2 restart).
The prefs window is exempt: it runs in a fresh process each time you open it.

The `Weatherglass v…` line in `journalctl --user -o cat` tells you which
build the running shell actually loaded.

## Scenes & how they map to real weather

Eleven animated scenes, chosen by the scene picker in `weather.js`. A WMO
weather code is the primary signal, but a few scenes are *under-reported* by
the code alone, so we also read the raw physical variables the providers
return in the same request — no extra calls:

| Scene | Primary WMO code | Also triggered by |
|---|---|---|
| sun / moon / partly / cloud | 0–3 | — |
| fog | 45, 48 | **visibility < 1 km** when not precipitating (codes often lag) |
| wind | — (no dedicated code) | wind speed ≥ threshold, clear/overcast sky |
| rain | 51–65, 80–82 | — |
| sleet | 56, 57, 66, 67 (freezing rain/drizzle) | — |
| snow | 71–77, 85, 86 | — |
| storm | 95 (thunderstorm) | **CAPE ≥ 1200 J/kg** with liquid precip (embedded convection) |
| hail | 96, 99 | **CAPE ≥ 2500 J/kg** with liquid precip (severe convection) |

Why the physical overrides? Across ~2,700 forecast hours we sampled, Open-Meteo's
`weather_code` emitted fog/storm/hail codes only ~1.8% of the time — thunder
was mostly lumped into plain rain, and freezing rain (56–67) is winter-only.
`visibility` and `cape` catch those events reliably and cost nothing extra, so
the thunderstorm, hail, and fog animations actually appear at the right times.

Previews: **prefs → Preview** plays any scene on the panel icon for ~12 s
(via the transient `preview-scene` setting) — useful for scenes your local
sky rarely shows.

## Privacy

No accounts, no tracking, no analytics. Weather requests go straight from
your machine to the chosen provider's public API (api.open-meteo.com,
api.met.no, or api.weather.gov). With *Detect location automatically* via
IP, the request includes your public IP (that's how Open-Meteo geolocates);
pick a city in prefs if you'd rather not. The optional GeoClue path uses
GNOME's own location service, which you control from system settings.
No forecasts are cached on disk; settings and preferences stay local.

## Contact

Questions, bug reports, translation fixes: **vijaybala-lang@users.noreply.github.com**

## License

GNU General Public License, version 2 or later (GPL-2.0-or-later) —
see [LICENSE](LICENSE).
