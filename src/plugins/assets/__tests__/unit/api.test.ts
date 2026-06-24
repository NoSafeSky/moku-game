/**
 * @file assets plugin — unit tests for createApi.
 *
 * Pixi Assets and Sprite are mocked so tests run in node without a GPU context.
 */
import { describe, expect, expectTypeOf, it, vi } from "vitest";

// ─────────────────────────────────────────────────────────────────────────────
// Hoisted mock state
// ─────────────────────────────────────────────────────────────────────────────

const pixiMocks = vi.hoisted(() => ({
  load: vi.fn(),
  addBundle: vi.fn(),
  loadBundle: vi.fn(),
  get: vi.fn()
}));

vi.mock("pixi.js", () => ({
  Assets: {
    load: pixiMocks.load,
    addBundle: pixiMocks.addBundle,
    loadBundle: pixiMocks.loadBundle,
    get: pixiMocks.get
  },
  Sprite: class {
    texture: unknown;
    destroy = vi.fn();
    constructor(texture: unknown) {
      this.texture = texture;
    }
  }
}));

// ─────────────────────────────────────────────────────────────────────────────
// Plugin imports (after mocks)
// ─────────────────────────────────────────────────────────────────────────────

import type { Sprite, Texture } from "pixi.js";
import type { AssetsContext } from "../../api";
import { createApi } from "../../api";
import type { Config, State } from "../../types";

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

const defaultConfig: Config = { basePath: "", manifest: {}, throwOnError: true };

const createMockCtx = (overrides?: {
  config?: Partial<Config>;
  emit?: AssetsContext["emit"];
}): AssetsContext => {
  const state: State = { loaded: new Set<string>() };
  return {
    config: { ...defaultConfig, ...overrides?.config },
    state,
    log: {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn()
    },
    emit: overrides?.emit ?? vi.fn(),
    require: vi.fn().mockReturnValue({})
  };
};

/** A fake Texture object accepted by Pixi mock. */
const fakeTexture = { source: {} } as unknown as Texture;
/** A second fake texture for bundle tests. */
const fakeTexture2 = { source: {} } as unknown as Texture;

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

