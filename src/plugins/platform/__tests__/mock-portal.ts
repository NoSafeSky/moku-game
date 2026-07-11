/**
 * @file platform plugin — shared test doubles.
 *
 * Spy-instrumented mocks of the portal SDKs, the dependency APIs (loop / audio /
 * storage), the `ctx.require` resolver, a mock adapter, and a mock `window` (event
 * listeners + document + injectable SDK globals). Reused across the adapter, api,
 * prefs, and lifecycle unit tests. Not a test file itself (no `.test.ts`), so
 * vitest does not collect it.
 */
import { type Mock, vi } from "vitest";

import { audioPlugin } from "../../audio";
import { loopPlugin } from "../../loop";
import { storagePlugin } from "../../storage";
import type {
  AudioDep,
  Log,
  LoopDep,
  PlatformRequire,
  Portal,
  PortalAdapter,
  StorageDep
} from "../types";

// ─────────────────────────────────────────────────────────────────────────────
// Logger
// ─────────────────────────────────────────────────────────────────────────────

/** Build a spied logger. */
export const makeLog = (): Log => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn()
});

// ─────────────────────────────────────────────────────────────────────────────
// Dependency API mocks (loop / audio / storage)
// ─────────────────────────────────────────────────────────────────────────────

/** A spied loop dependency whose `isRunning` reflects start/stop. */
export type MockLoop = LoopDep & { isRunning: Mock; start: Mock; stop: Mock };

/** Build a spied loop dependency seeded running or stopped. */
export const makeMockLoop = (running = true): MockLoop => {
  let isRunning = running;
  return {
    isRunning: vi.fn(() => isRunning),
    start: vi.fn(() => {
      isRunning = true;
    }),
    stop: vi.fn(() => {
      isRunning = false;
    })
  };
};

/** A spied audio dependency whose `isMuted` reflects mute/unmute/setMuted. */
export type MockAudio = AudioDep & {
  isMuted: Mock;
  mute: Mock;
  unmute: Mock;
  setMuted: Mock;
  setVolume: Mock;
};

/** Build a spied audio dependency seeded muted or not. */
export const makeMockAudio = (muted = false): MockAudio => {
  let isMuted = muted;
  return {
    isMuted: vi.fn(() => isMuted),
    mute: vi.fn(() => {
      isMuted = true;
    }),
    unmute: vi.fn(() => {
      isMuted = false;
    }),
    setMuted: vi.fn((value: boolean) => {
      isMuted = value;
    }),
    setVolume: vi.fn()
  };
};

/** A spied storage dependency backed by an in-memory map (structurally a StorageDep). */
export type MockStorage = { setBackend: Mock; get: Mock; set: Mock };

/** Build a spied storage dependency seeded from `store`. */
export const makeMockStorage = (store = new Map<string, unknown>()): MockStorage => ({
  setBackend: vi.fn(),
  get: vi.fn((key: string, fallback?: unknown) => (store.has(key) ? store.get(key) : fallback)),
  set: vi.fn((key: string, value: unknown) => {
    store.set(key, value);
    return true;
  })
});

/**
 * Build a `ctx.require` resolver mapping each dependency plugin instance to its
 * supplied mock (matched by reference, the same way the kernel resolves deps).
 */
export const makeRequire = (deps: {
  loop?: LoopDep;
  audio?: AudioDep;
  storage?: StorageDep;
}): PlatformRequire => {
  const resolve = (plugin: unknown): unknown => {
    if (plugin === loopPlugin) return deps.loop;
    if (plugin === audioPlugin) return deps.audio;
    if (plugin === storagePlugin) return deps.storage;
    throw new Error("unexpected require");
  };
  return resolve as unknown as PlatformRequire;
};

// ─────────────────────────────────────────────────────────────────────────────
// Mock adapter
// ─────────────────────────────────────────────────────────────────────────────

/** A spied {@link PortalAdapter} with every method as a mock. */
export type MockAdapter = PortalAdapter & {
  init: Mock;
  gameplayStart: Mock;
  gameplayStop: Mock;
  loadingStart: Mock;
  loadingFinished: Mock;
  commercialBreak: Mock;
  rewardedAd: Mock;
  destroy: Mock;
};

/**
 * Build a spied adapter. `rewarded` sets the rewarded outcome; `reject` makes both
 * ad methods reject (to exercise the "settle = reject → still restore" path).
 */
