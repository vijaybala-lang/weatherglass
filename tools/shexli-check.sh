#!/usr/bin/env bash
# tools/shexli-check.sh -- run EGO's own static analyzer over the dist zip.
#
# extensions.gnome.org reviews every upload with the `shexli` engine (the
# v8 review came back with four findings from exactly this tool). Its exit
# code is USELESS -- it returns 0 whatever it finds -- so the gate parses
# summary.status from --format json instead. Never trust $?; never ship on
# a status other than "clean".
#
# Host-gated like the golden lock: no engine -> loud SKIP (exit 0), never
# a fake PASS pretending analysis ran.
#
# Engine (Linux binary ^1.90, same one the review bot ships):
#   curl -sL -o /tmp/shexli.vsix https://github.com/NiffirgkcaJ/\
# shexli-gnome-extension/releases/download/v0.2.0/shexli-gnome-extension-0.2.0.vsix
#   unzip -o /tmp/shexli.vsix -d /tmp/shexli-x 'extension/*'
#   mkdir -p ~/.local/share/shexli && install -m755 \
#     /tmp/shexli-x/extension/vscode-extensions/extension/resources/bin/shexli \
#     ~/.local/share/shexli/shexli
# Or point WG_SHEXLI at any engine binary.
set -u
PROJ="$(cd "$(dirname "$0")/.." && pwd)"
ZIP="$PROJ/dist/weatherglass@vijaybala.dev.zip"
[[ -f "$ZIP" ]] || { echo "shexli: dist zip missing -- run tools/package.sh first" >&2; exit 1; }

BIN="${WG_SHEXLI:-}"
if [[ -z "$BIN" ]]; then
    for c in shexli "$HOME/.local/share/shexli/shexli"; do
        if command -v "$c" >/dev/null 2>&1; then BIN="$(command -v "$c")"; break; fi
        [[ -x "$c" ]] && { BIN="$c"; break; }
    done
fi
if [[ -z "$BIN" ]]; then
    echo "shexli: engine not found -- SKIP (analysis NOT performed; set WG_SHEXLI or"
    echo "        install per the header -- the reviewer WILL run it)"
    exit 0
fi

OUT="$(mktemp /tmp/opencode/shexli-XXXXXX.json)"
trap 'rm -f "$OUT"' EXIT
"$BIN" --format json "$ZIP" >"$OUT" 2>/dev/null
if [[ ! -s "$OUT" ]]; then
    echo "shexli: engine produced no analysis -- FAIL (cannot certify blind)" >&2
    exit 1
fi
if python3 - "$OUT" <<'PY'
import json, sys
d = json.load(open(sys.argv[1]))
s = d.get('summary', {})
n = int(s.get('finding_count', 0))
if n == 0 and s.get('status') in ('clean', 'ok', None):
    print(f'shexli: clean ({s.get("status", "?")}, spec {d.get("spec_version", "?")})')
    sys.exit(0)
print(f'shexli: {n} finding(s), status={s.get("status")}')
for f in d.get('findings', []):
    print(f'  {f.get("rule_id")} [{f.get("severity")}] {f.get("title")}')
    for e in f.get('evidence', [])[:4]:
        print(f'      {e.get("path", "").split(":")[-1]}:{e.get("line")}  {e.get("snippet", "")[:70]}')
sys.exit(1)
PY
then exit 0; else
    echo "shexli: the EGO reviewer will file these verbatim -- fix or escalate" >&2
    exit 1
fi
