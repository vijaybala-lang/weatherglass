# Animated Weather — GNOME Shell extension

A top-bar weather indicator that actually *moves*: a small cairo-animated
scene (sun, rain, wind, snow, storm, fog, moon…) sits next to the current
temperature. Clicking it opens today's forecast with the next 6 days below.

- Data: [Open-Meteo](https://open-meteo.com) — free, **no API key**
- Location: automatic (IP-based) or city search / manual coordinates
- Animations drawn with cairo on a `Clutter.Canvas` (~20 fps, pauses when
  unmapped), HiDPI aware
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

## Notes

- With *Detect location automatically* the request includes your public IP
  (that's how Open-Meteo geolocates). Pick a city in prefs if you'd rather
  not.
- The wind scene kicks in when wind exceeds the configurable threshold
  (30 km/h default) and the sky isn't already showing rain/snow/storm.
