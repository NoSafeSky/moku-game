/**
 * @file platform plugin — type definitions.
 *
 * The public plugin contract (Config, State, Api, Events, Portal, AdType) plus the
 * internal seam every portal integration implements — {@link PortalAdapter} and
 * its minimal {@link AdapterContext} — and the structural views of the three
 * dependency APIs this plugin calls ({@link LoopDep}, {@link AudioDep},
 * {@link StorageDep}).
 *
 * Portal SDKs are runtime-injected from the portal CDN and typed **structurally**
 * inside each adapter file (mirroring how `audio` types WebAudio and `storage`
 * types `WebStorageLike`), so this file — and the shipped `.d.ts` — carry no
 * SDK-ambient dependency.
 */
import type { audioPlugin } from "../audio";
import type { Channel as AudioChannel } from "../audio/types";
import type { loopPlugin } from "../loop";
import type { storagePlugin } from "../storage";
import type { StorageBackend } from "../storage/types";

// ─────────────────────────────────────────────────────────────────────────────
// Shared logger surface
// ─────────────────────────────────────────────────────────────────────────────

/** Shared minimal logger surface (from `logPlugin`) used by the platform domain files. */
export type Log = {
  /** Log at debug level (the no-show / degraded-mode paths). */
  debug(message: string): void;
  /** Log at info level (the resolved-portal + headless notices). */
  info(message: string): void;
  /** Log a warning (an SDK that failed to load — degraded to no-op). */
  warn(message: string): void;
  /** Log an error. */
  error(message: string): void;
};

// ─────────────────────────────────────────────────────────────────────────────
// Public contract
// ─────────────────────────────────────────────────────────────────────────────

/** The portals platform can target (the resolved adapter identity). */
export type Portal = "crazygames" | "poki" | "newgrounds" | "none";

/** The kinds of ad an adapter can show. */
export type AdType = "interstitial" | "rewarded";

/**
 * platform plugin configuration.
 *
 * `portal` is normally left at `"auto"` so the active portal is resolved from
 * `ctx.env` at build/boot time — one game codebase, one bundle per portal. An
 * explicit `Portal` value overrides the env lookup (used by tests and by a
 * consumer that wires the portal itself). Unknown/absent env → the `none` no-op.
 */
export type Config = {
  /**
   * Which portal adapter to activate, or `"auto"` to resolve from `ctx.env`.
   * `@default "auto"`
   */
  portal: Portal | "auto";
  /**
   * Env var read (via `ctx.env.get`) to resolve the portal when `portal` is
   * `"auto"`. Its value is matched case-insensitively against the `Portal` union;
   * anything unrecognised → `"none"`. `@default "GAME_PORTAL"`
   */
  portalEnvVar: string;
  /**
   * Auto-pause the `loop` and mute the `audio` plugin for the duration of every
   * ad (portals require the game paused + silent during ad breaks). `@default true`
   */
  pauseOnAd: boolean;
  /**
   * Minimum seconds between interstitial `commercialBreak()` shows (frequency
   * cap). A call inside the window resolves immediately as a no-show. `@default 60`
   */
  minInterstitialSeconds: number;
  /**
   * Route saves through the adapter's native `StorageBackend` when it provides
   * one (CrazyGames data API). `false` keeps the `storage` plugin's localStorage
   * default. `@default true`
   */
  useNativeStorage: boolean;
  /**
   * Persist `audio` mute/volume through `storage` (hook `audio:muteChanged` /
   * `audio:volumeChanged`) and rehydrate them into `audio` at start. `@default true`
   */
  persistAudioPrefs: boolean;
};

/**
 * platform plugin state — the session-serializable mirror.
 *
 * Holds only plain, restorable data. The **live adapter instance** (holding the
 * loaded SDK handle) and the registered **focus/visibility listeners** live in a
 * `ctx.global` WeakMap (see `lifecycle.ts`), never here — the same split `audio`
 * uses for its `AudioContext` and `loop` for its rAF handle.
 */
