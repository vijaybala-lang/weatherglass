#!/usr/bin/env python3
import os
from PIL import Image

B, A, OUT = "/tmp/opencode/wg-before", "/tmp/opencode/wg-after", "/tmp/opencode/wg-strips"
os.makedirs(OUT, exist_ok=True)
SCALE, BOX = 2.5, (4, 106, 326, 152)  # strip band crop region

for f in sorted(os.listdir(A)):
    if not f.endswith(".png"):
        continue
    before = Image.open(os.path.join(B, f)).convert("RGBA").crop(BOX)
    after = Image.open(os.path.join(A, f)).convert("RGBA").crop(BOX)
    w, h = before.size
    def up(im):
        return im.resize((int(w * SCALE), int(h * SCALE)), Image.NEAREST)
    bu, au = up(before), up(after)
    W, H = bu.size
    canvas = Image.new("RGBA", (W, H * 2 + 10), (20, 22, 30, 255))
    canvas.paste(bu, (0, 0))
    canvas.paste(au, (0, H + 10))
    canvas.convert("RGB").save(os.path.join(OUT, f.replace(".png", "-cmp.jpg")), quality=90)
    print("cmp", f)
print("done")
