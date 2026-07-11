/**
 * @file platform plugin — onStart / onStop lifecycle handlers.
 *
 * onStart: resolves the active portal (`config.portal`, or `ctx.env.get(portalEnvVar)`
 *   when `"auto"`; unknown/absent → `none`; no `window` → `none`), constructs the
 *   matching adapter and awaits `adapter.init()` (SDK load + handshake). Then, when
 *   `useNativeStorage` and the adapter exposes one, injects the portal-native
 *   `StorageBackend` into `storage`; when `persistAudioPrefs`, rehydrates `audio`
 *   mute/volume from `storage`; registers the game's own `window` focus/blur +
 *   visibilitychange listeners (blur/hidden → pause+mute, focus/visible → restore).
 *   The loaded SDK + DOM listeners are the real resource — held per app in the
 *   {@link platformRegistry} WeakMap (keyed on `ctx.global`, the `audio`/`loop`
 *   pattern) — then `adapter.loadingFinished()` runs and `platform:ready` is emitted.
 *
 * onStop: reads the runtime from the WeakMap via `ctx.global` (TeardownContext
 *   exposes only `{ global }`), removes the focus/visibility listeners, calls
 *   `adapter.destroy()`, and clears the entry so a re-`start()` builds fresh.
 *   Idempotent — a second call with the same `ctx.global` is a safe no-op.
 *
 * **Iframe-safe:** reads only the game's own `window` (`globalThis.window`), never
 * `window.top`.
 */
import { audioPlugin } from "../audio";
import { loopPlugin } from "../loop";
import { storagePlugin } from "../storage";
import { selectAdapter } from "./adapters";
import { rehydrateAudioPrefs } from "./prefs";
import type { Config, Events, Log, PlatformRequire, Portal, PortalAdapter, State } from "./types";

