#!/usr/bin/env python3
"""tools/compose-demo.py -- compose animated weather-transition GIFs.

Film mode captures one fixture per run. This composer turns several of
those real, nested-shell captures into one uploadable sequence: it
samples every segment on a shared timeline, crossfades adjacent
segments while both keep playing, encodes a compact palette GIF
(scene-local palettes + transparent per-frame deltas by default), and
writes a contact sheet plus a JSON manifest for QA/provenance.

The default sequence is the one-day Berlin arc registered by
film-mode: sunny afternoon -> rain -> golden hour -> full-moon night.
Without --compose-only it shoots any missing segments through the
existing tools/film.sh entry point.

Examples (run from extension/):
    python3 tools/compose-demo.py
    python3 tools/compose-demo.py --compose-only
    python3 tools/compose-demo.py --fps 15 --segment-seconds 2
"""

import argparse
import hashlib
import json
import os
import shutil
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path

from PIL import Image, ImageChops, ImageStat

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_WORKDIR = ROOT / 'tools' / 'out' / 'demo-transitions'
DEFAULT_SEGMENTS = (
    ('sunny', 'demo-berlin-sunny'),
    ('rain', 'demo-berlin-rain'),
    ('golden', 'demo-berlin-golden'),
    ('fullmoon', 'demo-berlin-fullmoon'),
)
ALL_CONDITIONS = (
    'clear', 'wind', 'partly', 'cloud', 'fog',
    'drizzle', 'rain', 'showers', 'freezing', 'sleet',
    'snow', 'grains', 'snowshowers', 'storm', 'hail', 'unknown',
)
ALL_CONDITIONS_SEGMENTS = tuple(
    (f'{cond}-{slot}', f'cov-{cond}-{slot}')
    for slot in ('day', 'night')
    for cond in ALL_CONDITIONS
)
MAX_BATCH_SEGMENTS = 16


@dataclass
class Segment:
    name: str
    fixture: str
    directory: Path
    report_base: Path
    source_dir: Path
    frames: list
    rect: list

    @property
    def report_path(self):
        return Path(f'{self.report_base}.final')

    @property
    def last_ms(self):
        return self.frames[-1][0] if self.frames else -1


@dataclass
class Sample:
    # a == -1 means black; b is always a segment index. alpha is b's weight.
    a: int
    a_ms: float
    b: int
    b_ms: float
    alpha: float


def parse_segments(values):
    if not values:
        return list(DEFAULT_SEGMENTS)
    out = []
    seen = set()
    for value in values:
        if '=' not in value:
            raise SystemExit(f'--segment expects NAME=FIXTURE, got {value!r}')
        name, fixture = (part.strip() for part in value.split('=', 1))
        if not name or not fixture:
            raise SystemExit(f'--segment expects NAME=FIXTURE, got {value!r}')
        if name in seen:
            raise SystemExit(f'duplicate segment name: {name}')
        seen.add(name)
        out.append((name, fixture))
    if len(out) < 2:
        raise SystemExit('at least two segments are required for a transition demo')
    return out


