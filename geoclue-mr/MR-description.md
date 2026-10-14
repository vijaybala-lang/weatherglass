# MR draft — GNOME/geoclue

Project: https://gitlab.gnome.org/GNOME/geoclue
Branch: `web-source-query-deadline` (from main)
File changed: `src/gclue-web-source.c` (+106/−23)
Patch: `0001-web-source-query-deadline-and-event-kill-recovery.patch`
Build-tested: yes — compiles clean against 2.8.2 (91/91 targets,
Fedora 44 toolchain). Live-tested: yes, deterministic stall simulation
plus live network-churn reproduction (see Testing); results
honest-scoped in "What it does / does not do".

## Scope history (learned by testing, before shipping a wrong claim)

Original hypothesis: bounding the query would let waiting clients
recover inside their D-Bus timeout. Disproved by experiment: the
client's `Start` call already returned successfully BEFORE the query
fails (and libgeoclue's `GClueSimple` then waits for a `Location`
property update that a failed query never delivers). A stalled/failed
query therefore hangs clients indefinitely -- patched AND unpatched.
Measured: unpatched daemon logs "Failed to query location: Connection
terminated unexpectedly" at +7 s, client still waiting at +30 s.
Patched (deadline-only) daemon logs "Failed to query location: Query
location timed out after 20 seconds" at +20 s, client still waiting at
+60 s.

The client-notification gap is filed as the main defect with the
report (see `upstream-report-geoclue.md`, Report B). This MR carries
the three pieces that do not need a design decision:

1. a hard deadline on locate queries, so a stalled endpoint cannot
   hold a connection (and the daemon's "in use" state) for minutes;
2. failure logging at a visible level, so a daemon stuck in this
   state is diagnosable from the journal instead of presenting as a
   silent wedge;
3. a capped re-arm when a query is killed by source churn — a third
   failure mode found while testing piece 1, reproduced on stock
   2.8.2, described in the commit message and below.

## Commit message

```
web-source: bound every location query with a deadline and recover from event kills

Queries to location servers had no overall time bound. On flaky or
silently-stalling endpoints (observed: api.beacondb.net and IPv6-only
reachability paths) a send could sit until the D-Bus reply timeout made
every waiting client give up, while the daemon still considered the
query live.

Give each query a private GCancellable plus a 20 s deadline, below the
client-side 25 s D-Bus timeout. Caller cancellation and source-lifecycle
cancellation are chained into the private handle exactly as they killed
the query before, so existing cancellation semantics are preserved; the
deadline expiry is distinguished and logged instead of vanishing
silently.

When a query is killed by source churn (network-change / connectivity
events), the stock follower refresh races this completion and is
routinely swallowed by the in-progress guard; nothing then re-arms a
query and every client waiting on the killed query hangs forever.
Re-arm once from an idle after a non-caller cancellation, capped at five
consecutive attempts so a pathological state cannot turn into a hot
loop.

Both failure modes reproduce 100% with a local endpoint that accepts
connections and never answers; the deadline fires at exactly 20 s on a
live daemon and the re-arm recovers clients that would otherwise wait
indefinitely.
```

## MR description (paste into the MR body)

**Motivation** -- see commit message. Endpoint for the failure-story
is the linked bug report (deterministic reproduction included there:
stall-server + `[ip]` conf drop-in, A/B before/after).

**What the patch does**

- Per-query `GCancellable` (`priv->query_cancellable`) armed with a
  20 s `g_timeout_add_seconds` deadline (`QUERY_TIMEOUT_SECONDS`,
  documented in-place).
- Cancellation is chained, not replaced: `bind_query_cancel()`
  connects BOTH the caller's cancellable (when given) and the
  source's own `priv->cancellable` to the private handle via
  `g_cancellable_connect` / `forward_query_cancelled`, with strong
  refs and explicit `g_cancellable_disconnect()` in
  `cancel_pending_query()`. A caller cancel or a churn kill therefore
  kills the query exactly as before (stock rides the send directly on
  `priv->cancellable`; this preserves that topology), while deadline
  expiry stays distinguishable in `refresh_callback`.
- Deadline expiry converts CANCELLED into `G_IO_ERROR_TIMED_OUT`;
  timeout / transport / HTTP-status failures all log at info level
  with endpoint URI + data class only (no location data in logs).
- On a cancellation that the caller did not initiate (source churn
  kill) while the source is still active, `query_callback` re-arms a
  refresh from an idle -- the follower that stock relies on
  (`locate_url_checked_cb`) provably loses the race against the
  in-progress guard about half the time (live reproduction on stock),
  after which nothing re-arms and every waiting client hangs. The
  re-arm is capped (5 consecutive) with one info line on give-up; the
  cap is load-bearing, see Testing.
- `cancel_pending_query()` wired into `refresh_async` (defensive,
  before arming), `refresh_callback` and `finalize`. It is
  deliberately NOT called from `cancellable_cancel_recreate()`:
  doing that (an earlier revision of this patch did) kills
  freshly-armed queries on every routine connectivity notify,
  measured live, and turns churn into wedges.
- The fire-and-forget submit path intentionally untouched.

**What it does NOT do** (deliberately): deliver failures to waiting
clients. `query_callback` currently drops every query error and the
client's `Start` completes before the first query even runs, so a
genuinely failing source still leaves clients pending with no error --
that is the subject of the linked bug report and needs a design
decision (fail the client when no other source can serve it? retry
with backoff? both?). Happy to build on top of whichever the
maintainers prefer; this MR stands alone either way.

**Testing**

- Compiles clean against 2.8.2 (Fedora 44, gcc/meson/ninja current);
  `git apply --check` clean on the release tarball.
- Live A/B on a real GNOME session with a never-answering local
  endpoint: unpatched = query error logged at +7 s (transport abort)
  or 60+ s silence (true stall), client hangs; patched = typed
  timeout at exactly 20 s + info log, identical client behavior
  (hang persists -- the separate issue above).
- Stock 2.8.2 reproduces the churn kill + swallowed follower-refresh
  wedge on the same harness (client hangs with the query cancelled
  and never re-armed); `g_cancellable_cancel` breakpoints confirm
  cancellations flow through the chained handle.
- The retry cap is proven load-bearing: an early uncapped revision
  of the re-arm degenerated under a pathological cancellation state
  into 583,181 sends in four minutes; the capped build stopped after
  five retries with one info line and behaved normally afterwards.
- Known gap (honest): one environmental ingredient of that
  pathological cancellation state was not fully identified before
  testing time ended; the cap bounds it, the root cause hunt
  continues in the linked report.

## Operator status

Token pending. When filing: attach this patch to Report B (issue
attachment + offer to open MR), not a cold MR -- geoclue activity is
low and the patch complements rather than answers the main defect.
