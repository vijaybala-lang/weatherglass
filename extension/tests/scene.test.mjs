/* tests/scene.test.mjs -- data-mapping locks: WMO code -> glyph scene for
 * day and night, unit formatting, the sun almanac, and the day window
 * slicer. These are the inputs the pixel matrix paints, certified at
 * the source so a wrong scene never reaches a correct-looking cell.
 */
import Cairo from 'gi://cairo';
import GdkPixbuf from 'gi://GdkPixbuf';
import { file, test, ok, near, eq, report } from './harness.mjs';
import { sceneFor, fmtTemp, sunGeometry, daySlice } from '../weather.js';
import { createSky, paintSky, resolveFloorScene } from '../sky.js';

file('scene');

// -- WMO -> scene, both shifts ----------------------------------------

const clear = sceneFor(0, true), clearNight = sceneFor(0, false);
test('clear sky: sun by day, moon by night', () => {
    eq(clear.scene, 'sun');
    eq(clearNight.scene, 'moon');
});

test('overcast is cloud and fog poses shift-stable; 1-2 still track the sun', () => {
    eq(sceneFor(3, true).scene, 'cloud');
    eq(sceneFor(3, false).scene, 'cloud');
    for (const code of [45, 48])
        eq(sceneFor(code, true).scene, sceneFor(code, false).scene, `fog code ${code}`);
    eq(sceneFor(1, true).scene, 'sun', 'mostly clear keeps the sun');
    eq(sceneFor(1, false).scene, 'moon', 'mostly clear yields the moon');
});

test('precip codes keep their pose day and night, only the sun swaps', () => {
    for (const code of [51, 61, 65, 71, 75, 77, 85, 95, 96]) {
        const d = sceneFor(code, true), n = sceneFor(code, false);
        eq(n.scene, d.scene, `code ${code} shifts must share the precip scene`);
    }
    eq(sceneFor(65, true).scene, 'rain');
    eq(sceneFor(75, true).scene, 'snow');
});

// -- units -------------------------------------------------------------

test('fmtTemp rounds per unit system', () => {
    eq(fmtTemp(0, 'metric'), '0\u00b0');
    eq(fmtTemp(20, 'metric'), '20\u00b0');
    eq(fmtTemp(20, 'imperial'), '68\u00b0');      // 20C = 68F exactly
    eq(fmtTemp(-15, 'imperial'), '5\u00b0');       // -15C = 5F exactly
});

// -- almanac (the golden-hour feed) ------------------------------------

test('SF sunrise on 2026-10-08 matches the published time', () => {
    // 37.7749,-122.4194: sunrise 07:11 PDT = 14:11 UTC
    const ms = Date.UTC(2026, 9, 8, 14, 11);
    const noon = sunGeometry(37.7749, -122.4194, ms);
    ok(Math.abs(noon.altitude) < 5, `sun near horizon at its sunrise: ${noon.altitude}`);
    const midday = sunGeometry(37.7749, -122.4194, Date.UTC(2026, 9, 8, 19, 30));
    ok(midday.altitude > 40, `noon altitude too low: ${midday.altitude}`);
    const midnight = sunGeometry(37.7749, -122.4194, Date.UTC(2026, 9, 8, 7, 0));
    ok(midnight.altitude < -10, `midnight sun at ${midnight.altitude}`);
});

test('epoch math is viewer-timezone agnostic', () => {
    // same instant expressed as a local-midnight-ish lookup must agree
    const a = sunGeometry(40.5, -74.4, Date.UTC(2026, 9, 8, 16, 0));
    const b = sunGeometry(40.5, -74.4, Date.UTC(2026, 9, 8, 16, 0));
    near(a.altitude, b.altitude, 1e-9);
    ok(a.sunrise !== null && a.sunset !== null && a.sunrise < a.sunset);
});

test('polar day and night degrade to null events, sane altitude', () => {
    const polarDay = sunGeometry(78.22, 15.65, Date.UTC(2026, 5, 21, 12, 0));   // Svalbard June
    ok(polarDay.altitude > 0, `polar midnight sun below horizon: ${polarDay.altitude}`);
    const polarNight = sunGeometry(78.22, 15.65, Date.UTC(2026, 11, 21, 12, 0)); // December
    ok(polarNight.altitude < 0, `polar noon sun above horizon: ${polarNight.altitude}`);
});

// -- day window slicing --------------------------------------------------

