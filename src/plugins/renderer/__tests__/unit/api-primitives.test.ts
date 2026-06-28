/**
 * @file renderer plugin — unit tests for Cycle 5 api additions.
 *
 * Tests cover:
 *   1. nodeType / tree() Graphics classification: a node carrying the verified
 *      Graphics marker (`context` object field) reports `type: "Graphics"`;
 *      Text/Sprite/Container still classify correctly.
 *   2. attachPrimitive: for each shape (rect/circle/line/polygon) returns true,
 *      calls stage.addChild once, records entity in state.views + state.dirty.
 *      Returns false (adds nothing) when state.app is undefined.
 *   3. Type-level: attachPrimitive returns boolean.
 *
 * Uses structural stubs — no full Pixi Application needed.
 */

import { Graphics } from "pixi.js";
import { describe, expect, expectTypeOf, it, vi } from "vitest";
import type { Component, Entity, World } from "../../../ecs/types";
import type { RendererContext } from "../../api";
import { createApi } from "../../api";
import { createState } from "../../state";
import type { Config, PrimitiveSpec, SceneNode, TransformValue } from "../../types";

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

const makeEntity = (n: number): Entity => n as Entity;

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
    addSystem: vi.fn().mockReturnValue(() => undefined),
    tick: vi.fn(),
    defineTag: vi.fn(),
    ...overrides
  }) as unknown as World;

const defaultConfig: Config = {
  width: 800,
  height: 600,
  background: 0x00_00_00,
  resolution: 0,
  antialias: true,
  mount: undefined,
  headless: false
};

const makeToken = (id: number): Component<TransformValue> =>
  ({ __id: id, __value: {} }) as unknown as Component<TransformValue>;

/** Build a structural display-node stub for the tree() walk. */
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

/** Create a mock stage with addChild spy. */
const makeMockStage = () => ({
  position: { set: vi.fn() },
  rotation: 0,
  scale: { set: vi.fn() },
  destroy: vi.fn(),
  children: [] as unknown[],
  addChild: vi.fn()
});

// ─────────────────────────────────────────────────────────────────────────────
// 1. tree() — Graphics classification (Cycle 5 fix)
// ─────────────────────────────────────────────────────────────────────────────