def parse_args(argv=None):
    p = argparse.ArgumentParser(
        description='Compose a Weatherglass weather-transition GIF from film-mode segments.')
    p.add_argument('--workdir', type=Path, default=DEFAULT_WORKDIR,
                   help='segment captures, intermediate frames, and default outputs')
    p.add_argument('--output', type=Path,
                   help='GIF path (default: <workdir>/weatherglass-demo-transitions.gif)')
    p.add_argument('--segment', action='append', metavar='NAME=FIXTURE',
                   help='segment in sequence order; repeat to replace the default arc')
    p.add_argument('--all-conditions', '--day-night', action='store_true',
                   dest='all_conditions',
                   help='compose all 16 supported weather conditions in day and night modes')
    p.add_argument('--fps', type=int, default=None, help='GIF/MP4 frames per second')
    p.add_argument('--width', type=int, default=300,
                   help='output width in pixels (0 keeps the capture width)')
    p.add_argument('--segment-seconds', type=float, default=None,
                   help='full-strength playback seconds per segment')
    p.add_argument('--transition-seconds', type=float, default=None,
                   help='crossfade seconds between adjacent segments')
    p.add_argument('--intro-seconds', type=float, default=0.4,
                   help='opening fade from black')
    p.add_argument('--outro-seconds', type=float, default=0.5,
                   help='closing fade to black')
    p.add_argument('--start-seconds', type=float, default=0.35,
                   help='skip this much of each capture (the open fade)')
    p.add_argument('--shoot-seconds', type=float,
                   help='close beat for newly shot segments (default: computed)')
    p.add_argument('--timezone', default='Europe/Berlin',
                   help='TZ for film shoots, so card clocks read fixture-local')
    p.add_argument('--encoder', choices=('delta', 'ffmpeg'), default='delta',
                   help='delta: palette + transparent frame deltas; '
                        'ffmpeg: palettegen/paletteuse archival encode')
    p.add_argument('--palette-mode', choices=('scene', 'global'), default='scene',
                   help='delta encoder palette scope: one local palette per '
                        'scene/transition range, or one global palette')
    p.add_argument('--max-colors', type=int, default=256,
                   help='total GIF palette entries (delta reserves one for transparency)')
    p.add_argument('--delta-threshold', type=int, default=8,
                   help='delta encoder: max per-channel error treated as unchanged')
    mode = p.add_mutually_exclusive_group()
    mode.add_argument('--compose-only', action='store_true',
                      help='fail instead of shooting missing segment captures')
    mode.add_argument('--force-shoot', action='store_true',
                      help='recapture every segment even if frames exist')
    args = p.parse_args(argv)
    if args.all_conditions:
        args.segments = list(ALL_CONDITIONS_SEGMENTS)
        if args.fps is None:
            args.fps = 15
        if args.segment_seconds is None:
            args.segment_seconds = 0.85
        if args.transition_seconds is None:
            args.transition_seconds = 0.45
    else:
        args.segments = parse_segments(args.segment)
        if args.fps is None:
            args.fps = 12
        if args.segment_seconds is None:
            args.segment_seconds = 2.5
        if args.transition_seconds is None:
            args.transition_seconds = 0.8
    if not 5 <= args.fps <= 30:
        p.error('--fps must be between 5 and 30')
    if args.width != 0 and args.width < 120:
        p.error('--width must be 0 (native) or at least 120')
    if not 0 <= args.delta_threshold <= 254:
        p.error('--delta-threshold must be between 0 and 254')
    for name in ('segment_seconds', 'transition_seconds'):
        if getattr(args, name) <= 0:
            p.error(f'--{name.replace("_", "-")} must be positive')
    for name in ('intro_seconds', 'outro_seconds', 'start_seconds'):
        if getattr(args, name) < 0:
            p.error(f'--{name.replace("_", "-")} must not be negative')
    if not 2 <= args.max_colors <= 256:
        p.error('--max-colors must be between 2 and 256')
    if args.output is None:
        default_name = ('weatherglass-demo-all-conditions.gif'
                        if args.all_conditions
                        else 'weatherglass-demo-transitions.gif')
        args.output = args.workdir / default_name
    return args


def segment_shell(workdir, name, fixture):
    return Segment(
        name=name,
        fixture=fixture,
        directory=workdir / 'segments' / name,
        report_base=workdir / 'reports' / f'{name}.json',
        source_dir=workdir / 'src' / name,
        frames=[],
        rect=[],
    )


def needed_seconds(args):
    """Latest source instant sampled from any segment."""
    edge = max(args.intro_seconds + args.transition_seconds,
               2 * args.transition_seconds,
               args.transition_seconds + args.outro_seconds)
    return args.start_seconds + args.segment_seconds + edge