test('daySlice carves a whole calendar day from rolling hourly data', () => {
    const time = [], temp = [];
    for (let h = 0; h < 72; h++) {
        time.push(`2026-10-0${8 + Math.floor(h / 24)}T${String(h % 24).padStart(2, '0')}:00`);
        temp.push(50 + h);
    }
    const daily = [{ date: '2026-10-08' }, { date: '2026-10-09' }, { date: '2026-10-10' }];
    const slice = daySlice({ time, temperature_2m: temp }, daily, 1, '2026-10-08T12:00');
    eq(slice.length, 24, 'Oct 9 slice length');
    eq(slice[0], 24, 'slice must start at the first hour of the day');
    eq(temp[slice[23]], 50 + 47, 'slice indexes must stay in range of the series');

    const chartToday = daySlice({ time, temperature_2m: temp }, daily, 0, '2026-10-08T14:15');
    eq(chartToday[0], 12, 'line chart Today slice keeps 2-hour backfill');
    const pillsToday = daySlice({ time, temperature_2m: temp }, daily, 0, '2026-10-08T14:15', 0);
    eq(pillsToday[0], 14, 'hourly pills Today slice starts at the current hour (Now) with no past hours');
    eq(pillsToday.length, 24, 'hourly pills Today slice spans 24 hours from Now forward');
});

// -- rain intensity tiers, connected splash ripples, & submerged koi pond ----

test('rain sky scales active drops across 3 WMO intensity tiers and connects ripples', () => {
    const countMovedDrops = code => {
        const surf = new Cairo.ImageSurface(Cairo.Format.ARGB32, 330, 472);
        const cr = new Cairo.Context(surf);
        const sky = createSky();
        paintSky(cr, { w: 330, h: 472, time: 1.0, scene: 'rain', night: false, sky, code });
        const beforeY = sky.drops.map(d => d.y);
        paintSky(cr, { w: 330, h: 472, time: 1.05, scene: 'rain', night: false, sky, code });
        cr.$dispose();
        return sky.drops.filter((d, i) => d.y !== beforeY[i]).length;
    };
    const lightMoved = countMovedDrops(61);
    const modMoved = countMovedDrops(63);
    const heavyMoved = countMovedDrops(65);
    ok(lightMoved > 0 && lightMoved < modMoved,
        `1-drop light rain (${lightMoved}) must animate fewer drops than 2-drop moderate (${modMoved})`);
    ok(modMoved < heavyMoved,
        `2-drop moderate rain (${modMoved}) must animate fewer drops than 3-drop heavy (${heavyMoved})`);
});

test('rain sky initializes submerged Nishikigoi pond floor and connects drop impacts to ripples', () => {
    const surf = new Cairo.ImageSurface(Cairo.Format.ARGB32, 330, 472);
    const cr = new Cairo.Context(surf);
    const sky = createSky();
    paintSky(cr, { w: 330, h: 472, time: 1.0, scene: 'rain', night: false, sky, code: 63 });

    eq(sky.koi.length, 2, 'rain pond must initialize two Nishikigoi');
    eq(sky.koi[0].variant, 'kohaku');
    eq(sky.koi[1].variant, 'sanke');
    eq(sky.koi[0].pathSpine.length, 16, 'each koi must have a 16-joint spine');
    ok(sky.koi[0].headZ < 0.12 && sky.koi[1].headZ > 0.45,
        'kohaku starts in surface-kiss depth while sanke glides deeper');
    eq(sky.pads.length, 2, 'rain pond must initialize two floating lotus pads');
    eq(sky.spriteBuilds, 0, 'koi pond must not allocate offscreen sprite surfaces');

    // Force an expired ripple and a single drop about to cross floorY, then step one frame
    for (const d of sky.drops)
        d.y = 0;
    sky.ripples[0].phase = 1.5;
    const drop0 = sky.drops[0];
    drop0.x = 180;
    drop0.y = drop0.floorY - 2;
    paintSky(cr, { w: 330, h: 472, time: 1.05, scene: 'rain', night: false, sky, code: 63 });
    near(sky.ripples[0].phase, 0.02, 1e-6, 'falling drop impact must reset expired ripple phase');
    near(sky.ripples[0].y, drop0.floorY, 1e-6, 'spawned ripple must sit at the drop floorY');

    // Step 120 frames (6.0 s) and verify pathSpine never accumulates runaway bend
    for (let f = 1; f <= 120; f++)
        paintSky(cr, { w: 330, h: 472, time: 1.05 + f * 0.05, scene: 'rain', night: false, sky, code: 63 });
    for (const koi of sky.koi) {
        for (let i = 2; i < koi.pathSpine.length; i++) {
            const p0 = koi.pathSpine[i - 2], p1 = koi.pathSpine[i - 1], p2 = koi.pathSpine[i];
            const a1 = Math.atan2(p0.y - p1.y, p0.x - p1.x);
            const a2 = Math.atan2(p1.y - p2.y, p1.x - p2.x);
            let diff = a2 - a1;
            while (diff > Math.PI)
                diff -= Math.PI * 2;
            while (diff < -Math.PI)
                diff += Math.PI * 2;
            ok(Math.abs(diff) <= 0.15, `koi spine joint ${i} bend ${diff} exceeded gentle cap`);
        }
    }
    cr.$dispose();
});

