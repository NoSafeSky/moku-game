/**
 * @file platform adapter — `none` (no-op / standalone).
 *
 * A fully-inert adapter for local dev and self-hosting: every lifecycle + ad
 * method is a safe no-op with no SDK, no DOM, and no network. `init()` resolves
 * immediately and exposes no `storageBackend` (so `storage` keeps its
 * localStorage default). `rewardedAd()` resolves `true` so local dev exercises
 * the reward-granted branch without a real ad network.
 */
import type { PortalAdapter } from "../types";

/**
 * Build the inert `none` adapter.
 *
 * @returns A {@link PortalAdapter} whose every method no-ops; `rewardedAd()` → `true`.
 * @example
 * ```ts
 * const adapter = createNoopAdapter();
 * await adapter.init({ log, window: undefined }); // resolves immediately
 * await adapter.rewardedAd();                     // → true (dev reward branch)
 * ```
 */
export const createNoopAdapter = (): PortalAdapter => ({
  portal: "none",

  /**
   * No SDK to load — resolves immediately.
   *
   * @returns A Promise that resolves at once.
   * @example
   * ```ts
   * await adapter.init({ log, window });
   * ```
   */
  init(): Promise<void> {
    return Promise.resolve();
  },

  /**
   * No-op: no portal to signal.
   *
   * @example
   * ```ts
   * adapter.gameplayStart(); // inert
   * ```
   */
  gameplayStart(): void {
    // Inert — standalone build has no portal.
  },

  /**
   * No-op: no portal to signal.
   *
   * @example
   * ```ts
   * adapter.gameplayStop(); // inert
   * ```
   */
  gameplayStop(): void {
    // Inert — standalone build has no portal.
  },

  /**
   * No-op: no portal to signal.
   *
   * @example
   * ```ts
   * adapter.loadingStart(); // inert
   * ```
   */
  loadingStart(): void {
    // Inert — standalone build has no portal.
  },

  /**
   * No-op: no portal to signal.
   *
   * @example
   * ```ts
   * adapter.loadingFinished(); // inert
   * ```
   */
  loadingFinished(): void {
    // Inert — standalone build has no portal.
  },

  /**
   * No interstitial to show — resolves immediately (a no-show).
   *
   * @returns A Promise that resolves at once.
   * @example
   * ```ts
   * await adapter.commercialBreak(); // resolves immediately
   * ```
   */
  commercialBreak(): Promise<void> {
    return Promise.resolve();
  },

  /**
   * No ad network — resolves `true` so local dev exercises the reward-granted branch.
   *
   * @returns A Promise that resolves `true`.
   * @example
   * ```ts
   * if (await adapter.rewardedAd()) grantReward(); // always granted in dev
   * ```
   */
  rewardedAd(): Promise<boolean> {
    return Promise.resolve(true);
  },

  /**
   * No-op: nothing to detach.
   *
   * @example
   * ```ts
   * adapter.destroy(); // inert
   * ```
   */
  destroy(): void {
    // Inert — no SDK callbacks or timers to release.
  }
});
