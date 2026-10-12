# MR draft — GNOME/geoclue  (UPDATED after live A/B testing)

Project: https://gitlab.gnome.org/GNOME/geoclue
Branch: `web-source-query-deadline` (from main)
File changed: `src/gclue-web-source.c` (+98 lines)
Patch: `0001-web-source-bound-query-deadline.patch`
Build-tested: yes -- compiles clean against 2.8.2 (73/73 targets,
Fedora 44 toolchain). Live-tested: yes, deterministic stall simulation
(see below); results honest-scoped in "What it does / does not do".

## Scope correction (learned by testing, before shipping a wrong claim)

Original hypothesis: bounding the query would let waiting clients
recover inside their D-Bus timeout. Disproved by experiment: the
client's `Start` call already returned successfully BEFORE the query
fails (and libgeoclue's `GClueSimple` then waits for a `Location`
property update that a failed query never delivers). A stalled/failed
query therefore hangs clients indefinitely -- patched AND unpatched.
Measured: unpatched daemon logs "Failed to query location: Connection
terminated unexpectedly" at +7 s, client still waiting at +30 s.
Patched daemon logs "Failed to query location: Query location timed
out after 20 seconds" at +20 s, client still waiting at +60 s.

The client-notification gap is filed as the main defect with the
report (see `upstream-report-geoclue.md`, Report B); this MR is
deliberately only the two pieces that are uncontroversial:

1. a hard deadline on locate queries, so a stalled endpoint cannot
   hold a connection (and the daemon's "in use" state) for minutes;
2. failure logging at a visible level, so a daemon stuck in this
   state is diagnosable from the journal instead of presenting as a
   silent wedge.

## Commit message

```
web-source: Bound location queries with a deadline and log failures

All network geolocation ([ip] and WiFi sources) sends through
GClueWebSource on a bare soup_session_new(). libsoup's session timeout
is a per-socket-I/O inactivity timeout, not a request deadline: a
stalling endpoint keeps the query -- and through it the daemon's
busy state -- alive for minutes, and since waiting clients are never
notified of failures either (separate issue), a broken backend turns
into an undiagnosable hang: in one 81-minute window the service
consumed 1.6 s of CPU, held pending clients, and logged nothing,
while direct requests to the same endpoint from another process
succeeded.

Give each query an own GCancellable with a 20-second deadline
(over the WiFi scan allowance of 10 s, comfortably under any
reasonable client patience). Expired queries fail as
G_IO_ERROR_TIMED_OUT, and all query failures (timeout, transport,
HTTP status) are logged at info level with the endpoint URI and the
data-class description, so a broken backend is visible in the journal
instead of presenting as a hang.

Reproduced and verified with a local endpoint that accepts requests
and never answers (script in the bug report): patched daemon fails
the query at exactly 20 s and logs the reason; the build before the
patch retries/holds for 60+ s silently.
```

## MR description (paste into the MR body)

**Motivation** -- see commit message. Endpoint for the failure-story
is the linked bug report (deterministic reproduction included there:
stall-server + `[ip]` conf drop-in, A/B before/after).

**What the patch does**

- Per-query `GCancellable` (`priv->query_cancellable`) armed with a
  20 s `g_timeout_add_seconds` deadline (`QUERY_TIMEOUT_SECONDS`,
  documented in-place).
- Caller cancellation chained via `g_cancellable_connect` /
  `forward_query_cancelled`, caller held by strong ref, connection
  explicitly disconnected in `cancel_pending_query()` -- no leaked
  handler connections, caller-cancel semantics unchanged (verified:
  the CANCELLED error path is untouched).
- Deadline expiry converts CANCELLED into `G_IO_ERROR_TIMED_OUT`;
  timeout / transport / HTTP-status failures all log at info level
  with endpoint URI + data class only (no location data in logs).
- `cancel_pending_query()` wired into both teardown points
  (`cancellable_cancel_recreate`, `finalize`); the fire-and-forget
  submit path intentionally untouched.

**What it does NOT do** (deliberately): deliver failures to waiting
clients. `query_callback` currently drops every query error and the
client's `Start` completes before the first query even runs, so a
source failure leaves clients pending with no retry and no error --
that is the subject of the linked bug report and needs a design
decision (fail the client when no other source can serve it? retry
with backoff? both?). Happy to build on top of whichever the
maintainers prefer; this MR stands alone either way.

**Testing**

- Compiles clean against 2.8.2 (Fedora 44, gcc/meson/ninja current).
- Live A/B on a real GNOME session with a never-answering local
  endpoint: unpatched = query error logged at +7 s (transport abort)
  or 60+ s silence (true stall), client hangs; patched = typed
  timeout at exactly 20 s + info log, identical client behavior
  (hang persists -- the separate issue above).

## Operator status

Token pending. When filing: attach this patch to Report B (issue
attachment + offer to open MR), not a cold MR -- geoclue activity is
low and the patch complements rather than answers the main defect.
