/**
 * @file audio plugin — the WebAudio engine (internal).
 *
 * Owns the small gain graph the plugin manages directly (no Howler):
 *
 * ```
 * source → channelGain(sfx | music) → masterGain → destination
 * ```
 *
 * `masterGain` is the **mute bus** — a single node a future `platform` adapter
 * zeroes to duck the whole mix during ad breaks / focus loss. The live graph is
 * held per app in the {@link audioRegistry} WeakMap (keyed on `ctx.global`, the
 * same pattern the `loop` plugin uses for its rAF handle), built in `onStart`
 * and torn down in `onStop`.
 *
 * Every WebAudio type here is declared **structurally** — the DOM `lib` is absent
 * from this project's tsconfig, and structural types keep the shipped `.d.ts`
 * free of ambient DOM dependencies. When no `AudioContext` constructor exists
 * (SSR / tests), {@link createEngine} returns a headless engine and every API
 * method no-ops.
 */
import type { AudioBufferLike, Config, Log } from "./types";

// ─────────────────────────────────────────────────────────────────────────────
// Structural WebAudio surface (DOM lib is intentionally absent)
// ─────────────────────────────────────────────────────────────────────────────

/** Minimal structural view of a WebAudio `AudioParam` (a gain or playbackRate). */
export type AudioParameterLike = {
  /** Immediate parameter value. */
  value: number;
  /** Anchor a value at an exact context time (the start of a fade ramp). */
  setValueAtTime(value: number, startTime: number): void;
  /** Linearly ramp to a value by the given context time (fade in / out). */
  linearRampToValueAtTime(value: number, endTime: number): void;
  /** Cancel scheduled automation from the given time onward. */
  cancelScheduledValues(startTime: number): void;
};

/** Anything the graph can connect into (a gain input, or the destination). */
export type AudioNodeLike = {
  /** Connect this node's output into `destination`. */
  connect(destination: AudioNodeLike): void;
};

/** Minimal structural view of a WebAudio `GainNode`. */
export type GainNodeLike = AudioNodeLike & {
  /** The gain AudioParam (channel / master / per-shot volume). */
  readonly gain: AudioParameterLike;
};

/** Minimal structural view of a one-shot / music `AudioBufferSourceNode`. */
export type AudioBufferSourceNodeLike = AudioNodeLike & {
  /** The PCM buffer this source plays. */
  buffer: AudioBufferLike | undefined;
  /** Whether playback loops (music tracks loop; one-shots do not). */
  loop: boolean;
  /** Playback-rate AudioParam (pitch / speed). */
  readonly playbackRate: AudioParameterLike;
  /** Begin playback, optionally at a scheduled context time. */
  start(when?: number): void;
  /** Stop playback, optionally at a scheduled context time. */
  stop(when?: number): void;
};

/** Minimal structural view of a WebAudio `AudioContext`. */
export type AudioContextLike = {
  /** Monotonic audio clock (seconds) — the base for fade scheduling. */
  readonly currentTime: number;
  /** The context's final output node (speakers). */
  readonly destination: AudioNodeLike;
  /** Create a gain node for the channel / master / per-shot graph. */
  createGain(): GainNodeLike;
  /** Create a buffer source to play a decoded buffer. */
  createBufferSource(): AudioBufferSourceNodeLike;
  /** Decode compressed audio bytes into a playable buffer. */
  decodeAudioData(data: ArrayBuffer): Promise<AudioBufferLike>;
  /** Resume the context after a user gesture (browsers start it suspended). */
  resume(): Promise<void>;
  /** Close the context and release the audio hardware. */
  close(): Promise<void>;
};

/** Constructor for an `AudioContext` (or vendor-prefixed `webkitAudioContext`). */
export type AudioContextCtor = new () => AudioContextLike;

/**
 * Structural view of `globalThis` exposing the optional WebAudio + fetch surface
 * the plugin probes. All fields are optional so the plugin degrades gracefully
 * in a headless / non-browser runtime where none of them exist.
 */
type GlobalWithAudio = {
  /** Standard `AudioContext` constructor. */
  AudioContext?: AudioContextCtor;
  /** Legacy Safari-prefixed `AudioContext` constructor. */
  webkitAudioContext?: AudioContextCtor;
  /** Fetch used to load compressed audio bytes before decoding. */
  fetch?: (input: string) => Promise<{ arrayBuffer(): Promise<ArrayBuffer> }>;
};

// ─────────────────────────────────────────────────────────────────────────────
// Per-instance engine (stored in the WeakMap)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The live audio engine for one app: the gain graph plus the currently-playing
 * music source. A discriminated union on `headless` so `!engine.headless`
 * narrows the four graph nodes to present without a non-null assertion.
 */
export type LiveEngine = {
  /** This engine has a real AudioContext. */
  readonly headless: false;
  /** The live AudioContext. */
  readonly context: AudioContextLike;
  /** Master mute-bus gain: `channel → master → destination`. */
  readonly master: GainNodeLike;
  /** SFX channel gain. */
  readonly sfx: GainNodeLike;
  /** Music channel gain. */
  readonly music: GainNodeLike;
  /** The currently-playing looping music source, or undefined when silent. */
  musicSource: AudioBufferSourceNodeLike | undefined;
};

