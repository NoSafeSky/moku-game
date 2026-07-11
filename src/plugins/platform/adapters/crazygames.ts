/**
 * @file platform adapter — CrazyGames.
 *
 * Wraps the CrazyGames runtime SDK (`window.CrazyGames.SDK`): lifecycle signals,
 * promise-wrapped interstitial + rewarded ads (callback → Promise), and a
 * portal-native {@link StorageBackend} over the CrazyGames **data** API.
 *
 * The SDK global is typed **structurally** here (no `@crazygames/*` import), so
 * the shipped `.d.ts` carries no SDK-ambient dependency. The SDK is expected to
 * be present on the page (portals require serving it from their own CDN); when
 * absent, `init()` best-effort injects the `<script>` and, failing that, degrades
 * to a fully-inert adapter with an in-memory backend.
 *
 * **Async→sync storage bridge:** the data API is async but `storage`'s
 * `StorageBackend` is synchronous and non-throwing. `init()` awaits a one-time
 * hydrate of an in-memory snapshot; `getItem`/`keys` read the snapshot, `setItem`/
 * `removeItem` mutate it synchronously and flush to the portal best-effort. Because
 * `storage` migrates lazily and `setBackend()` resets its migrated flag, migration
 * correctly targets the hydrated snapshot.
 */
import type { StorageBackend } from "../../storage/types";
import type { AdapterContext, Log, PortalAdapter } from "../types";

// ─────────────────────────────────────────────────────────────────────────────
// Structural CrazyGames SDK surface (no SDK import — kept out of the .d.ts)
// ─────────────────────────────────────────────────────────────────────────────

/** Callbacks the CrazyGames `requestAd` accepts (finish / error). */
type CrazyAdCallbacks = {
  /** Invoked when the ad finishes (or is skipped) — the settle signal. */
  adFinished?: () => void;
  /** Invoked when the ad errors / is unavailable. */
  adError?: (error: unknown) => void;
};

/** Structural view of the CrazyGames game-lifecycle module. */
type CrazyGamesGame = {
  /** Signal active gameplay started. */
  gameplayStart(): void;
  /** Signal gameplay stopped. */
  gameplayStop(): void;
  /** Signal the loading phase started. */
  loadingStart(): void;
  /** Signal loading finished (game interactive). */
  loadingStop(): void;
};

/** Structural view of the CrazyGames ad module. */
type CrazyGamesAd = {
  /** Request an ad of the given type, driving the supplied callbacks. */
  requestAd(type: "midgame" | "rewarded", callbacks: CrazyAdCallbacks): void;
};

/** Structural view of the CrazyGames async data (save) module. */
type CrazyGamesData = {
  /** Read a stored string by key (resolves `null` if absent). */
  getItem(key: string): Promise<string | null>;
  /** Write a string by key. */
  setItem(key: string, value: string): Promise<void>;
  /** Remove a key. */
  removeItem(key: string): Promise<void>;
  /** List every stored key (used once to hydrate the snapshot). */
  keys(): Promise<string[]>;
};

/** Structural view of the top-level `window.CrazyGames.SDK`. */
type CrazyGamesSDK = {
  /** Initialise the SDK (portal handshake). */
  init(): Promise<void>;
  /** Game-lifecycle module. */
  game: CrazyGamesGame;
  /** Ad module. */
  ad: CrazyGamesAd;
  /** Async data (save) module. */
  data: CrazyGamesData;
};

/** Minimal structural view of an injected `<script>` element. */
type CrazyGamesScript = {
  /** The script URL to load. */
  src: string;
  /** Whether to load asynchronously. */
  async: boolean;
  /** Register a load/error listener. */
  addEventListener(type: "load" | "error", listener: () => void): void;
};

/** Minimal structural DOM surface used to inject the SDK `<script>`. */
type CrazyGamesDocument = {
  /** Create a `<script>` element. */
  createElement(tag: "script"): CrazyGamesScript;
  /** The document head, where the script is appended. */
  head?: { append(node: CrazyGamesScript): void };
};

/** Structural view of the game's own `window` exposing the CrazyGames SDK + DOM. */
type CrazyGamesHost = {
  /** The CrazyGames global, present once the SDK script has loaded. */
  CrazyGames?: { SDK?: CrazyGamesSDK };
  /** DOM document, used to best-effort inject the SDK script. */
  document?: CrazyGamesDocument;
};

/** Official CrazyGames SDK v3 module URL (served from the portal CDN). */
const SDK_URL = "https://sdk.crazygames.com/crazygames-sdk-v3.js";

// ─────────────────────────────────────────────────────────────────────────────
// Async→sync storage bridge
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Fire-and-forget an async portal write; failures are swallowed (the snapshot is
 * the source of truth, so a rejected flush must never surface or throw).
 *
 * @param op - The pending portal write.
 * @example
 * ```ts
 * flush(data.setItem("k", "1")); // returns immediately; errors ignored
 * ```
 */