export const makeMockAdapter = (opts?: {
  portal?: Portal;
  rewarded?: boolean;
  reject?: boolean;
}): MockAdapter => ({
  portal: opts?.portal ?? "none",
  init: vi.fn(async () => {}),
  gameplayStart: vi.fn(),
  gameplayStop: vi.fn(),
  loadingStart: vi.fn(),
  loadingFinished: vi.fn(),
  commercialBreak: vi.fn(async () => {
    if (opts?.reject) throw new Error("ad failed");
  }),
  rewardedAd: vi.fn(async () => {
    if (opts?.reject) throw new Error("ad failed");
    return opts?.rewarded ?? true;
  }),
  destroy: vi.fn()
});

// ─────────────────────────────────────────────────────────────────────────────
// Portal SDK mocks
// ─────────────────────────────────────────────────────────────────────────────

/** Build a spied CrazyGames SDK; `adOutcome` drives whether `requestAd` finishes or errors. */
export const makeCrazyGamesSdk = (opts?: {
  adOutcome?: "finished" | "error";
  store?: Record<string, string>;
}) => {
  const data = new Map<string, string>(Object.entries(opts?.store ?? {}));
  return {
    init: vi.fn(async () => {}),
    game: {
      gameplayStart: vi.fn(),
      gameplayStop: vi.fn(),
      loadingStart: vi.fn(),
      loadingStop: vi.fn()
    },
    ad: {
      requestAd: vi.fn(
        (
          _type: string,
          callbacks: { adFinished?: () => void; adError?: (error: unknown) => void }
        ) => {
          if (opts?.adOutcome === "error") callbacks.adError?.(new Error("no ad"));
          else callbacks.adFinished?.();
        }
      )
    },
    data: {
      getItem: vi.fn(async (key: string) => data.get(key) ?? null),
      setItem: vi.fn(async (key: string, value: string) => {
        data.set(key, value);
      }),
      removeItem: vi.fn(async (key: string) => {
        data.delete(key);
      }),
      keys: vi.fn(async () => [...data.keys()])
    }
  };
};

/** Build a spied Poki SDK; `rewarded` sets the rewarded outcome; `reject` makes ads reject. */
export const makePokiSdk = (opts?: { rewarded?: boolean; reject?: boolean }) => ({
  init: vi.fn(async () => ({})),
  gameLoadingStart: vi.fn(),
  gameLoadingFinished: vi.fn(),
  gameplayStart: vi.fn(),
  gameplayStop: vi.fn(),
  commercialBreak: vi.fn(async () => {
    if (opts?.reject) throw new Error("no ad");
  }),
  rewardedBreak: vi.fn(async () => {
    if (opts?.reject) throw new Error("no ad");
    return opts?.rewarded ?? true;
  })
});

/** Build a spied Newgrounds SDK; `completed` drives the `triggerAd` callback; `withAd: false` models no ad support. */
export const makeNewgroundsSdk = (opts?: { completed?: boolean; withAd?: boolean }) => {
  const triggerAd =
    opts?.withAd === false
      ? undefined
      : vi.fn((callback: (completed: boolean) => void) => {
          callback(opts?.completed ?? true);
        });
  return {
    init: vi.fn(),
    logView: vi.fn(),
    logEvent: vi.fn(),
    triggerAd
  };
};

// ─────────────────────────────────────────────────────────────────────────────
// Mock window (event listeners + document + injectable SDK globals)
// ─────────────────────────────────────────────────────────────────────────────

/** A spied window that records event listeners and can fire them. */
export type MockWindow = {
  addEventListener: Mock;
  removeEventListener: Mock;
  document: { visibilityState: string };
  /** Invoke every registered listener for an event type. */
  fire(type: string): void;
  /** The currently-registered listeners, by event type. */
  listeners: Map<string, Set<() => void>>;
};

/** Build a spied window carrying the given SDK globals (`CrazyGames`, `PokiSDK`, …). */
export const makeMockWindow = (globals: Record<string, unknown> = {}): MockWindow => {
  const listeners = new Map<string, Set<() => void>>();

  return {
    ...globals,
    document: { visibilityState: "visible" },
    listeners,
    addEventListener: vi.fn((type: string, fn: () => void) => {
      const set = listeners.get(type) ?? new Set<() => void>();
      set.add(fn);
      listeners.set(type, set);
    }),
    removeEventListener: vi.fn((type: string, fn: () => void) => {
      listeners.get(type)?.delete(fn);
    }),
    fire(type: string) {
      for (const fn of listeners.get(type) ?? []) fn();
    }
  };
};

/** Install `window` on globalThis; returns an uninstall that restores the previous value. */
export const installWindow = (window: object): (() => void) => {
  const globals = globalThis as { window?: unknown };
  const previous = globals.window;
  globals.window = window;
  return () => {
    globals.window = previous;
  };
};
