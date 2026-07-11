/**
 * Audio plugin — Standard tier.
 *
 * Native WebAudio SFX + music with a master mute bus, per-channel + master
 * volume, and a user-gesture `unlock()` (no autoplay). Owns a small gain graph
 * (`source → channel → master → destination`) whose `master` node is the mute
 * bus a future `platform` adapter ducks during ad breaks. Zero runtime deps.
 * Emits `audio:muteChanged` / `audio:volumeChanged`. Headless-safe (no-ops when
 * `AudioContext` is unavailable). Manages the AudioContext resource via onStart/onStop.
 *
 * @see README.md
 */
import { createPlugin } from "../../config";
import { createApi } from "./api";
import { start, stop } from "./lifecycle";
import { createState } from "./state";
import type { Config, Events } from "./types";

const defaultConfig: Config = {
  masterVolume: 1,
  sfxVolume: 1,
  musicVolume: 1,
  muted: false,
  manifest: {}
};

/**
 * Audio plugin instance — Standard tier.
 *
 * Foundational (Wave 1), no game-plugin dependencies and no new package
 * dependency (WebAudio globals only — Howler rejected for the load budget).
 * Emits `audio:muteChanged` / `audio:volumeChanged` for a future `storage`/
 * `platform` plugin to persist and rehydrate via `pluginConfigs.audio.*`.
 *
 * @see README.md
 */
export const audioPlugin = createPlugin("audio", {
  config: defaultConfig,
  /**
   * Declares this plugin's events so they are typed on `ctx.emit`.
   *
   * @param register - The framework event registrar.
   * @returns The registered event descriptor map.
   * @example
   * ```ts
   * events: (register) => register.map<Events>({ "audio:muteChanged": "…" });
   * ```
   */
  events: register =>
    register.map<Events>({
      "audio:muteChanged": "Fired when global mute state changes",
      "audio:volumeChanged": "Fired when a channel volume changes"
    }),
  createState,
  /**
   * Builds the plugin API, forwarding the plugin context so declared events infer on `ctx.emit`.
   *
   * @param ctx - The plugin context.
   * @returns The plugin API surface.
   * @example
   * ```ts
   * api: (ctx) => createApi(ctx);
   * ```
   */
  api: ctx => createApi(ctx), // inline lambda so declared events infer into ctx.emit
  onStart: start, // creates the AudioContext + gain graph (real resource — spec/06 §3)
  onStop: stop // closes the AudioContext + stops sources (spec/06 §4)
});
