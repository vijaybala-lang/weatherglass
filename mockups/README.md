# Menu redesign prototypes

Interactive HTML prototype of the panel-icon dropdown: Apple-style layout
with a full-bleed **animated sky** behind everything that matches the
selected day's weather and day/night.

Open `weather-menu.html` directly in any browser — the data is baked into
`data.js`, so no server or network is needed.

## What's in the prototype

- **Header** — big current temp, °F|°C toggle (metric stays canonical,
  conversion happens at render), details column, clock + condition.
- **Metric tabs** — Temperature / Precipitation / Wind. Switching re-themes
  the accent color and *morphs* the curve between datasets (same 24 points,
  tweened with an ease-out cubic).
- **Hourly chart** — smooth Catmull-Rom curve with gradient area fill,
  value labels every 3 h, dashed "now" marker on today.
- **8 day tiles** — clickable, today selected by default; selecting a day
  retargets the chart **and** the background sky. Mini icons are inline SVG
  with small CSS animations (spinning sun rays, drifting clouds, falling
  drops, flickering bolt).
- **Sky engine** — a canvas particle system mirroring the extension's
  `painter.js` scenes: sun rays, moon + stars, drifting clouds, rain, snow,
  bouncing hail, storm flashes with bolts, fog bands, wind streaks. The
  *today* sky uses the same physics override as the extension
  (`visibility` < 1 km → fog, CAPE thresholds → storm/hail).

## URL overrides (for demos & screenshots)

| Param | Effect |
|---|---|
| `?scene=rain\|snow\|storm\|hail\|sleet\|fog\|wind\|clear\|partly\|cloud` | force the background sky |
| `?night=1` | force night palette |
| `?metric=temp\|precip\|wind` | initial tab |
| `?day=0..7` | initially selected day |
| `?f=1` | start in °F/mph |

Example: `weather-menu.html?scene=storm&night=1&metric=wind&f=1`

## Refreshing the data

```sh
curl -s "https://api.open-meteo.com/v1/forecast?latitude=37.3394&longitude=-121.8950&current=temperature_2m,relative_humidity_2m,apparent_temperature,is_day,precipitation,weather_code,wind_speed_10m,visibility,cape&hourly=temperature_2m,precipitation_probability,precipitation,wind_speed_10m,weather_code,is_day&daily=weather_code,temperature_2m_max,temperature_2m_min,sunrise,sunset,precipitation_probability_max,wind_speed_10m_max&forecast_days=8&timezone=auto" > /tmp/f.json
{ echo 'window.WEATHER_DATA ='; cat /tmp/f.json; echo ';'; } > data.js
echo "window.WEATHER_CITY = { display: 'San Jose, CA' };" >> data.js
```

The city shown top-right comes from `WEATHER_CITY.display` — in the real
extension this maps to the `location-name` setting (searched city or
"Detected location").

## Porting notes → the real GNOME menu

The prototype is deliberately portable: the canvas sky maps onto the same
`St.DrawingArea`/`vfunc_repaint` pattern already used in the extension; the
SVG chart is straightforward cairo (Catmull-Rom → `cr.curveTo`); tabs and
day tiles are plain `St.Button` + `St.BoxLayout` rows. Open-Meteo already
returns everything the charts need in the single request the extension
makes today.
