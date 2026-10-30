/* animation.js -- the panel/menu weather icon. */

import Cairo from 'gi://cairo';
import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import St from 'gi://St';

import { paintWeather, createParticles, GRID } from './painter.js';

const CALM_FRAME_INTERVAL_MS = 200;       // 5 fps: sun/moon/partly/cloud/fog drift < 0.06 px/tick
const ACTIVE_FRAME_INTERVAL_MS = 100;     // 10 fps: falling precip / wind streaks / loading spinner
const CALM_SCENES = ['sun', 'moon', 'partly', 'cloud', 'fog'];

const WARNING_LEVEL_RGB = {
    0: [0.788, 0.824, 0.867],   // #c9d2dd neutral
    1: [0.961, 0.773, 0.259],   // #f5c542 yellow
    2: [0.941, 0.498, 0.180],   // #f07f2e orange
    3: [1.000, 0.420, 0.447],   // #ff6b72 red
};

function warningTrianglePath(cr) {
    cr.moveTo(7.90625, 0.09375);
    cr.curveTo(7.378906, 0.066406, 6.867188, 0.375, 6.46875, 1.0625);
    cr.lineTo(0.21875, 12.65625);
    cr.curveTo(-0.316406, 13.621094, 0.265625, 15.0, 1.3125, 15.0);
    cr.lineTo(14.46875, 15.0);
    cr.curveTo(15.449219, 15.0, 16.371094, 13.839844, 15.6875, 12.65625);
    cr.lineTo(9.375, 1.125);
    cr.curveTo(8.976562, 0.480469, 8.433594, 0.121094, 7.90625, 0.09375);
    cr.closePath();
}

function warningBangPath(cr) {
    // Bold rounded-capsule stem (width 2.6 at top -> 2.3 at bottom, y = 3.7..9.7)
    cr.newSubPath();
    cr.arc(8.0, 5.0, 1.3, Math.PI, 0);
    cr.arc(8.0, 8.55, 1.15, 0, Math.PI);
    cr.closePath();
    // Bold dot centered at (8.0, 12.15), radius 1.35 (diameter 2.7)
    cr.newSubPath();
    cr.arc(8.0, 12.15, 1.35, 0, Math.PI * 2);
    cr.closePath();
}

export const WarningIcon = GObject.registerClass(
    class WarningIcon extends St.DrawingArea {
        _init({ size = 16, level = 0, shadow = false, ...rest } = {}) {
            super._init({
                reactive: false,
                can_focus: false,
                width: size,
                height: size,
                ...rest,
            });
            this._level = level ?? 0;
            this._shadow = shadow;
        }

        setLevel(level) {
            const next = level ?? 0;
            if (this._level === next)
                return;
            this._level = next;
            this.queue_repaint();
        }

        vfunc_repaint() {
            const [w, h] = this.get_surface_size();
            if (w <= 0 || h <= 0)
                return;
            const cr = this.get_context();
            cr.setOperator(Cairo.Operator.CLEAR);
            cr.paint();
            cr.setOperator(Cairo.Operator.OVER);
            cr.scale(w / 16, h / 16);

            if (this._shadow) {
                cr.save();
                cr.translate(0, 0.75);
                cr.newPath();
                warningTrianglePath(cr);
                cr.setSourceRGBA(0, 0, 0.04, 0.65);
                cr.fill();
                cr.restore();

                cr.newPath();
                warningBangPath(cr);
                cr.setSourceRGBA(0.08, 0.09, 0.12, 0.90);
                cr.fill();
            }

            const [r, g, b] = WARNING_LEVEL_RGB[this._level] ?? WARNING_LEVEL_RGB[0];
            cr.setFillRule(Cairo.FillRule.EVEN_ODD);
            cr.newPath();
            warningTrianglePath(cr);
            warningBangPath(cr);
            cr.setSourceRGBA(r, g, b, 1);
            cr.fill();
            cr.$dispose();
        }
    });