/** A headless engine (no `AudioContext` available) — every API method no-ops. */
export type HeadlessEngine = {
  /** This engine has no AudioContext (SSR / tests). */
  readonly headless: true;
};

/** The value stored per app in {@link audioRegistry}. */
export type AudioEngine = LiveEngine | HeadlessEngine;

/**
 * Module-level WeakMap mapping each app's global registry to its audio engine.
 * Exported so `api.ts` and `lifecycle.ts` reach the same engine without a second
 * map (mirrors the `loop` plugin's `loopRegistry`).
 */
export const audioRegistry = new WeakMap<object, AudioEngine>();

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Clamp a volume into the valid WebAudio gain range `0..1`.
 *
 * @param value - The requested volume.
 * @returns `value` clamped to `[0, 1]`.
 * @example
 * ```ts
 * clamp01(1.5); // → 1
 * clamp01(-0.2); // → 0
 * ```
 */
export const clamp01 = (value: number): number => Math.max(0, Math.min(1, value));

/**
 * Resolve the `AudioContext` constructor from `globalThis`, preferring the
 * standard name and falling back to the Safari-prefixed one.
 *
 * @returns The constructor, or `undefined` when neither exists (headless).
 * @example
 * ```ts
 * const Ctor = resolveAudioContextCtor();
 * const context = Ctor ? new Ctor() : undefined; // undefined under SSR/tests
 * ```
 */
export const resolveAudioContextCtor = (): AudioContextCtor | undefined => {
  const globals = globalThis as GlobalWithAudio;
  return globals.AudioContext ?? globals.webkitAudioContext;
};

/**
 * Fetch compressed audio bytes for `url` and decode them into a playable buffer.
 *
 * Returns `undefined` when `fetch` is unavailable (headless) so the caller can
 * skip caching without throwing.
 *
 * @param context - The live AudioContext used to decode.
 * @param url - The URL to fetch the compressed audio from.
 * @returns The decoded buffer, or `undefined` when `fetch` is unavailable.
 * @example
 * ```ts
 * const buffer = await decodeFromUrl(context, "sfx/jump.webm");
 * ```
 */
export const decodeFromUrl = async (
  context: AudioContextLike,
  url: string
): Promise<AudioBufferLike | undefined> => {
  const fetchFunction = (globalThis as GlobalWithAudio).fetch;
  if (!fetchFunction) return undefined;

  const response = await fetchFunction(url);
  const bytes = await response.arrayBuffer();
  return context.decodeAudioData(bytes);
};

// ─────────────────────────────────────────────────────────────────────────────
// Engine lifecycle
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Build the audio engine for one app.
 *
 * When an `AudioContext` constructor exists: creates the context, the master /
 * sfx / music gain graph (`sfx,music → master → destination`), and applies the
 * initial config (master at 0 when `muted`, else `masterVolume`; channels at
 * their configured volumes — all clamped). When no constructor exists (SSR /
 * tests): logs a debug line and returns a headless engine.
 *
 * @param config - Resolved audio configuration (initial volumes + mute).
 * @param log - Logger used to note the headless fallback.
 * @returns A live engine wired to the audio hardware, or a headless engine.
 * @example
 * ```ts
 * const engine = createEngine(ctx.config, ctx.log);
 * audioRegistry.set(ctx.global, engine);
 * ```
 */
export const createEngine = (config: Readonly<Config>, log: Log): AudioEngine => {
  const Ctor = resolveAudioContextCtor();

  // Headless guard: no WebAudio → a no-op engine (matches the renderer's guard).
  if (!Ctor) {
    log.debug("[audio] no AudioContext available — running headless (audio methods no-op).");
    return { headless: true };
  }

  const context = new Ctor();

  // Build the gain graph: source → channel(sfx|music) → master → destination.
  const master = context.createGain();
  const sfx = context.createGain();
  const music = context.createGain();

  master.gain.value = config.muted ? 0 : clamp01(config.masterVolume);
  sfx.gain.value = clamp01(config.sfxVolume);
  music.gain.value = clamp01(config.musicVolume);

  sfx.connect(master);
  music.connect(master);
  master.connect(context.destination);

  return { headless: false, context, master, sfx, music, musicSource: undefined };
};

/**
 * Tear down the audio engine: stop the active music source and close the
 * `AudioContext` (releasing the audio hardware). A no-op for a headless engine.
 * Safe to call once — pairs with `onStop`.
 *
 * @param engine - The engine to release.
 * @returns A Promise that resolves once the context is closed.
 * @example
 * ```ts
 * await teardownEngine(engine);
 * ```
 */
export const teardownEngine = async (engine: AudioEngine): Promise<void> => {
  if (engine.headless) return;

  if (engine.musicSource) {
    engine.musicSource.stop();
    engine.musicSource = undefined;
  }

  await engine.context.close();
};