// ─────────────────────────────────────────────────────────────────────────────
// Per-instance runtime (stored in the WeakMap)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Runtime data stored per plugin instance, keyed on `ctx.global`. Shared between
 * `lifecycle.ts` and `api.ts` via the exported {@link platformRegistry} (mirrors
 * the loop plugin's `loopRuntime`).
 */
export type PlatformRuntime = {
  /** The live portal adapter (holding the loaded SDK handle). */
  readonly adapter: PortalAdapter;
  /** Detaches the focus/visibility listeners registered in `onStart`. */
  readonly removeListeners: () => void;
};

/**
 * Module-level WeakMap mapping each app's global registry to its platform runtime.
 * Exported so `api.ts` reaches the same adapter without a second map (mirrors the
 * `audio` plugin's `audioRegistry`).
 */
export const platformRegistry = new WeakMap<object, PlatformRuntime>();

// ─────────────────────────────────────────────────────────────────────────────
// Structural globalThis / window surface (DOM lib is intentionally absent)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Minimal structural view of the game's own `window` — the focus/visibility event
 * target plus its `document.visibilityState`. Declared here rather than pulled
 * from the DOM `lib` so the emitted `.d.ts` stays DOM-ambient-free.
 */
type WindowLike = {
  /**
   * Register an event listener.
   *
   * @param type - The event type (`focus` | `blur` | `visibilitychange`).
   * @param listener - The handler.
   */
  addEventListener(type: string, listener: () => void): void;
  /**
   * Remove an event listener.
   *
   * @param type - The event type.
   * @param listener - The handler to remove.
   */
  removeEventListener(type: string, listener: () => void): void;
  /** The document, whose `visibilityState` disambiguates a visibilitychange. */
  document?: { visibilityState?: string };
};

/** Structural minimal env accessor (`ctx.env` from the common envPlugin). */
type EnvironmentLike = {
  /**
   * Read a resolved environment value.
   *
   * @param key - The variable name.
   * @returns The value, or `undefined` when unset.
   */
  get(key: string): string | undefined;
};

/** What a focus-pause captured, so `onShow` restores only what `onHide` changed. */
type FocusCapture = {
  /** Whether the loop was running when focus was lost. */
  readonly wasRunning: boolean;
  /** Whether audio was already muted when focus was lost. */
  readonly wasMuted: boolean;
};

// ─────────────────────────────────────────────────────────────────────────────
// Context types (structural — only fields actually accessed)
// ─────────────────────────────────────────────────────────────────────────────

/** Context available in onStart (full PluginContext, subset used here). */
type StartContext = {
  /** Resolved platform configuration. */
  readonly config: Readonly<Config>;
  /** platform plugin state (the resolved portal is written here). */
  readonly state: State;
  /** Global plugin registry — key for the WeakMap. */
  readonly global: object;
  /** Logger from logPlugin. */
  readonly log: Log;
  /** Validated environment accessor (resolves the active portal when `"auto"`). */
  readonly env: EnvironmentLike;
  /** Require a dependency's API by plugin instance (`loop` / `audio` / `storage`). */
  require: PlatformRequire;
  /**
   * Emit a declared platform event. A method signature (bivariant params) so the
   * kernel's merged `ctx.emit` is assignable to this narrower platform-only view
   * when the handler is wired via `onStart: ctx => start(ctx)`.
   *
   * @param event - The platform event name.
   * @param payload - The event payload, matching the declared shape.
   */
  emit<K extends keyof Events>(event: K, payload: Events[K]): void;
};

/** Context available in onStop (TeardownContext — global only). */
type StopContext = {
  /** Global plugin registry — key for the WeakMap. */
  readonly global: object;
};

// ─────────────────────────────────────────────────────────────────────────────
// Portal resolution
// ─────────────────────────────────────────────────────────────────────────────

/** The concrete portals, checked case-insensitively when resolving from env. */
const PORTALS: readonly Portal[] = ["crazygames", "poki", "newgrounds", "none"];

/**
 * Resolve the active portal: `none` when headless (no `window`); an explicit
 * `config.portal`; otherwise the case-insensitive `ctx.env` value (unknown/absent
 * → `none`).
 *
 * @param config - Resolved platform configuration.
 * @param env - The environment accessor.
 * @param hasWindow - Whether the game's own `window` is available.
 * @returns The resolved concrete {@link Portal}.
 * @example
 * ```ts
 * resolvePortal({ portal: "auto", portalEnvVar: "GAME_PORTAL", ... }, env, true);
 * ```
 */
const resolvePortal = (
  config: Readonly<Config>,
  env: EnvironmentLike,
  hasWindow: boolean
): Portal => {
  if (!hasWindow) return "none"; // headless / iframe-less guard
  if (config.portal !== "auto") return config.portal;

  const raw = env.get(config.portalEnvVar)?.toLowerCase();
  return PORTALS.find(portal => portal === raw) ?? "none";
};

/**
 * Resolve the game's own `window` (never `window.top` — iframe-safe), or
 * `undefined` when headless.
 *
 * @returns The structural window, or `undefined`.
 * @example
 * ```ts
 * const window = resolveWindow();
 * ```
 */
const resolveWindow = (): WindowLike | undefined => (globalThis as { window?: WindowLike }).window;

// ─────────────────────────────────────────────────────────────────────────────
// Focus / visibility pause
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Register the game's `window` focus/blur + visibilitychange listeners so the game
 * pauses + mutes on focus loss and restores on focus regain (portals require the
 * game paused when hidden). Capture-then-restore, guarded so it never fights an
 * in-flight ad. Only active when `pauseOnAd`. Returns a cleanup that removes them
 * all; a no-op cleanup when headless.
 *
 * @param ctx - The start context (config, state, require).
 * @param window - The game's own window, or `undefined` when headless.
 * @returns A cleanup that removes every registered listener.
 * @example
 * ```ts
 * const removeListeners = registerFocusListeners(ctx, window);
 * ```
 */
const registerFocusListeners = (
  ctx: StartContext,
  window: WindowLike | undefined
): (() => void) => {
  if (!window || !ctx.config.pauseOnAd) {
    return () => {
      // Headless or pause-on-ad disabled — nothing was registered.
    };
  }

  // Held across the hide → show pair so restore touches only what hide changed.
  let capture: FocusCapture | undefined;

  /**
   * On focus loss: capture loop/audio state and pause + mute (unless an ad or an
   * existing pause already owns them).
   *
   * @example
   * ```ts
   * window.addEventListener("blur", onHide);
   * ```
   */
  const onHide = (): void => {
    if (ctx.state.adPlaying || capture) return; // an ad, or an existing pause, owns it
    const loop = ctx.require(loopPlugin);
    const audio = ctx.require(audioPlugin);
    capture = { wasRunning: loop.isRunning(), wasMuted: audio.isMuted() };
    if (capture.wasRunning) loop.stop();
    if (!capture.wasMuted) audio.mute();
  };

  /**
   * On focus regain: restore only what {@link onHide} changed, then clear the capture.
   *
   * @example
   * ```ts
   * window.addEventListener("focus", onShow);
   * ```
   */
  const onShow = (): void => {
    if (!capture) return;
    const loop = ctx.require(loopPlugin);
    const audio = ctx.require(audioPlugin);
    if (capture.wasRunning) loop.start();
    if (!capture.wasMuted) audio.unmute();
    capture = undefined;
  };

  /**
   * Route a visibilitychange to hide/show based on `document.visibilityState`.
   *
   * @example
   * ```ts
   * window.addEventListener("visibilitychange", onVisibility);
   * ```
   */
  const onVisibility = (): void => {
    if (window.document?.visibilityState === "hidden") onHide();
    else onShow();
  };

  window.addEventListener("blur", onHide);
  window.addEventListener("focus", onShow);
  window.addEventListener("visibilitychange", onVisibility);

  return () => {
    window.removeEventListener("blur", onHide);
    window.removeEventListener("focus", onShow);
    window.removeEventListener("visibilitychange", onVisibility);
  };
};

// ─────────────────────────────────────────────────────────────────────────────
// onStart
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Starts the platform plugin: resolves the portal, builds + inits the adapter,
 * injects the native storage backend (when applicable), rehydrates audio prefs,
 * registers the focus/visibility listeners, records the runtime, and emits
 * `platform:ready`. When headless (no `window`) the portal resolves to `none` and
 * every effectful path no-ops.
 *
 * @param ctx - Plugin context providing config, state, global, log, env, require, emit.
 * @returns A Promise that resolves once the adapter is ready and wired.
 * @example
 * ```ts
 * await start(ctx);
 * ```
 */
export const start = async (ctx: StartContext): Promise<void> => {
  const window = resolveWindow();
  const portal = resolvePortal(ctx.config, ctx.env, window !== undefined);
  ctx.state.portal = portal;

  // ── Build + initialise the adapter (loads the SDK; `none` resolves at once) ──
  const adapter = selectAdapter(portal);
  adapter.loadingStart();
  await adapter.init({ log: ctx.log, window });

  // ── Route saves through the portal-native backend, when provided ────────────
  if (ctx.config.useNativeStorage && adapter.storageBackend) {
    ctx.require(storagePlugin).setBackend(adapter.storageBackend);
  }

  // ── Rehydrate audio prefs (after any backend swap, so prefs read the portal) ─
  if (ctx.config.persistAudioPrefs) {
    rehydrateAudioPrefs(ctx);
  }

  // ── Register the real resource (focus/visibility listeners) + record runtime ─
  const removeListeners = registerFocusListeners(ctx, window);
  platformRegistry.set(ctx.global, { adapter, removeListeners });

  adapter.loadingFinished();
  ctx.emit("platform:ready", { portal });
  ctx.log.info(`[platform] ready — portal "${portal}".`);
};

// ─────────────────────────────────────────────────────────────────────────────
// onStop
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Stops the platform plugin: removes the focus/visibility listeners, destroys the
 * adapter (detaches SDK callbacks/timers), and removes the WeakMap entry. Reads the
 * runtime from the module WeakMap via `ctx.global` because onStop only receives
 * TeardownContext (`{ global }`). Idempotent — a second call with the same global
 * is a safe no-op.
 *
 * @param ctx - Teardown context providing only the global registry.
 * @returns A Promise that resolves once teardown is complete.
 * @example
 * ```ts
 * await stop(ctx);
 * ```
 */
export const stop = async (ctx: StopContext): Promise<void> => {
  const runtime = platformRegistry.get(ctx.global);
  if (!runtime) return;

  runtime.removeListeners();
  runtime.adapter.destroy();
  platformRegistry.delete(ctx.global);
};