export const WeatherIcon = GObject.registerClass(
    class WeatherIcon extends St.DrawingArea {
        _init({ size = 22, animate = true, time = null, dark = true, seed = 7, groundLum = -1 } = {}) {
            super._init({
                style_class: 'aw-icon',
                reactive: false,
                can_focus: false,
                x_align: Clutter.ActorAlign.CENTER,
                y_align: Clutter.ActorAlign.CENTER,
                width: size,
                height: size,
            });

            this._animate = animate;
            this._time = time ?? Math.random() * 3;
            this._particles = createParticles();
            this._dark = dark;
            this._opts = {
                scene: 'loading', windy: false, night: false,
                intensity: 0, windKmh: 0, phase: null, seed, groundLum, pale: false
            };

            this._clockId = 0;
            this._clockInterval = 0;
            this.connect('notify::mapped', () => {
                if (this.mapped)
                    this._startClock();
                else
                    this._stopClock();
            });
            this.connect('destroy', () => {
                if (this._clockId) {
                    GLib.source_remove(this._clockId);
                    this._clockId = 0;
                }
            });
        }

        _frameIntervalMs() {
            return (!this._opts.windy && CALM_SCENES.includes(this._opts.scene))
                ? CALM_FRAME_INTERVAL_MS
                : ACTIVE_FRAME_INTERVAL_MS;
        }

        setScene(scene, { windy = false, night = false, intensity = 0, windKmh = 0,
            phase = null, variant = null, dark } = {}) {
            Object.assign(this._opts, { scene, windy, night, intensity, windKmh, phase, variant });
            if (dark !== undefined)
                this._dark = dark;
            if (this._clockId && this._clockInterval !== this._frameIntervalMs()) {
                this._stopClock();
                this._startClock();
            }
            this.queue_repaint();
        }

        setPale(pale) {
            if (this._opts.pale === !!pale)
                return;
            this._opts.pale = !!pale;
            this.queue_repaint();
        }

        // the referee reads luminance only to tier ink depth, so tiles
        // must refresh it as the sky (or another location's card) shifts
        // under them -- a build-time snapshot mis-tiers the cloud tones
        setGroundLum(lum) {
            if (this._opts.groundLum === lum)
                return;
            this._opts.groundLum = lum;
            this.queue_repaint();
        }

        setDark(dark) {
            if (dark === this._dark)
                return;
            this._dark = dark;
            this.queue_repaint();
        }

        setAnimate(enabled) {
            this._animate = enabled;
            if (enabled)
                this._startClock();
            else
                this._stopClock();
        }

        get scene() {
            return this._opts.scene;
        }

        vfunc_repaint() {
            const [surfaceWidth] = this.get_surface_size();   // device px (HiDPI scaled)
            if (surfaceWidth <= 0)
                return;
            const cr = this.get_context();
            cr.setOperator(Cairo.Operator.CLEAR);
            cr.paint();
            cr.setOperator(Cairo.Operator.OVER);
            cr.scale(surfaceWidth / GRID, surfaceWidth / GRID);
            paintWeather(cr, {
                ...this._opts,
                dark: this._dark,
                time: this._time,
                particles: this._particles,
                staticPose: !this._animate,
            });
            cr.$dispose();
        }

        _startClock() {
            if (this._clockId || !this._animate || !this.mapped)
                return;
            const intervalMs = this._frameIntervalMs();
            this._clockInterval = intervalMs;
            this._lastTime = GLib.get_monotonic_time();
            this._clockId = GLib.timeout_add(GLib.PRIORITY_LOW, intervalMs, () => {
                const now = GLib.get_monotonic_time();
                if (this.mapped ?? true) {
                    const elapsed = (now - this._lastTime) / 1000000;
                    this._time += Math.min(elapsed, 0.25);
                    this.queue_repaint();
                }
                this._lastTime = now;
                return GLib.SOURCE_CONTINUE;
            });
        }

        _stopClock() {
            if (this._clockId) {
                GLib.source_remove(this._clockId);
                this._clockId = 0;
                this._clockInterval = 0;
            }
        }
    });
