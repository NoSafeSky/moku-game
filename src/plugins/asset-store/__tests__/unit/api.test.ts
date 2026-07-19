/**
 * @file asset-store plugin — API factory unit tests.
 *
 * Drives `createApi` against a mock `AssetBackend` + a mock `URL`. Covers the accept-guard reject
 * path, a successful import (persist + mint + emit + return), alias derivation, the synchronous
 * `url`/`has`/`entries` reads (sorted, each carrying its url), `remove` (delete + revoke + drop +
 * emit), and that every method stays safe (never throws) against a throwing backend. Also asserts
 * the never-serialized invariant: nothing `import` returns is a blob or a live object, only plain
 * JSON-safe fields.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { createApi } from "../../api";
import type { AssetBackend, State } from "../../types";
import { installUrl } from "../mock-url";

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

const makeState = (backend: AssetBackend, accept: readonly string[] = ["image/"]): State => ({
  backend,
  urls: new Map(),
  meta: new Map(),
  accept,
  ready: true
});

const makeCtx = (state: State) => ({
  state,
  log: { warn: vi.fn() },
  emit: vi.fn()
});

const pngBlob = { type: "image/png", size: 2048 };

let uninstallUrl: (() => void) | undefined;

afterEach(() => {
  uninstallUrl?.();
  uninstallUrl = undefined;
});

// ─────────────────────────────────────────────────────────────────────────────
// import — accept guard
// ─────────────────────────────────────────────────────────────────────────────

describe("asset-store api: import accept guard", () => {
  it("rejects a blob whose mime matches no accept prefix — no put, no url, no emit", async () => {
    const backend = makeBackend();
    const state = makeState(backend);
    const ctx = makeCtx(state);
    const api = createApi(ctx);

    const asset = await api.import({ type: "audio/webm", size: 10 }, { name: "sfx.webm" });

    expect(asset.url).toBeUndefined();
    expect(asset.name).toBe("sfx.webm");
    expect(backend.put).not.toHaveBeenCalled();
    expect(ctx.emit).not.toHaveBeenCalled();
    expect(ctx.log.warn).toHaveBeenCalledTimes(1);
    expect(state.meta.has(asset.alias)).toBe(false);
  });

  it("accepts an image/png blob — persists, mints a url, emits, and returns the StoredAsset", async () => {
    const { mock: mockUrl, uninstall } = installUrl();
    uninstallUrl = uninstall;

    const backend = makeBackend();
    const state = makeState(backend);
    const ctx = makeCtx(state);
    const api = createApi(ctx);

    const asset = await api.import(pngBlob, { name: "sprite.png", alias: "sprite-1" });

    expect(backend.put).toHaveBeenCalledWith({
      alias: "sprite-1",
      name: "sprite.png",
      mime: "image/png",
      blob: pngBlob
    });
    expect(asset).toEqual({
      alias: "sprite-1",
      name: "sprite.png",
      mime: "image/png",
      byteLength: 2048,
      url: mockUrl.created[0]
    });
    expect(ctx.emit).toHaveBeenCalledWith("asset-store:imported", {
      alias: "sprite-1",
      mime: "image/png",
      byteLength: 2048
    });
    expect(state.urls.get("sprite-1")).toBe(mockUrl.created[0]);
    expect(state.meta.get("sprite-1")).toEqual({
      name: "sprite.png",
      mime: "image/png",
      byteLength: 2048
    });
  });

  it("returns without persisting/emitting when the backend rejects the write", async () => {
    const { uninstall } = installUrl();
    uninstallUrl = uninstall;

    const backend = makeBackend({ put: vi.fn(async () => false) });
    const state = makeState(backend);
    const ctx = makeCtx(state);
    const api = createApi(ctx);

    const asset = await api.import(pngBlob, { name: "sprite.png" });

    expect(asset.url).toBeUndefined();
    expect(ctx.emit).not.toHaveBeenCalled();
    expect(ctx.log.warn).toHaveBeenCalledTimes(1);
    expect(state.meta.has(asset.alias)).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// alias derivation
// ─────────────────────────────────────────────────────────────────────────────

describe("asset-store api: alias derivation", () => {
  it("derives a stable slug-of-name alias with a unique suffix when opts.alias is omitted", async () => {
    const { uninstall } = installUrl();
    uninstallUrl = uninstall;

    const backend = makeBackend();
    const state = makeState(backend);
    const api = createApi(makeCtx(state));

    const asset = await api.import(pngBlob, { name: "My Sprite.png" });

    expect(asset.alias.startsWith("my-sprite-png-")).toBe(true);
    expect(asset.alias.length).toBeGreaterThan("my-sprite-png-".length);
  });

  it("falls back to a generic slug when name is omitted", async () => {
    const { uninstall } = installUrl();
    uninstallUrl = uninstall;

    const backend = makeBackend();
    const state = makeState(backend);
    const api = createApi(makeCtx(state));

    const asset = await api.import(pngBlob);

    expect(asset.alias.startsWith("asset-")).toBe(true);
    expect(asset.name).toBe("asset");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// synchronous reads: url / has / entries
// ─────────────────────────────────────────────────────────────────────────────

describe("asset-store api: synchronous reads", () => {
  it("url/has reflect the maps synchronously", () => {
    const backend = makeBackend();
    const state = makeState(backend);
    state.urls.set("a", "blob:mock/a");
    state.meta.set("a", { name: "a.png", mime: "image/png", byteLength: 1 });
    const api = createApi(makeCtx(state));

    expect(api.url("a")).toBe("blob:mock/a");
    expect(api.url("missing")).toBeUndefined();
    expect(api.has("a")).toBe(true);
    expect(api.has("missing")).toBe(false);
  });

  it("entries() is sorted by name and each entry carries its url", () => {
    const backend = makeBackend();
    const state = makeState(backend);
    state.meta.set("b-alias", { name: "banana.png", mime: "image/png", byteLength: 2 });
    state.meta.set("a-alias", { name: "apple.png", mime: "image/png", byteLength: 1 });
    state.urls.set("a-alias", "blob:mock/a");
    // "b-alias" intentionally has no minted url (pre-onStart window).
    const api = createApi(makeCtx(state));

    expect(api.entries()).toEqual([
      { alias: "a-alias", name: "apple.png", mime: "image/png", byteLength: 1, url: "blob:mock/a" },
      { alias: "b-alias", name: "banana.png", mime: "image/png", byteLength: 2, url: undefined }
    ]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// get / remove
// ─────────────────────────────────────────────────────────────────────────────

describe("asset-store api: get", () => {
  it("returns the persisted blob for a known alias", async () => {
    const backend = makeBackend({
      get: vi.fn(async () => ({ alias: "a", name: "a.png", mime: "image/png", blob: pngBlob }))
    });
    const state = makeState(backend);
    const api = createApi(makeCtx(state));

    await expect(api.get("a")).resolves.toEqual(pngBlob);
  });

  it("returns undefined for an unknown alias", async () => {
    const backend = makeBackend();
    const state = makeState(backend);
    const api = createApi(makeCtx(state));

    await expect(api.get("missing")).resolves.toBeUndefined();
  });
});

describe("asset-store api: remove", () => {
  it("deletes from the backend, revokes the url, drops the maps, and emits", async () => {
    const { mock: mockUrl, uninstall } = installUrl();
    uninstallUrl = uninstall;

    const backend = makeBackend();
    const state = makeState(backend);
    state.urls.set("a", "blob:mock/a");
    state.meta.set("a", { name: "a.png", mime: "image/png", byteLength: 1 });
    const ctx = makeCtx(state);
    const api = createApi(ctx);

    await api.remove("a");

    expect(backend.delete).toHaveBeenCalledWith("a");
    expect(mockUrl.revoked).toEqual(["blob:mock/a"]);
    expect(state.urls.has("a")).toBe(false);
    expect(state.meta.has("a")).toBe(false);
    expect(ctx.emit).toHaveBeenCalledWith("asset-store:removed", { alias: "a" });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Safety: no method throws against a throwing backend
// ─────────────────────────────────────────────────────────────────────────────

const throwingBackend = (): AssetBackend => ({
  persistent: true,
  open: vi.fn(async () => {
    throw new Error("boom");
  }),
  put: vi.fn(async () => {
    throw new Error("boom");
  }),
  get: vi.fn(async () => {
    throw new Error("boom");
  }),
  delete: vi.fn(async () => {
    throw new Error("boom");
  }),
  list: vi.fn(async () => {
    throw new Error("boom");
  }),
  close: vi.fn(() => {
    throw new Error("boom");
  })
});

describe("asset-store api: safety against a throwing backend", () => {
  it("import resolves a degraded StoredAsset instead of throwing", async () => {
    const state = makeState(throwingBackend());
    const api = createApi(makeCtx(state));

    await expect(api.import(pngBlob, { name: "sprite.png" })).resolves.toMatchObject({
      url: undefined
    });
  });

  it("get resolves undefined instead of throwing", async () => {
    const state = makeState(throwingBackend());
    const api = createApi(makeCtx(state));

    await expect(api.get("a")).resolves.toBeUndefined();
  });

  it("remove resolves instead of throwing", async () => {
    const state = makeState(throwingBackend());
    const api = createApi(makeCtx(state));

    await expect(api.remove("a")).resolves.toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Never-serialized invariant
// ─────────────────────────────────────────────────────────────────────────────

describe("asset-store api: never-serialized invariant", () => {
  it("the StoredAsset returned by import carries only plain JSON-safe fields — no Blob/URL object", async () => {
    const { uninstall } = installUrl();
    uninstallUrl = uninstall;

    const backend = makeBackend();
    const state = makeState(backend);
    const api = createApi(makeCtx(state));

    const asset = await api.import(pngBlob, { name: "sprite.png", alias: "sprite-1" });
    const serialized = structuredClone(asset);

    // The only durable reference a serializer should ever persist is the alias string.
    expect(serialized).toEqual({
      alias: "sprite-1",
      name: "sprite.png",
      mime: "image/png",
      byteLength: 2048,
      url: asset.url
    });
    expect(typeof asset.alias).toBe("string");
    expect(typeof asset.url === "string" || asset.url === undefined).toBe(true);
  });
});