def shoot_segment(seg, args):
    seg.directory.mkdir(parents=True, exist_ok=True)
    seg.report_base.parent.mkdir(parents=True, exist_ok=True)
    seg.source_dir.mkdir(parents=True, exist_ok=True)
    shoot_seconds = args.shoot_seconds or needed_seconds(args) + 1.0
    beats = json.dumps([
        {'t': 0, 'do': 'open'},
        {'t': shoot_seconds, 'do': 'close'},
    ])
    env = dict(os.environ)
    env.update({
        'TZ': args.timezone,
        'WG_FILM_FIXTURE': seg.fixture,
        'WG_FILM_BEATS': beats,
        'WG_FILM_DIR': str(seg.directory),
        'WG_FILM_OUT': str(seg.report_base),
        'WG_FILM_SRC': str(seg.source_dir),
    })
    print(f"shoot {seg.name}: fixture={seg.fixture} close@{shoot_seconds:.1f}s")
    result = subprocess.run(['bash', 'tools/film.sh'], cwd=ROOT, env=env)
    if result.returncode != 0:
        # Film mode's smoke lock is calibrated for the standalone demo,
        # including a 120-frame floor. A segment capture is still good
        # when its final report and required frame window are present;
        # load_segment() is the authority for that narrower contract.
        print(f"warning: film.sh exited {result.returncode} for {seg.name}; "
              'checking captured frames before deciding', file=sys.stderr)


def load_segment(seg, args):
    if not seg.report_path.exists():
        raise SystemExit(f"missing capture report for {seg.name}: {seg.report_path}")
    report = json.loads(seg.report_path.read_text())
    if report.get('fixture') != seg.fixture:
        raise SystemExit(
            f"{seg.name}: report fixture {report.get('fixture')!r} != {seg.fixture!r}; "
            'recapture with --force-shoot')
    frames = []
    for item in report.get('frames', []):
        path = seg.directory / f"frame_{item['f']:03d}.png"
        if path.exists():
            frames.append((float(item['t']), path))
    if len(frames) < 10:
        raise SystemExit(f'{seg.name}: only {len(frames)} captured frames in {seg.directory}')
    seg.frames = sorted(frames)
    seg.rect = report.get('rect') or []
    required = needed_seconds(args) * 1000
    if seg.last_ms < required - 100:
        raise SystemExit(
            f'{seg.name}: capture ends at {seg.last_ms:.0f}ms, composer needs '
            f'{required:.0f}ms; recapture with --force-shoot or more --shoot-seconds')
    return seg


