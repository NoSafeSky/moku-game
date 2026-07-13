/**
 * @file renderer plugin — unit tests for createApi and createSyncSystem.
 *
 * Tests use stub Pixi objects (Container, Application) and a hand-rolled mock
 * context. The "pixi.js" module is mocked at module level.
 */
import { describe, expect, expectTypeOf, it, vi } from "vitest";

vi.mock("pixi.js", () => {
  /** Pixi Container stub — includes children to distinguish from the local test stub. */
  const makePixiContainer = () => ({
    position: { set: vi.fn() },
    rotation: 0,
    scale: { set: vi.fn() },
    destroy: vi.fn(),
    children: [] as unknown[]
  });

  return {
    Application: vi.fn().mockImplementation(() => ({
      init: vi.fn().mockResolvedValue(undefined),
      render: vi.fn(),
      destroy: vi.fn(),
      canvas: {} as HTMLCanvasElement,
      stage: makePixiContainer()
    })),
    Container: vi.fn().mockImplementation(makePixiContainer)
  };
});

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

import type { Component, Entity, World } from "../../../ecs/types";
import type { TransformValue } from "../../types";

/** Create a branded Entity handle for tests. */
const makeEntity = (n: number): Entity => n as Entity;

/** Create a minimal stub World. */
const makeWorld = (overrides?: Partial<World>): World =>
  ({
    defineComponent: vi.fn().mockReturnValue({ __id: 1, __value: {} }),
    spawn: vi.fn(),
    despawn: vi.fn(),
    isAlive: vi.fn().mockReturnValue(true),
    get: vi.fn(),
    set: vi.fn(),
    query: vi.fn().mockReturnValue({ updateEach: vi.fn(), count: vi.fn(), first: vi.fn() }),
    add: vi.fn(),
    remove: vi.fn(),
    has: vi.fn(),
    addSystem: vi.fn().mockReturnValue(() => {
      /* no-op unsubscribe */
    }),
    tick: vi.fn(),
    defineTag: vi.fn(),
    ...overrides
  }) as unknown as World;

/** Create a stub Container. */
const makeContainer = () => ({
  position: { set: vi.fn() },
  rotation: 0,
  scale: { set: vi.fn() },
  destroy: vi.fn()
});

/** Build a structural Pixi-display-object stub for the scene-graph walk. */
const makeNode = (over: Record<string, unknown> = {}) => ({
  label: "",
  position: { x: 0, y: 0 },
  rotation: 0,
  scale: { x: 1, y: 1 },
  visible: true,
  alpha: 1,
  width: 0,
  height: 0,
  children: [] as unknown[],
  ...over
});

/** A stub Transform token of the same shape onStart stores on state. */
const makeToken = (id: number): Component<TransformValue> =>
  ({ __id: id, __value: {} }) as unknown as Component<TransformValue>;

import type { Container } from "pixi.js";
import type { RendererContext } from "../../api";
// ─────────────────────────────────────────────────────────────────────────────
// Import after mocks are declared
// ─────────────────────────────────────────────────────────────────────────────
import { createApi } from "../../api";
import { createState } from "../../state";
import type { Config, SceneNode } from "../../types";

const defaultConfig: Config = {
  width: 800,
  height: 600,
  background: 0x00_00_00,
  resolution: 0,
  antialias: true,
  mount: undefined,
  headless: false
};

const createMockCtx = (world?: World): RendererContext => {
  const resolvedWorld = world ?? makeWorld();
  const state = createState({ global: {}, config: defaultConfig });
  return {
    config: defaultConfig,
    state,
    global: {},
    log: {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn()
    },
    require: vi.fn().mockReturnValue(resolvedWorld)
  };
};

// ─────────────────────────────────────────────────────────────────────────────
// createApi — attach / detach / markDirty
// ─────────────────────────────────────────────────────────────────────────────

