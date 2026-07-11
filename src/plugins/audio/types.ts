/**
 * @file audio plugin — type definitions.
 *
 * The public plugin contract (Config, State, Api, Events, Channel) plus the one
 * WebAudio value that leaks into State — {@link AudioBufferLike}, the decoded
 * PCM buffer cached per sound. The rest of the WebAudio structural surface (the
 * gain graph, context, and source nodes) is internal to `engine.ts`.
 *
 * The DOM `lib` is intentionally absent from this project's tsconfig, so the
 * WebAudio globals (`AudioContext`, `GainNode`, …) are declared structurally
 * rather than imported — the shipped `.d.ts` therefore has no ambient DOM
 * dependency and stays self-contained.
 */

/** Shared minimal logger surface (from `logPlugin`) used by the audio domain files. */
export type Log = {
  /** Log at debug level (used for the play/load no-op paths). */
  debug(message: string): void;
  /** Log at info level (used for the headless notice on start). */
  info(message: string): void;
  /** Log a warning. */
  warn(message: string): void;
  /** Log an error. */
  error(message: string): void;
};

/**
 * Opaque decoded PCM buffer — the result of `AudioContext.decodeAudioData`,
 * replayed by one-shot / music sources. Structural stand-in for the DOM
 * `AudioBuffer` (absent from this project's `lib`), exposing only the fields the
 * plugin reads. Cached per sound name in {@link State.buffers}.
 */
export type AudioBufferLike = {
  /** Buffer duration in seconds. */
  readonly duration: number;
};

/** A gain channel this plugin exposes to `setVolume` / `getVolume`. */
export type Channel = "master" | "sfx" | "music";

/** Options for a one-shot {@link Api.play}. */
export type PlayOptions = {
  /** Per-shot volume 0..1 (clamped), routed through a per-shot gain. */
  volume?: number;
  /** Playback rate (1 = normal); scales pitch + speed. */
  rate?: number;
};

/** Options for {@link Api.playMusic}. */
export type PlayMusicOptions = {
  /** Whether the track loops. `@default true` */
  loop?: boolean;
  /** Seconds to ramp the music gain from 0 (0 = start at full volume). `@default 0` */
  fadeIn?: number;
};

/** Options for {@link Api.stopMusic}. */
export type StopMusicOptions = {
  /** Seconds to ramp the music gain to 0 before stopping (0 = stop immediately). `@default 0` */
  fadeOut?: number;
};

/**
 * audio plugin configuration. Volumes are 0..1 and clamped on apply.
 * `muted` and the volume fields double as **rehydration inputs**: a future
 * `platform`/`storage` plugin reads the persisted session values and passes them
 * via `pluginConfigs.audio.*`, so audio needs no direct dependency on storage.
 */
export type Config = {
  /** Master volume 0..1 (the mute-bus gain when unmuted). `@default 1` */
  masterVolume: number;
  /** SFX channel volume 0..1. `@default 1` */
  sfxVolume: number;
  /** Music channel volume 0..1. `@default 1` */
  musicVolume: number;
  /** Start muted (e.g. rehydrated from a prior session). `@default false` */
  muted: boolean;
  /** Preload manifest of name → url, decoded lazily/on first use. `@default {}` */
  manifest: Readonly<Record<string, string>>;
};

/**
 * audio plugin state — the session-serializable mirror of the audio engine.
 *
 * Holds only plain, restorable data: mute state, per-channel volumes (the source
 * of truth restored on unmute), the decoded-buffer cache, and the unlock flag.
 * The live `AudioContext` + gain graph live in a `ctx.global` WeakMap (see
 * `engine.ts`), never here.
 */
export type State = {
  /** Current mute state (mirrors the master mute-bus gain). */
  muted: boolean;
  /** Per-channel volumes 0..1 (source of truth restored on unmute). */
  volumes: { master: number; sfx: number; music: number };
  /** Decoded buffer cache: name → buffer ("pooling" one-shots = buffer reuse). */
  readonly buffers: Map<string, AudioBufferLike>;
  /** True once the AudioContext has been resumed by a user gesture. */
  unlocked: boolean;
};

/** audio plugin event contract — coarse, non-hot-path mute/volume milestones. */
export type Events = {
  /** Emitted when mute state changes — a storage/platform plugin persists it. */
  "audio:muteChanged": { muted: boolean };
  /** Emitted when a channel volume changes. */
  "audio:volumeChanged": { channel: Channel; value: number };
};

/** audio plugin API, exposed as `app.audio`. */
export type Api = {
  /**
   * Resume the AudioContext after a user gesture (browsers suspend it until then).
   * Idempotent and safe to call on every gesture. Sets `state.unlocked` on success.
   *
   * @returns A Promise that resolves once the context is resumed (or immediately when headless).
   */
  unlock(): Promise<void>;
  /**
   * Fetch + `decodeAudioData` a sound by name (url from the manifest or the 2nd
   * arg) and cache the buffer. Repeat calls for a cached name are a no-op.
   *
   * @param name - Logical sound name (the play/playMusic key, and manifest key).
   * @param url - Explicit URL; falls back to `config.manifest[name]` when omitted.
   * @returns A Promise that resolves once the buffer is decoded and cached.
   */
  load(name: string, url?: string): Promise<void>;
  /**
   * Play a one-shot SFX by name on the sfx channel. Returns immediately.
   * No-op (debug log) if not loaded, not unlocked, or headless.
   *
   * @param name - The loaded sound name.
   * @param opts - Optional per-shot volume + playback rate ({@link PlayOptions}).
   */
  play(name: string, opts?: PlayOptions): void;
  /**
   * Play looping music by name on the music channel; stops any current track
   * first. `fadeIn` seconds ramps the music gain from 0.
   *
   * @param name - The loaded music name.
   * @param opts - Optional loop + fade-in ({@link PlayMusicOptions}).
   */
  playMusic(name: string, opts?: PlayMusicOptions): void;
  /**
   * Stop the current music track, optionally fading out over `fadeOut` seconds.
   *
   * @param opts - Optional fade-out ({@link StopMusicOptions}).
   */
  stopMusic(opts?: StopMusicOptions): void;
  /**
   * Mute all audio (zero the master mute bus). The single call the platform
   * adapter invokes during ad breaks / focus loss. Emits `audio:muteChanged`
   * when it changes.
   */
  mute(): void;
  /** Unmute all audio (restore master gain to masterVolume). Emits on change. */
  unmute(): void;
  /**
   * Set mute state explicitly; emits `audio:muteChanged` only when it changes.
   *
   * @param muted - The desired mute state.
   */
  setMuted(muted: boolean): void;
  /**
   * Whether audio is currently muted.
   *
   * @returns `true` when muted.
   */
  isMuted(): boolean;
  /**
   * Set a channel volume 0..1 (clamped); emits `audio:volumeChanged` on change.
   * Setting `"master"` while muted updates the stored value but keeps the bus at 0.
   *
   * @param channel - Which channel to set (`master` | `sfx` | `music`).
   * @param value - The new volume 0..1 (clamped).
   */
  setVolume(channel: Channel, value: number): void;
  /**
   * Get a channel volume 0..1.
   *
   * @param channel - Which channel to read (`master` | `sfx` | `music`).
   * @returns The stored channel volume 0..1.
   */
  getVolume(channel: Channel): number;
};