const flush = (op: Promise<void>): void => {
  op.catch(() => {
    // Best-effort — the snapshot already holds the value; ignore portal write errors.
  });
};

/**
 * Build a synchronous, non-throwing {@link StorageBackend} over the async
 * CrazyGames data API. Reads/writes hit an in-memory snapshot; writes also flush
 * to the portal best-effort. `hydrate()` fills the snapshot from the data API once
 * (awaited during adapter `init()` before `storage.setBackend()` runs).
 *
 * @param getData - Lazily resolves the live data module (available after `init`).
 * @returns The synchronous backend plus a one-time async `hydrate`.
 * @example
 * ```ts
 * const bridge = createCrazyGamesBackend(() => sdk?.data);
 * await bridge.hydrate();            // snapshot filled from the portal store
 * bridge.backend.setItem("k", "1"); // → true (snapshot + async flush)
 * ```
 */
export const createCrazyGamesBackend = (
  getData: () => CrazyGamesData | undefined
): { backend: StorageBackend; hydrate: () => Promise<void> } => {
  const snapshot = new Map<string, string>();

  /**
   * Hydrate the snapshot from the async data API, once. Any failure leaves the
   * snapshot as-is (degrades to an empty, in-memory-only backend).
   *
   * @returns A Promise that resolves once hydration is attempted.
   * @example
   * ```ts
   * await hydrate();
   * ```
   */
  const hydrate = async (): Promise<void> => {
    const data = getData();
    if (!data) return;

    let keys: string[] = [];
    try {
      keys = await data.keys();
    } catch {
      return; // enumeration failed → keep the empty snapshot
    }

    for (const key of keys) {
      try {
        const value = await data.getItem(key);
        if (value !== null) snapshot.set(key, value);
      } catch {
        // Skip an unreadable key rather than aborting the whole hydrate.
      }
    }
  };

  const backend: StorageBackend = {
    persistent: true,

    /**
     * Read from the snapshot.
     *
     * @param key - The full key.
     * @returns The stored string, or `null` if absent.
     * @example
     * ```ts
     * backend.getItem("game:score"); // "10" | null
     * ```
     */
    getItem(key: string): string | null {
      const value = snapshot.get(key);
      return value === undefined ? null : value;
    },

    /**
     * Write to the snapshot synchronously and flush to the portal best-effort.
     *
     * @param key - The full key.
     * @param value - The string to persist.
     * @returns Always `true` (the synchronous snapshot write cannot fail).
     * @example
     * ```ts
     * backend.setItem("game:score", "10"); // → true
     * ```
     */
    setItem(key: string, value: string): boolean {
      snapshot.set(key, value);
      const data = getData();
      if (data) flush(data.setItem(key, value));
      return true;
    },

    /**
     * Remove from the snapshot synchronously and flush to the portal best-effort.
     *
     * @param key - The full key to remove.
     * @example
     * ```ts
     * backend.removeItem("game:score");
     * ```
     */
    removeItem(key: string): void {
      snapshot.delete(key);
      const data = getData();
      if (data) flush(data.removeItem(key));
    },

    /**
     * List snapshot keys beginning with `prefix`.
     *
     * @param prefix - The `${namespace}:` prefix to filter by.
     * @returns The matching keys.
     * @example
     * ```ts
     * backend.keys("game:"); // ["game:score"]
     * ```
     */
    keys(prefix: string): string[] {
      return [...snapshot.keys()].filter(key => key.startsWith(prefix));
    }
  };

  return { backend, hydrate };
};

// ─────────────────────────────────────────────────────────────────────────────
// SDK resolution
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Resolve the CrazyGames SDK already present on the host window, or `undefined`.
 *
 * @param host - The game's own window (structurally typed).
 * @returns The SDK, or `undefined` when the global is not present.
 * @example
 * ```ts
 * const sdk = resolveSdk(window as CrazyGamesHost);
 * ```
 */
const resolveSdk = (host: CrazyGamesHost | undefined): CrazyGamesSDK | undefined =>
  host?.CrazyGames?.SDK;

/**
 * Best-effort inject the SDK `<script>` and resolve once it loads. Resolves (never
 * rejects) so a blocked/absent DOM degrades the adapter to inert rather than
 * failing start. No-op resolve when no document is available.
 *
 * @param host - The game's own window (for its document).
 * @returns A Promise that resolves once the script loads or is skipped.
 * @example
 * ```ts
 * await injectSdkScript(window as CrazyGamesHost);
 * ```
 */
