# Upstream reports draft — GeoClue + gnome-shell location for shell extensions

Working document for filing upstream (not shipped in the extension ZIP; repo-only,
same policy as `ego-upload-notes.md`). Two defects, filed separately, cross-linked.

Environment for both: Fedora Workstation 44, GNOME 50.5,
`gnome-shell-50.5-1.fc44`, `geoclue2-2.8.2-1.fc44`,
`xdg-desktop-portal-1.22.1-1.fc44`. Intel WiFi 6 AX201 (iwlwifi), ThinkPad.
GeoClue `[agent] whitelist=geoclue-demo-agent;gnome-shell;...` unmodified.

---

## Report A — gnome-shell: location agent never services requests from
## GNOME Shell extension clients (silent 25 s hang, no dialog, no deny)

Project: GNOME/gnome-shell

### Summary

When a client registered on the system bus by a **GNOME Shell extension**
requests a location from GeoClue, gnome-shell's location agent
(`js/ui/status/location.js`) never answers `AuthorizeApp`, even when the
client carries a `DesktopId` that resolves to a real installed
`.desktop` file. The request hangs until the D-Bus method timeout
(~25 s). Expected behavior per the code: either the standard "Allow
location access" dialog (app resolvable), or an immediate silent deny
(app unresolvable) — never silence.

### Steps to reproduce

1. Fresh GNOME session (do **not** run any custom agent; verify the
   shell registered as agent — see "Notes on observability" below).
2. Install a desktop file for a fake app id, e.g.
   `~/.local/share/applications/dev.vijaybala.weatherglass.desktop`:
   `[Desktop Entry]`, `Name=Weatherglass`, `NoDisplay=true`,
   `X-Geoclue-Reason=Show the weather for where you are.`, `Type=Application`.
3. From a gjs one-liner (unprivileged user process, outside the shell)
   create a libgeoclue client with that desktop id and init it:

```js
// probe.mjs — gjs probe.mjs
import Geoclue from 'gi://Geoclue';
import GLib from 'gi://GLib';
const loop = new GLib.MainLoop();
const t0 = GLib.get_monotonic_time();
const simple = new Geoclue.Simple({ desktopId: 'dev.vijaybala.weatherglass' });
simple.init_async(GLib.PRIORITY_DEFAULT, null, (c, res) => {
    const dt = (GLib.get_monotonic_time() - t0) / 1e6;
    try {
        c.init_finish(res);
        const l = c.get_location();
        log(`+${dt.toFixed(2)}s OK ${l ? l.latitude + ',' + l.longitude : 'null'}`);
    } catch (e) { log(`+${dt.toFixed(2)}s ERROR: ${e.message}`); }
    loop.quit();
});
GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 30, () => { loop.quit(); });
loop.run();
```

### Observed

- `init_async` neither succeeds nor errors; it dies at the D-Bus reply
  timeout: `INIT ERROR: Timeout was reached` at +25 s. (Reproduced both
  with and without the desktop file installed.)
- No "Allow location access" dialog appears at any point.
- `journalctl -u geoclue` logs **nothing** for the attempt — the daemon
  is waiting on the agent, and the agent (`AuthorizeAppAsync`,
  location.js) is never reached, or its reply never arrives.
- With the desktop file *absent*, upstream `AppAuthorizer.authorize()`
  should complete instantly with accuracy `NONE` (`lookup_app(...) ==
  null → _completeAuth()`); we do not even observe that fast-deny.

### Control (daemon side is healthy)

Registering the **shipped demo agent** (already on the whitelist) as an
ordinary user process makes the very same client succeed in ~0.8 s:

```sh
/usr/libexec/geoclue-2.0/demos/agent    # autostarted nowhere in this
                                        # session; run manually
```

It receives `AuthorizeApp` + `NotifyInUse` and the client gets its fix.
Stopping it, restarting `geoclue.service`, and re-running the probe
without any custom agent: same hang returns. So the daemon, the
whitelist, and libgeoclue are fine; the shell's agent is the dead end.

### Notes on observability (contributing factor)