export type State = {
  /** The portal resolved at onStart (never `"auto"` — always a concrete Portal). */
  portal: Portal;
  /** True while an interstitial or rewarded ad is in flight (re-entrancy guard). */
  adPlaying: boolean;
  /** Epoch ms of the last shown interstitial (frequency-cap anchor; 0 = never). */
  lastInterstitialAt: number;
};

/** platform plugin event contract — coarse, non-hot-path portal + ad-boundary milestones. */
export type Events = {
  /** Emitted once the active adapter is initialised and loading is signalled finished. */
  "platform:ready": { portal: Portal };
  /** Emitted when an ad begins (after pause + mute). */
  "platform:adStart": { type: AdType };
  /** Emitted when an ad ends (after resume + unmute). `rewarded` is set for rewarded ads. */
  "platform:adEnd": { type: AdType; rewarded?: boolean };
};

/** platform plugin API, exposed as `app.platform`. */
export type Api = {
  /**
   * The portal resolved at start (`"none"` for local dev / unknown env).
   *
   * @returns The resolved {@link Portal}.
   */
  getPortal(): Portal;
  /** Signal that active gameplay started (some portals gate ad timing / analytics on this). */
  gameplayStart(): void;
  /** Signal that gameplay stopped (menu, pause, game-over). */
  gameplayStop(): void;
  /** Signal that the loading phase started. Usually called by onStart; exposed for manual control. */
  loadingStart(): void;
  /** Signal that loading finished and the game is interactive. Called by onStart after the SDK is ready. */
  loadingFinished(): void;
  /**
   * Show an interstitial ad. When `pauseOnAd`, pauses `loop` + mutes `audio` for
   * the ad and restores both on settle. Honours `minInterstitialSeconds` — a call
   * inside the cap window resolves immediately without showing. Resolves when the
   * ad completes, is skipped, or is unavailable (never rejects to the caller).
   *
   * @returns A Promise that resolves once the ad settles (or is skipped / capped).
   */
  commercialBreak(): Promise<void>;
  /**
   * Show a rewarded ad. Same pause+mute+resume coordination as `commercialBreak`.
   * Resolves `true` when the ad was watched to completion (grant the reward), else
   * `false` (dismissed / unavailable). The `none` adapter resolves `true` so local
   * dev exercises the reward-granted branch.
   *
   * @returns A Promise resolving `true` when the reward was earned, else `false`.
   */
  rewardedAd(): Promise<boolean>;
  /**
   * Whether an ad is currently in flight.
   *
   * @returns `true` while an ad is playing.
   */
  isAdPlaying(): boolean;
};

// ─────────────────────────────────────────────────────────────────────────────
// Portal adapter seam
// ─────────────────────────────────────────────────────────────────────────────

/** Minimal, side-effect-free context an adapter needs (logger + the game's own window). */
export type AdapterContext = {
  /** Logger for SDK-load / degraded-mode notices. */
  readonly log: Log;
  /**
   * The game's own `window` (never `window.top` — iframe-safe), or `undefined`
   * when headless. Typed as `unknown`; each adapter narrows it structurally to
   * the SDK-host shape it needs.
   */
  readonly window: unknown;
};

/**
 * The seam every portal integration implements. The public API
 * (`app.platform.*`) is portal-agnostic; only the concrete adapter differs.
 * CrazyGames/Poki/Newgrounds each wrap their portal's runtime SDK; the `none`
 * adapter is a fully-inert no-op.
 */