const injectSdkScript = (host: CrazyGamesHost | undefined): Promise<void> => {
  const document = host?.document;
  if (!document?.head) return Promise.resolve();

  return new Promise<void>(resolve => {
    const script = document.createElement("script");
    script.src = SDK_URL;
    script.async = true;
    script.addEventListener("load", resolve);
    script.addEventListener("error", resolve); // failed load → degrade, never reject
    document.head?.append(script);
  });
};

/**
 * Log the degraded-mode notice (SDK unavailable → inert adapter + in-memory backend).
 *
 * @param log - The adapter logger.
 * @example
 * ```ts
 * degraded(ctx.log);
 * ```
 */
const degraded = (log: Log): void => {
  log.warn(
    "[platform] CrazyGames SDK unavailable — running degraded (ads no-op, saves in-memory)."
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// Adapter factory
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Build the CrazyGames adapter. The live SDK handle is captured in `init()`; every
 * other method reads it and no-ops (or degrades) when the SDK is unavailable.
 *
 * @returns A {@link PortalAdapter} for CrazyGames, with a data-API storage backend.
 * @example
 * ```ts
 * const adapter = createCrazyGamesAdapter();
 * await adapter.init({ log, window });            // loads + hydrates
 * app.storage.setBackend(adapter.storageBackend); // route saves to the portal
 * ```
 */
export const createCrazyGamesAdapter = (): PortalAdapter => {
  let sdk: CrazyGamesSDK | undefined;
  const bridge = createCrazyGamesBackend(() => sdk?.data);

  /**
   * Wrap a CrazyGames `requestAd` call as a Promise resolving whether it finished.
   *
   * @param type - `"midgame"` (interstitial) or `"rewarded"`.
   * @returns A Promise resolving `true` on completion, `false` on error/unavailable.
   * @example
   * ```ts
   * const completed = await requestAd("rewarded");
   * ```
   */
  const requestAd = (type: "midgame" | "rewarded"): Promise<boolean> => {
    const ad = sdk?.ad;
    if (!ad) return Promise.resolve(false); // degraded — no ad module

    return new Promise<boolean>(resolve => {
      ad.requestAd(type, {
        /**
         * Resolve the ad as completed.
         *
         * @example
         * ```ts
         * callbacks.adFinished?.();
         * ```
         */
        adFinished: () => {
          resolve(true);
        },
        /**
         * Resolve the ad as a no-show (unavailable / errored).
         *
         * @example
         * ```ts
         * callbacks.adError?.();
         * ```
         */
        adError: () => {
          resolve(false);
        }
      });
    });
  };

  return {
    portal: "crazygames",
    storageBackend: bridge.backend,

    /**
     * Resolve (or best-effort inject) the SDK, run its handshake, and hydrate the
     * storage snapshot. Degrades to inert (with an in-memory backend) when the SDK
     * cannot be loaded.
     *
     * @param ctx - The adapter context (logger + the game's own window).
     * @returns A Promise that resolves once init is attempted.
     * @example
     * ```ts
     * await adapter.init({ log, window });
     * ```
     */
    async init(ctx: AdapterContext): Promise<void> {
      const host = ctx.window as CrazyGamesHost | undefined;

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
        return;
      }

      await bridge.hydrate();
    },

    /**
     * Signal active gameplay started to CrazyGames.
     *
     * @example
     * ```ts
     * adapter.gameplayStart();
     * ```
     */
    gameplayStart(): void {
      sdk?.game.gameplayStart();
    },

    /**
     * Signal gameplay stopped to CrazyGames.
     *
     * @example
     * ```ts
     * adapter.gameplayStop();
     * ```
     */
    gameplayStop(): void {
      sdk?.game.gameplayStop();
    },

    /**
     * Signal the loading phase started to CrazyGames.
     *
     * @example
     * ```ts
     * adapter.loadingStart();
     * ```
     */
    loadingStart(): void {
      sdk?.game.loadingStart();
    },

    /**
     * Signal loading finished (game interactive) to CrazyGames.
     *
     * @example
     * ```ts
     * adapter.loadingFinished();
     * ```
     */
    loadingFinished(): void {
      sdk?.game.loadingStop();
    },

    /**
     * Show a CrazyGames midgame (interstitial) ad.
     *
     * @returns A Promise that resolves when the ad settles (finish / skip / unavailable).
     * @example
     * ```ts
     * await adapter.commercialBreak();
     * ```
     */
    async commercialBreak(): Promise<void> {
      await requestAd("midgame");
    },

    /**
     * Show a CrazyGames rewarded ad.
     *
     * @returns A Promise resolving `true` when watched to completion, else `false`.
     * @example
     * ```ts
     * if (await adapter.rewardedAd()) grantReward();
     * ```
     */
    rewardedAd(): Promise<boolean> {
      return requestAd("rewarded");
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