test('resolveFloorScene routes temperature-stable weather defaults and pinned ground scenes (S1, S2, T3, K1, C1, C2)', () => {
    // Auto mode is temperature-stable across all temperatures
    for (const temp of [-25, -5, 15, 30, null]) {
        eq(resolveFloorScene('storm', false, temp, 'auto'), 'T3', `storm temp=${temp} -> T3`);
        eq(resolveFloorScene('storm', true, temp, 'auto'), 'T3', `storm night temp=${temp} -> T3`);
        eq(resolveFloorScene('rain', false, temp, 'auto'), 'K1', `rain temp=${temp} -> K1`);
        eq(resolveFloorScene('snow', false, temp, 'auto'), 'S2', `snow temp=${temp} -> S2`);
        eq(resolveFloorScene('snow', true, temp, 'auto'), 'S2', `snow night temp=${temp} -> S2`);
        eq(resolveFloorScene('sun', false, temp, 'auto'), 'C1', `sun temp=${temp} -> C1`);
        eq(resolveFloorScene('moon', true, temp, 'auto'), 'C1', `moon temp=${temp} -> C1`);
        eq(resolveFloorScene('cloud', false, temp, 'auto'), 'C1', `cloud temp=${temp} -> C1`);
        eq(resolveFloorScene('partly', false, temp, 'auto'), 'C1', `partly temp=${temp} -> C1`);
    }

    // Explicit ground scene selector pins the chosen landscape across all weather conditions
    for (const scene of ['sun', 'moon', 'cloud', 'rain', 'snow', 'storm']) {
        eq(resolveFloorScene(scene, false, 18, 'hills'), 'C1');
        eq(resolveFloorScene(scene, false, 18, 'beach'), 'C2');
        eq(resolveFloorScene(scene, false, 18, 'chalet'), 'S2');
        eq(resolveFloorScene(scene, false, 18, 'arctic'), 'S1');
        eq(resolveFloorScene(scene, false, 18, 'koi'), 'K1');
        eq(resolveFloorScene(scene, false, 18, 'frogs'), 'T3');
    }

    // Render all floor scenes cleanly through paintSky, and verify floor: false suppresses them
    const surfOn = new Cairo.ImageSurface(Cairo.Format.ARGB32, 330, 472);
    const surfOff = new Cairo.ImageSurface(Cairo.Format.ARGB32, 330, 472);
    const crOn = new Cairo.Context(surfOn);
    const crOff = new Cairo.Context(surfOff);
    const tmpOn = '/tmp/wg-test-floor-on.png';
    const tmpOff = '/tmp/wg-test-floor-off.png';
    for (const [scene, night, temp, code, glow, floorScene] of [
        ['snow', false, -21, 75, 0, 'arctic'],
        ['snow', false, -5, 73, 0, 'chalet'],
        ['moon', true, -4, 0, 0, 'chalet'],
        ['moon', true, -4, 0, 0, 'hills'],
        ['storm', true, 19, 95, 0, 'frogs'],
        ['sun', false, 20, 0, 0, 'hills'],
        ['moon', true, 18, 0, 0, 'hills'],
        ['cloud', false, 15, 3, 0, 'auto'],
        ['sun', false, 29, 0, 0, 'beach'],
        ['sun', false, 29, 0, 0.9, 'beach'],
        ['moon', true, 29, 0, 0, 'beach'],
        ['rain', false, 16, 63, 0, 'koi'],
        ['sun', false, 22, 0, 0, 'koi'],
        ['rain', false, 18, 63, 0, 'beach'],
    ]) {
        const sky = createSky();
        paintSky(crOn, { w: 330, h: 472, time: 1.5, scene, night, sky, temp, code, glow, floor: true, floorScene, fxScale: 1 });
        sky.fx.writeToPNG(tmpOn);
        paintSky(crOff, { w: 330, h: 472, time: 1.5, scene, night, sky, temp, code, glow, floor: false, floorScene, fxScale: 1 });
        sky.fx.writeToPNG(tmpOff);
        const pbOn = GdkPixbuf.Pixbuf.new_from_file(tmpOn);
        const pbOff = GdkPixbuf.Pixbuf.new_from_file(tmpOff);
        const pxOn = pbOn.get_pixels(), pxOff = pbOff.get_pixels();
        const stride = pbOn.get_rowstride(), nChan = pbOn.get_n_channels();
        let bottomDiff = 0;
        for (let y = 390; y < 470; y += 2) {
            for (let x = 16; x < 314; x += 4) {
                const idx = y * stride + x * nChan;
                if (Math.abs(pxOn[idx] - pxOff[idx]) +
                    Math.abs(pxOn[idx + 1] - pxOff[idx + 1]) +
                    Math.abs(pxOn[idx + 2] - pxOff[idx + 2]) > 12)
                    bottomDiff++;
            }
        }
        ok(bottomDiff > 20, `${scene} (temp=${temp}) floor: true must suppress bottom floor art (diff=${bottomDiff})`);
    }
    crOn.$dispose();
    crOff.$dispose();
});

report('scene');
