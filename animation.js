/* animation.js -- the panel/menu weather icon. */

import Cairo from 'gi://cairo';
import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import St from 'gi://St';

import { paintWeather, createParticles, GRID } from './painter.js';

const FRAME_INTERVAL_MS = 50;

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
            this.connect('destroy', () => this._stopClock());
            if (animate)
                this._startClock();
        }

        setScene(scene, { windy = false, night = false, intensity = 0, windKmh = 0,
            phase = null, dark } = {}) {
            Object.assign(this._opts, { scene, windy, night, intensity, windKmh, phase });
            if (dark !== undefined)
                this._dark = dark;
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
            if (this._clockId || !this._animate)
                return;
            this._lastTime = GLib.get_monotonic_time();
            this._clockId = GLib.timeout_add(GLib.PRIORITY_LOW, FRAME_INTERVAL_MS, () => {
                const now = GLib.get_monotonic_time();
                if (this.mapped ?? true) {
                    const elapsed = (now - this._lastTime) / 1000000;
                    this._time += Math.min(elapsed, 0.1);
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
            }
        }
    });
