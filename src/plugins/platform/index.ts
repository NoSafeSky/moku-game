/**
 * platform plugin — Complex tier.
 *
 * Portal-SDK adapter layer (CrazyGames / Poki / Newgrounds / no-op) selected via
 * `ctx.env`. Promise-based ads that pause `loop` + mute `audio` and restore on
 * settle (capture-then-restore, frequency-capped, re-entrancy-guarded); injects a
 * portal-native `StorageBackend` into `storage`; persists + rehydrates `audio`
 * mute/volume through `storage`. Owns the loaded SDK + focus/visibility listeners
 * via onStart/onStop. Emits `platform:ready` / `platform:adStart` / `platform:adEnd`.
 *
 * @see README.md
 */
import { createPlugin } from "../../config";
import { audioPlugin } from "../audio";
import { loopPlugin } from "../loop";
import { storagePlugin } from "../storage";
import { createApi } from "./api";
import { start, stop } from "./lifecycle";
import { createPrefsHooks } from "./prefs";
import { createState } from "./state";
import type { Config, Events } from "./types";

const defaultConfig: Config = {
  portal: "auto",
  portalEnvVar: "GAME_PORTAL",
  pauseOnAd: true,
  minInterstitialSeconds: 60,
  useNativeStorage: true,
  persistAudioPrefs: true
};

/**
 * platform plugin instance — Complex tier.
 *
 * Depends on `audioPlugin`, `loopPlugin`, and `storagePlugin` (their APIs obtained
 * via `ctx.require`); registered after the three deps and before `mcp`. No new
 * package dependency — portal SDKs are runtime-injected and typed structurally.
 *
 * @see README.md
 */
export const platformPlugin = createPlugin("platform", {
  depends: [audioPlugin, loopPlugin, storagePlugin],
  config: defaultConfig,
  /**
   * Declares this plugin's events so they are typed on `ctx.emit`.
   *
   * @param register - The framework event registrar.
   * @returns The registered event descriptor map.
   * @example
   * ```ts
   * events: register => register.map<Events>({ "platform:ready": "…" });
   * ```
   */
  events: register =>
    register.map<Events>({
      "platform:ready": "Fired when the portal adapter is initialised",
      "platform:adStart": "Fired when an ad begins (after pause + mute)",
      "platform:adEnd": "Fired when an ad ends (after resume + unmute)"
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
  /**
   * Attaches the audio-pref write-back hooks — only when `persistAudioPrefs` is on.
   *
   * @param ctx - The plugin context (config + require).
   * @returns The audio-event hook map, or an empty map when persistence is disabled.
   * @example
   * ```ts
   * hooks: ctx => (ctx.config.persistAudioPrefs ? createPrefsHooks(ctx) : {});
   * ```
   */
  hooks: ctx => (ctx.config.persistAudioPrefs ? createPrefsHooks(ctx) : {}),
  /**
   * Starts the plugin: resolves the portal, loads the SDK, injects the native
   * backend, rehydrates prefs, and registers the focus/visibility listeners. Inline
   * lambda so declared events infer into `ctx.emit` (mirrors the mcp/scene pattern).
   *
   * @param ctx - Plugin execution context (config, state, global, log, env, require, emit).
   * @returns A Promise that resolves once the adapter is ready and wired.
   * @example
   * ```ts
   * // Called automatically by the framework during app.start()
   * ```
   */
  onStart: ctx => start(ctx), // resolves portal + loads SDK + injects backend + listeners (real resource)
  onStop: stop // removes listeners + destroys the adapter
});
