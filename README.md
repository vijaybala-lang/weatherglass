# Weatherglass -- animated weather for GNOME Shell

A weather dropdown for the GNOME Shell top panel. The panel icon animates
with the current conditions (sun, moon, clouds, fog, wind, rain, sleet,
snow, hail, storm...) next to the live temperature; clicking it opens a
forecast card with an animated sky, an hourly chart (temperature,
precipitation or wind), and eight days of forecast tiles.

- **Data models:** Open-Meteo (global), MET Norway (ECMWF AIFS) and NOAA
  NWS -- pick your favourite forecaster in prefs; no API key for any of them
- **Location:** automatic (GeoClue or IP-based) or city search / manual
  coordinates
- **20 languages** including RTL (Arabic, Hebrew, Persian, Urdu); the whole
  card mirrors in RTL sessions
- 12- or 24-hour clock, bolder/larger chart text, panel-icon toggles,
  live scene previews in preferences
- Animations drawn with cairo on `St.DrawingArea` (~20 fps, pauses when
  unmapped), HiDPI aware, adaptive ink for legibility over any sky
- GNOME Shell **50** (ES modules)

## Gallery

Every card below is a **golden**: a real card rendered by the headless
render-lock the test suite byte-diffs against (`tools/golden/shell/`,
see [CONTRIBUTING.md](CONTRIBUTING.md)) -- so this gallery is the same
pixel truth CI certifies, refreshed with every bless.

### Weather conditions

Ten animated scenes, daytime cards, same city geometry per column:

<table>
<tr>
<td><img src="https://github.com/vijaybala-lang/weatherglass/raw/master/tools/golden/shell/cov-clear-day.png" width="160" height="220" alt="Clear sky"></td>
<td><img src="https://github.com/vijaybala-lang/weatherglass/raw/master/tools/golden/shell/cov-partly-day.png" width="160" height="220" alt="Partly cloudy"></td>
<td><img src="https://github.com/vijaybala-lang/weatherglass/raw/master/tools/golden/shell/cov-cloud-day.png" width="160" height="220" alt="Overcast"></td>
<td><img src="https://github.com/vijaybala-lang/weatherglass/raw/master/tools/golden/shell/cov-fog-day.png" width="160" height="220" alt="Fog"></td>
<td><img src="https://github.com/vijaybala-lang/weatherglass/raw/master/tools/golden/shell/cov-rain-day.png" width="160" height="220" alt="Rain"></td>
</tr>
<tr><td align="middle"><b>Clear</b></td><td align="middle"><b>Partly cloudy</b></td><td align="middle"><b>Overcast</b></td><td align="middle"><b>Fog</b></td><td align="middle"><b>Rain</b></td></tr>
<tr>
<td><img src="https://github.com/vijaybala-lang/weatherglass/raw/master/tools/golden/shell/cov-snow-day.png" width="160" height="220" alt="Snow"></td>
<td><img src="https://github.com/vijaybala-lang/weatherglass/raw/master/tools/golden/shell/cov-sleet-day.png" width="160" height="220" alt="Sleet"></td>
<td><img src="https://github.com/vijaybala-lang/weatherglass/raw/master/tools/golden/shell/cov-storm-day.png" width="160" height="220" alt="Thunderstorm"></td>
<td><img src="https://github.com/vijaybala-lang/weatherglass/raw/master/tools/golden/shell/cov-hail-day.png" width="160" height="220" alt="Hail"></td>
<td><img src="https://github.com/vijaybala-lang/weatherglass/raw/master/tools/golden/shell/cov-wind-day.png" width="160" height="220" alt="Wind"></td>
</tr>
<tr><td align="middle"><b>Snow</b></td><td align="middle"><b>Sleet</b></td><td align="middle"><b>Thunderstorm</b></td><td align="middle"><b>Hail</b></td><td align="middle"><b>Wind</b></td></tr>
</table>

The same scenes after dark -- stars and moonlight, with precipitation
keeping its night palette:

<table>
<tr>
<td><img src="https://github.com/vijaybala-lang/weatherglass/raw/master/tools/golden/shell/cov-clear-night.png" width="160" height="220" alt="Clear night"></td>
<td><img src="https://github.com/vijaybala-lang/weatherglass/raw/master/tools/golden/shell/cov-partly-night.png" width="160" height="220" alt="Partly cloudy night"></td>
<td><img src="https://github.com/vijaybala-lang/weatherglass/raw/master/tools/golden/shell/cov-cloud-night.png" width="160" height="220" alt="Overcast night"></td>
<td><img src="https://github.com/vijaybala-lang/weatherglass/raw/master/tools/golden/shell/cov-fog-night.png" width="160" height="220" alt="Fog at night"></td>
<td><img src="https://github.com/vijaybala-lang/weatherglass/raw/master/tools/golden/shell/cov-rain-night.png" width="160" height="220" alt="Rain at night"></td>
</tr>
<tr><td align="middle"><b>Clear</b></td><td align="middle"><b>Partly cloudy</b></td><td align="middle"><b>Overcast</b></td><td align="middle"><b>Fog</b></td><td align="middle"><b>Rain</b></td></tr>
<tr>
<td><img src="https://github.com/vijaybala-lang/weatherglass/raw/master/tools/golden/shell/cov-snow-night.png" width="160" height="220" alt="Snow at night"></td>
<td><img src="https://github.com/vijaybala-lang/weatherglass/raw/master/tools/golden/shell/cov-sleet-night.png" width="160" height="220" alt="Sleet at night"></td>
<td><img src="https://github.com/vijaybala-lang/weatherglass/raw/master/tools/golden/shell/cov-storm-night.png" width="160" height="220" alt="Thunderstorm at night"></td>
<td><img src="https://github.com/vijaybala-lang/weatherglass/raw/master/tools/golden/shell/cov-hail-night.png" width="160" height="220" alt="Hail at night"></td>
<td><img src="https://github.com/vijaybala-lang/weatherglass/raw/master/tools/golden/shell/cov-wind-night.png" width="160" height="220" alt="Wind at night"></td>
</tr>
<tr><td align="middle"><b>Snow</b></td><td align="middle"><b>Sleet</b></td><td align="middle"><b>Thunderstorm</b></td><td align="middle"><b>Hail</b></td><td align="middle"><b>Wind</b></td></tr>
</table>

### Moon phases at night

The panel and strip moons carry the **real lunar phase**, searched from
the actual almanac rather than fabricated -- here pinned to the eight
cardinal phases over real Berlin nights:

<table>
<tr>
<td><img src="https://github.com/vijaybala-lang/weatherglass/raw/master/tools/golden/shell/cov-moon-new.png" width="160" height="220" alt="New moon"></td>
<td><img src="https://github.com/vijaybala-lang/weatherglass/raw/master/tools/golden/shell/cov-moon-waxing-crescent.png" width="160" height="220" alt="Waxing crescent"></td>
<td><img src="https://github.com/vijaybala-lang/weatherglass/raw/master/tools/golden/shell/cov-moon-first-quarter.png" width="160" height="220" alt="First quarter"></td>
<td><img src="https://github.com/vijaybala-lang/weatherglass/raw/master/tools/golden/shell/cov-moon-waxing-gibbous.png" width="160" height="220" alt="Waxing gibbous"></td>
<td><img src="https://github.com/vijaybala-lang/weatherglass/raw/master/tools/golden/shell/cov-moon-full.png" width="160" height="220" alt="Full moon"></td>
</tr>
<tr><td align="middle"><b>New moon</b></td><td align="middle"><b>Waxing crescent</b></td><td align="middle"><b>First quarter</b></td><td align="middle"><b>Waxing gibbous</b></td><td align="middle"><b>Full moon</b></td></tr>
<tr>
<td><img src="https://github.com/vijaybala-lang/weatherglass/raw/master/tools/golden/shell/cov-moon-waning-gibbous.png" width="160" height="220" alt="Waning gibbous"></td>
<td><img src="https://github.com/vijaybala-lang/weatherglass/raw/master/tools/golden/shell/cov-moon-last-quarter.png" width="160" height="220" alt="Last quarter"></td>
<td><img src="https://github.com/vijaybala-lang/weatherglass/raw/master/tools/golden/shell/cov-moon-waning-crescent.png" width="160" height="220" alt="Waning crescent"></td>
<td><img src="https://github.com/vijaybala-lang/weatherglass/raw/master/tools/golden/shell/cov-moon-new-day.png" width="160" height="220" alt="New moon in daylight"></td>
<td></td>
</tr>
<tr><td align="middle"><b>Waning gibbous</b></td><td align="middle"><b>Last quarter</b></td><td align="middle"><b>Waning crescent</b></td><td align="middle"><b>New moon, daylight</b></td><td></td></tr>
</table>