def shoot_segments_batch(batch, args, batch_idx=0):
    if len(batch) == 1:
        shoot_segment(batch[0], args)
        return
    req_s = needed_seconds(args)
    slot_0 = round((args.shoot_seconds or req_s) + 0.45, 2)
    slot_n = round(max(1.2, (args.shoot_seconds or req_s) - args.start_seconds + 0.50), 2)
    beats = [{'t': 0, 'do': 'open'}]
    windows = []
    cur = 0.0
    for idx, seg in enumerate(batch):
        dur = slot_0 if idx == 0 else slot_n
        if idx > 0:
            beats.append({'t': round(cur, 2), 'do': 'fixture', 'arg': seg.fixture})
        windows.append((round(cur * 1000), round((cur + dur) * 1000)))
        cur += dur
    beats.append({'t': round(cur, 2), 'do': 'close'})

    batch_root = args.workdir / 'batch' / f'run-{batch_idx:02d}'
    frames_dir = batch_root / 'frames'
    report_base = batch_root / 'report.json'
    src_dir = batch_root / 'src'
    mp4_path = batch_root / 'batch.mp4'
    frames_dir.mkdir(parents=True, exist_ok=True)
    src_dir.mkdir(parents=True, exist_ok=True)

    env = dict(os.environ)
    env.update({
        'TZ': args.timezone,
        'WG_FILM_FIXTURE': batch[0].fixture,
        'WG_FILM_BEATS': json.dumps(beats),
        'WG_FILM_DIR': str(frames_dir),
        'WG_FILM_OUT': str(report_base),
        'WG_FILM_SRC': str(src_dir),
        'WG_FILM_MP4': str(mp4_path),
        'WG_FILM_TIMEOUT': '600',
    })
    names = ', '.join(s.name for s in batch)
    print(f"batch shoot ({len(batch)} segments: {names}) close@{cur:.1f}s")
    subprocess.run(['bash', 'tools/film.sh'], cwd=ROOT, env=env)

    final_report = Path(f'{report_base}.final')
    if not final_report.exists():
        raise SystemExit(f'batch shoot failed: missing {final_report}')
    rep = json.loads(final_report.read_text())
    all_frames = rep.get('frames') or []
    start_offset_ms = round(args.start_seconds * 1000)

    for idx, (seg, (w_start, w_end)) in enumerate(zip(batch, windows)):
        seg.directory.mkdir(parents=True, exist_ok=True)
        seg.report_base.parent.mkdir(parents=True, exist_ok=True)
        for stale in seg.directory.glob('frame_*.png'):
            stale.unlink()
        raw = [fr for fr in all_frames if w_start <= fr['t'] < w_end]
        if not raw:
            raise SystemExit(f'batch shoot produced no frames for {seg.name} in [{w_start}, {w_end})')
        first_t = raw[0]['t']
        seg_frames = []
        for new_f, fr in enumerate(raw):
            src_png = frames_dir / f"frame_{fr['f']:03d}.png"
            dst_png = seg.directory / f"frame_{new_f:03d}.png"
            if src_png.exists():
                shutil.copy2(src_png, dst_png)
                local_t = (round(fr['t'] - w_start) if idx == 0
                           else round(fr['t'] - first_t + start_offset_ms))
                seg_frames.append({
                    'f': new_f,
                    't': local_t,
                    'bytes': fr.get('bytes'),
                })
        seg_rep = {
            'fixture': seg.fixture,
            'rect': rep.get('rect'),
            'endMs': seg_frames[-1]['t'] if seg_frames else 0,
            'frames': seg_frames,
        }
        seg.report_path.write_text(json.dumps(seg_rep, indent=1) + '\n')


def ensure_segments(args):
    segments = [segment_shell(args.workdir, name, fixture)
                for name, fixture in args.segments]
    missing = [seg for seg in segments
               if args.force_shoot or not seg.report_path.exists()]
    if missing:
        if args.compose_only:
            raise SystemExit(
                f'missing segment {missing[0].name} ({missing[0].fixture}); rerun without '
                '--compose-only to shoot it')
        for b_idx, start in enumerate(range(0, len(missing), MAX_BATCH_SEGMENTS)):
            shoot_segments_batch(
                missing[start:start + MAX_BATCH_SEGMENTS], args, b_idx)
    for seg in segments:
        load_segment(seg, args)
    rects = {tuple(seg.rect) for seg in segments}
    if len(rects) != 1 or not next(iter(rects)):
        raise SystemExit(f'segment capture rectangles differ: {sorted(rects)}')
    return segments


def smooth(x):
    x = max(0.0, min(1.0, x))
    return x * x * (3 - 2 * x)


def frame_count(seconds, fps):
    return max(0, int(round(seconds * fps)))


