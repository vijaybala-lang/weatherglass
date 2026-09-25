# Animated Weather — GNOME Shell extension

A top-bar weather indicator that actually *moves*: a small cairo-animated
scene (sun, moon, partly, cloud, fog, wind, rain, sleet, snow, hail,
storm…) sits next to the current temperature. Clicking it opens today's
forecast with the next 6 days below.

- Data: [Open-Meteo](https://open-meteo.com) — free, **no API key**
- Location: automatic (IP-based) or city search / manual coordinates
- Animations drawn with cairo on a `St.DrawingArea` (`vfunc_repaint`,
  ~20 fps, pauses when unmapped), HiDPI aware
- GNOME Shell **50** (ES modules)

## Layout

| file | role |
|---|---|
| `painter.js` | pure cairo scene painter (all animation logic) |
| `animation.js` | `St.Widget` + `Clutter.Canvas` frame driver |
| `weather.js` | Open-Meteo client, WMO codes → scenes, formatting |
| `menu.js` | dropdown: today + next 6 days |
| `extension.js` | panel button, timers, settings glue |
| `prefs.js` | Adw preferences window |
| `tools/preview.mjs` | renders every scene to PNG outside the shell (`gjs -m tools/preview.mjs`) |

## Install

```sh
./install.sh
```

Then tweak it from the panel icon → ⚙ (or `gnome-extensions prefs animated-weather@vbala.dev`).

## Uninstall

```sh
gnome-extensions disable animated-weather@vbala.dev
rm -rf ~/.local/share/gnome-shell/extensions/animated-weather@vbala.dev
```

## Editing the code? Restart the shell session

GNOME Shell 50 caches an extension's ES modules inside the long-lived
`gnome-shell` process. `gnome-extensions disable/enable` (and even the
Extensions app's toggle) re-run `enable()` on the **already-imported** module
objects — they do **not** re-read `weather.js`, `menu.js`, etc. from disk. So
after editing any file, **log out and back in** (Wayland can't Alt-F2 restart).
The prefs window is exempt: it runs in a fresh process each time you open it.

The `Animated Weather v…` line in `journalctl --user -o cat` tells you which
build the running shell actually loaded.

## Scenes & how they map to real weather

Eleven animated scenes, chosen by `deriveScene()` in `weather.js`. A WMO
weather code is the primary signal, but a few scenes are *under-reported* by
the code alone, so we also read the raw physical variables Open-Meteo gives
us in the same request — no extra calls:

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

Previews: **prefs → Display → Preview animations** plays any scene on the panel
icon for ~12 s (via the transient `preview-scene` setting) — useful for scenes
your local sky rarely shows.

## Notes

- With *Detect location automatically* the request includes your public IP
  (that's how Open-Meteo geolocates). Pick a city in prefs if you'd rather
  not.
- The wind scene kicks in when wind exceeds the configurable threshold
  (30 km/h default) and the sky isn't already showing precipitation — it also
  overlays faint streaks on the other calm-sky scenes.
