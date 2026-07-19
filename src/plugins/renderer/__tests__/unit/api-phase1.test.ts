/**
 * @file renderer plugin — unit tests for the Phase-1 (Wave F1) API additions.
 *
 * Covers attachSprite, setTextureResolver, setWorldTransformResolver,
 * setEntityVisible, and setGridVisible via createApi with a mocked "pixi.js".
 */
import { describe, expect, expectTypeOf, it, vi } from "vitest";

vi.mock("pixi.js", () => {
  class Graphics {
    rect = vi.fn();
    fill = vi.fn();
    stroke = vi.fn();
    scale = { x: 1, y: 1 };
    tint: number | string = 0xff_ff_ff;
    visible = true;
    label = "";
    /** Chainable no-op (real Pixi drawing methods return `this`). */
    clear(): this {
      return this;
    }
    /** Chainable no-op (real Pixi drawing methods return `this`). */
    moveTo(): this {
      return this;
    }
    /** Chainable no-op (real Pixi drawing methods return `this`). */
    lineTo(): this {
      return this;
    }
  }
  class Sprite {
    texture: unknown;
    anchor = { set: vi.fn() };
    scale = { x: 1, y: 1 };
    tint: number | string = 0xff_ff_ff;
    width = 0;
    height = 0;
    visible = true;
    constructor(texture: unknown) {
      this.texture = texture;
    }
  }
  class Container {
    children: unknown[] = [];
    scale = { x: 1, y: 1 };
    visible = true;
    /** Records the child and returns it, matching Pixi's real addChild contract. */
    addChild(child: unknown): unknown {
      this.children.push(child);
      return child;
    }
  }
  return {
    Application: vi.fn(),
    Graphics,
    Sprite,
    Container
  };
});

// ─────────────────────────────────────────────────────────────────────────────
// Imports after the mock is declared
// ─────────────────────────────────────────────────────────────────────────────

import { Container, Graphics, Sprite } from "pixi.js";
import type { Entity, World } from "../../../ecs/types";
import type { RendererContext } from "../../api";
import { createApi } from "../../api";
import { createState } from "../../state";
import type {
  Config,
  GridSpec,
  SpriteSpec,
  TextureHandle,
  TextureResolver,
  WorldTransformResolver
} from "../../types";

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

/** A mock stage exposing both addChild and addChildAt spies. */
const makeMockStage = () => ({
  position: { set: vi.fn() },
  rotation: 0,
  scale: { set: vi.fn() },
  destroy: vi.fn(),
  children: [] as unknown[],
  addChild: vi.fn(),
  addChildAt: vi.fn()
});

const makeHandle = (): TextureHandle => ({}) as TextureHandle;

// ─────────────────────────────────────────────────────────────────────────────
// attachSprite
// ─────────────────────────────────────────────────────────────────────────────