describe("tree() — Graphics classification (Cycle 5)", () => {
  it("classifies a node with `context` (object) as 'Graphics'", () => {
    const ctx = createMockCtx();
    // A mock node carrying the Graphics marker: `context` is an object
    const graphicsNode = makeNode({ context: { __type: "GraphicsContext" } });
    ctx.state.app = { stage: graphicsNode } as unknown as import("pixi.js").Application;
    const api = createApi(ctx);

    const tree = api.tree();

    expect(tree?.type).toBe("Graphics");
  });

  it("still classifies a Text node (string text) as 'Text'", () => {
    const ctx = createMockCtx();
    const textNode = makeNode({ text: "hello" });
    ctx.state.app = { stage: textNode } as unknown as import("pixi.js").Application;
    const api = createApi(ctx);

    const tree = api.tree();

    expect(tree?.type).toBe("Text");
  });

  it("still classifies a Sprite node (texture, no context) as 'Sprite'", () => {
    const ctx = createMockCtx();
    const spriteNode = makeNode({ texture: {} });
    ctx.state.app = { stage: spriteNode } as unknown as import("pixi.js").Application;
    const api = createApi(ctx);

    const tree = api.tree();

    expect(tree?.type).toBe("Sprite");
  });

  it("still classifies a plain Container (no context, no texture) as 'Container'", () => {
    const ctx = createMockCtx();
    const containerNode = makeNode();
    ctx.state.app = { stage: containerNode } as unknown as import("pixi.js").Application;
    const api = createApi(ctx);

    const tree = api.tree();

    expect(tree?.type).toBe("Container");
  });

  it("classifies a real Pixi Graphics instance as 'Graphics' via tree()", () => {
    const ctx = createMockCtx();
    // Use a real Pixi Graphics as the stage to confirm the live marker works
    const g = new Graphics();
    // Add minimal Pixi-like shape fields expected by the walk
    const nodeProxy = Object.assign(g, {
      position: { x: 0, y: 0 },
      scale: { x: 1, y: 1 },
      rotation: 0,
      visible: true,
      alpha: 1,
      width: 0,
      height: 0,
      label: "graphics-node",
      children: []
    });
    ctx.state.app = {
      stage: nodeProxy
    } as unknown as import("pixi.js").Application;
    const api = createApi(ctx);

    const tree = api.tree();

    expect(tree?.type).toBe("Graphics");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. attachPrimitive — each shape
// ─────────────────────────────────────────────────────────────────────────────

describe("attachPrimitive", () => {
  const shapes: PrimitiveSpec[] = [
    { shape: "rect", width: 20, height: 10 },
    { shape: "circle", radius: 8 },
    { shape: "line", x2: 30, y2: 30 },
    {
      shape: "polygon",
      points: [
        { x: 0, y: 0 },
        { x: 5, y: 0 },
        { x: 2, y: 5 }
      ]
    }
  ];

  for (const spec of shapes) {
    it(`${spec.shape}: returns true, calls addChild, records views+dirty`, () => {
      const ctx = createMockCtx();
      const stage = makeMockStage();
      ctx.state.app = { stage } as unknown as import("pixi.js").Application;
      const api = createApi(ctx);
      const entity = makeEntity(10);

      const result = api.attachPrimitive(entity, spec);

      expect(result).toBe(true);
      expect(stage.addChild).toHaveBeenCalledOnce();
      expect(ctx.state.views.has(entity)).toBe(true);
      expect(ctx.state.dirty.has(entity)).toBe(true);
    });
  }

  it("returns false and calls no addChild when state.app is undefined (headless / before start)", () => {
    const ctx = createMockCtx();
    const stage = makeMockStage();
    // Leave ctx.state.app undefined (before start / headless)
    const api = createApi(ctx);
    const entity = makeEntity(20);

    const result = api.attachPrimitive(entity, { shape: "rect", width: 10, height: 10 });

    expect(result).toBe(false);
    expect(stage.addChild).not.toHaveBeenCalled();
    expect(ctx.state.views.has(entity)).toBe(false);
    expect(ctx.state.dirty.has(entity)).toBe(false);
  });

  it("the added Graphics node has the expected label (accessible via tree())", () => {
    const ctx = createMockCtx();
    const stage = makeMockStage();
    ctx.state.app = { stage } as unknown as import("pixi.js").Application;
    const api = createApi(ctx);
    const entity = makeEntity(30);

    api.attachPrimitive(entity, { shape: "circle", radius: 5, label: "test-ball" });

    // Retrieve the added view from state and check its label
    const view = ctx.state.views.get(entity);
    expect(view).toBeDefined();
    expect((view as unknown as { label: string }).label).toBe("test-ball");
  });

  it("the added Graphics node is the same object passed to addChild", () => {
    const ctx = createMockCtx();
    const stage = makeMockStage();
    ctx.state.app = { stage } as unknown as import("pixi.js").Application;
    const api = createApi(ctx);
    const entity = makeEntity(31);

    api.attachPrimitive(entity, { shape: "rect", width: 5, height: 5 });

    const view = ctx.state.views.get(entity);
    const addChildArg = (stage.addChild.mock.calls[0] as unknown[])[0];
    expect(view).toBe(addChildArg);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. Type-level assertions
// ─────────────────────────────────────────────────────────────────────────────

describe("types — attachPrimitive", () => {
  it("attachPrimitive returns boolean", () => {
    const ctx = createMockCtx();
    ctx.state.transformToken = makeToken(1);
    const api = createApi(ctx);

    expectTypeOf(api.attachPrimitive).toMatchTypeOf<
      (entity: Entity, spec: PrimitiveSpec) => boolean
    >();
  });

  it("tree() still returns SceneNode | undefined", () => {
    const ctx = createMockCtx();
    const api = createApi(ctx);

    expectTypeOf(api.tree).toEqualTypeOf<() => SceneNode | undefined>();
  });
});
