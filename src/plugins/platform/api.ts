/**
 * @file platform plugin — API factory.
 *
 * The public `app.platform` surface: the portal-lifecycle signals
 * (`gameplayStart/Stop`, `loadingStart/Finished`) plus the two promise-based ads
 * (`commercialBreak`, `rewardedAd`).
 *
 * **Ad coordination is capture-then-restore.** Each ad captures `loop.isRunning()`
 * + `audio.isMuted()` *before* pausing + muting, then on settle (resolve **or**
 * reject) restores only what it changed — `loop.start()` only if the loop was
 * running before, `audio.unmute()` only if audio was not already muted before. A
 * re-entrancy guard (`state.adPlaying`) makes a second ad call while one is in
 * flight a no-op, and `commercialBreak` honours the `minInterstitialSeconds`
 * frequency cap. Neither ad ever rejects to the caller. The live adapter is read
 * from the `ctx.global` WeakMap (exported from `lifecycle.ts`); before `onStart` /
 * after `onStop` there is no adapter, so every method safely no-ops.
 */
import { audioPlugin } from "../audio";
import { loopPlugin } from "../loop";
import { platformRegistry } from "./lifecycle";
import type {
  AdType,
  Api,
  Config,
  Events,
  Log,
  PlatformRequire,
  Portal,
  PortalAdapter,
  State
} from "./types";

// ─────────────────────────────────────────────────────────────────────────────
// Structural context type (only the fields the API factory accesses)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Structural context required by {@link createApi}, so unit tests can pass a
 * minimal mock without wiring the full kernel. Mirrors the AudioApiContext /
 * LoopContext pattern used across this framework.
 */
export type PlatformApiContext = {
  /** Resolved platform configuration (pause-on-ad + frequency cap). */
  readonly config: Readonly<Config>;
  /** platform plugin state — resolved portal, ad-flight flag, last-interstitial time. */
  readonly state: State;
  /** Global plugin registry — key for the adapter WeakMap. */
  readonly global: object;
  /** Logger from logPlugin (the no-show notice). */
  readonly log: Log;
  /** Require a dependency's API by plugin instance (`loop` / `audio`). */
  require: PlatformRequire;
  /**
   * Emit a declared platform event with its typed payload. Written as a method
   * signature (bivariant params) so the kernel's merged `ctx.emit` — which also
   * carries the framework-level events — is assignable to this narrower
   * platform-only view when the API factory is wired via `api: ctx => createApi(ctx)`.
   *
   * @param event - The platform event name.
   * @param payload - The event payload, matching the declared shape.
   */
  emit<K extends keyof Events>(event: K, payload: Events[K]): void;
};

/** What an ad captured before pausing + muting — restored (only if changed) on settle. */
type AdCapture = {
  /** Whether the loop was running before the ad (restart only if it was). */
  readonly wasRunning: boolean;
  /** Whether audio was already muted before the ad (unmute only if it wasn't). */
  readonly wasMuted: boolean;
};

// ─────────────────────────────────────────────────────────────────────────────
// API factory
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Creates the platform plugin API surface.
 *
 * @param ctx - Plugin context (structural — only the fields this API uses).
 * @param ctx.config - Resolved platform configuration.
 * @param ctx.state - The session-mirror state (portal, ad flag, last-interstitial time).
 * @param ctx.global - Global plugin registry (key for the adapter WeakMap).
 * @param ctx.log - Logger from logPlugin.
 * @param ctx.require - Kernel function to obtain the `loop` / `audio` APIs.
 * @param ctx.emit - Typed emit for the platform events.
 * @returns The platform plugin {@link Api} object.
 * @example
 * ```ts
 * const api = createApi(ctx);
 * const rewarded = await api.rewardedAd(); // loop paused + audio muted during, restored after
 * if (rewarded) grantExtraLife();
 * ```
 */