describe("createApi", () => {
  describe("attach", () => {
    it("records the view in state.views and marks the entity dirty", () => {
      const ctx = createMockCtx();
      const api = createApi(ctx);
      const entity = makeEntity(1);
      const view = makeContainer() as unknown as Container;

      api.attach(entity, view);

      expect(ctx.state.views.has(entity)).toBe(true);
      expect(ctx.state.dirty.has(entity)).toBe(true);
    });

    it("overwrites a previous view without crashing", () => {
      const ctx = createMockCtx();
      const api = createApi(ctx);
      const entity = makeEntity(2);
      const v1 = makeContainer() as unknown as Container;
      const v2 = makeContainer() as unknown as Container;

      api.attach(entity, v1);
      api.attach(entity, v2);

      expect(ctx.state.views.get(entity)).toBe(v2);
    });
  });

  describe("getEntityView", () => {
    it("returns the view attached to an entity", () => {
      const ctx = createMockCtx();
      const api = createApi(ctx);
      const entity = makeEntity(11);
      const view = makeContainer() as unknown as Container;

      api.attach(entity, view);

      expect(api.getEntityView(entity)).toBe(view);
    });

    it("returns undefined for an entity with no view", () => {
      const ctx = createMockCtx();
      const api = createApi(ctx);

      expect(api.getEntityView(makeEntity(12))).toBeUndefined();
    });
  });

  describe("detach", () => {
    it("disposes and removes the view", () => {
      const ctx = createMockCtx();
      const api = createApi(ctx);
      const entity = makeEntity(3);
      const mock = makeContainer();
      const view = mock as unknown as Container;

      api.attach(entity, view);
      api.detach(entity);

      expect(ctx.state.views.has(entity)).toBe(false);
      expect(mock.destroy).toHaveBeenCalled();
    });

    it("is idempotent when entity has no view", () => {
      const ctx = createMockCtx();
      const api = createApi(ctx);
      const entity = makeEntity(99);

      expect(() => api.detach(entity)).not.toThrow();
    });
  });

  describe("markDirty", () => {
    it("adds the entity to state.dirty", () => {
      const ctx = createMockCtx();
      const api = createApi(ctx);
      const entity = makeEntity(5);

      api.markDirty(entity);

      expect(ctx.state.dirty.has(entity)).toBe(true);
    });
  });

  describe("render", () => {
    it("is a no-op before start (app is undefined)", () => {
      const ctx = createMockCtx();
      const api = createApi(ctx);

      expect(() => api.render()).not.toThrow();
    });
  });

  describe("getView", () => {
    it("returns undefined before start", () => {
      const ctx = createMockCtx();
      const api = createApi(ctx);

      expect(api.getView()).toBeUndefined();
    });
  });

  describe("getStage", () => {
    it("returns undefined before start", () => {
      const ctx = createMockCtx();
      const api = createApi(ctx);

      expect(api.getStage()).toBeUndefined();
    });
  });

  describe("Transform", () => {
    it("returns the token onStart stored on state", () => {
      const ctx = createMockCtx();
      const token = makeToken(1);
      ctx.state.transformToken = token;
      const api = createApi(ctx);

      expect(api.Transform).toBe(token);
      expect(typeof api.Transform.__id).toBe("number");
    });

    it("returns the same token instance on subsequent accesses", () => {
      const ctx = createMockCtx();
      ctx.state.transformToken = makeToken(2);
      const api = createApi(ctx);

      expect(api.Transform).toBe(api.Transform);
    });

    it("throws when accessed before start (no token defined yet)", () => {
      const ctx = createMockCtx();
      const api = createApi(ctx);

      expect(() => api.Transform).toThrow(/before start/);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // screenshot (Pixi extract)
  // ─────────────────────────────────────────────────────────────────────────

  describe("screenshot", () => {
    it("returns undefined before start (app is undefined)", async () => {
      const ctx = createMockCtx();
      const api = createApi(ctx);

      await expect(api.screenshot()).resolves.toBeUndefined();
    });

    it("delegates to renderer.extract.base64(stage) and returns its data URL", async () => {
      const ctx = createMockCtx();
      const base64 = vi.fn().mockResolvedValue("data:image/png;base64,AAAA");
      const stage = makeContainer();
      ctx.state.app = {
        renderer: { extract: { base64 } },
        stage
      } as unknown as import("pixi.js").Application;
      const api = createApi(ctx);

      const result = await api.screenshot();

      expect(result).toBe("data:image/png;base64,AAAA");
      expect(base64).toHaveBeenCalledWith(stage);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // tree (scene-graph walk)
  // ─────────────────────────────────────────────────────────────────────────

  describe("tree", () => {
    it("returns undefined before start (app is undefined)", () => {
      const ctx = createMockCtx();
      const api = createApi(ctx);

      expect(api.tree()).toBeUndefined();
    });

    it("serialises the stage and its children with positions and types", () => {
      const ctx = createMockCtx();
      const scoreText = makeNode({
        label: "score",
        text: "12",
        position: { x: 10, y: 20 },
        width: 50,
        height: 12
      });
      const paddle = makeNode({ label: "paddle", texture: {}, position: { x: 5, y: 100 } });
      const stage = makeNode({ label: "stage", children: [scoreText, paddle] });
      ctx.state.app = { stage } as unknown as import("pixi.js").Application;
      const api = createApi(ctx);

      const tree = api.tree();

      expect(tree?.label).toBe("stage");
      expect(tree?.type).toBe("Container");
      expect(tree?.children).toHaveLength(2);

      const [text, sprite] = tree?.children ?? [];
      expect(text?.type).toBe("Text");
      expect(text?.text).toBe("12");
      expect(text?.x).toBe(10);
      expect(text?.y).toBe(20);
      expect(sprite?.type).toBe("Sprite");
      expect(sprite?.text).toBeUndefined();
    });

    it("truncates children past the MAX_TREE_DEPTH cap (no pathological recursion)", () => {
      const ctx = createMockCtx();
      // A chain deeper than the 64-level cap (70 wrappers around a leaf).
      let node: Record<string, unknown> = makeNode({ label: "leaf" });
      for (let i = 0; i < 70; i += 1) node = makeNode({ label: `n${i}`, children: [node] });
      ctx.state.app = { stage: node } as unknown as import("pixi.js").Application;
      const api = createApi(ctx);

      // Follow the single child chain; it must bottom out (children === []) at the cap.
      let cursor = api.tree();
      let depth = 0;
      while (cursor && cursor.children.length > 0) {
        cursor = cursor.children[0];
        depth += 1;
      }
      expect(depth).toBe(64); // MAX_TREE_DEPTH — deeper nodes are dropped
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Type-level assertions
  // ─────────────────────────────────────────────────────────────────────────

  describe("types", () => {
    it("Transform is Component<TransformValue>", () => {
      const ctx = createMockCtx();
      ctx.state.transformToken = { __id: 1, __value: {} } as unknown as Component<TransformValue>;
      const api = createApi(ctx);

      expectTypeOf(api.Transform).toEqualTypeOf<Component<TransformValue>>();
    });

    it("attach signature requires Entity and Container", () => {
      const ctx = createMockCtx();
      const api = createApi(ctx);

      expectTypeOf(api.attach).toMatchTypeOf<(entity: Entity, view: Container) => void>();
    });

    it("getView returns HTMLCanvasElement | undefined", () => {
      const ctx = createMockCtx();
      const api = createApi(ctx);

      expectTypeOf(api.getView).toEqualTypeOf<() => HTMLCanvasElement | undefined>();
    });

    it("getStage returns Container | undefined", () => {
      const ctx = createMockCtx();
      const api = createApi(ctx);

      expectTypeOf(api.getStage).toEqualTypeOf<() => Container | undefined>();
    });

    it("screenshot returns Promise<string | undefined>", () => {
      const ctx = createMockCtx();
      const api = createApi(ctx);

      expectTypeOf(api.screenshot).toEqualTypeOf<() => Promise<string | undefined>>();
    });

    it("tree returns SceneNode | undefined", () => {
      const ctx = createMockCtx();
      const api = createApi(ctx);

      expectTypeOf(api.tree).toEqualTypeOf<() => SceneNode | undefined>();
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// createState
// ─────────────────────────────────────────────────────────────────────────────

describe("createState", () => {
  it("initializes app as undefined", () => {
    const state = createState({ global: {}, config: defaultConfig });

    expect(state.app).toBeUndefined();
  });

  it("initializes views as an empty Map", () => {
    const state = createState({ global: {}, config: defaultConfig });

    expect(state.views).toBeInstanceOf(Map);
    expect(state.views.size).toBe(0);
  });

  it("initializes dirty as an empty Set", () => {
    const state = createState({ global: {}, config: defaultConfig });

    expect(state.dirty).toBeInstanceOf(Set);
    expect(state.dirty.size).toBe(0);
  });
});
