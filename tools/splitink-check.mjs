/* splitInk unit check: moon-disc scenarios (offscreen, no shell needed) */
import {splitInk, judgeInk, INK_DARK, INK_LIGHT, ratio} from '../chart.js';

const DISC = [0.94, 0.95, 0.97];        // full-moon disc (bright)
const SKY = [0.07, 0.09, 0.16];         // night sky (dark)
const MID = [0.42, 0.45, 0.52];         // disc's soft outer rim
const n = (bg, k = 5) => Array.from({length: k}, () => bg);
let fail = 0;
const ck = (name, cond) => {
    if (!cond) { log(`SPLITINK FAIL: ${name}`); fail = 1; }
    else log(`ok: ${name}`);
};

// S1: icon pair, one fully on the disc, one fully on sky
let p = splitInk([n(DISC), n(SKY)]);
ck('S1 group stays light', p[0].ink === INK_LIGHT || p[1].ink === INK_LIGHT);
ck('S1 disc icon flips dark', p[0].ink === INK_DARK);
ck('S1 sky icon stays white', p[1].ink === INK_LIGHT);
ck('S1 flip is crisp (no emboss)', !p[0].emboss);

// S2: city label straddles disc/sky; clock+icons on disc; one tab on sky
p = splitInk([n(DISC, 3).concat(n(SKY, 2)),   // city: straddles
              n(DISC), n(DISC),                 // clock, icon on disc
              n(SKY)]);                         // tab on sky
ck('S2 straddler not split (rides group)',
   p[0].ink === p[1].ink || p[0].emboss || p[0].ink === p[2].ink);
ck('S2 full-disc actors dark',
   p[1].ink === INK_DARK && p[2].ink === INK_DARK);
ck('S2 sky actor white', p[3].ink === INK_LIGHT);

// S3: icon fully on the moon ALONE: consensus==own => dark
p = splitInk([n(DISC)]);
ck('S3 solo disc actor dark', p[0].ink === INK_DARK);

// S4: mid-tone bg: white clears 4.8:1 linearly and dark lacks the 1.35
// halation margin -> white, crisp
p = splitInk([n(MID)]);
ck('S4 mid-tone stays white', p[0].ink === INK_LIGHT);
ck('S4 mid-tone crisp', !p[0].emboss);
// S4b: actor straddling disc+sky: no ink wins everywhere -> white with
// the emboss cue (the documented halo path: white + dark shadow)
p = splitInk([n(DISC, 3).concat(n(SKY, 3))]);
ck('S4b straddler white', p[0].ink === INK_LIGHT);
ck('S4b straddler embossed (halo cue)', p[0].emboss);

// S5: empty actor follows the group, never invents an ink
p = splitInk([[], n(SKY)]);
ck('S5 empty follows group', p[0].ink === p[1].ink);

// Sanity: ratios we assume
ck('ratio white-on-disc hopeless', ratio(INK_LIGHT, DISC) < 1.2);
ck('ratio dark-on-disc strong', ratio(INK_DARK, DISC) > 10);

log(fail ? 'SPLITINK: FAIL' : 'SPLITINK: ALL PASS');
imports.system.exit(fail);
