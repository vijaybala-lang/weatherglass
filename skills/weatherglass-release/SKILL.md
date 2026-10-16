---
name: weatherglass-release
description: Ship a Weatherglass release to extensions.gnome.org (EGO) -- version bump, certification gate, GitHub release-list upkeep (draft release, assets, publish), README release-link bump, live-session verification, upload captures and demo video, zip upload and its sha record, and post-approval hygiene. Use whenever any Weatherglass release or version is prepared, bumped, cut, uploaded, or wrapped up -- "prep for the next release", "ready to upload?", "bump to vN", "update the release list" -- and whenever a GitHub release is missing, stale, or its demo URL 404s.
---

# Weatherglass release ritual

Every concrete release command lives in this file and nowhere else.
That is a bug lesson, not a style rule: the manual `glib-compile-schemas`
install step once lived in both `AGENTS.md` and the upload kit, and
outlived the zip bug that made it necessary -- two homes meant two
stale copies. A `guide` lock keeps the split honest (command lines
outside this skill fail the suite).

| File | Role |
|------|------|
| `skills/weatherglass-release/SKILL.md` (here) | every command, in order |
| `AGENTS.md` § Pre-upload release review | the semantic principles (justify hunks, dead-code sweep, best-practices audit) -- prose only |
| `ego-upload-notes.md` | EGO-page material: manifest description mirror (verbatim, test-locked), capture order, standing reviewer answers |

The GitHub release is **part of the release**, not a footnote: v7 went
to EGO without one, the manifest's demo URL pointed at a nonexistent
tag, and the release list rotted to v6. Step 3 and step 7 exist so
that never recurs -- a release is not cut until the tag, its assets,
and the README links all agree.

## The ritual

Work in a fresh worktree off `master`; never release from the main
checkout. All commits carry
`--author="vijaybala-lang <vijaybala-lang@users.noreply.github.com>"`.

### 0. Pre-upload release review (principles: AGENTS.md)

Audit the scope BETWEEN TAGS -- everything shipping is exactly the
diff since the last release, so the best-practices validation runs
over precisely that file set (the token rules are machine-enforced by
the `guide` lock inside certify; this is the semantic half no regex
can see):

```sh
PREV=$(git tag --sort=-v:refname | head -1)
git diff "$PREV..master" --stat
git diff --name-only "$PREV..master"          # the audit file set
tools/review-diff "$PREV" master              # read every hunk (Meld or vimdiff)
```

Then validate every changed file against `BEST-PRACTICES.md` -- our
distillation of the EGO review guidelines and best-practices doc --
by name, file by file: lifecycle cleanup (destroy what you create),
process isolation, modern GJS idioms, clean-code rules, settings +
metadata hygiene, and ZIP contents. Reviewer pet-peeve tokens get the
zero-tolerance treatment (unjustified try/catch, non-ASCII in
decorative strings, optional chaining on guaranteed APIs). Findings
are fixed in this same pass; anything where a rule contradicts how
this extension provably works (e.g. the measured-ground referee) gets
escalated with a reviewer-facing comment, not quietly ignored.

Every user-visible fix in that diff should trace to a named regression
lock in `tests/` (a `*.test.mjs` for logic, a matrix cell for anything
a screenshot could catch). A shipped fix with no lock is a gap to
close before release, not after the next regression.

### 1. Version bump

`metadata.json` version goes up by exactly one -- the integer
identifies the release to humans and the repo (EGO's page numbers are
its own upload serials and its served metadata is re-stamped with
them, so a "version 12" on the review page proves nothing about our
integer; see ego-upload-notes.md). The integer lives inside the zip,
so the bump precedes the final build.

**Addressing reviewer comments or findings does NOT bump the
version.** A review round -- needs-work returned, or comments arriving
while still in review -- is answered with the SAME version integer,
even when the fix changes code, re-certifies, rebuilds the zip, and
lands a fresh sha in the release body. The integer identifies the
RELEASE to EGO (bumping strands the flagged build in the queue and
opens a number that was never reviewed); the sha identifies the
BUILD. New bytes are normal mid-review -- a new number is not.
The only time to bump is a genuinely new release: EGO approved N,
the next submission is N+1.

**A shexli-clean build is not a reviewer-approved build.** Serial 11
passed shexli and was still rejected on mechanism: "Don't use
\`vfunc\`" -- the map/unmap lifecycle our own #63 fix had chosen. The
reviewer prescribed the shape (plain \`destroy()\` chaining up,
explicit child destroy); ship the shape they name, then encode the
preference as a guide.test lock so no future round relearns it. The
branch carrying an EGO answer must merge to master the moment review
runs it -- master must always build the zip under review.

### 2. Certify the release commit itself

```sh
bash tools/certify.sh        # must end: CERTIFIED: all stages green
git checkout -- po/ locale/  # packaging stamps build artifacts; keep the tree clean
sha256sum dist/weatherglass@vijaybala.dev.zip
bash tools/qa/run-old-shell.sh 43   # certify the OLDEST shell in metadata
                                    # shell-version; repeat per older major
                                    # (Fedora N houses GNOME N+6)
