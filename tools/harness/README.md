# harness

Dev-only render harness (never packaged, never in the zip).
It boots a disposable headless gnome-shell, renders the REAL
ForecastPanel from mocked-by-construction fixtures, and its captures
ARE the canon: the blessed goldens live in `tools/golden/shell/`.
See `tools/shell-golden.sh` for run modes (`card check|bless`, one
boot for all 47), the full door map (which GNOME 50 capture/eval APIs
are gated and which are not), and the bless ceremony rules.