export const createApi = (ctx: PlatformApiContext): Api => {
  /**
   * The live adapter for this app, or `undefined` before `onStart` / after `onStop`.
   *
   * @returns The active {@link PortalAdapter}, or `undefined` when unavailable.
   * @example
   * ```ts
   * const adapter = liveAdapter();
   * if (!adapter) return; // not started
   * ```
   */
  const liveAdapter = (): PortalAdapter | undefined => platformRegistry.get(ctx.global)?.adapter;

  /**
   * Whether an interstitial `commercialBreak()` is inside the frequency-cap window
   * (too soon since the last shown interstitial).
   *
   * @returns `true` when a fresh interstitial must be suppressed.
   * @example
   * ```ts
   * if (withinFrequencyCap()) return; // no-show
   * ```
   */
  const withinFrequencyCap = (): boolean => {
    const capMs = ctx.config.minInterstitialSeconds * 1000;
    return Date.now() - ctx.state.lastInterstitialAt < capMs;
  };

  /**
   * Capture the current loop/audio state, then (when `pauseOnAd`) pause + mute for
   * the ad. Sets the re-entrancy flag and emits `platform:adStart`.
   *
   * @param type - The kind of ad beginning.
   * @returns The captured pre-ad state, for {@link endAd} to restore.
   * @example
   * ```ts
   * const capture = beginAd("interstitial");
   * ```
   */
  const beginAd = (type: AdType): AdCapture => {
    const loop = ctx.require(loopPlugin);
    const audio = ctx.require(audioPlugin);
    const capture: AdCapture = { wasRunning: loop.isRunning(), wasMuted: audio.isMuted() };

    if (ctx.config.pauseOnAd) {
      if (capture.wasRunning) loop.stop();
      if (!capture.wasMuted) audio.mute();
    }

    ctx.state.adPlaying = true;
    ctx.emit("platform:adStart", { type });
    return capture;
  };

  /**
   * Restore only what {@link beginAd} changed (loop restart iff it was running,
   * unmute iff it was not already muted) and clear the re-entrancy flag.
   *
   * @param capture - The state captured by {@link beginAd}.
   * @example
   * ```ts
   * endAd(capture); // loop + audio back exactly as they were
   * ```
   */
  const endAd = (capture: AdCapture): void => {
    if (ctx.config.pauseOnAd) {
      const loop = ctx.require(loopPlugin);
      const audio = ctx.require(audioPlugin);
      if (capture.wasRunning) loop.start();
      if (!capture.wasMuted) audio.unmute();
    }

    ctx.state.adPlaying = false;
  };

  return {
    /**
     * The portal resolved at start (`"none"` for local dev / unknown env).
     *
     * @returns The resolved {@link Portal}.
     * @example
     * ```ts
     * if (app.platform.getPortal() === "none") console.info("standalone build");
     * ```
     */
    getPortal(): Portal {
      return ctx.state.portal;
    },

    /**
     * Signal that active gameplay started. No-op before start / after stop.
     *
     * @example
     * ```ts
     * app.platform.gameplayStart();
     * ```
     */
    gameplayStart(): void {
      liveAdapter()?.gameplayStart();
    },

    /**
     * Signal that gameplay stopped (menu, pause, game-over). No-op before start.
     *
     * @example
     * ```ts
     * app.platform.gameplayStop();
     * ```
     */
    gameplayStop(): void {
      liveAdapter()?.gameplayStop();
    },

    /**
     * Signal that the loading phase started. Usually called by onStart. No-op before start.
     *
     * @example
     * ```ts
     * app.platform.loadingStart();
     * ```
     */
    loadingStart(): void {
      liveAdapter()?.loadingStart();
    },

    /**
     * Signal that loading finished and the game is interactive. No-op before start.
     *
     * @example
     * ```ts
     * app.platform.loadingFinished();
     * ```
     */
    loadingFinished(): void {
      liveAdapter()?.loadingFinished();
    },

    /**
     * Show an interstitial ad. Pauses `loop` + mutes `audio` (when `pauseOnAd`) and
     * restores both on settle. Honours the frequency cap and re-entrancy guard;
     * never rejects to the caller. No-op resolve before start / while an ad plays /
     * inside the cap window.
     *
     * @returns A Promise that resolves once the ad settles (or is skipped / capped).
     * @example
     * ```ts
     * app.platform.gameplayStop();
     * await app.platform.commercialBreak();
     * app.platform.gameplayStart();
     * ```
     */
    async commercialBreak(): Promise<void> {
      const adapter = liveAdapter();
      if (!adapter) return; // not started / after stop
      if (ctx.state.adPlaying) return; // re-entrancy guard → resolve, no second ad

      if (withinFrequencyCap()) {
        ctx.log.debug(
          `[platform] commercialBreak suppressed — within the ${ctx.config.minInterstitialSeconds}s frequency cap.`
        );
        return;
      }

      const capture = beginAd("interstitial");
      try {
        await adapter.commercialBreak();
      } catch {
        // settle = resolve OR reject — swallow so we never reject to the caller.
      } finally {
        ctx.state.lastInterstitialAt = Date.now();
        endAd(capture);
        ctx.emit("platform:adEnd", { type: "interstitial" });
      }
    },

    /**
     * Show a rewarded ad. Same pause+mute+resume coordination as
     * `commercialBreak`. Resolves `true` when watched to completion, else `false`.
     * The re-entrancy guard resolves `false` while another ad plays; never rejects.
     *
     * @returns A Promise resolving `true` when the reward was earned, else `false`.
     * @example
     * ```ts
     * if (await app.platform.rewardedAd()) grantExtraLife();
     * ```
     */
    async rewardedAd(): Promise<boolean> {
      const adapter = liveAdapter();
      if (!adapter) return false; // not started / after stop
      if (ctx.state.adPlaying) return false; // re-entrancy guard → no reward

      const capture = beginAd("rewarded");
      let rewarded = false;
      try {
        rewarded = await adapter.rewardedAd();
      } catch {
        rewarded = false; // settle = resolve OR reject — no reward, never rethrow
      } finally {
        endAd(capture);
        ctx.emit("platform:adEnd", { type: "rewarded", rewarded });
      }
      return rewarded;
    },

    /**
     * Whether an ad is currently in flight.
     *
     * @returns `true` while an ad is playing.
     * @example
     * ```ts
     * if (!app.platform.isAdPlaying()) app.platform.commercialBreak();
     * ```
     */
    isAdPlaying(): boolean {
      return ctx.state.adPlaying;
    }
  };
};
