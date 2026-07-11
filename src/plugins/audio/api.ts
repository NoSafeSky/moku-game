/**
 * @file audio plugin — API factory.
 *
 * The public `app.audio` surface: unlock/load/play/playMusic/stopMusic +
 * mute/unmute/setMuted/isMuted + setVolume/getVolume.
 *
 * Every effectful method reads the per-app {@link LiveEngine} from the module
 * WeakMap (exported from `engine.ts`) via `ctx.global`. When there is no live
 * engine — before `onStart`, after `onStop`, or headless — the effectful methods
 * no-op (a debug log for the playback ones); the getters (`isMuted`,
 * `getVolume`) still return the state mirror. Mute/volume changes write the gain
 * graph and emit the coarse `audio:muteChanged` / `audio:volumeChanged` events
 * (only on an actual change); `play` / `playMusic` / `stopMusic` are hot-path and
 * emit nothing.
 */
import { audioRegistry, clamp01, decodeFromUrl, type LiveEngine } from "./engine";
import type {
  Api,
  Channel,
  Config,
  Events,
  Log,
  PlayMusicOptions,
  PlayOptions,
  State,
  StopMusicOptions
} from "./types";

// ─────────────────────────────────────────────────────────────────────────────
// Structural context type (only the fields the API factory accesses)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Structural context type required by {@link createApi}, so unit tests can pass
 * a minimal mock without wiring the full kernel. Mirrors the AssetsContext /
 * LoopContext pattern used across this framework.
 */
export type AudioApiContext = {
  /** Resolved audio configuration (manifest + initial volumes). */
  readonly config: Readonly<Config>;
  /** Audio plugin state — the session mirror (mute, volumes, buffers, unlock). */
  readonly state: State;
  /** Global plugin registry — key for the engine WeakMap. */
  readonly global: object;
  /** Logger from logPlugin (used for the play/load no-op paths). */
  readonly log: Log;
  /**
   * Emit a declared audio event with its typed payload. Written as a method
   * signature (bivariant params) so the kernel's merged `ctx.emit` — which also
   * carries the framework-level events — is assignable to this narrower audio-only
   * view when the API factory is wired via `api: ctx => createApi(ctx)`.
   *
   * @param event - The audio event name.
   * @param payload - The event payload, matching the declared shape.
   */
  emit<K extends keyof Events>(event: K, payload: Events[K]): void;
};

// ─────────────────────────────────────────────────────────────────────────────
// API factory
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Creates the audio plugin API surface.
 *
 * @param ctx - Plugin context (structural — only the fields this API uses).
 * @param ctx.config - Resolved audio configuration.
 * @param ctx.state - The session-mirror state (mute, volumes, buffers, unlock).
 * @param ctx.global - Global plugin registry (key for the engine WeakMap).
 * @param ctx.log - Logger from logPlugin.
 * @param ctx.emit - Typed emit for the audio events.
 * @returns The audio plugin {@link Api} object.
 * @example
 * ```ts
 * const api = createApi(ctx);
 * await api.unlock();     // after a user gesture
 * await api.load("jump", "sfx/jump.webm");
 * api.play("jump");
 * api.mute();             // single call ducks the whole mix
 * ```
 */
