/**
 * @file platform plugin — state factory.
 */
import type { State } from "./types";

/**
 * Creates the initial platform plugin state — the session-serializable mirror.
 *
 * `portal` starts as `"none"` and is overwritten with the resolved concrete portal
 * in `onStart`; `adPlaying` starts `false`; `lastInterstitialAt` starts `0` (no
 * interstitial shown yet, so the frequency cap never blocks the first show). The
 * live adapter + focus/visibility listeners are **not** here — they live in the
 * `ctx.global` WeakMap (see `lifecycle.ts`), the same split `audio` uses for its
 * AudioContext.
 *
 * @returns The initial {@link State} object for this plugin instance.
 * @example
 * ```ts
 * const state = createState();
 * // → { portal: "none", adPlaying: false, lastInterstitialAt: 0 }
 * ```
 */
export const createState = (): State => ({
  portal: "none",
  adPlaying: false,
  lastInterstitialAt: 0
});