```

`CERTIFIED` is the whole suite standing at attention on the release
commit: unit locks, the scenario matrix pixel-graded against the
contrast each ground was promised, the coverage grid, the golden lock,
a nested-shell boot of the real zip, and finally the EGO review
engine itself -- shexli over the real zip (`tools/shexli-check.sh`;
host-gated SKIP if the engine binary is absent, which is NOT a pass
for step 8 purposes -- install it before uploading and run it green).
The sha goes into the release
body at step 3. Any rebuild re-runs both.

**The older-shell certs.** Host certify attests exactly one shell: the
dev box's. Every *older* major declared in `shell-version` owes its own
green cert: `tools/qa/run-old-shell.sh <fedora-release>` builds a podman
guest of that Fedora (Fedora N ships GNOME N+6) and runs the ladder
there -- every property stage on the foreign GJS, the FULL card registry
rendered as the real ForecastPanel and graded structurally, and the
SAME dist zip byte-for-byte installed via `gnome-extensions install` and
surviving the popup-toggle crash gate, plus a JS-error scan attributed
per shipped module. Rendered goldens cannot cross shells (different
font/render stacks), so foreign shells grade STRUCTURALLY and only
REPORT pixel drift vs the blessed canon (`diffs.txt`, median a fraction
of a percent is support; structural fallout is not); native renders
bank under `tools/out/qa-gnome<SHELL>/` beside the summary for human
eyes. A version wins its `shell-version` slot by certing, and LOSES it
the moment keeping it alive would cost version-branched code --
drop-over-branch, per BEST-PRACTICES.md. Companion test extensions in
`tools/` must stay unlocked to every certified shell too: a stale
single-major pin makes 49-era shells silently decline to load them,
turning green pipelines into empty no-heartbeat husks.

**The golden lock and the bless ceremony.** The goldens
(`tools/golden/shell/`) are blessed rendered truth: every
golden-named fixture re-renders inside a disposable gnome-shell and
byte-diffs against it. A mismatch at release time means the candidate
drew something different than what was canonized -- that is either a
visual regression (fix it, ship nothing) or a deliberate change whose
bless ceremony was never done. Blessing (`bash tools/shell-golden.sh
card bless <slug>`) is a deliberate act requiring **operator approval**
before the bless commit lands: goldens are the public
imagery -- the EGO screenshots ARE the goldens and the README gallery
promises them -- so re-canonicalizing pixels is publishing. The agent
shows the changed PNGs (paths, or previews) with what changed and why,
and waits for the human's yes, exactly like the live-session walk.
Blessing re-canonicalizes the
pixels, and its commit must carry the why, exactly like the
`RE-CANONISED` commits in history. If a bless belongs in the release
window, it lands as its own justified step-0 change before the final
build -- never bless the failing gate to make the gate pass.

### 3. GitHub release list: draft now, publish at step 6

```sh
cp "dist/weatherglass@vijaybala.dev.zip" /tmp/weatherglass-vN.zip
gh release create vN --draft --target master --title vN --notes "..."
gh release upload vN /tmp/weatherglass-vN.zip
```

Notes must state the honest lineage: if any version shipped to EGO
without a GitHub release, say so in one line rather than pretending
the list is complete. Include the step-2 sha. If the tag already
exists as a draft, reuse it (`gh release view vN`).

### 4. Live-session verification (agent installs, operator sees)

The install is mechanical -- the agent runs it, not the operator:

```sh
gnome-extensions install --force dist/weatherglass@vijaybala.dev.zip
```

Then stop touching the running session. The zip ships schema XML only
(EGO-P-006), and **gnome-shell never compiles user-extension schemas at
login** -- the CLI install must compile them itself, the same step
`./install.sh` runs for checkouts. Real users never hit this: the
Extensions app compiles on install, and EGO compiles SERVER-SIDE when
serving (the delivered tree carries a blob the uploaded zip never had).

```sh
glib-compile-schemas ~/.local/share/gnome-shell/extensions/weatherglass@vijaybala.dev/schemas
```

Skip it and login dies on `GLib.FileError: ... gschemas.compiled: No
such file`, and the ERROR state wedges until the NEXT login. And on a
host that ever received the website's build, GNOME 50's shell applies
EGO-served updates at session start -- its own updater, NOT
gnome-software (`org.gnome.software download-updates false` does not
stop it), triggered purely by version comparison. A verification
install must raise the INSTALLED metadata version above the served one
(local routing only -- the zip keeps the real integer; EGO never sees
installed metadata; check the served integer at
https://extensions.gnome.org/api/v1/extensions/ before the last login):

```sh
sed -i 's/"version": 8/"version": 99/' ~/.local/share/gnome-shell/extensions/weatherglass@vijaybala.dev/metadata.json
```

Do not try to rush the load with a runtime toggle either: GJS caches
modules per process, and toggling races destroy and wedges the state
until login. The operator's share is exactly one logout/login (announce it:
it closes any earlier wedged state too) and the surface walk: panel +
menu in dark and light themes, animated/solid/accent styles, hover +
selected tiles, prefs, and this release's must-sees named in the
release notes. Screenshot + pixel forensics after the walk are the
proof, and the verified zip must be byte-identical to the uploaded
one -- never verify a rebuild and ship a different build.

### 5. Upload imagery: screenshots are the goldens

What EGO shows as the extension's screenshots are the byte-locked
goldens in `tools/golden/shell/` (upload set and order:
`ego-upload-notes.md` § Screenshots). A separate live-photo set once
made sense; it became a second source of truth and rotted by
construction -- v7's night heroes photographed the invisible-moon bug
and every release since inherited the reshoot panic. Goldens cannot:
they are the same bytes the golden lock diffs, they re-canonicalize
only through bless commits carrying their why, so the upload set is
automatically the current truth.

The one image goldens cannot cover is the preferences window (a
window, not a card): `screenshots/05-preferences.png` stays, replaced
only when the prefs UI itself changes.

The demo video is GENERATED, not hand-recorded -- the tab/tile morph
is what a still cannot show, and film mode (`tools/film.sh`, #60)
casts it headlessly by putting the golden machine on a timer:

```sh
bash tools/film.sh              # -> tools/out/film/weatherglass-demo-card.mp4
bash tools/film.sh --check      # smoke lock (frames, painted rects, duration)
```

The provenance is the goldens' own honesty contract: a disposable
nested gnome-shell runs the same working-tree widgets the golden lock
certifies, with the scene fixture-forced (clock + weather, the hero
card cov-clear-night); the timing is REAL -- chart morphs, the sky
ticker and the scripted beats (tab switches, a day-tile tap exercising
the Today-morph, open/close) run live on the nested frame clock,
driven by direct calls into the panel, never synthetic input. Only the
scene is a fixture. Video frames are not byte-diffable, so film mode
is deliberately NOT a certify stage -- the goldens stay the pixel
canon, and `tools/film.sh --check` is the standalone smoke lock
(host-gated like the golden lock: SKIPs loudly without gnome-shell or
an h264 encoder, never a fake PASS).

### 6. Publish the release; the demo URL must resolve before a click can reach it

```sh
gh release edit vN --draft=false
```

The manifest description embeds the demo URL, and EGO renders the page
from the manifest -- so the invariant is *the link resolves before
anyone can click it*, not "before the zip is submitted." Two valid
orders:

- **Video ready:** attach then publish, then prove it --

  ```sh
  gh release upload vN weatherglass-demo-card.mp4
  curl -sI https://github.com/vijaybala-lang/weatherglass/releases/download/vN/weatherglass-demo-card.mp4 | head -1   # must be 200
  ```

- **Video pending** -- only when the generating host cannot cast it
  (film mode is host-gated: no gnome-shell or no h264 encoder in
  ffmpeg means the frames stand and the mp4 is SKIPped loudly, never
  faked): publish the release now, say so in one line of the release
  notes, and re-run `bash tools/film.sh` plus the attach +
  `curl -sI` check on a capable host the moment one exists. The URL
  is stable, so a later attach lights the EGO link with no zip
  re-upload. The window to close: EGO review can probe links any day,
  and users can from the first approval -- attach well before
  approval is plausible, not before upload.

Never ship a manifest URL pointing at a tag that will not exist;
pending means the *asset* waits, not the tag.

### 7. Bump the README's release links

The README points at a specific release tag (the demo-capture line,
and any install links). Update every `releases/tag/v(N-1)` reference to
`vN` in a `docs: point README at vN` PR (land it after step 6's
publish so the link is live the moment it merges) -- except the
demo-capture sentence when the video is pending: its claim is that the
capture LIVES in the release, so that line bumps in step 6's
attach-the-mp4 moment instead, when the claim becomes true (vN-1's
release page keeps the older cast in the meantime). This and step 3
together are "the release list is updated" -- don't close the release
until both land.

### 8. Upload

The upload artifact is ONE named file: **the release worktree's**
`dist/weatherglass@vijaybala.dev.zip` -- never a bare relative
`dist/`, which exists in every tree (a pre-commit rebuild in the main
checkout nearly became "the newest zip" at the v8 resubmit), and never
a download from the release page. Prove the bytes before the browser
opens:

```sh
sha256sum <release-worktree>/dist/weatherglass@vijaybala.dev.zip  # must equal the step-2 sha recorded in the release body
```

Any copy whose sha differs: submit nothing until it matches. Then
submit the verified zip at https://extensions.gnome.org/upload/ --
the SAME version integer when resubmitting a needs-work round (EGO
latches on the integer; a bump strands the flagged build in the
queue). Standing answers for reviewer
questions live in `ego-upload-notes.md` § Standing answers -- use them
verbatim rather than re-explaining.

### 9. After approval

Keep the manifest `url` pointed at the GitHub repo (EGO requires it);
link the EGO page from the README instead. Record the outcome (sha,
date) in the release body. Next release: N+1.

## When stuck

`certify.sh` output is the authority; `CERTIFIED` or nothing ships.
If the guide lock fires about file roles, the fix is always "command
back into this skill, prose stays where it is" -- never loosen the
lock.