export const createApi = (ctx: AudioApiContext): Api => {
  /**
   * The live engine for this app, or `undefined` when unavailable/headless.
   * Narrowing on `!engine.headless` proves the four graph nodes are present, so
   * callers get a {@link LiveEngine} with no non-null assertions.
   *
   * @returns The live engine, or `undefined` when every effectful method must no-op.
   * @example
   * ```ts
   * const engine = liveEngine();
   * if (!engine) return; // headless / not started
   * ```
   */
  const liveEngine = (): LiveEngine | undefined => {
    const engine = audioRegistry.get(ctx.global);
    return engine && !engine.headless ? engine : undefined;
  };

  /**
   * Apply a mute change: write the master mute-bus gain and emit — but only when
   * the state actually flips. When unmuting, the bus is restored to the stored
   * master volume (which may have been changed via `setVolume` while muted).
   *
   * @param muted - The desired mute state.
   * @example
   * ```ts
   * applyMuted(true); // zero the master bus + emit audio:muteChanged { muted: true }
   * ```
   */
  const applyMuted = (muted: boolean): void => {
    const engine = liveEngine();
    if (!engine) return;
    if (ctx.state.muted === muted) return;

    ctx.state.muted = muted;
    engine.master.gain.value = muted ? 0 : clamp01(ctx.state.volumes.master);
    ctx.emit("audio:muteChanged", { muted });
  };

  return {
    /**
     * Resume the AudioContext after a user gesture. Idempotent; sets
     * `state.unlocked` on success. No-op when headless / not started.
     *
     * @returns A Promise that resolves once the context is resumed.
     * @example
     * ```ts
     * await app.audio.unlock(); // on the first title-screen tap / keypress
     * ```
     */
    async unlock(): Promise<void> {
      const engine = liveEngine();
      if (!engine) return;

      await engine.context.resume();
      ctx.state.unlocked = true;
    },

    /**
     * Fetch + decode a sound by name and cache the buffer. A cached name is a
     * no-op (one decode per name). No-op when headless / not started, or when no
     * url is given and the name is not in the manifest.
     *
     * @param name - Logical sound name (the play/playMusic key + manifest key).
     * @param url - Explicit URL; falls back to `config.manifest[name]`.
     * @returns A Promise that resolves once the buffer is decoded and cached.
     * @example
     * ```ts
     * await app.audio.load("jump", "sfx/jump.webm");
     * ```
     */
    async load(name: string, url?: string): Promise<void> {
      const engine = liveEngine();
      if (!engine) return;

      // Pooling: a cached name is a no-op — one decode per name.
      if (ctx.state.buffers.has(name)) return;

      const source = url ?? ctx.config.manifest[name];
      if (!source) {
        ctx.log.debug(`[audio] load("${name}") ignored — no url (not in manifest).`);
        return;
      }

      const buffer = await decodeFromUrl(engine.context, source);
      if (buffer) ctx.state.buffers.set(name, buffer);
    },

    /**
     * Play a one-shot SFX by name on the sfx channel. Returns immediately.
     * No-op (debug log) if headless, not unlocked, or not loaded.
     *
     * @param name - The loaded sound name.
     * @param opts - Optional per-shot volume + rate ({@link PlayOptions}).
     * @example
     * ```ts
     * app.audio.play("jump", { volume: 0.8, rate: 1.2 });
     * ```
     */
    play(name: string, opts?: PlayOptions): void {
      const engine = liveEngine();
      if (!engine) {
        ctx.log.debug(`[audio] play("${name}") ignored — audio unavailable (headless).`);
        return;
      }
      if (!ctx.state.unlocked) {
        ctx.log.debug(`[audio] play("${name}") ignored — not unlocked (call unlock() first).`);
        return;
      }

      const buffer = ctx.state.buffers.get(name);
      if (!buffer) {
        ctx.log.debug(`[audio] play("${name}") ignored — not loaded (call load("${name}") first).`);
        return;
      }

      // Build the one-shot source; route through a per-shot gain only when a
      // volume override is given, else straight into the sfx channel.
      const source = engine.context.createBufferSource();
      source.buffer = buffer;
      if (opts?.rate !== undefined) source.playbackRate.value = opts.rate;

      if (opts?.volume === undefined) {
        source.connect(engine.sfx);
      } else {
        const shotGain = engine.context.createGain();
        shotGain.gain.value = clamp01(opts.volume);
        source.connect(shotGain);
        shotGain.connect(engine.sfx);
      }

      source.start();
    },

    /**
     * Play looping music by name on the music channel, stopping any current
     * track first. `fadeIn` seconds ramps the music gain from 0. No-op (debug
     * log) if headless, not unlocked, or not loaded.
     *
     * @param name - The loaded music name.
     * @param opts - Optional loop + fade-in ({@link PlayMusicOptions}).
     * @example
     * ```ts
     * app.audio.playMusic("theme", { fadeIn: 0.5 });
     * ```
     */
    playMusic(name: string, opts?: PlayMusicOptions): void {
      const engine = liveEngine();
      if (!engine) {
        ctx.log.debug(`[audio] playMusic("${name}") ignored — audio unavailable (headless).`);
        return;
      }
      if (!ctx.state.unlocked) {
        ctx.log.debug(`[audio] playMusic("${name}") ignored — not unlocked (call unlock() first).`);
        return;
      }

      const buffer = ctx.state.buffers.get(name);
      if (!buffer) {
        ctx.log.debug(`[audio] playMusic("${name}") ignored — not loaded.`);
        return;
      }

      // Only one music track at a time — stop the previous before starting.
      if (engine.musicSource) {
        engine.musicSource.stop();
        engine.musicSource = undefined;
      }

      // Build the new looping source and connect it to the music channel.
      const source = engine.context.createBufferSource();
      source.buffer = buffer;
      source.loop = opts?.loop ?? true;
      source.connect(engine.music);

      // Set the music gain: ramp from 0 for a fade-in, else restore the stored
      // volume immediately (a prior stopMusic fade-out may have left it at 0).
      const target = clamp01(ctx.state.volumes.music);
      const fadeIn = opts?.fadeIn ?? 0;
      const now = engine.context.currentTime;
      engine.music.gain.cancelScheduledValues(now);
      if (fadeIn > 0) {
        engine.music.gain.setValueAtTime(0, now);
        engine.music.gain.linearRampToValueAtTime(target, now + fadeIn);
      } else {
        engine.music.gain.setValueAtTime(target, now);
      }

      // Start playback and record it as the active track.
      source.start();
      engine.musicSource = source;
    },

    /**
     * Stop the current music track, optionally fading out over `fadeOut`
     * seconds. No-op when headless / not started or when nothing is playing.
     *
     * @param opts - Optional fade-out ({@link StopMusicOptions}).
     * @example
     * ```ts
     * app.audio.stopMusic({ fadeOut: 1 });
     * ```
     */
    stopMusic(opts?: StopMusicOptions): void {
      const engine = liveEngine();
      if (!engine) return;

      const source = engine.musicSource;
      if (!source) return;

      const fadeOut = opts?.fadeOut ?? 0;
      if (fadeOut > 0) {
        // Ramp the music gain to 0, then stop the source when the fade completes.
        const now = engine.context.currentTime;
        engine.music.gain.cancelScheduledValues(now);
        engine.music.gain.setValueAtTime(clamp01(ctx.state.volumes.music), now);
        engine.music.gain.linearRampToValueAtTime(0, now + fadeOut);
        source.stop(now + fadeOut);
      } else {
        source.stop();
      }

      engine.musicSource = undefined;
    },

    /**
     * Mute all audio (zero the master mute bus). Emits `audio:muteChanged` when
     * it changes. The single call a platform adapter makes on an ad break.
     *
     * @example
     * ```ts
     * app.audio.mute();
     * ```
     */
    mute(): void {
      applyMuted(true);
    },

    /**
     * Unmute all audio (restore master gain to the stored master volume). Emits
     * `audio:muteChanged` when it changes.
     *
     * @example
     * ```ts
     * app.audio.unmute();
     * ```
     */
    unmute(): void {
      applyMuted(false);
    },

    /**
     * Set mute state explicitly; emits `audio:muteChanged` only on an actual change.
     *
     * @param muted - The desired mute state.
     * @example
     * ```ts
     * app.audio.setMuted(persisted.muted);
     * ```
     */
    setMuted(muted: boolean): void {
      applyMuted(muted);
    },

    /**
     * Whether audio is currently muted. A pure read — valid even headless.
     *
     * @returns `true` when muted.
     * @example
     * ```ts
     * if (app.audio.isMuted()) app.audio.unmute();
     * ```
     */
    isMuted(): boolean {
      return ctx.state.muted;
    },

    /**
     * Set a channel volume 0..1 (clamped); emits `audio:volumeChanged` on an
     * actual change. Setting `"master"` while muted updates the stored value but
     * keeps the bus at 0. No-op when headless / not started.
     *
     * @param channel - Which channel to set (`master` | `sfx` | `music`).
     * @param value - The new volume 0..1 (clamped).
     * @example
     * ```ts
     * app.audio.setVolume("music", 0.5);
     * ```
     */
    setVolume(channel: Channel, value: number): void {
      const engine = liveEngine();
      if (!engine) return;

      const clamped = clamp01(value);
      if (ctx.state.volumes[channel] === clamped) return; // emit only on change

      ctx.state.volumes[channel] = clamped;
      writeChannelGain(engine, ctx.state.muted, channel, clamped);
      ctx.emit("audio:volumeChanged", { channel, value: clamped });
    },

    /**
     * Get a channel volume 0..1. A pure read — valid even headless.
     *
     * @param channel - Which channel to read (`master` | `sfx` | `music`).
     * @returns The stored channel volume 0..1.
     * @example
     * ```ts
     * const musicVolume = app.audio.getVolume("music");
     * ```
     */
    getVolume(channel: Channel): number {
      return ctx.state.volumes[channel];
    }
  };
};

// ─────────────────────────────────────────────────────────────────────────────
// Internal helper
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Write a clamped channel volume onto the matching gain node. Setting `"master"`
 * while muted updates the stored value only (handled by the caller) and keeps
 * the mute bus at 0 — so master is skipped here when muted.
 *
 * @param engine - The live engine holding the gain graph.
 * @param muted - Current mute state (master gain is left at 0 while muted).
 * @param channel - Which channel's gain to write.
 * @param value - The already-clamped volume 0..1.
 * @example
 * ```ts
 * writeChannelGain(engine, false, "sfx", 0.5);
 * ```
 */
const writeChannelGain = (
  engine: LiveEngine,
  muted: boolean,
  channel: Channel,
  value: number
): void => {
  if (channel === "sfx") {
    engine.sfx.gain.value = value;
    return;
  }
  if (channel === "music") {
    engine.music.gain.value = value;
    return;
  }
  // master: while muted the bus stays at 0 — only the stored value changed.
  if (!muted) engine.master.gain.value = value;
};
