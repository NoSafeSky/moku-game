/**
 * @file platform adapter — Poki.
 *
 * Wraps the Poki runtime SDK (`window.PokiSDK`): lifecycle signals plus Poki's
 * already-promise-based `commercialBreak()` (interstitial) and `rewardedBreak()`
 * (rewarded). Poki exposes no game-save API, so this adapter provides **no**
 * `storageBackend` — `storage` keeps its safe localStorage default.
 *
 * The SDK global is typed **structurally** here (no Poki npm import), so the
 * shipped `.d.ts` carries no SDK-ambient dependency. When the global is absent,
 * `init()` best-effort injects the `<script>` and, failing that, degrades to inert.
 */
import type { AdapterContext, Log, PortalAdapter } from "../types";

// ─────────────────────────────────────────────────────────────────────────────
// Structural Poki SDK surface (no SDK import — kept out of the .d.ts)
// ─────────────────────────────────────────────────────────────────────────────

/** Structural view of the top-level `window.PokiSDK`. */
type PokiSDKLike = {
  /** Initialise the SDK (portal handshake). */
  init(): Promise<unknown>;
  /** Signal the loading phase started (optional in the Poki API). */
  gameLoadingStart?(): void;
  /** Signal loading finished (game interactive). */
  gameLoadingFinished(): void;
  /** Signal active gameplay started. */
  gameplayStart(): void;
  /** Signal gameplay stopped. */
  gameplayStop(): void;
  /** Show an interstitial ad break (resolves when it settles). */
  commercialBreak(): Promise<void>;
  /** Show a rewarded ad break (resolves `true` when watched to completion). */
  rewardedBreak(): Promise<boolean>;
};

/** Minimal structural view of an injected `<script>` element. */
type PokiScript = {
  /** The script URL to load. */
  src: string;
  /** Whether to load asynchronously. */
  async: boolean;
  /** Register a load/error listener. */
  addEventListener(type: "load" | "error", listener: () => void): void;
};

/** Minimal structural DOM surface used to inject the SDK `<script>`. */
type PokiDocument = {
  /** Create a `<script>` element. */
  createElement(tag: "script"): PokiScript;
  /** The document head, where the script is appended. */
  head?: { append(node: PokiScript): void };
};

/** Structural view of the game's own `window` exposing the Poki SDK + DOM. */
type PokiHost = {
  /** The Poki global, present once the SDK script has loaded. */
  PokiSDK?: PokiSDKLike;
  /** DOM document, used to best-effort inject the SDK script. */
  document?: PokiDocument;
};

/** Official Poki SDK v2 module URL (served from the portal CDN). */
const SDK_URL = "https://game-cdn.poki.com/scripts/v2/poki-sdk.js";

// ─────────────────────────────────────────────────────────────────────────────
// SDK resolution
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Resolve the Poki SDK already present on the host window, or `undefined`.
 *
 * @param host - The game's own window (structurally typed).
 * @returns The SDK, or `undefined` when the global is not present.
 * @example
 * ```ts
 * const sdk = resolveSdk(window as PokiHost);
 * ```
 */
const resolveSdk = (host: PokiHost | undefined): PokiSDKLike | undefined => host?.PokiSDK;

/**
 * Best-effort inject the SDK `<script>` and resolve once it loads (never rejects).
 *
 * @param host - The game's own window (for its document).
 * @returns A Promise that resolves once the script loads or is skipped.
 * @example
 * ```ts
 * await injectSdkScript(window as PokiHost);
 * ```
 */
const injectSdkScript = (host: PokiHost | undefined): Promise<void> => {
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
 * Log the degraded-mode notice (SDK unavailable → inert adapter).
 *
 * @param log - The adapter logger.
 * @example
 * ```ts
 * degraded(ctx.log);
 * ```
 */
const degraded = (log: Log): void => {
  log.warn("[platform] Poki SDK unavailable — running degraded (ads no-op).");
};

// ─────────────────────────────────────────────────────────────────────────────
// Adapter factory
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Build the Poki adapter. The live SDK handle is captured in `init()`; every other
 * method reads it and no-ops (or degrades) when the SDK is unavailable.
 *
 * @returns A {@link PortalAdapter} for Poki (no native storage backend).
 * @example
 * ```ts
 * const adapter = createPokiAdapter();
 * await adapter.init({ log, window });
 * const rewarded = await adapter.rewardedAd();
 * ```
 */
export const createPokiAdapter = (): PortalAdapter => {
  let sdk: PokiSDKLike | undefined;

  return {
    portal: "poki",

    /**
     * Resolve (or best-effort inject) the SDK and run its handshake. Degrades to
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
      const host = ctx.window as PokiHost | undefined;

      sdk = resolveSdk(host);
      if (!sdk) {
        await injectSdkScript(host);
        sdk = resolveSdk(host);
      }

      if (!sdk) {
        degraded(ctx.log);
        return;
      }

      try {
        await sdk.init();
      } catch {
        sdk = undefined;
        degraded(ctx.log);
      }
    },

    /**
     * Signal active gameplay started to Poki.
     *
     * @example
     * ```ts
     * adapter.gameplayStart();
     * ```
     */
    gameplayStart(): void {
      sdk?.gameplayStart();
    },

    /**
     * Signal gameplay stopped to Poki.
     *
     * @example
     * ```ts
     * adapter.gameplayStop();
     * ```
     */
    gameplayStop(): void {
      sdk?.gameplayStop();
    },

    /**
     * Signal the loading phase started to Poki (optional in the Poki API).
     *
     * @example
     * ```ts
     * adapter.loadingStart();
     * ```
     */
    loadingStart(): void {
      sdk?.gameLoadingStart?.();
    },

    /**
     * Signal loading finished (game interactive) to Poki.
     *
     * @example
     * ```ts
     * adapter.loadingFinished();
     * ```
     */
    loadingFinished(): void {
      sdk?.gameLoadingFinished();
    },

    /**
     * Show a Poki interstitial ad break.
     *
     * @returns A Promise that resolves when the ad settles (never rejects).
     * @example
     * ```ts
     * await adapter.commercialBreak();
     * ```
     */
    async commercialBreak(): Promise<void> {
      if (!sdk) return;
      try {
        await sdk.commercialBreak();
      } catch {
        // Poki rejected / unavailable → treat as a no-show; never reject to the caller.
      }
    },

    /**
     * Show a Poki rewarded ad break.
     *
     * @returns A Promise resolving `true` when watched to completion, else `false`.
     * @example
     * ```ts
     * if (await adapter.rewardedAd()) grantReward();
     * ```
     */
    async rewardedAd(): Promise<boolean> {
      if (!sdk) return false;
      try {
        return await sdk.rewardedBreak();
      } catch {
        return false; // rejected / unavailable → no reward
      }
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
