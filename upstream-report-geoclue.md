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
  with and without the desktop file installed; re-verified clean after a
  daemon restart with zero custom agents ever having run in the session:
  identical +25.0 s, so the shell-side silence is not registration-order
  dependent.)
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

### Measured: agent registration is lost permanently on daemon restart

The hang above worsens into a system-wide wedge after any
`systemctl restart geoclue` (including the idle auto-shutdown): the
shell registers its agent exactly once per daemon instance.
Journal evidence from a live session:

```text
17:14:26 daemon (re)start: "New agent for user ID '1000'" (x2 churn)
17:14:29 "Agent for user '1000' vanished"
17:14:31 "New agent for user ID '1000'"
17:15:18 "Agent for user '1000' vanished"   <-- final; never returns
```

From 17:15:18 on, no `AddAgent` arrives for any subsequent daemon
instance, and every location client for that user either hangs (Start
is queued on `clients_waiting_agent`, `gclue-service-manager.c`, with
no timeout) or is refused while the shell momentarily holds the slot
with `MaxAccuracyLevel = 0`. A minimal stand-in agent (own object
implementing `org.freedesktop.GeoClue2.Agent`, `AddAgent` with the
whitelisted id) immediately unblocks every client -- proving the queue
drains the moment any agent exists, and that the missing
re-registration is the whole gap.

### Notes on observability (contributing factor)

In geoclue 2.8.2 the Manager's `Agent` property is gone (introspected:
only `AvailableAccuracyLevel` / `InUse` remain), so there is no way to
ask the daemon which agent holds the slot, and no journal line when an
agent fails to answer. `location.js` registers once (`AddAgentAsync`)
at daemon startup and, as measured above, never re-registers after the
daemon restarts or the slot is taken (any whitelisted id works — the
daemon trusts the claimed id from an unconfined caller, which is how
the stand-in agent above gets in).
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

## Report B — geoclue: a failed location query is dropped and waiting
## clients are never notified -- one broken endpoint hangs clients
## indefinitely, silently, with a deterministic reproducer

Project: GNOME/geoclue

### Summary

A client that calls `Start` and is waiting for its first fix learns
**nothing** when the underlying source query fails. `Start` replies
successfully *before* the first query completes; the terminal query
handler (`query_callback` in `gclue-web-source.c`, comment: `/* Ignore
returned location */`) logs the failure and drops it -- no retry, no
propagation, no error channel to the client. `GClueSimple` then waits
for a `Location` property update that never arrives: the client hangs
indefinitely, the daemon considers it in use (so it never idles out),
and at default log levels the journal may show nothing at all. One
broken or stalling backend endpoint therefore presents as a completely
wedged location stack while the daemon is actually healthy-but-deaf.

### Observed in the wild (Fedora 44, geoclue 2.8.2)

```text
11:09:49 systemd[1]: Started geoclue.service - Location Lookup Service.
   (two allow-listed client requests at 11:49 and 11:51 hang;
    daemon logs NOTHING; over the next 81 minutes the service uses
    1.6 s of CPU and does not auto-idle: pending clients, no progress)
12:26:38 probe: INIT ERROR: Timeout was reached (+25.01s)
12:31:12 systemctl restart geoclue
12:31:27 probe: INIT OK, location=37.6688,-122.081 acc=25000m (+1.09s)
```

Direct `curl` to the same BeaconDB endpoint succeeds (~0.7 s) while
the daemon is stuck, so this was egress-independent all along -- it was
this dead-end, plus a stalled query holding things open
(`soup_session_new()` sets no request deadline; libsoup's 60 s timeout
is per-socket-I/O inactivity, not a request bound).

### Deterministic reproduction (100%, no external service needed)

1. Stall server -- accepts requests, reads them, never answers:

```python
# staller.py
import socket, threading
s = socket.socket()
s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
s.bind(('127.0.0.1', 8399)); s.listen(16)
def hold(c):
    try: c.recv(65536)
    except Exception: pass
    threading.Event().wait()
while True:
    c, _ = s.accept()
    threading.Thread(target=hold, args=(c,), daemon=True).start()
```

2. Point the IP source at it and isolate it (`/etc/geoclue/conf.d/zz.conf`):
```ini
[ip]
enable=true
method=gmaps
url=http://127.0.0.1:8399/geoip
[wifi]
enable=false
```
   (`systemctl restart geoclue`; use a client desktop-id you have
   allow-listed so consent isn't a variable -- see Report A.)
3. Run any `GClueSimple` client (gjs snippet in Report A).

Expected per the API contract: the client learns of the failure.
Actual: client hangs > 60 s (watchdog-killed) while the daemon logs
`Failed to query location: ...` (or nothing at all in the stall case).

Measured A/B on this setup:
- stock 2.8.2: daemon logs the failure (+7 s for a transport abort);
  client still hanging at +30 s; true stall variant logs nothing at
  all for minutes.
- with attached patch: typed failure
  `Failed to query location: Query location timed out after 20 seconds`
  at exactly +20 s, info-level; **client behavior unchanged** -- which
  is the point of this report: the deadline alone does not fix the
  dead-end. The client-notification gap is the bug; the patch bounds
  the query and lifts the veil.

### A third failure mode: churn kills the query, the follower
### refresh loses the race, nothing ever re-arms

Distinct from a stall: `GClueWebSource` rides every query on the
source's own `priv->cancellable`, and `on_network_changed` /
`on_connectivity_changed` cancel-and-recreate it on routine events
(e.g. the connectivity notify a daemon receives seconds after
activation). The kill itself is by design -- but the recovery is a
race: the follower refresh (`locate_url_checked_cb` →
`gclue_web_source_refresh`) usually arrives while the killed query's
completion has not yet cleared `priv->query`, so `refresh_async`'s
in-progress guard eats it, and if no further event happens to arrive,
**no query is ever armed again** while clients wait forever.

Measured with the harness above plus live churn: on patched builds
the signature is direct (`Sending following request` logged, a
connectivity event within the same second, `Operation was cancelled`
on the query, **no subsequent `Sending` line ever** -- client hangs;
`g_cancellable_cancel` breakpoints confirm the kill path). Stock
2.8.2 hangs identically under the same conditions (its send rides the
same cancellable, and the follow-the-kill refresh is the same racing
code); on one stock run the daemon never even reached the first send
before the window closed. Same signature also killed a live query
against the real BeaconDB endpoint during testing (daemon start, query
armed, connectivity notify in the same second, silence thereafter).

The attached patch re-arms once from an idle after a non-caller
cancellation while the source is still active. The cap (5, then one
info line) is load-bearing, not cosmetic: an uncapped revision of the
re-arm, driven by a pathological cancellation state we did not fully
isolate, burned 583,181 sends in four minutes before the cap
contained it.

### Asks

1. **Decide how clients learn of query failure.** Options with
   precedent: fail the pending `Start` late (the invocation may be
   keepable), add an error/`none` transition on the `Location`
   interface, or a new signal. Needs maintainer preference; happy to
   implement once chosen.
2. **Retry with backoff on failed sources** -- currently a failed
   source only re-fires on network/connectivity change signals.
3. Attached MR bounds queries (20 s deadline), logs all query
   failures at info level (endpoint URI + data class only, no
   location data), and caps the churn re-arm described above — the
   general "retry with backoff" decision (#2) remains open.
4. Observability: `Manager.Agent` removal in 2.8 makes agent-side
   dead-ends (Report A) undiagnosable from outside; one info-level
   line per `AuthorizeApp` dispatch/answer would have saved days.

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
