/**
 * @file platform adapter — Newgrounds.
 *
 * Wraps the Newgrounds runtime SDK (`window.Newgrounds`). Newgrounds' ad surface
 * is intentionally thin — a single callback-style `triggerAd` (mapped to a
 * Promise) plus best-effort lifecycle/analytics hooks; any method the loaded SDK
 * does not expose degrades to a safe no-show. Newgrounds exposes no game-save API,
 * so this adapter provides **no** `storageBackend` — `storage` keeps its safe
 * localStorage default.
 *
 * The SDK global is typed **structurally** here (no Newgrounds npm import), so the
 * shipped `.d.ts` carries no SDK-ambient dependency. When the global is absent,
 * `init()` best-effort injects the `<script>` and, failing that, degrades to inert.
 */
import type { AdapterContext, Log, PortalAdapter } from "../types";

// ─────────────────────────────────────────────────────────────────────────────
// Structural Newgrounds SDK surface (no SDK import — kept out of the .d.ts)
// ─────────────────────────────────────────────────────────────────────────────

/** Structural view of the top-level `window.Newgrounds` object. */
type NewgroundsSDKLike = {
  /** Initialise / open the Newgrounds session (optional). */
  init?(): void;
  /** Log a view / analytics ping (optional). */
  logView?(): void;
  /** Log a named analytics event (optional). */
  logEvent?(event: string): void;
  /** Trigger an ad, invoking the callback with whether it completed (optional). */
  triggerAd?(callback: (completed: boolean) => void): void;
};

/** Minimal structural view of an injected `<script>` element. */
type NewgroundsScript = {
  /** The script URL to load. */
  src: string;
  /** Whether to load asynchronously. */
  async: boolean;
  /** Register a load/error listener. */
  addEventListener(type: "load" | "error", listener: () => void): void;
};

/** Minimal structural DOM surface used to inject the SDK `<script>`. */
type NewgroundsDocument = {
  /** Create a `<script>` element. */
  createElement(tag: "script"): NewgroundsScript;
  /** The document head, where the script is appended. */
  head?: { append(node: NewgroundsScript): void };
};

/** Structural view of the game's own `window` exposing the Newgrounds SDK + DOM. */
type NewgroundsHost = {
  /** The Newgrounds global, present once the SDK script has loaded. */
  Newgrounds?: NewgroundsSDKLike;
  /** DOM document, used to best-effort inject the SDK script. */
  document?: NewgroundsDocument;
};

/** Newgrounds.io client library URL (served from the portal CDN). */
const SDK_URL = "https://ngmc.co/lib/1.0/index.min.js";

// ─────────────────────────────────────────────────────────────────────────────
// SDK resolution
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Resolve the Newgrounds SDK already present on the host window, or `undefined`.
 *
 * @param host - The game's own window (structurally typed).
 * @returns The SDK, or `undefined` when the global is not present.
 * @example
 * ```ts
 * const sdk = resolveSdk(window as NewgroundsHost);
 * ```
 */
const resolveSdk = (host: NewgroundsHost | undefined): NewgroundsSDKLike | undefined =>
  host?.Newgrounds;

/**
 * Best-effort inject the SDK `<script>` and resolve once it loads (never rejects).
 *
 * @param host - The game's own window (for its document).
 * @returns A Promise that resolves once the script loads or is skipped.
 * @example
 * ```ts
 * await injectSdkScript(window as NewgroundsHost);
 * ```
 */
const injectSdkScript = (host: NewgroundsHost | undefined): Promise<void> => {
  const document = host?.document;
  if (!document?.head) return Promise.resolve();

  return new Promise<void>(resolve => {
    const script = document.createElement("script");
    script.src = SDK_URL;
    script.async = true;
    script.addEventListener("load", resolve);
    script.addEventListener("error", resolve);
    document.head?.append(script);
  });
};

/**
 * Wrap the callback-style `triggerAd` as a Promise. Resolves `false` (no-show)
 * when the loaded SDK exposes no `triggerAd`.
 *
 * @param sdk - The resolved Newgrounds SDK, or `undefined`.
 * @returns A Promise resolving whether the ad completed.
 * @example
 * ```ts
 * const completed = await triggerAd(sdk);
 * ```
 */