In geoclue 2.8.2 the Manager's `Agent` property is gone (introspected:
only `AvailableAccuracyLevel` / `InUse` remain), so there is no way to
ask the daemon which agent holds the slot, and no journal line when an
agent fails to answer. `location.js` registers once (`AddAgentAsync`)
at daemon startup and never re-registers if the name owner dies or is
stolen (e.g. by any process that calls `AddAgent('geoclue-demo-agent')`,
which is whitelisted and auto-started via
`/etc/xdg/autostart/geoclue-demo-agent.desktop` on some desktops).
Both make the failure mode invisible to users and to us.

### Impact

Shell extensions cannot use the system location service at all. This
matches the ecosystem: peer weather extensions either dropped auto-
location to IP lookups or delegate to GNOME Weather (a desktop app,
which prompts correctly). We ship a masked workaround (client
allow-list drop-in per the geoclue man page; see Report B) but the
clean fix belongs in the shell.

### Suggested direction

- Verify `AddAgentAsync('gnome-shell')` actually succeeds on boot
  (its only error handling is `log(e.message)`, which goes where?);
  re-register on geoclue name-owner change and on agent-name loss.
- Surface a log line when `AuthorizeApp` arrives and what it decided.

---

## Report B — geoclue: [ip] network source can wedge silently, blocking
## every client until the daemon is restarted

Project: GNOME/geoclue

### Summary

The default `[ip]` (ichnaea/beacondb) source can enter a state where it
never completes its HTTP query **and logs nothing**, and because it is
required for the combined fix, every client's `init_async` then hangs to
the D-Bus timeout — including clients that are already allow-listed and
therefore need no consent round-trip at all. Only
`systemctl restart geoclue` recovers. Earlier in the same week the same
source failed *cleanly* (`journalctl`: `Failed to query location: Could
not connect to api.beacondb.net`), proving the failure itself isn't the
novelty — the silent wedge is.

### Observed (excerpt)

```text
11:09:49 systemd[1]: Started geoclue.service - Location Lookup Service.
   (two allow-listed client requests at 11:49 and 11:51: both time out
    client-side; daemon logs nothing; systemd reports the service using
    1.575 s CPU over the next 81 minutes and not auto-idling, i.e. it
    held pending clients while doing nothing)
12:26:38 probe: INIT ERROR: Timeout was reached (+25.01s)
12:31:12 systemctl restart geoclue   # operator action
12:31:27 probe: INIT OK, location=37.6688,-122.081 acc=25000m (+1.09s)
```

Direct `curl` POSTs to the same BeaconDB endpoint from the same machine
succeed (≈0.7 s) while the daemon is wedged, so it is not network
egress. Suspect a missing/stuck timeout or a serialized source-start
queue in the 2.8 HTTP path (`libsoup` request that never resolves
holds the single source loop).

### Reproduction

Hard to force deterministically (observed 2×/week under repeated client
churn); filing as an observation with journal + timings because the
silent-forever wedge turns a backend hiccup into a total outage with no
log trace. Minimum ask: apply a hard timeout to the network source's
query (the client's accuracy expectation should time-shift, not stall),
and log source-query start/finish at info level.

### Secondary ask (same daemon version)

Restore agent-state observability: with `Manager.Agent` removed in 2.8,
a stuck consent round-trip (Report A) is undiagnosable from outside;
one `journalctl` line per `AuthorizeApp` dispatch/answer would have
saved days.

---

## Filing notes (operator-side)

- Report A → https://gitlab.gnome.org/GNOME/gnome-shell/-/issues/new
  (component: system/location). Report B →
  https://gitlab.gnome.org/GNOME/geoclue/-/issues/new. Cross-link both;
  mention Fedora 44 first so Fedora QA can dup-check.
- Also worth a `binbug`/Fedora report referencing the GNOME ones
  (Red Hat triages shell issues on distro versions).
- The extension's probe above is public-domain; the extension source at
  https://github.com/vijaybala-lang/weatherglass (weather.js) shows a
  fully instrumented client (5 s cap + backoff) for reference.
- Before filing Report A, optionally re-verify on a *virgin* session:
  boot, no custom agents ever run, run probe.mjs → expect hang. (Our
  first observation predates any custom-agent experiments, but a clean
  second datapoint makes the report airtight.)
- Sanitizer detail: replace nothing in the probe; the desktop id is the
  extension's public id and the reason string is what the dialog shows.
