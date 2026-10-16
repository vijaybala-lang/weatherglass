#!/usr/bin/env bash
# tools/qa/run.sh — certify the current build on an OLDER gnome-shell in
# a Fedora container (host side).
#
#   tools/qa/run.sh [RELEASE] [--force-build]
#
# Fedora RELEASE (default 43) is resolved to the gnome-shell it carries
# (43 -> GNOME 49). The image hosts the whole certify ladder; see the
# guest script of the same name for grading rules. Artifacts land in
# tools/out/qa-gnome<SHELL>/ ; exit 0 means the guest's own pixel,
# property, capture, zip-boot and exception gates all voted green.
set -uo pipefail
PROJ="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$PROJ" || exit 1

RELEASE="${1:-43}"; FORCE="${2:-}"
SHELL_V=$((RELEASE + 6))                  # fedora N carries gnome N+6
IMAGE=localhost/wg-qa:$RELEASE
LABEL=gnome-$SHELL_V
OUT="$PROJ/tools/out/qa-$LABEL"

if [ "$FORCE" = --force-build ] || ! podman image exists "$IMAGE"; then
    echo "==> building $IMAGE (this dnf-installs gnome $SHELL_V; patient)"
    podman build -f tools/qa/fedora.Containerfile --build-arg RELEASE="$RELEASE" \
        -t "$IMAGE" || exit 1
fi

rm -rf "$OUT"; mkdir -p "$OUT"
echo "==> running ladder: $IMAGE as $LABEL -> $OUT"
timeout 3600 podman run --rm \
    --security-opt label=disable --shm-size=2g \
    -v "$PROJ":/src:ro -v "$OUT":/out \
    -e QA_SHELL_LABEL="$LABEL" \
    -e WG_PROBE_TIMEOUT="${WG_PROBE_TIMEOUT:-600}" \
    "$IMAGE" bash /src/tools/qa/run.sh
RC=$?
echo "==> guest exit $RC; artifacts: $OUT"
exit $RC