At new moon there is no lit crescent to draw: on night skies the disc
survives as a faint earthshine whisper, and on bright daytime grounds it
wears a deep slate ink twin (last card) so the strip's clear-night hours
never go missing.

### Golden hour

Every scene at the city's own sunset minus 12 minutes -- the sky model,
lighting and chart ink all follow the low sun:

<table>
<tr>
<td><img src="https://github.com/vijaybala-lang/weatherglass/raw/master/tools/golden/shell/cov-clear-golden.png" width="160" height="220" alt="Clear at golden hour"></td>
<td><img src="https://github.com/vijaybala-lang/weatherglass/raw/master/tools/golden/shell/cov-partly-golden.png" width="160" height="220" alt="Partly cloudy at golden hour"></td>
<td><img src="https://github.com/vijaybala-lang/weatherglass/raw/master/tools/golden/shell/cov-cloud-golden.png" width="160" height="220" alt="Overcast at golden hour"></td>
<td><img src="https://github.com/vijaybala-lang/weatherglass/raw/master/tools/golden/shell/cov-fog-golden.png" width="160" height="220" alt="Fog at golden hour"></td>
<td><img src="https://github.com/vijaybala-lang/weatherglass/raw/master/tools/golden/shell/cov-rain-golden.png" width="160" height="220" alt="Rain at golden hour"></td>
</tr>
<tr><td align="middle"><b>Clear</b></td><td align="middle"><b>Partly cloudy</b></td><td align="middle"><b>Overcast</b></td><td align="middle"><b>Fog</b></td><td align="middle"><b>Rain</b></td></tr>
<tr>
<td><img src="https://github.com/vijaybala-lang/weatherglass/raw/master/tools/golden/shell/cov-snow-golden.png" width="160" height="220" alt="Snow at golden hour"></td>
<td><img src="https://github.com/vijaybala-lang/weatherglass/raw/master/tools/golden/shell/cov-sleet-golden.png" width="160" height="220" alt="Sleet at golden hour"></td>
<td><img src="https://github.com/vijaybala-lang/weatherglass/raw/master/tools/golden/shell/cov-storm-golden.png" width="160" height="220" alt="Thunderstorm at golden hour"></td>
<td><img src="https://github.com/vijaybala-lang/weatherglass/raw/master/tools/golden/shell/cov-hail-golden.png" width="160" height="220" alt="Hail at golden hour"></td>
<td><img src="https://github.com/vijaybala-lang/weatherglass/raw/master/tools/golden/shell/cov-wind-golden.png" width="160" height="220" alt="Wind at golden hour"></td>
</tr>
<tr><td align="middle"><b>Snow</b></td><td align="middle"><b>Sleet</b></td><td align="middle"><b>Thunderstorm</b></td><td align="middle"><b>Hail</b></td><td align="middle"><b>Wind</b></td></tr>
</table>

**The descent.** Golden hour is a passage, not a moment: one clear Berlin
evening, four clock readings, nothing retouched. The middle card is the
locked golden above; the other three are the same scene at neighboring
instants — the sky model carries the hue, the glyphs flip to their night
family somewhere in the middle, and the chart language never changes:

