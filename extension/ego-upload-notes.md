# EGO upload kit -- integer 10

The release ritual (every command, in order: review, bump, certify,
GitHub release, live gate, captures, publish, README links, upload)
lives in `skills/weatherglass-release/SKILL.md`. This kit holds only
EGO-page material: the artifact identity, the capture list, the
canonical description block, and the standing reviewer answers.

Upload at: https://extensions.gnome.org/upload/
Artifact:  dist/weatherglass@vijaybala.dev.zip  (integer 10; sha256
324fff81cf390d75663deb0831027ddf17e3a5dcae88bff08d729c9fe3d626d0,
certified on every declared shell; the EGO-served bytes must match).

## Last shipped (the step-0 audit anchor; update at every upload)

Last shipped commit: 247cc65
(integer 10, pending upload as the next serial after 16; serial 16's
exact build commit was never recorded -- the gap this section ends.
The integer-10 audit used 558f319, the release-v9 merge, as its base:
shipped changes since are only the two #89 theme fixes, dead-code
sweep clean.)

Integer 10 ships the #89 theme fixes: light mode works on GNOME 50
(the watcher no longer reads a settings key schemas 50 removed), the
solid style's city/clock no longer ink black over a dimmed sun, and
the theme-background style judges its ink by the shell surface
variant. The upload imagery is the goldens, so the v7-era lesson --
live-photo sets that "photograph whatever bugs shipped then" -- no
longer applies: see skill step 5.

## Before uploading (manual verification gate)

The full gate is skill steps 1-6; in short: bump the manifest integer
before the final build, certify the release commit, install the exact
artifact, one logout/login, walk panel + menu in dark/light theme, all
three backdrop styles, hover + selected tiles and prefs, then cast
the demo video from this build with film mode (below) and rehost it
on the v8 GitHub release
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

The demo video is GENERATED, not hand-recorded: film mode
(`tools/film.sh`, #60) casts `weatherglass-demo-card.mp4` headlessly
from a disposable nested gnome-shell -- the same engine and the real
widgets the golden lock certifies, with only the scene fixture-forced
(clock + weather, the hero card) and the timing real: chart morphs,
the animated sky and the scripted beats run live on the nested frame
clock (ritual: skill step 5; frames are not byte-diffable, so the
goldens remain the pixel canon). Rehost on the GitHub release (tag
v8). The video is pending only if the generating host lacks
gnome-shell or an h264 encoder -- film mode then SKIPs the encode
loudly; the URL is stable, so a later attach lights the EGO demo link
with no zip re-upload (attach well before approval is plausible).
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
* 21 languages with full bidirectional support: the entire card mirrors in Arabic, Hebrew, Persian and Urdu
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
- Timer (formerly EGO-L-004): restructured after the v8 finding -- the
  sky animation source is created on notify::mapped (menu actually mapped)
  and removed on unmap, with an inline safety remove in SkyArea.destroy();
  enable() itself creates no main-loop source. Chart morph and city-clock
  timers are removed inline in destroy(). The local shexli stage
  (`tools/shexli-check.sh`) re-verifies this every certify.
- Schemas: XML only in the zip, per EGO-P-006. Delivery compiles what
  it serves (EGO server-side; the Extensions app locally), so users get
  a working schema without a blob in our package; CLI installs from a
  checkout compile via ./install.sh. (An early v8 build shipped the
  compiled blob for install robustness; the reviewer's engine flagged
  it, and the policy won.)
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

## EGO numbers uploads; they are NOT our version integer

Every upload lands in the All-Versions table under SweetTooth's own
counter (our 12 uploads have run 1..12 no matter what the metadata
said), and the zip Served for download is re-stamped: metadata.json
arrives with "_generated: Generated by SweetTooth", keys reordered,
and "version" REWRITTEN to the serial. Consequences, learned the slow
way during the v8 review round:

- A "version 11/12" on the review page is not a repo bump: our integer
  stayed 8 the whole round (and the review-round-never-bump rule says
  it must -- same integer, new sha).
- The GNOME 50 shell updater compares the INSTALLED metadata version
  against the SERVED serial. To verify an install without the shell
  silently overwriting it, the installed copy's integer must sit ABOVE
  the newest active serial (v8 round: installed 10 > served 9).
- "Rejected" next to a serial is not always a reviewer finding: an
  upload superseded by a newer one is AUTO-rejected (serial 10 was).
  Read "Previous Reviews on this Version" before panicking.

## After approval

- The metadata "url" points at the GitHub repo per the EGO review
  guidelines (must be a GitHub/GitLab project URL) -- keep it there even
  after approval; link the EGO page from the repo README instead.
- Keep integer version bumps for every future upload (next: 11).
