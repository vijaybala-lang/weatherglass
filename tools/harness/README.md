# harness

Dev-only render harness (never packaged, never in the zip).
It boots a disposable headless gnome-shell, renders the REAL
ForecastPanel from mocked-by-construction fixtures, and its captures
ARE the canon: the blessed goldens live in `tools/golden/shell/`.
See `tools/shell-golden.sh` for run modes (`card check|bless`, one
boot for all 47), the full door map (which GNOME 50 capture/eval APIs
are gated and which are not), and the bless ceremony rules.

Film mode (`tools/film.sh`, stage 3) is the same machine put on a
timer: the golden rig on a beat sheet, capturing the live menu region
every ~33 ms and encoding `weatherglass-demo-card.mp4` -- the EGO
demo video, generated not recorded. Same fixture honesty (only the
scene is a fixture; morph/sky/fade timing is real), so it is a
standalone smoke lock (`--check`), never a certify stage -- video
frames are not byte-diffable and the goldens remain the pixel canon.