def build_timeline(args, segment_count):
    """Return (samples, labeled picks, palette ranges). Cursors are ms.

    Palette ranges start at the first frame, at each crossfade, and at
    each segment that follows a crossfade. The delta encoder can give
    those ranges local GIF palettes so daylight, rain, dusk, and night
    gradients do not all compete for one 256-entry table.
    """
    step = 1000.0 / args.fps
    start = args.start_seconds * 1000
    cursors = [start] * segment_count
    samples = []
    picks = []
    palette_starts = [0]

    intro = frame_count(args.intro_seconds, args.fps)
    if intro:
        picks.append(('intro', len(samples) + intro // 2))
    for i in range(intro):
        samples.append(Sample(-1, 0, 0, cursors[0], smooth(i / intro)))
        cursors[0] += step

    content = frame_count(args.segment_seconds, args.fps)
    transition = frame_count(args.transition_seconds, args.fps)
    for seg in range(segment_count):
        picks.append((f'{seg}-mid', len(samples) + content // 2))
        for _ in range(content):
            samples.append(Sample(seg, cursors[seg], seg, cursors[seg], 1.0))
            cursors[seg] += step
        if seg + 1 < segment_count:
            palette_starts.append(len(samples))
            picks.append((f'{seg}-to-{seg + 1}', len(samples) + transition // 2))
            for i in range(transition):
                alpha = smooth((i + 1) / (transition + 1))
                samples.append(Sample(seg, cursors[seg], seg + 1,
                                      cursors[seg + 1], alpha))
                cursors[seg] += step
                cursors[seg + 1] += step
            palette_starts.append(len(samples))

    outro = frame_count(args.outro_seconds, args.fps)
    if outro:
        picks.append(('outro', len(samples) + outro // 2))
    last = segment_count - 1
    for i in range(outro):
        samples.append(Sample(last, cursors[last], -1, 0,
                              smooth(i / outro) if outro else 1.0))
        cursors[last] += step
    samples.append(Sample(-1, 0, -1, 0, 1.0))
    starts = sorted(set(palette_starts))
    palette_ranges = []
    for idx, range_start in enumerate(starts):
        range_end = starts[idx + 1] if idx + 1 < len(starts) else len(samples)
        if range_start < range_end:
            palette_ranges.append((range_start, range_end))
    return samples, picks, palette_ranges


class FrameSource:
    def __init__(self, segments):
        self.segments = segments
        self.cache = {}
        first = self.frame_at(0, segments[0].frames[0][0])
        self.size = first.size
        self.black = Image.new('RGB', self.size, (0, 0, 0))
        # Validate every segment's raster size without loading all frames.
        for idx, seg in enumerate(segments):
            if self.frame_at(idx, seg.frames[0][0]).size != self.size:
                raise SystemExit(f'{seg.name}: frame size differs from first segment')

    def frame_at(self, seg_idx, t_ms):
        if seg_idx < 0:
            return self.black
        frames = self.segments[seg_idx].frames
        _, path = min(frames, key=lambda item: abs(item[0] - t_ms))
        if path not in self.cache:
            # A timeline can touch a few hundred unique captures; keep
            # the cache bounded while retaining hot neighbors.
            if len(self.cache) > 80:
                self.cache.clear()
            self.cache[path] = Image.open(path).convert('RGB')
        return self.cache[path]

    def render(self, sample):
        if sample.a < 0 and sample.b < 0:
            return self.black.copy()
        if sample.a < 0:
            return Image.blend(self.black, self.frame_at(sample.b, sample.b_ms),
                                sample.alpha)
        if sample.b < 0:
            return Image.blend(self.frame_at(sample.a, sample.a_ms), self.black,
                                sample.alpha)
        if sample.a == sample.b:
            return self.frame_at(sample.b, sample.b_ms).copy()
        return Image.blend(self.frame_at(sample.a, sample.a_ms),
                            self.frame_at(sample.b, sample.b_ms), sample.alpha)


def mean_luminance(image):
    return ImageStat.Stat(image.convert('L')).mean[0]


def check_output_frames(frames, picks):
    if mean_luminance(frames[0]) > 2:
        raise SystemExit('composed timeline does not start from black')
    if mean_luminance(frames[-1]) > 2:
        raise SystemExit('composed timeline does not end on black')
    for label, idx in picks:
        if 'mid' not in label:
            continue
        image = frames[idx]
        stat = ImageStat.Stat(image.convert('L'))
        if stat.mean[0] < 8 or stat.stddev[0] < 8:
            raise SystemExit(f'{label}: segment midpoint looks blank '
                             f'(mean={stat.mean[0]:.1f}, stddev={stat.stddev[0]:.1f})')


def write_contact_sheet(path, frames, picks, segment_names):
    labels = []
    for label, idx in picks:
        if label.endswith('-mid'):
            label = f"{segment_names[int(label.split('-')[0])]}-mid"
        elif '-to-' in label:
            a, b = (int(part) for part in label.split('-to-'))
            label = f'{segment_names[a]}-to-{segment_names[b]}'
        labels.append((label, idx))
    cols = 8 if len(segment_names) >= 16 else 4
    rows = (len(labels) + cols - 1) // cols
    w, h = frames[0].size
    sheet = Image.new('RGB', (cols * w, rows * h), (0, 0, 0))
    for slot, (_, idx) in enumerate(labels):
        sheet.paste(frames[idx], ((slot % cols) * w, (slot // cols) * h))
    sheet.save(path)
    return labels


def run_checked(command, **kwargs):
    result = subprocess.run(command, text=True, capture_output=True, **kwargs)
    if result.returncode != 0:
        raise SystemExit(
            f"command failed ({result.returncode}): {' '.join(map(str, command))}\n"
            f'{result.stdout}\n{result.stderr}'.strip())
    return result


def probe_gif(output):
    probe = run_checked([
        'ffprobe', '-v', 'error', '-select_streams', 'v:0',
        '-show_entries', 'stream=width,height,avg_frame_rate,nb_frames,duration',
        '-of', 'json', str(output),
    ])
    return json.loads(probe.stdout)['streams'][0]


def encode_gif_ffmpeg(frame_dir, output, args):
    output.parent.mkdir(parents=True, exist_ok=True)
    vf = (f'split[s0][s1];[s0]palettegen=max_colors={args.max_colors}:'
          'stats_mode=diff[p];[s1][p]paletteuse=dither=sierra2_4a:diff_mode=rectangle')
    run_checked([
        'ffmpeg', '-y', '-v', 'error', '-framerate', str(args.fps),
        '-i', str(frame_dir / 'frame_%04d.png'), '-vf', vf,
        '-loop', '0', str(output),
    ])
    return probe_gif(output)


def encode_mp4_ffmpeg(frame_dir, output, args):
    encs = subprocess.run(
        ['ffmpeg', '-hide_banner', '-encoders'],
        text=True, capture_output=True).stdout
    enc = None
    for cand in ('libx264', 'libopenh264'):
        if f' {cand} ' in encs:
            enc = cand
            break
    if not enc:
        return None
    mp4_path = output.with_suffix('.mp4')
    qual = ['-crf', '18', '-preset', 'slow'] if enc == 'libx264' else ['-b:v', '4M']
    run_checked([
        'ffmpeg', '-y', '-v', 'error', '-framerate', str(args.fps),
        '-i', str(frame_dir / 'frame_%04d.png'),
        '-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2',
        '-c:v', enc, *qual,
        '-pix_fmt', 'yuv420p', '-movflags', '+faststart', str(mp4_path),
    ])
    return mp4_path


def delta_palette(frame_paths, name, args):
    """One ffmpeg-derived palette for a frame range.

    palettegen's sequence quantization allocates the scarce entries
    to sky gradients far better than a median-cut contact sheet.
    Index 255 is reserved transparent; unused slots duplicate
    palette entry 0 during mapping, so any pixel the quantizer lands
    on 255 can be remapped to 0 losslessly before 255 is given its
    transparent meaning in the output.
    """
    if not frame_paths:
        raise SystemExit(f'palette range {name} has no frames')
    input_dir = args.workdir / 'palette-input' / name
    if input_dir.exists():
        shutil.rmtree(input_dir)
    input_dir.mkdir(parents=True)
    for idx, frame_path in enumerate(frame_paths):
        (input_dir / f'frame_{idx:04d}.png').symlink_to(frame_path.resolve())
    palette_path = args.workdir / f'delta-palette-{name}.png'
    run_checked([
        'ffmpeg', '-y', '-v', 'error', '-framerate', str(args.fps),
        '-i', str(input_dir / 'frame_%04d.png'),
        '-vf', (f'palettegen=max_colors={args.max_colors - 1}:'
                'reserve_transparent=0:stats_mode=diff'),
        '-frames:v', '1', str(palette_path),
    ])
    with Image.open(palette_path) as palette_image:
        # palettegen writes an RGBA 16x16 swatch, not a P-mode image:
        # its pixels in row-major order are the palette entries.
        seen = set()
        unique = []
        raw = palette_image.convert('RGB').tobytes()
        for offset in range(0, len(raw), 3):
            rgb = tuple(raw[offset:offset + 3])
            if rgb not in seen:
                seen.add(rgb)
                unique.extend(rgb)
            if len(unique) >= (args.max_colors - 1) * 3:
                break
    palette = unique[:(args.max_colors - 1) * 3]
    if len(palette) < 3:
        raise SystemExit('could not derive a GIF palette from the composed frames')
    palette += palette[:3] * (256 - len(palette) // 3)
    holder = Image.new('P', (1, 1))
    holder.putpalette(palette)
    return holder, palette


def frame_durations(count, fps):
    """Centisecond-exact per-frame durations averaging to 1/fps."""
    durations = []
    previous = 0
    for idx in range(count):
        boundary = round((idx + 1) * 100 / fps)
        durations.append((boundary - previous) * 10)
        previous = boundary
    return durations


def encode_gif_delta(frames, frame_paths, palette_ranges, output, args):
    """Palette GIF whose later frames store only changed pixels.

    In scene mode each scene/crossfade range gets a local palette and
    begins with a full frame; in global mode the whole timeline shares
    one palette. A pixel whose quantized color is within
    --delta-threshold of the displayed color (max channel error) is
    left transparent, so reconstruction error stays bounded per frame
    while static UI and slow gradients stop costing bytes every frame.
    """
    output.parent.mkdir(parents=True, exist_ok=True)
    if args.palette_mode == 'global':
        ranges = [(0, len(frames))]
    else:
        ranges = palette_ranges or [(0, len(frames))]
    remap_255 = [0 if idx == 255 else idx for idx in range(256)]
    change_lut = ([0] * (args.delta_threshold + 1) +
                  [255] * (255 - args.delta_threshold))
    encoded = []
    for range_idx, (range_start, range_end) in enumerate(ranges):
        name = 'global' if args.palette_mode == 'global' else f'scene-{range_idx:02d}'
        holder, palette = delta_palette(
            frame_paths[range_start:range_end], name, args)
        transparent = Image.new('P', frames[0].size, 255)
        transparent.putpalette(palette)
        displayed = None
        for frame in frames[range_start:range_end]:
            quantized = frame.quantize(palette=holder, dither=Image.Dither.NONE)
            if quantized.getextrema()[1] == 255:
                quantized = quantized.point(remap_255)
                quantized.putpalette(palette)
            desired = quantized.convert('RGB')
            if displayed is None:
                encoded.append(quantized)
                displayed = desired
                continue
            red, green, blue = ImageChops.difference(desired, displayed).split()
            max_diff = ImageChops.lighter(ImageChops.lighter(red, green), blue)
            changed = max_diff.point(change_lut)
            delta = Image.composite(quantized, transparent, changed)
            delta.putpalette(palette)
            encoded.append(delta)
            displayed = Image.composite(desired, displayed, changed)
    encoded[0].save(
        output, save_all=True, append_images=encoded[1:],
        duration=frame_durations(len(encoded), args.fps), loop=0,
        transparency=255, disposal=1, optimize=True)
    return probe_gif(output)


def sha256(path):
    digest = hashlib.sha256()
    with path.open('rb') as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b''):
            digest.update(chunk)
    return digest.hexdigest()


def rel(path):
    try:
        return str(path.relative_to(ROOT))
    except ValueError:
        return str(path)


def main(argv=None):
    args = parse_args(argv)
    args.workdir.mkdir(parents=True, exist_ok=True)
    segments = ensure_segments(args)
    samples, picks, palette_ranges = build_timeline(args, len(segments))

    source = FrameSource(segments)
    frames = [source.render(sample) for sample in samples]
    capture_size = source.size
    if args.width and args.width != capture_size[0]:
        output_size = (args.width,
                       max(1, round(capture_size[1] * args.width / capture_size[0])))
        frames = [frame.resize(output_size, Image.LANCZOS) for frame in frames]
    else:
        output_size = capture_size
    check_output_frames(frames, picks)

    frame_dir = args.workdir / 'frames'
    frame_dir.mkdir(parents=True, exist_ok=True)
    for stale in frame_dir.glob('frame_*.png'):
        stale.unlink()
    frame_paths = []
    for idx, frame in enumerate(frames):
        frame_path = frame_dir / f'frame_{idx:04d}.png'
        frame.save(frame_path)
        frame_paths.append(frame_path)

    contact = args.output.with_name(f'{args.output.stem}-contact.png')
    labels = write_contact_sheet(contact, frames, picks,
                                 [seg.name for seg in segments])
    if args.encoder == 'delta':
        probe = encode_gif_delta(
            frames, frame_paths, palette_ranges, args.output, args)
    else:
        probe = encode_gif_ffmpeg(frame_dir, args.output, args)
    if int(probe['width']) != output_size[0] or int(probe['height']) != output_size[1]:
        raise SystemExit(f'encoded GIF dimensions changed: {probe}')
    if int(probe['nb_frames']) != len(frames):
        raise SystemExit(
            f"encoded GIF has {probe['nb_frames']} frames, composed {len(frames)}")
    mp4_path = encode_mp4_ffmpeg(frame_dir, args.output, args)

    manifest = {
        'format': 2,
        'output': rel(args.output),
        'mp4': rel(mp4_path) if mp4_path else None,
        'contact_sheet': rel(contact),
        'sha256': sha256(args.output),
        'bytes': args.output.stat().st_size,
        'fps': args.fps,
        'frames': len(frames),
        'duration_seconds': round(len(frames) / args.fps, 3),
        'size': list(output_size),
        'capture_size': list(capture_size),
        'encoding': {
            'encoder': args.encoder,
            'palette_mode': args.palette_mode if args.encoder == 'delta' else None,
            'palette_ranges': ((palette_ranges if args.palette_mode == 'scene'
                                else [(0, len(frames))])
                               if args.encoder == 'delta' else None),
            'max_colors': args.max_colors,
            'delta_threshold': args.delta_threshold if args.encoder == 'delta' else None,
        },
        'ffprobe': probe,
        'timeline': {
            'start_seconds': args.start_seconds,
            'intro_seconds': args.intro_seconds,
            'segment_seconds': args.segment_seconds,
            'transition_seconds': args.transition_seconds,
            'outro_seconds': args.outro_seconds,
        },
        'segments': [{
            'name': seg.name,
            'fixture': seg.fixture,
            'capture_dir': rel(seg.directory),
            'report': rel(seg.report_path),
            'rect': seg.rect,
            'captured_frames': len(seg.frames),
            'capture_first_ms': seg.frames[0][0],
            'capture_last_ms': seg.frames[-1][0],
        } for seg in segments],
        'contact_picks': [{'label': label, 'frame': idx}
                          for label, idx in labels],
    }
    manifest_path = args.output.with_name(f'{args.output.name}.manifest.json')
    manifest_path.write_text(json.dumps(manifest, indent=1) + '\n')
    print(f"gif: {args.output} ({manifest['bytes']} bytes, sha256 {manifest['sha256']})")
    if mp4_path:
        print(f'mp4: {mp4_path} ({mp4_path.stat().st_size} bytes)')
    print(f'contact: {contact}')
    print(f'manifest: {manifest_path}')
    print(f"frames: {len(frames)} @ {args.fps}fps = {manifest['duration_seconds']}s, "
          f"{output_size[0]}x{output_size[1]}")
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
