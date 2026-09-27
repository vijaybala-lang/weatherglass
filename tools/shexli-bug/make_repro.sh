#!/usr/bin/env bash
# Minimal shexli 0.2.1 segfault repro:
#   ./make_repro.sh          builds /tmp/shexli-repro/ as a valid 1-file
#                            extension package; shexli on it SIGSEGVs.
# Threshold: N-1 comment lines exits 0, N lines segfault (N=255 measured
# on python 3.12 + tree-sitter 0.26.0 / tree-sitter-javascript 0.25.0).
set -eu
N=${1:-255}
D=/tmp/shexli-repro
rm -rf "$D"; mkdir -p "$D"
cat > "$D/metadata.json" <<'MD'
{
  "uuid": "repro@example.com",
  "name": "Repro",
  "description": "shexli segfault repro",
  "shell-version": ["50"],
  "url": "https://example.com",
  "version": 1
}
MD
{
  echo "import GLib from 'gi://GLib';"
  echo "export const a = 1;"
  for _ in $(seq 1 "$N"); do echo "//"; done
  echo "export const b = 2;"
} > "$D/extension.js"
echo "$D ready with $N comment lines"
