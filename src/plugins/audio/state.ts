/**
 * @file audio plugin — state factory.
 */
import { clamp01 } from "./engine";
import type { Config, State } from "./types";

/**
 * Creates the initial audio plugin state — the session-serializable mirror of
 * the engine, seeded from config.
 *
 * Mute and per-channel volumes come straight from config (volumes clamped to
 * `0..1`), doubling as the rehydration path a future `storage`/`platform` plugin
 * feeds via `pluginConfigs.audio.*`. The decoded-buffer cache starts empty and
 * `unlocked` is false — nothing plays before the first `unlock()` user gesture.
 *
 * @param ctx - Minimal context providing global registry and resolved config.
 * @param ctx.global - Global plugin registry (unused; the live graph lives in the engine WeakMap).
 * @param ctx.config - Resolved audio configuration (initial volumes + mute).
 * @returns The initial {@link State} object for this plugin instance.
 * @example
 * ```ts
 * const state = createState({ global: {}, config: { masterVolume: 1, sfxVolume: 1, musicVolume: 1, muted: false, manifest: {} } });
 * // → { muted: false, volumes: { master: 1, sfx: 1, music: 1 }, buffers: Map {}, unlocked: false }
 * ```
 */
export const createState = (ctx: {
  readonly global: Readonly<Record<string, unknown>>;
  readonly config: Readonly<Config>;
}): State => ({
  muted: ctx.config.muted,
  volumes: {
    master: clamp01(ctx.config.masterVolume),
    sfx: clamp01(ctx.config.sfxVolume),
    music: clamp01(ctx.config.musicVolume)
  },
  buffers: new Map(),
  unlocked: false
});
