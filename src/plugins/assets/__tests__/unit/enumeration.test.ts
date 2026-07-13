/**
 * @file assets plugin — unit tests for the editor-cycle delta:
 *   `entries()` (union of manifest + loaded aliases), `manifest()` (configured map),
 *   and `metadata()` (dimensions of a loaded texture). Pixi `Assets.get` is mocked so
 *   `metadata` (via `get`) runs in node without a GPU context.
 */
import { describe, expect, it, vi } from "vitest";

// ─── Hoisted Pixi mock (metadata reads through Assets.get) ────

const pixiMocks = vi.hoisted(() => ({ get: vi.fn() }));

vi.mock("pixi.js", () => ({
  Assets: {
    load: vi.fn(),
    addBundle: vi.fn(),
    loadBundle: vi.fn(),
    get: pixiMocks.get
  },
  Sprite: class {
    texture: unknown;
    constructor(texture: unknown) {
      this.texture = texture;
    }
  }
}));

import type { AssetsContext } from "../../api";
import { createApi } from "../../api";
import type { Config } from "../../types";

// ─── helpers ──────────────────────────────────────────────────

const defaultConfig: Config = { basePath: "", manifest: {}, throwOnError: true };

const makeCtx = (config?: Partial<Config>, loaded: readonly string[] = []): AssetsContext => ({
  config: { ...defaultConfig, ...config },
  state: { loaded: new Set<string>(loaded) },
  log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  emit: vi.fn(),
  require: vi.fn().mockReturnValue({})
});

// ─── entries ──────────────────────────────────────────────────

describe("assets — entries()", () => {
  it("unions manifest aliases with loaded aliases, flagging loaded and carrying url", () => {
    const api = createApi(
      makeCtx({ manifest: { ship: "ship.png", ui: "ui.png" } }, ["ship", "extra"])
    );

    const byAlias = new Map(api.entries().map(e => [e.alias, e]));

    // manifest + loaded → loaded true, url present
    expect(byAlias.get("ship")).toEqual({ alias: "ship", loaded: true, url: "ship.png" });
    // manifest only → not loaded, url present
    expect(byAlias.get("ui")).toEqual({ alias: "ui", loaded: false, url: "ui.png" });
    // loaded only (not in manifest) → loaded true, NO url key
    const extra = byAlias.get("extra");
    expect(extra).toEqual({ alias: "extra", loaded: true });
    expect(extra && "url" in extra).toBe(false);

    expect(api.entries()).toHaveLength(3);
  });

  it("returns [] when no manifest and nothing loaded", () => {
    expect(createApi(makeCtx()).entries()).toEqual([]);
  });
});

// ─── manifest ─────────────────────────────────────────────────

describe("assets — manifest()", () => {
  it("returns the configured alias → url map", () => {
    const api = createApi(makeCtx({ manifest: { ship: "ship.png" } }));
    expect(api.manifest()).toEqual({ ship: "ship.png" });
  });
});

// ─── metadata ─────────────────────────────────────────────────

describe("assets — metadata()", () => {
  it("returns the dimensions of a loaded texture", () => {
    pixiMocks.get.mockReturnValue({ width: 64, height: 32 });
    const api = createApi(makeCtx({}, ["ship"]));
    expect(api.metadata("ship")).toEqual({ width: 64, height: 32 });
  });

  it("returns undefined when the alias is not loaded (cache miss)", () => {
    pixiMocks.get.mockReturnValue(undefined);
    const api = createApi(makeCtx());
    expect(api.metadata("nope")).toBeUndefined();
  });
});