const triggerAd = (sdk: NewgroundsSDKLike | undefined): Promise<boolean> => {
  const trigger = sdk?.triggerAd;
  if (!trigger) return Promise.resolve(false); // no ad support → no-show

  return new Promise<boolean>(resolve => {
    trigger(completed => resolve(completed));
  });
};

/**
 * Log the degraded-mode notice (SDK unavailable → inert adapter).
 *
 * @param log - The adapter logger.
 * @example
 * ```ts
 * degraded(ctx.log);
 * ```
 */
const degraded = (log: Log): void => {
  log.warn("[platform] Newgrounds SDK unavailable — running degraded (ads no-op).");
};

// ─────────────────────────────────────────────────────────────────────────────
// Adapter factory
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Build the Newgrounds adapter. The live SDK handle is captured in `init()`; every
 * other method reads it and no-ops (or degrades) when the SDK is unavailable.
 *
 * @returns A {@link PortalAdapter} for Newgrounds (no native storage backend).
 * @example
 * ```ts
 * const adapter = createNewgroundsAdapter();
 * await adapter.init({ log, window });
 * await adapter.commercialBreak();
 * ```
 */
export const createNewgroundsAdapter = (): PortalAdapter => {
  let sdk: NewgroundsSDKLike | undefined;

  return {
    portal: "newgrounds",

    /**
     * Resolve (or best-effort inject) the SDK and open the session. Degrades to
     * inert when the SDK cannot be loaded.
     *
     * @param ctx - The adapter context (logger + the game's own window).
     * @returns A Promise that resolves once init is attempted.
     * @example
     * ```ts
     * await adapter.init({ log, window });
     * ```
     */
    async init(ctx: AdapterContext): Promise<void> {
      const host = ctx.window as NewgroundsHost | undefined;

      sdk = resolveSdk(host);
      if (!sdk) {
        await injectSdkScript(host);
        sdk = resolveSdk(host);
      }

      if (!sdk) {
        degraded(ctx.log);
        return;
      }

      sdk.init?.();
    },

    /**
     * Signal active gameplay started to Newgrounds (best-effort analytics).
     *
     * @example
     * ```ts
     * adapter.gameplayStart();
     * ```
     */
    gameplayStart(): void {
      sdk?.logEvent?.("gameplay_start");
    },

    /**
     * Signal gameplay stopped to Newgrounds (best-effort analytics).
     *
     * @example
     * ```ts
     * adapter.gameplayStop();
     * ```
     */
    gameplayStop(): void {
      sdk?.logEvent?.("gameplay_stop");
    },

    /**
     * No dedicated loading signal — best-effort no-op.
     *
     * @example
     * ```ts
     * adapter.loadingStart(); // inert on Newgrounds
     * ```
     */
    loadingStart(): void {
      // Newgrounds has no loading-start hook.
    },

    /**
     * Signal loading finished (log a view) to Newgrounds.
     *
     * @example
     * ```ts
     * adapter.loadingFinished();
     * ```
     */
    loadingFinished(): void {
      sdk?.logView?.();
    },

    /**
     * Show a Newgrounds ad (interstitial). Resolves on completion / no-show.
     *
     * @returns A Promise that resolves when the ad settles.
     * @example
     * ```ts
     * await adapter.commercialBreak();
     * ```
     */
    async commercialBreak(): Promise<void> {
      await triggerAd(sdk);
    },

    /**
     * Show a Newgrounds rewarded ad.
     *
     * @returns A Promise resolving `true` when completed, else `false` (or unsupported).
     * @example
     * ```ts
     * if (await adapter.rewardedAd()) grantReward();
     * ```
     */
    rewardedAd(): Promise<boolean> {
      return triggerAd(sdk);
    },

    /**
     * Drop the SDK handle so a re-`init()` re-resolves it.
     *
     * @example
     * ```ts
     * adapter.destroy();
     * ```
     */
    destroy(): void {
      sdk = undefined;
    }
  };
};