<table>
<tr>
<td><img src="https://github.com/vijaybala-lang/weatherglass/raw/master/tools/golden/shell/cov-clear-descent-early.png" width="160" height="220" alt="Late afternoon, sunset minus 72 minutes"></td>
<td><img src="https://github.com/vijaybala-lang/weatherglass/raw/master/tools/golden/shell/cov-clear-golden.png" width="160" height="220" alt="Golden hour, sunset minus 12 minutes"></td>
<td><img src="https://github.com/vijaybala-lang/weatherglass/raw/master/tools/golden/shell/cov-clear-descent-afterglow.png" width="160" height="220" alt="Afterglow, sunset plus 18 minutes"></td>
<td><img src="https://github.com/vijaybala-lang/weatherglass/raw/master/tools/golden/shell/cov-clear-descent-twilight.png" width="160" height="220" alt="Twilight, sunset plus 54 minutes"></td>
</tr>
<tr><td align="middle"><b>Late afternoon</b><br>sunset &minus; 72 min</td><td align="middle"><b>Golden hour</b><br>sunset &minus; 12 min</td><td align="middle"><b>Afterglow</b><br>sunset + 18 min</td><td align="middle"><b>Twilight</b><br>sunset + 54 min</td></tr>
</table>

### Backdrop styles

Three backdrop styles, one chart language. *Sky* is the default: the card
is a live animated sky (every card above this row uses it). *Solid* paints
a flat sky-appropriate wash behind the card; *accent* (a.k.a. themed) lets
the card take the system theme's colors and charts adopt the user's GNOME
accent:

<table>
<tr>
<td><img src="https://github.com/vijaybala-lang/weatherglass/raw/master/tools/golden/shell/cov-clear-day.png" width="160" height="220" alt="Sky style (default)"></td>
<td><img src="https://github.com/vijaybala-lang/weatherglass/raw/master/tools/golden/shell/style-solid-dark.png" width="160" height="220" alt="Solid style, dark theme"></td>
<td><img src="https://github.com/vijaybala-lang/weatherglass/raw/master/tools/golden/shell/style-solid-light.png" width="160" height="220" alt="Solid style, light theme"></td>
<td><img src="https://github.com/vijaybala-lang/weatherglass/raw/master/tools/golden/shell/style-accent-dark.png" width="160" height="220" alt="Accent style, dark theme"></td>
<td><img src="https://github.com/vijaybala-lang/weatherglass/raw/master/tools/golden/shell/style-accent-light.png" width="160" height="220" alt="Accent style, light theme"></td>
</tr>
<tr><td align="middle"><b>Sky, animated</b><br>(default)</td><td align="middle"><b>Solid, dark theme</b></td><td align="middle"><b>Solid, light theme</b></td><td align="middle"><b>Accent, dark theme</b></td><td align="middle"><b>Accent, light theme</b></td></tr>
</table>

### Real cities

<table>
<tr>
<td><img src="https://github.com/vijaybala-lang/weatherglass/raw/master/tools/golden/shell/sf-sunset.png" width="160" height="220" alt="San Francisco at sunset"></td>
<td><img src="https://github.com/vijaybala-lang/weatherglass/raw/master/tools/golden/shell/tokyo-storm-night.png" width="160" height="220" alt="Tokyo thunderstorm at night"></td>
<td><img src="https://github.com/vijaybala-lang/weatherglass/raw/master/tools/golden/shell/berlin-rain-day.png" width="160" height="220" alt="Berlin rain by day"></td>
<td><img src="https://github.com/vijaybala-lang/weatherglass/raw/master/tools/golden/shell/ny-snow-day.png" width="160" height="220" alt="New York snow by day"></td>
<td><img src="https://github.com/vijaybala-lang/weatherglass/raw/master/tools/golden/shell/kilimanjaro-clear-noon.png" width="160" height="220" alt="Kilimanjaro clear noon"></td>
</tr>
<tr><td align="middle"><b>San Francisco</b><br>sunset</td><td align="middle"><b>Tokyo</b><br>storm, night</td><td align="middle"><b>Berlin</b><br>rain, day</td><td align="middle"><b>New York</b><br>snow, day</td><td align="middle"><b>Kilimanjaro</b><br>clear, noon</td></tr>
</table>

### Preferences & the live demo

<table>
<tr>
<td><img src="https://github.com/vijaybala-lang/weatherglass/raw/master/screenshots/05-preferences.png" width="380" alt="Preferences window"></td>
<td valign="middle">
<img src="https://github.com/vijaybala-lang/weatherglass/raw/master/assets/weatherglass-demo.gif" width="300" alt="Animated demo: opening the card, switching between temperature and precipitation tabs">
</td>
</tr>
</table>