describe("createApi — attachSprite", () => {
  it("returns false and adds nothing when headless / before start (no app)", () => {
    const ctx = createMockCtx();
    const api = createApi(ctx);
    const entity = makeEntity(1);

    const result = api.attachSprite(entity, { alias: "player" });

    expect(result).toBe(false);
    expect(ctx.state.views.has(entity)).toBe(false);
    expect(ctx.state.dirty.has(entity)).toBe(false);
  });

  it("resolved: builds a wrapper+Sprite, self-parents to the stage, records views+dirty, returns true", () => {
    const ctx = createMockCtx();
    const stage = makeMockStage();
    ctx.state.app = { stage } as unknown as import("pixi.js").Application;
    ctx.state.textureResolver = vi.fn().mockReturnValue(makeHandle());
    const api = createApi(ctx);
    const entity = makeEntity(2);

    const result = api.attachSprite(entity, { alias: "player" });

    expect(result).toBe(true);
    expect(stage.addChild).toHaveBeenCalledOnce();
    expect(ctx.state.views.has(entity)).toBe(true);
    expect(ctx.state.dirty.has(entity)).toBe(true);

    const wrapper = ctx.state.views.get(entity);
    const child = (wrapper as unknown as { children: unknown[] }).children[0];
    expect(child).toBeInstanceOf(Sprite);
  });

  it("unresolved (no resolver installed): builds a wrapper+placeholder Graphics, still returns true", () => {
    const ctx = createMockCtx();
    const stage = makeMockStage();
    ctx.state.app = { stage } as unknown as import("pixi.js").Application;
    // ctx.state.textureResolver stays undefined (the flat-app default)
    const api = createApi(ctx);
    const entity = makeEntity(3);

    const result = api.attachSprite(entity, { alias: "player" });

    expect(result).toBe(true);
    const wrapper = ctx.state.views.get(entity);
    const child = (wrapper as unknown as { children: unknown[] }).children[0];
    expect(child).toBeInstanceOf(Graphics);
  });

  it("applies tint/flipX/width/height to the INNER sprite so the wrapper stays transform-only", () => {
    const ctx = createMockCtx();
    const stage = makeMockStage();
    ctx.state.app = { stage } as unknown as import("pixi.js").Application;
    ctx.state.textureResolver = vi.fn().mockReturnValue(makeHandle());
    const api = createApi(ctx);
    const entity = makeEntity(4);
    const spec: SpriteSpec = {
      alias: "player",
      tint: 0xff_00_00,
      flipX: true,
      width: 40,
      height: 50
    };

    api.attachSprite(entity, spec);

    const wrapper = ctx.state.views.get(entity);
    const child = (wrapper as unknown as { children: [Sprite] }).children[0];
    expect(child.tint).toBe(0xff_00_00);
    expect(child.width).toBe(40);
    expect(child.height).toBe(50);
    expect(child.scale.x).toBe(-1);
    // The wrapper itself carries none of these — only position/rotation/scale is sync-driven.
    expect((wrapper as unknown as { tint?: unknown }).tint).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// setTextureResolver / setWorldTransformResolver
// ─────────────────────────────────────────────────────────────────────────────

describe("createApi — setTextureResolver", () => {
  it("installs the resolver on state.textureResolver", () => {
    const ctx = createMockCtx();
    const api = createApi(ctx);
    const resolve = vi.fn().mockReturnValue(makeHandle());

    api.setTextureResolver(resolve);

    expect(ctx.state.textureResolver).toBe(resolve);
  });

  it("clears the resolver back to undefined", () => {
    const ctx = createMockCtx();
    const api = createApi(ctx);
    ctx.state.textureResolver = vi.fn();

    api.setTextureResolver(undefined);

    expect(ctx.state.textureResolver).toBeUndefined();
  });
});

describe("createApi — setWorldTransformResolver", () => {
  it("installs the resolver on state.worldResolver", () => {
    const ctx = createMockCtx();
    const api = createApi(ctx);
    const resolve: WorldTransformResolver = vi
      .fn()
      .mockReturnValue({ x: 1, y: 2, rotation: 0, scaleX: 1, scaleY: 1 });

    api.setWorldTransformResolver(resolve);

    expect(ctx.state.worldResolver).toBe(resolve);
  });

  it("clears the resolver back to undefined", () => {
    const ctx = createMockCtx();
    const api = createApi(ctx);
    ctx.state.worldResolver = vi.fn();

    api.setWorldTransformResolver(undefined);

    expect(ctx.state.worldResolver).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// setEntityVisible
// ─────────────────────────────────────────────────────────────────────────────

describe("createApi — setEntityVisible", () => {
  it("toggles the view's visible flag", () => {
    const ctx = createMockCtx();
    const api = createApi(ctx);
    const entity = makeEntity(10);
    const view = { visible: true };
    ctx.state.views.set(entity, view as never);

    api.setEntityVisible(entity, false);

    expect(view.visible).toBe(false);
  });

  it("is a safe no-op (never throws) when the entity has no view", () => {
    const ctx = createMockCtx();
    const api = createApi(ctx);
    const entity = makeEntity(11);

    expect(() => api.setEntityVisible(entity, false)).not.toThrow();
  });

  it("is a safe no-op when headless (no view was ever attached)", () => {
    const ctx = createMockCtx();
    const api = createApi(ctx);
    const entity = makeEntity(12);

    expect(() => api.setEntityVisible(entity, true)).not.toThrow();
    expect(ctx.state.views.has(entity)).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// setGridVisible
// ─────────────────────────────────────────────────────────────────────────────

describe("createApi — setGridVisible", () => {
  it("is headless-tolerant (no-op, no throw) when there is no app", () => {
    const ctx = createMockCtx();
    const api = createApi(ctx);

    expect(() => api.setGridVisible(true)).not.toThrow();
    expect(ctx.state.grid).toBeUndefined();
  });

  it("shows: builds a Graphics grid and adds it at stage index 0", () => {
    const ctx = createMockCtx();
    const stage = makeMockStage();
    ctx.state.app = { stage } as unknown as import("pixi.js").Application;
    const api = createApi(ctx);

    api.setGridVisible(true);

    expect(ctx.state.grid).toBeInstanceOf(Graphics);
    expect(stage.addChildAt).toHaveBeenCalledWith(ctx.state.grid, 0);
    expect((ctx.state.grid as unknown as { visible: boolean }).visible).toBe(true);
    // Never hit-testable: an interactive stage must not let the full-canvas grid shadow the
    // entity pick layer (it would absorb every canvas click).
    expect((ctx.state.grid as unknown as { eventMode: string }).eventMode).toBe("none");
  });

  it("hides: sets visible=false without destroying the grid", () => {
    const ctx = createMockCtx();
    const stage = makeMockStage();
    ctx.state.app = { stage } as unknown as import("pixi.js").Application;
    const api = createApi(ctx);

    api.setGridVisible(true);
    const grid = ctx.state.grid;
    api.setGridVisible(false);

    expect(ctx.state.grid).toBe(grid); // same instance — not torn down
    expect((ctx.state.grid as unknown as { visible: boolean }).visible).toBe(false);
  });

  it("hide is a safe no-op when the grid was never shown", () => {
    const ctx = createMockCtx();
    const stage = makeMockStage();
    ctx.state.app = { stage } as unknown as import("pixi.js").Application;
    const api = createApi(ctx);

    expect(() => api.setGridVisible(false)).not.toThrow();
    expect(ctx.state.grid).toBeUndefined();
  });

  it("re-showing reuses the same Graphics instance (no duplicate grid)", () => {
    const ctx = createMockCtx();
    const stage = makeMockStage();
    ctx.state.app = { stage } as unknown as import("pixi.js").Application;
    const api = createApi(ctx);

    api.setGridVisible(true);
    const first = ctx.state.grid;
    api.setGridVisible(false);
    api.setGridVisible(true);

    expect(ctx.state.grid).toBe(first);
  });

  it("spec restyles the grid (color/size passed through to the draw)", () => {
    const ctx = createMockCtx();
    const stage = makeMockStage();
    ctx.state.app = { stage } as unknown as import("pixi.js").Application;
    const api = createApi(ctx);
    const spec: GridSpec = { size: 16, color: 0x11_22_33 };

    api.setGridVisible(true, spec);

    const grid = ctx.state.grid as unknown as { stroke: ReturnType<typeof vi.fn> };
    expect(grid.stroke).toHaveBeenCalledWith({ color: 0x11_22_33, width: 1 });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// setContentRoot — editor content layer (camera-transformed pick surface)
// ─────────────────────────────────────────────────────────────────────────────

describe("createApi — setContentRoot", () => {
  it("re-parents every existing view into the root and flips it eventMode 'static'", () => {
    const ctx = createMockCtx();
    const stage = makeMockStage();
    ctx.state.app = { stage } as unknown as import("pixi.js").Application;
    const api = createApi(ctx);
    const entity = makeEntity(20);
    const view = new Container() as unknown as { eventMode?: string };
    ctx.state.views.set(entity, view as never);

    const root = new Container();
    api.setContentRoot(root as never);

    expect(ctx.state.contentRoot).toBe(root);
    expect((root as unknown as { children: unknown[] }).children).toContain(view);
    expect(view.eventMode).toBe("static");
  });

  it("clearing with undefined resets the content root (views parent on the stage again)", () => {
    const ctx = createMockCtx();
    const api = createApi(ctx);
    ctx.state.contentRoot = new Container() as never;

    api.setContentRoot(undefined);

    expect(ctx.state.contentRoot).toBeUndefined();
  });

  it("with a content root set, attachSprite parents new views into it and flips them static", () => {
    const ctx = createMockCtx();
    const stage = makeMockStage();
    ctx.state.app = { stage } as unknown as import("pixi.js").Application;
    const api = createApi(ctx);
    const root = new Container();
    api.setContentRoot(root as never);

    const entity = makeEntity(21);
    api.attachSprite(entity, { alias: "player" });

    const view = ctx.state.views.get(entity) as unknown as { eventMode?: string };
    expect((root as unknown as { children: unknown[] }).children).toContain(view);
    expect(view.eventMode).toBe("static");
    expect(stage.addChild).not.toHaveBeenCalled(); // parented into the root, not the raw stage
  });

  it("without a content root, attachSprite parents onto the raw stage and leaves views inert", () => {
    const ctx = createMockCtx();
    const stage = makeMockStage();
    ctx.state.app = { stage } as unknown as import("pixi.js").Application;
    const api = createApi(ctx);

    const entity = makeEntity(22);
    api.attachSprite(entity, { alias: "player" });

    const view = ctx.state.views.get(entity) as unknown as { eventMode?: string };
    expect(stage.addChild).toHaveBeenCalledWith(view); // the flat-app default: raw stage
    expect(view.eventMode).toBeUndefined(); // a non-editor game pays nothing
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Type-level assertions — no Pixi leak
// ─────────────────────────────────────────────────────────────────────────────

describe("types — Phase-1 additions", () => {
  it("attachSprite requires Entity and SpriteSpec, returns boolean", () => {
    const ctx = createMockCtx();
    const api = createApi(ctx);

    expectTypeOf(api.attachSprite).toMatchTypeOf<(entity: Entity, spec: SpriteSpec) => boolean>();
  });

  it("setTextureResolver accepts the resolver or undefined", () => {
    const ctx = createMockCtx();
    const api = createApi(ctx);

    expectTypeOf(api.setTextureResolver).toMatchTypeOf<
      (resolve: TextureResolver | undefined) => void
    >();
  });

  it("setWorldTransformResolver accepts the resolver or undefined", () => {
    const ctx = createMockCtx();
    const api = createApi(ctx);

    expectTypeOf(api.setWorldTransformResolver).toMatchTypeOf<
      (resolve: WorldTransformResolver | undefined) => void
    >();
  });

  it("a plain object literal is not assignable to the opaque TextureHandle", () => {
    // @ts-expect-error — TextureHandle is an opaque brand; a plain object literal is not assignable.
    const handle: TextureHandle = {};
    expect(handle).toEqual({});
  });
});