export type PortalAdapter = {
  /** The portal this adapter targets. */
  readonly portal: Portal;
  /**
   * Load the portal SDK (async `<script>` inject) + portal handshake. Iframe-safe.
   * Resolves when ready (the `none` adapter resolves immediately); a failed load
   * degrades to no-op rather than rejecting.
   *
   * @param ctx - The adapter context (logger + the game's own window).
   * @returns A Promise that resolves once the adapter is ready.
   */
  init(ctx: AdapterContext): Promise<void>;
  /** Signal active gameplay started to the portal. */
  gameplayStart(): void;
  /** Signal gameplay stopped to the portal. */
  gameplayStop(): void;
  /** Signal the loading phase started to the portal. */
  loadingStart(): void;
  /** Signal loading finished (game interactive) to the portal. */
  loadingFinished(): void;
  /**
   * Show an interstitial; resolves on complete/skip/unavailable (never rejects).
   *
   * @returns A Promise that resolves once the interstitial settles.
   */
  commercialBreak(): Promise<void>;
  /**
   * Show a rewarded ad; resolves `true` when watched to completion, else `false`.
   *
   * @returns A Promise resolving `true` when the reward was earned, else `false`.
   */
  rewardedAd(): Promise<boolean>;
  /**
   * Optional portal-native persistence (CrazyGames data API) as a synchronous,
   * non-throwing {@link StorageBackend} facade: hydrated from the async data API
   * during `init()`, writes mirrored to memory synchronously and flushed to the
   * portal asynchronously. `undefined` → keep storage's localStorage default.
   */
  readonly storageBackend?: StorageBackend | undefined;
  /** Detach SDK callbacks / timers. */
  destroy(): void;
};

// ─────────────────────────────────────────────────────────────────────────────
// Structural dependency APIs (obtained via ctx.require — no internal imports)
// ─────────────────────────────────────────────────────────────────────────────

/** The subset of the `loop` API platform calls to pause/resume around ads + focus loss. */
export type LoopDep = {
  /** Whether the loop is currently running. */
  isRunning(): boolean;
  /** Start the loop (restore after an ad / focus regain). */
  start(): void;
  /** Stop the loop (pause for an ad / focus loss). */
  stop(): void;
};

/** The subset of the `audio` API platform calls to mute/restore + rehydrate prefs. */
export type AudioDep = {
  /** Whether audio is currently muted. */
  isMuted(): boolean;
  /** Mute the mix (for an ad / focus loss). */
  mute(): void;
  /** Unmute the mix (restore after an ad / focus regain). */
  unmute(): void;
  /**
   * Set mute state explicitly (rehydration).
   *
   * @param muted - The desired mute state.
   */
  setMuted(muted: boolean): void;
  /**
   * Set a channel volume (rehydration).
   *
   * @param channel - Which channel to set.
   * @param value - The new volume 0..1.
   */
  setVolume(channel: AudioChannel, value: number): void;
};

/** The subset of the `storage` API platform calls to inject a backend + persist prefs. */
export type StorageDep = {
  /**
   * Inject a portal-native backend (routes saves through the CrazyGames data API).
   *
   * @param backend - The replacement {@link StorageBackend}.
   */
  setBackend(backend: StorageBackend): void;
  /**
   * Read + JSON-parse a value by key.
   *
   * @param key - The un-namespaced key.
   * @param fallback - Value returned when the key is absent / unreadable.
   * @returns The parsed value, or the fallback.
   */
  get<T>(key: string, fallback?: T): T | undefined;
  /**
   * JSON-serialize and write a value by key.
   *
   * @param key - The un-namespaced key.
   * @param value - Any JSON-serializable value.
   * @returns `true` on success, `false` when rejected.
   */
  set(key: string, value: unknown): boolean;
};

/**
 * The `require` surface platform's context exposes: a single overloaded function
 * mapping each dependency plugin instance to its structural API subset. The
 * kernel's generic `require` is assignable to this intersection (the loop plugin
 * types its scheduler/renderer requires the same way).
 */
export type PlatformRequire = ((plugin: typeof loopPlugin) => LoopDep) &
  ((plugin: typeof audioPlugin) => AudioDep) &
  ((plugin: typeof storagePlugin) => StorageDep);

/** The audio channel identifiers platform rehydrates (re-exported for prefs helpers). */
export type Channel = AudioChannel;