describe("createApi", () => {
  // ──────────────────────────────────────────────────────────────────────────
  // load
  // ──────────────────────────────────────────────────────────────────────────

  describe("load", () => {
    it("resolves the texture returned by Assets.load", async () => {
      pixiMocks.load.mockResolvedValueOnce(fakeTexture);
      const ctx = createMockCtx();
      const api = createApi(ctx);

      const texture = await api.load("ship");

      expect(texture).toBe(fakeTexture);
    });

    it("records the alias in state.loaded after a successful load", async () => {
      pixiMocks.load.mockResolvedValueOnce(fakeTexture);
      const ctx = createMockCtx();
      const api = createApi(ctx);

      await api.load("ship");

      expect(ctx.state.loaded.has("ship")).toBe(true);
    });

    it("emits assets:loaded with { alias, kind: 'asset' } on success", async () => {
      pixiMocks.load.mockResolvedValueOnce(fakeTexture);
      const emit = vi.fn();
      const ctx = createMockCtx({ emit });
      const api = createApi(ctx);

      await api.load("ship");

      expect(emit).toHaveBeenCalledWith("assets:loaded", { alias: "ship", kind: "asset" });
    });

    it("calls Assets.load with the alias directly when no basePath or manifest entry", async () => {
      pixiMocks.load.mockResolvedValueOnce(fakeTexture);
      const ctx = createMockCtx();
      const api = createApi(ctx);

      await api.load("ship.png");

      expect(pixiMocks.load).toHaveBeenCalledWith("ship.png");
    });

    it("prepends basePath to the url when basePath is set and alias is not in manifest", async () => {
      pixiMocks.load.mockResolvedValueOnce(fakeTexture);
      const ctx = createMockCtx({ config: { basePath: "assets/" } });
      const api = createApi(ctx);

      await api.load("ship.png");

      expect(pixiMocks.load).toHaveBeenCalledWith("assets/ship.png");
    });

    it("uses manifest url when alias is present in manifest", async () => {
      pixiMocks.load.mockResolvedValueOnce(fakeTexture);
      const ctx = createMockCtx({
        config: { manifest: { ship: "sprites/ship.png" } }
      });
      const api = createApi(ctx);

      await api.load("ship");

      expect(pixiMocks.load).toHaveBeenCalledWith("sprites/ship.png");
    });

    it("prepends basePath to manifest url when both are set", async () => {
      pixiMocks.load.mockResolvedValueOnce(fakeTexture);
      const ctx = createMockCtx({
        config: { basePath: "assets/", manifest: { ship: "sprites/ship.png" } }
      });
      const api = createApi(ctx);

      await api.load("ship");

      expect(pixiMocks.load).toHaveBeenCalledWith("assets/sprites/ship.png");
    });

    it("rethrows when throwOnError is true and Assets.load rejects", async () => {
      pixiMocks.load.mockRejectedValueOnce(new Error("Network error"));
      const ctx = createMockCtx({ config: { throwOnError: true } });
      const api = createApi(ctx);

      await expect(api.load("missing.png")).rejects.toThrow("Network error");
    });

    it("does NOT record alias in state.loaded on failure", async () => {
      pixiMocks.load.mockRejectedValueOnce(new Error("Network error"));
      const ctx = createMockCtx({ config: { throwOnError: true } });
      const api = createApi(ctx);

      await expect(api.load("missing.png")).rejects.toThrow();
      expect(ctx.state.loaded.has("missing.png")).toBe(false);
    });

    it("logs the error and resolves undefined when throwOnError is false", async () => {
      pixiMocks.load.mockRejectedValueOnce(new Error("Network error"));
      const ctx = createMockCtx({ config: { throwOnError: false } });
      const api = createApi(ctx);

      const result = await (api.load("missing.png") as Promise<Texture | undefined>);

      expect(result).toBeUndefined();
      expect(ctx.log.error).toHaveBeenCalled();
    });

    it("does NOT emit assets:loaded when load fails and throwOnError is false", async () => {
      pixiMocks.load.mockRejectedValueOnce(new Error("Network error"));
      const emit = vi.fn();
      const ctx = createMockCtx({ config: { throwOnError: false }, emit });
      const api = createApi(ctx);

      await (api.load("missing.png") as Promise<Texture | undefined>);

      expect(emit).not.toHaveBeenCalled();
    });

    it("load return type is Promise<Texture>", () => {
      const ctx = createMockCtx();
      const api = createApi(ctx);

      expectTypeOf(api.load).toEqualTypeOf<(alias: string) => Promise<Texture>>();
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // loadBundle
  // ──────────────────────────────────────────────────────────────────────────

  describe("loadBundle", () => {
    it("calls Assets.addBundle then Assets.loadBundle", async () => {
      const entries = { ship: "ship.png", tank: "tank.png" };
      const bundleResult = { ship: fakeTexture, tank: fakeTexture2 };
      pixiMocks.addBundle.mockReturnValueOnce(undefined);
      pixiMocks.loadBundle.mockResolvedValueOnce(bundleResult);

      const ctx = createMockCtx();
      const api = createApi(ctx);

      await api.loadBundle("vehicles", entries);

      expect(pixiMocks.addBundle).toHaveBeenCalledWith("vehicles", entries);
      expect(pixiMocks.loadBundle).toHaveBeenCalledWith("vehicles");
    });

    it("records each alias in state.loaded", async () => {
      const entries = { ship: "ship.png", tank: "tank.png" };
      const bundleResult = { ship: fakeTexture, tank: fakeTexture2 };
      pixiMocks.addBundle.mockReturnValueOnce(undefined);
      pixiMocks.loadBundle.mockResolvedValueOnce(bundleResult);

      const ctx = createMockCtx();
      const api = createApi(ctx);

      await api.loadBundle("vehicles", entries);

      expect(ctx.state.loaded.has("ship")).toBe(true);
      expect(ctx.state.loaded.has("tank")).toBe(true);
    });

    it("emits assets:loaded ONCE with { alias: bundle, kind: 'bundle' }", async () => {
      const entries = { ship: "ship.png", tank: "tank.png" };
      const bundleResult = { ship: fakeTexture, tank: fakeTexture2 };
      pixiMocks.addBundle.mockReturnValueOnce(undefined);
      pixiMocks.loadBundle.mockResolvedValueOnce(bundleResult);

      const emit = vi.fn();
      const ctx = createMockCtx({ emit });
      const api = createApi(ctx);

      await api.loadBundle("vehicles", entries);

      expect(emit).toHaveBeenCalledTimes(1);
      expect(emit).toHaveBeenCalledWith("assets:loaded", { alias: "vehicles", kind: "bundle" });
    });

    it("returns the texture record from Assets.loadBundle", async () => {
      const entries = { ship: "ship.png" };
      const bundleResult = { ship: fakeTexture };
      pixiMocks.addBundle.mockReturnValueOnce(undefined);
      pixiMocks.loadBundle.mockResolvedValueOnce(bundleResult);

      const ctx = createMockCtx();
      const api = createApi(ctx);

      const result = await api.loadBundle("pack", entries);

      expect(result).toEqual({ ship: fakeTexture });
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // get
  // ──────────────────────────────────────────────────────────────────────────

  describe("get", () => {
    it("returns the texture from Assets.get when available", () => {
      pixiMocks.get.mockReturnValueOnce(fakeTexture);
      const ctx = createMockCtx();
      const api = createApi(ctx);

      const result = api.get("ship");

      expect(result).toBe(fakeTexture);
      expect(pixiMocks.get).toHaveBeenCalledWith("ship");
    });

    it("returns undefined when Assets.get returns undefined", () => {
      pixiMocks.get.mockReturnValueOnce(undefined);
      const ctx = createMockCtx();
      const api = createApi(ctx);

      const result = api.get("unknown");

      expect(result).toBeUndefined();
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // sprite
  // ──────────────────────────────────────────────────────────────────────────

  describe("sprite", () => {
    it("returns a Sprite instance built from the texture", async () => {
      pixiMocks.load.mockResolvedValueOnce(fakeTexture);
      const ctx = createMockCtx();
      const api = createApi(ctx);

      const result = await api.sprite("ship");

      // Check it is a sprite-like object
      expect(result).toBeDefined();
      expect((result as { texture: unknown }).texture).toBe(fakeTexture);
    });

    it("reuses the cached texture without loading or re-emitting on a cache hit", async () => {
      pixiMocks.get.mockReturnValueOnce(fakeTexture);
      const emit = vi.fn();
      const ctx = createMockCtx({ emit });
      const api = createApi(ctx);

      const result = await api.sprite("ship");

      // Built from the cached texture, and NO load()/assets:loaded fired.
      expect((result as { texture: unknown }).texture).toBe(fakeTexture);
      expect(emit).not.toHaveBeenCalled();
    });

    it("loads and emits assets:loaded exactly once on a cache miss", async () => {
      pixiMocks.get.mockReturnValueOnce(undefined);
      pixiMocks.load.mockResolvedValueOnce(fakeTexture);
      const emit = vi.fn();
      const ctx = createMockCtx({ emit });
      const api = createApi(ctx);

      await api.sprite("ship");

      expect(emit).toHaveBeenCalledTimes(1);
      expect(emit).toHaveBeenCalledWith("assets:loaded", { alias: "ship", kind: "asset" });
    });

    it("sprite return type is Promise<Sprite>", () => {
      const ctx = createMockCtx();
      const api = createApi(ctx);

      expectTypeOf(api.sprite).toEqualTypeOf<(alias: string) => Promise<Sprite>>();
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // isLoaded
  // ──────────────────────────────────────────────────────────────────────────

  describe("isLoaded", () => {
    it("returns false before any load", () => {
      const ctx = createMockCtx();
      const api = createApi(ctx);

      expect(api.isLoaded("ship")).toBe(false);
    });

    it("returns true after a successful load", async () => {
      pixiMocks.load.mockResolvedValueOnce(fakeTexture);
      const ctx = createMockCtx();
      const api = createApi(ctx);

      await api.load("ship");

      expect(api.isLoaded("ship")).toBe(true);
    });

    it("returns false for an alias that was not loaded", async () => {
      pixiMocks.load.mockResolvedValueOnce(fakeTexture);
      const ctx = createMockCtx();
      const api = createApi(ctx);

      await api.load("ship");

      expect(api.isLoaded("tank")).toBe(false);
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Types: ctx.emit type safety
  // ──────────────────────────────────────────────────────────────────────────

  describe("types: ctx.emit type safety", () => {
    it("emit accepts the correct assets:loaded payload shape", () => {
      const ctx = createMockCtx();

      // Should not cause a type error
      ctx.emit("assets:loaded", { alias: "ship", kind: "asset" });
      ctx.emit("assets:loaded", { alias: "pack", kind: "bundle" });

      expectTypeOf(ctx.emit).toBeFunction();
    });

    it("rejects wrong kind value in assets:loaded payload", () => {
      const ctx = createMockCtx();

      // @ts-expect-error -- "texture" is not "asset" | "bundle"
      ctx.emit("assets:loaded", { alias: "ship", kind: "texture" });

      expect(ctx).toBeDefined();
    });

    it("rejects missing alias in assets:loaded payload", () => {
      const ctx = createMockCtx();

      // @ts-expect-error -- alias is required
      ctx.emit("assets:loaded", { kind: "asset" });

      expect(ctx).toBeDefined();
    });
  });
});
