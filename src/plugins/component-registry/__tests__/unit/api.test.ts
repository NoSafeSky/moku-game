/**
 * @file component-registry plugin — API unit tests.
 */
import { describe, expect, it, vi } from "vitest";

import type { ComponentRegistryApiContext } from "../../api";
import { createApi } from "../../api";
import type { ComponentCatalogEntry, State } from "../../types";

// ─── helpers ──────────────────────────────────────────────────

/**
 * Build a fresh component-registry State (empty catalog map).
 *
 * @returns A fresh component-registry State.
 */
const createMockState = (): State => ({ catalog: new Map() });

/**
 * Build a ComponentRegistryApiContext for unit tests.
 *
 * @param overrides - Partial overrides for state and log.
 * @returns A typed mock ComponentRegistryApiContext.
 */
const createMockCtx = (
  overrides: Partial<ComponentRegistryApiContext> = {}
): ComponentRegistryApiContext => ({
  state: createMockState(),
  log: { warn: vi.fn() },
  ...overrides
});

const shapeEntry: ComponentCatalogEntry = {
  name: "Shape",
  category: "Rendering",
  defaults: { kind: "rect" },
  addable: true
};

const spriteEntry: ComponentCatalogEntry = {
  name: "SpriteRenderer",
  category: "Rendering",
  defaults: { texture: "none" },
  addable: true
};

const transformEntry: ComponentCatalogEntry = {
  name: "Transform",
  category: "Transform",
  defaults: { x: 0, y: 0 },
  addable: false
};

// ─── register / get / has / list ────────────────────────────────

describe("createApi — register + get/has/list", () => {
  it("registering an entry makes get/has/list see it", () => {
    const ctx = createMockCtx();
    const api = createApi(ctx);

    api.register(shapeEntry);

    expect(api.get("Shape")).toBe(shapeEntry);
    expect(api.has("Shape")).toBe(true);
    expect(api.list()).toStrictEqual([shapeEntry]);
  });

  it("an unknown name misses: get undefined, has false", () => {
    const ctx = createMockCtx();
    const api = createApi(ctx);

    expect(api.get("Ghost")).toBeUndefined();
    expect(api.has("Ghost")).toBe(false);
  });

  it("list preserves registration order across multiple entries", () => {
    const ctx = createMockCtx();
    const api = createApi(ctx);

    api.register(shapeEntry);
    api.register(transformEntry);
    api.register(spriteEntry);

    expect(api.list()).toStrictEqual([shapeEntry, transformEntry, spriteEntry]);
  });
});

// ─── register: idempotent override ──────────────────────────────

describe("createApi — register idempotent override", () => {
  it("re-registering the same name replaces the entry (last wins) and warns once", () => {
    const warn = vi.fn();
    const ctx = createMockCtx({ log: { warn } });
    const api = createApi(ctx);

    api.register(shapeEntry);
    const replacement: ComponentCatalogEntry = { ...shapeEntry, defaults: { kind: "circle" } };
    api.register(replacement);

    expect(api.get("Shape")).toBe(replacement);
    expect(warn).toHaveBeenCalledOnce();
  });

  it("does not duplicate the name in list() after an override", () => {
    const ctx = createMockCtx();
    const api = createApi(ctx);

    api.register(shapeEntry);
    api.register({ ...shapeEntry, defaults: { kind: "circle" } });

    expect(api.list()).toHaveLength(1);
  });

  it("does not warn on the first registration of a name", () => {
    const warn = vi.fn();
    const ctx = createMockCtx({ log: { warn } });
    const api = createApi(ctx);

    api.register(shapeEntry);

    expect(warn).not.toHaveBeenCalled();
  });
});

// ─── byCategory: completeness + grouping ────────────────────────

describe("createApi — byCategory", () => {
  it("returns all six category keys, empty ones as []", () => {
    const ctx = createMockCtx();
    const api = createApi(ctx);

    const byCategory = api.byCategory();

    expect([...byCategory.keys()]).toStrictEqual([
      "Transform",
      "Rendering",
      "Physics",
      "Animation",
      "Audio",
      "Scripts"
    ]);
    expect(byCategory.get("Physics")).toStrictEqual([]);
    expect(byCategory.get("Animation")).toStrictEqual([]);
    expect(byCategory.get("Audio")).toStrictEqual([]);
    expect(byCategory.get("Scripts")).toStrictEqual([]);
  });

  it("groups two Rendering entries in registration order", () => {
    const ctx = createMockCtx();
    const api = createApi(ctx);

    api.register(shapeEntry);
    api.register(spriteEntry);

    expect(api.byCategory().get("Rendering")).toStrictEqual([shapeEntry, spriteEntry]);
  });

  it("groups Transform under its own category", () => {
    const ctx = createMockCtx();
    const api = createApi(ctx);

    api.register(transformEntry);

    expect(api.byCategory().get("Transform")).toStrictEqual([transformEntry]);
  });
});

// ─── addable passthrough ─────────────────────────────────────────

describe("createApi — addable passthrough", () => {
  it("stores and lists a non-addable entry (Transform) with addable === false", () => {
    const ctx = createMockCtx();
    const api = createApi(ctx);

    api.register(transformEntry);

    expect(api.get("Transform")?.addable).toBe(false);
    expect(api.list()[0]?.addable).toBe(false);
  });
});
