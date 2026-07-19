/**
 * @file asset-store plugin — lifecycle unit tests.
 *
 * Drives `start` / `stop` directly against a mock `AssetBackend` (seeded with persisted records)
 * and a mock `URL`, covering URL re-minting + map hydration on start, the degraded-mode log line
 * when `open()` reports no persistent backend, and revoke/clear/close + idempotency on stop.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { assetStoreRegistry, start, stop } from "../../lifecycle";
import type { AssetBackend, State, StoredRecord } from "../../types";
import { installUrl } from "../mock-url";

const makeLog = () => ({ debug: vi.fn() });

const record = (alias: string): StoredRecord => ({
  alias,
  name: `${alias}.png`,
  mime: "image/png",
  blob: { type: "image/png", size: 4 }
});

const makeBackend = (overrides?: Partial<AssetBackend>): AssetBackend => ({
  persistent: true,
  open: vi.fn(async () => true),
  put: vi.fn(async () => true),
  get: vi.fn(async () => undefined),
  delete: vi.fn(async () => {
    /* no-op mock */
  }),
  list: vi.fn(async () => []),
  close: vi.fn(),
  ...overrides
});

const makeState = (backend: AssetBackend): State => ({
  backend,
  urls: new Map(),
  meta: new Map(),
  accept: ["image/"],
  ready: false
});

let uninstallUrl: (() => void) | undefined;

afterEach(() => {
  uninstallUrl?.();
  uninstallUrl = undefined;
});

// ─────────────────────────────────────────────────────────────────────────────
// start
// ─────────────────────────────────────────────────────────────────────────────

describe("asset-store: lifecycle start", () => {
  it("opens the backend, mints a URL for every persisted record, and marks ready", async () => {
    const { mock: mockUrl, uninstall } = installUrl();
    uninstallUrl = uninstall;

    const records = [record("a"), record("b")];
    const backend = makeBackend({ list: vi.fn(async () => records) });
    const state = makeState(backend);
    const log = makeLog();
    const global = {};

    await start({ state, global, log });

    expect(backend.open).toHaveBeenCalledTimes(1);
    expect(backend.list).toHaveBeenCalledTimes(1);
    expect(state.urls.size).toBe(2);
    expect(state.urls.get("a")).toBe(mockUrl.created[0]);
    expect(state.urls.get("b")).toBe(mockUrl.created[1]);
    expect(state.meta.get("a")).toEqual({ name: "a.png", mime: "image/png", byteLength: 4 });
    expect(state.ready).toBe(true);
    expect(log.debug).not.toHaveBeenCalled();

    expect(assetStoreRegistry.has(global)).toBe(true);
    expect(assetStoreRegistry.get(global)?.urls).toBe(state.urls);
    expect(assetStoreRegistry.get(global)?.backend).toBe(backend);
  });

  it("logs the degraded-mode line and leaves empty maps when open() reports no persistent backend", async () => {
    const { uninstall } = installUrl();
    uninstallUrl = uninstall;

    const backend = makeBackend({ open: vi.fn(async () => false), list: vi.fn(async () => []) });
    const state = makeState(backend);
    const log = makeLog();

    await expect(start({ state, global: {}, log })).resolves.toBeUndefined();

    expect(log.debug).toHaveBeenCalledTimes(1);
    expect(state.urls.size).toBe(0);
    expect(state.meta.size).toBe(0);
    expect(state.ready).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// stop
// ─────────────────────────────────────────────────────────────────────────────

describe("asset-store: lifecycle stop", () => {
  it("revokes every minted URL, clears the urls + meta maps, resets ready, and closes the backend", async () => {
    const { mock: mockUrl, uninstall } = installUrl();
    uninstallUrl = uninstall;

    const records = [record("a"), record("b")];
    const backend = makeBackend({ list: vi.fn(async () => records) });
    const state = makeState(backend);
    const global = {};

    await start({ state, global, log: makeLog() });
    expect(state.urls.size).toBe(2);
    expect(state.meta.size).toBe(2);
    expect(state.ready).toBe(true);

    stop({ global });

    expect(mockUrl.revoked.toSorted()).toEqual(mockUrl.created.toSorted());
    expect(state.urls.size).toBe(0);
    expect(state.meta.size).toBe(0);
    expect(state.ready).toBe(false);
    expect(backend.close).toHaveBeenCalledTimes(1);
    expect(assetStoreRegistry.has(global)).toBe(false);
  });

  it("is idempotent — a second stop does not revoke/close again or throw", async () => {
    const { uninstall } = installUrl();
    uninstallUrl = uninstall;

    const backend = makeBackend({ list: vi.fn(async () => [record("a")]) });
    const state = makeState(backend);
    const global = {};

    await start({ state, global, log: makeLog() });
    stop({ global });
    expect(() => stop({ global })).not.toThrow();

    expect(backend.close).toHaveBeenCalledTimes(1);
  });

  it("is a safe no-op when called without a prior start", () => {
    expect(() => stop({ global: {} })).not.toThrow();
  });
});
