// coordinator.js — sequential, cycle-based forecast freshness.
// Ports the extension's WeatherCoordinator ideas (coalesce, retry, stale
// refetch) to the multi-city case: one serial cycle warms every city without
// bursting the free API, and the cycle timer resets to the configured period.

import GLib from 'gi://GLib?version=2.0';
import { fetchForecast, sleepSeconds, logw } from './weather.js';

const STAGGER_SECONDS = 0.6;
const RETRY_AFTER_FAILURE_SECONDS = 60;

export class Forecasts {
    #bus;
    #cache = new Map(); // cityId → { data, error, at }
    #running = false;
    #dirty = false;     // a cycle was requested while one was running
    #timer = 0;
    #priorityCityId = null;

    constructor(bus) {
        this.#bus = bus;
    }

    getState(cityId) {
        return this.#cache.get(cityId) ?? { data: null, error: null, at: 0 };
    }

    isFetching(cityId) {
        return this.#cache.get(cityId)?.fetching === true;
    }

    // Kick a refresh cycle; optional city gets fetched first.
    // force=true is honored only when no cycle is in flight; otherwise the
    // queued re-pass still refetches anything stale or errored.
    async kick(cityId = null, force = false) {
        this.#dirty = true; // re-run the pass if a cycle is already in flight
        if (cityId) this.#priorityCityId = cityId;
        if (this.#running) return;
        await this.#cycle(force);
    }

    async #cycle(force) {
        this.#running = true;
        try {
            let first = true;
            do {
                this.#dirty = false;
                const cities = this.#orderedCities();
                for (const city of cities) {
                    const prio = first && this.#priorityCityId === city.id;
                    first = false;
                    const state = this.#cache.get(city.id) ?? {};
                    const freshEnough = state.at > 0
                        && Date.now() - state.at < this._periodSeconds * 1000;
                    const shouldFetch = force || !state.at || !freshEnough
                        || prio || (state.error && !state.data);
                    if (shouldFetch) {
                        this.#cache.set(city.id, { ...state, fetching: true });
                        this.#bus.emit('forecast-status', city.id, true);
                        const ok = await this.#fetchOne(city);
                        if (!ok) await sleepSeconds(RETRY_AFTER_FAILURE_SECONDS / cities.length);
                    }
                    await sleepSeconds(STAGGER_SECONDS);
                }
            } while (this.#dirty);
        } finally {
            this.#running = false;
            this.#priorityCityId = null;
        }
    }

    #orderedCities() {
        const cities = this.#bus.config.cities;
        if (!this.#priorityCityId) return cities;
        const i = cities.findIndex(c => c.id === this.#priorityCityId);
        if (i <= 0) return cities;
        return [cities[i], ...cities.slice(0, i), ...cities.slice(i + 1)];
    }

    async #fetchOne(city) {
        const state = this.#cache.get(city.id) ?? {};
        try {
            const data = await fetchForecast(city.latitude, city.longitude, undefined, {
                countryCode: city.countryCode ?? '',
                placeNames: [city.name, city.admin1].filter(Boolean),
            });
            this.#cache.set(city.id, { data, error: null, at: Date.now() });
            this.#bus.emit('forecast-updated', city.id, data);
            return true;
        } catch (e) {
            // Keep the last good data — degrade to a stale badge, as in the
            // extension; only a cold failure surfaces the error page.
            this.#cache.set(city.id, { ...state, fetching: false, data: state.data ?? null, error: e, at: Date.now() });
            this.#bus.emit('forecast-failed', city.id, e);
            logw(`fetch failed for ${city.name}: ${e.message}`);
            return false;
        } finally {
            this.#bus.emit('forecast-status', city.id, false);
        }
    }

    get _periodSeconds() {
        return Math.max(60, this.#bus.config.refreshMinutes * 60);
    }

    // Periodic maintenance timer; restart whenever refresh-minutes changes.
    startPeriodic() {
        this.stopPeriodic();
        this.#timer = GLib.timeout_add_seconds(GLib.PRIORITY_LOW, this._periodSeconds, () => {
            this.kick();
            return GLib.SOURCE_CONTINUE;
        });
    }

    stopPeriodic() {
        if (this.#timer) {
            GLib.Source.remove(this.#timer);
            this.#timer = 0;
        }
    }
}
