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

```sh
PREV=$(git tag --sort=-v:refname | head -1)
git diff "$PREV..master" --stat
tools/review-diff "$PREV" master    # read every hunk; justify or delete
```

Every user-visible fix in that diff should trace to a named regression
lock in `tests/` (a `*.test.mjs` for logic, a matrix cell for anything
a screenshot could catch). A shipped fix with no lock is a gap to
close before release, not after the next regression.

### 1. Version bump

`metadata.json` version goes up by exactly one -- EGO latches on the
integer, and it lives inside the zip, so the bump precedes the final
build. Exception: if EGO returned the SAME version as needs-work,
resubmit the same number (a bump would strand the flagged build in
the reviewer queue).

### 2. Certify the release commit itself

```sh
bash tools/certify.sh        # must end: CERTIFIED: all stages green
git checkout -- po/ locale/  # packaging stamps build artifacts; keep the tree clean
sha256sum dist/weatherglass@vijaybala.dev.zip
```

`CERTIFIED` is the whole suite standing at attention on the release
commit: unit locks, the scenario matrix pixel-graded against the
contrast each ground was promised, the coverage grid, the golden lock,
and a nested-shell boot of the real zip. The sha goes into the release
body at step 3. Any rebuild re-runs both.

**The golden lock and the bless ceremony.** The goldens
(`tools/golden/shell/`) are blessed rendered truth: every
golden-named fixture re-renders inside a disposable gnome-shell and
byte-diffs against it. A mismatch at release time means the candidate
drew something different than what was canonized -- that is either a
visual regression (fix it, ship nothing) or a deliberate change whose
bless ceremony was never done. Blessing (`bash tools/shell-golden.sh
card bless <slug>`) is a deliberate act: it re-canonicalizes the
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

### 4. Live-session verification (the operator's eyes)

```sh
gnome-extensions install --force dist/weatherglass@vijaybala.dev.zip
```

The zip ships a compiled schema (v8+), so this installs cleanly in a
running session; still ask the operator for ONE logout/login (GJS
caches modules per process) and have them walk: panel + menu in dark
and light themes, animated/solid/accent styles, hover + selected
tiles, prefs. The verified zip must be byte-identical to the uploaded
one -- never verify a rebuild and ship a different build.

### 5. Captures and demo, from the verified build only

Reshoot the seven files under `screenshots/` (order and subjects:
`ego-upload-notes.md` § Screenshots) and record the demo cast
(`weatherglass-demo-card.mp4`, the menu tab-morph + night scenes).
Captures from older builds are history, not inputs -- they photograph
whatever bugs shipped then. Land them as one PR:
`docs: refresh vN upload captures`.

### 6. Publish the release, then prove the demo URL alive

```sh
gh release upload vN weatherglass-demo-card.mp4
gh release edit vN --draft=false
curl -sI https://github.com/vijaybala-lang/weatherglass/releases/download/vN/weatherglass-demo-card.mp4 | head -1   # must be 200
```

The manifest description embeds this exact URL, and the EGO page is
rendered from the manifest at upload time -- a 404 here becomes the
extension page's demo link. Fix the manifest URL (via PR) before
uploading, never after.

### 7. Bump the README's release links

The README points at a specific release tag (the demo-capture line,
and any install links). Update every `releases/tag/v(N-1)` reference to
`vN` in a `docs: point README at vN` PR. This and step 3 together are
"the release list is updated" -- don't close the release until both
land.

### 8. Upload

Submit `dist/weatherglass@vijaybala.dev.zip` (the verified bytes) at
https://extensions.gnome.org/upload/ . Standing answers for reviewer
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
