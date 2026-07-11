/**
 * @file platform plugin — audio-preference persistence helpers.
 *
 * Closes the persistence the `audio` and `storage` specs deferred to "a future
 * storage/platform plugin". Two directions:
 *
 * - **write-back** ({@link createPrefsHooks}) — hooks `audio:muteChanged` /
 *   `audio:volumeChanged` and mirrors each change into `storage`.
 * - **rehydrate** ({@link rehydrateAudioPrefs}) — at `onStart` (after any
 *   native-backend injection so prefs read from the portal store) reads the stored
 *   keys back and applies them to `audio` via `setMuted` / `setVolume`.
 *
 * A fresh store yields `undefined` for every key, so rehydrate leaves `audio` at
 * its configured defaults. Both are attached only when `config.persistAudioPrefs`
 * is on (gated in `index.ts` / `lifecycle.ts`).
 */
import { audioPlugin } from "../audio";
import { storagePlugin } from "../storage";
import type { Channel, PlatformRequire } from "./types";

// ─────────────────────────────────────────────────────────────────────────────
// Storage keys
// ─────────────────────────────────────────────────────────────────────────────

/** Storage key holding the persisted global mute flag. */
export const MUTE_KEY = "audio.muted";

/** Storage key prefix holding a persisted per-channel volume (`audio.volume.<channel>`). */
export const VOLUME_PREFIX = "audio.volume.";

/** The audio channels whose volume is persisted + rehydrated. */
export const CHANNELS: readonly Channel[] = ["master", "sfx", "music"];

// ─────────────────────────────────────────────────────────────────────────────
// Context
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The minimal context the pref helpers need: `require` to reach the `storage` and
 * `audio` APIs (obtained via `ctx.require`, never a direct internal import).
 */
export type PrefsContext = {
  /** Require a dependency's API by plugin instance. */
  require: PlatformRequire;
};

/** Payload of the `audio:muteChanged` event this plugin persists. */
export type MuteChange = { muted: boolean };

/** Payload of the `audio:volumeChanged` event this plugin persists. */
export type VolumeChange = { channel: Channel; value: number };

/** The two audio-event hook handlers this plugin attaches when persisting prefs. */
export type PrefsHooks = {
  /** Persist a mute change into storage. */
  "audio:muteChanged": (payload: MuteChange) => void;
  /** Persist a channel-volume change into storage. */
  "audio:volumeChanged": (payload: VolumeChange) => void;
};

// ─────────────────────────────────────────────────────────────────────────────
// Write-back hooks
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Build the write-back hooks that mirror audio mute/volume changes into `storage`.
 *
 * @param ctx - Context providing `require` (for the `storage` API).
 * @returns The `audio:muteChanged` / `audio:volumeChanged` handler map.
 * @example
 * ```ts
 * hooks: ctx => (ctx.config.persistAudioPrefs ? createPrefsHooks(ctx) : {});
 * ```
 */
export const createPrefsHooks = (ctx: PrefsContext): PrefsHooks => ({
  /**
   * Mirror a mute change into storage.
   *
   * @param payload - The `audio:muteChanged` payload.
   * @example
   * ```ts
   * hooks["audio:muteChanged"]({ muted: true });
   * ```
   */
  "audio:muteChanged": (payload: MuteChange): void => {
    ctx.require(storagePlugin).set(MUTE_KEY, payload.muted);
  },
  /**
   * Mirror a channel-volume change into storage.
   *
   * @param payload - The `audio:volumeChanged` payload.
   * @example
   * ```ts
   * hooks["audio:volumeChanged"]({ channel: "music", value: 0.5 });
   * ```
   */
  "audio:volumeChanged": (payload: VolumeChange): void => {
    ctx.require(storagePlugin).set(VOLUME_PREFIX + payload.channel, payload.value);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Rehydrate
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Read persisted mute/volume from `storage` and apply them to `audio`. Absent keys
 * (a fresh store) are skipped, leaving `audio` at its configured defaults.
 *
 * @param ctx - Context providing `require` (for the `storage` + `audio` APIs).
 * @example
 * ```ts
 * rehydrateAudioPrefs(ctx); // after storage.setBackend, before listeners
 * ```
 */
export const rehydrateAudioPrefs = (ctx: PrefsContext): void => {
  const storage = ctx.require(storagePlugin);
  const audio = ctx.require(audioPlugin);

  const muted = storage.get<boolean>(MUTE_KEY);
  if (muted !== undefined) audio.setMuted(muted);

  for (const channel of CHANNELS) {
    const value = storage.get<number>(VOLUME_PREFIX + channel);
    if (value !== undefined) audio.setVolume(channel, value);
  }
};