The sky is live cairo animation -- stars twinkle, the moon carries the
real phase, and switching tabs or day tiles morphs the chart between
series. The full 5&nbsp;s capture as an mp4 is in the
<a href="https://github.com/vijaybala-lang/weatherglass/releases/tag/v14">release</a>.

## Install

The easiest way is the Extensions app (or https://extensions.gnome.org):
toggle Weatherglass on and you're done. From a checkout:

```sh
./install.sh
```

Then tweak it from the panel icon ->  (or
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
| `weather.js` | provider adapters (Open-Meteo / MET Norway / NOAA), WMO -> scenes, formatting |
| `menu.js` | the dropdown card |
| `extension.js` | panel button, timers, settings glue |
| `prefs.js` | Adw preferences window |
| `moon.js` | moon phases |
| `tools/preview.mjs` | renders every scene to PNG outside the shell (`gjs -m tools/preview.mjs`) |

## Editing the code? Restart the shell session

GNOME Shell 50 caches an extension's ES modules inside the long-lived
`gnome-shell` process. `gnome-extensions disable/enable` (and even the
Extensions app's toggle) re-run `enable()` on the **already-imported** module
objects -- they do **not** re-read `weather.js`, `menu.js`, etc. from disk. So
after editing any file, **log out and back in** (Wayland can't Alt-F2 restart).
The prefs window is exempt: it runs in a fresh process each time you open it.

The `Weatherglass v...` line in `journalctl --user -o cat` tells you which
build the running shell actually loaded.

## Scenes & how they map to real weather

Eleven animated scenes, chosen by the scene picker in `weather.js`. A WMO
weather code is the primary signal, but a few scenes are *under-reported* by
the code alone, so we also read the raw physical variables the providers
return in the same request -- no extra calls:

| Scene | Primary WMO code | Also triggered by |
|---|---|---|
| sun / moon / partly / cloud | 0-3 | -- |
| fog | 45, 48 | **visibility < 1 km** when not precipitating (codes often lag) |
| wind | -- (no dedicated code) | wind speed >= threshold, clear/overcast sky |
| rain | 51-65, 80-82 | -- |
| sleet | 56, 57, 66, 67 (freezing rain/drizzle) | -- |
| snow | 71-77, 85, 86 | -- |
| storm | 95 (thunderstorm) | **CAPE >= 1200 J/kg** with liquid precip (embedded convection) |
| hail | 96, 99 | **CAPE >= 2500 J/kg** with liquid precip (severe convection) |

Why the physical overrides? Across ~2,700 forecast hours we sampled, Open-Meteo's
`weather_code` emitted fog/storm/hail codes only ~1.8% of the time -- thunder
was mostly lumped into plain rain, and freezing rain (56-67) is winter-only.
`visibility` and `cape` catch those events reliably and cost nothing extra, so
the thunderstorm, hail, and fog animations actually appear at the right times.

Previews: **prefs -> Preview** plays any scene on the panel icon for ~12 s
(via the transient `preview-scene` setting) -- useful for scenes your local
sky rarely shows.

## Privacy

No accounts, no tracking, no analytics. Weather requests go straight from
your machine to the chosen provider's public API (api.open-meteo.com,
api.met.no, or api.weather.gov). With *Detect location automatically*,
IP detection sends your public IP to the geolocation endpoint (that is
how the lookup works); pick a city in prefs if you'd rather not. The
preferred GeoClue path uses GNOME's own location service, which you
control from system settings: while automatic detection is on, the
extension registers a hidden (NoDisplay) "Weatherglass" app entry in
your session so the standard "Allow location access" prompt can name
this extension honestly, and removes it again when you turn automatic
detection off or disable the extension. On distributions where the
system location prompt never appears, the GeoClue attempt is time-boxed
to a few seconds and detection falls back to the IP lookup on its own.
To label a GeoClue fix with a
city name, the fix's coordinates (not your IP) go to BigDataCloud's
free reverse-geocode endpoint; if it declines, the menu simply says
"My location".
No forecasts are cached on disk; settings and preferences stay local.

## Contact

Questions, bug reports, translation fixes: **open an issue at
https://github.com/vijaybala-lang/weatherglass/issues**

## License

GNU General Public License, version 2 or later (GPL-2.0-or-later) --
see [LICENSE](LICENSE).
