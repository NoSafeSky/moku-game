/**
 * @file graphics-2d plugin — the changeEpoch-gated render-sync system.
 *
 * Drives `createRenderSyncSystem` with a stub world (query / get / has / isAlive / changeEpoch)
 * and a mock renderer recording attachPrimitive / attachSprite / detach / markDirty. Covers the
 * whole reconcile contract: epoch early-out, attach-on-add, signature-driven rebuild,
 * detach-on-component-removal, detach-on-despawn, sprite precedence, and headless tolerance.
 */
import { describe, expect, it, vi } from "vitest";
import type { Component, Entity, World } from "../../../ecs/types";
import type { PrimitiveSpec, SpriteSpec } from "../../../renderer/types";
import { createState } from "../../state";
import { createRenderSyncSystem } from "../../sync";
import type {
  RenderSurface,
  ShapeValue,
  SpriteRendererValue,
  State,
  StoreLookup,
  TextureLookup
} from "../../types";

/** A stub component token of the same shape `onStart` stores on state. */
const makeToken = <T>(id: number): Component<T> =>
  ({ __id: id, __value: {} }) as unknown as Component<T>;

const SHAPE_TOKEN = makeToken<ShapeValue>(1);
const SPRITE_TOKEN = makeToken<SpriteRendererValue>(2);

/** Mint a stub entity handle (the ecs `Entity` brand is opaque — tests only need identity). */
const entityOf = (id: number): Entity => id as unknown as Entity;

/** One stub-world row: the (optional) renderable values an entity currently carries. */
type Row = {
  /** The entity's Shape value, or undefined when it carries no Shape. */
  shape: ShapeValue | undefined;
  /** The entity's SpriteRenderer value, or undefined when it carries no SpriteRenderer. */
  sprite: SpriteRendererValue | undefined;
};

/** A minimal in-memory stand-in for the ecs world, plus the levers a test needs to drive it. */
type StubWorld = {
  /** The `World`-shaped facade handed to the system under test. */
  readonly world: World;
  /** Put (or replace) an entity's renderable values. Bumps the change epoch, as a real write does. */
  set(entity: Entity, row: Partial<Row>): void;
  /** Despawn an entity (drops its row and marks the handle dead). Bumps the change epoch. */
  despawn(entity: Entity): void;
  /** Bump the change epoch without changing any value (simulates an unrelated write). */
  bump(): void;
};

/**
 * Build the stub world. `query(token)` iterates the entities whose row carries that component,
 * `get`/`has` read the row, and `changeEpoch` returns a counter every mutating helper bumps —
 * mirroring the real world's monotonic write counter.
 *
 * @returns The stub world facade plus its test levers.
 * @example
 * ```ts
 * const stub = createStubWorld();
 * stub.set(entityOf(1), { shape: createShape() });
 * ```
 */
const createStubWorld = (): StubWorld => {
  const rows = new Map<Entity, Row>();
  let epoch = 0;

  const facade = {
    query: (token: Component<object>) => ({
      *[Symbol.iterator](): Iterator<Entity> {
        for (const [entity, row] of rows) {
          const value = token === SHAPE_TOKEN ? row.shape : row.sprite;
          if (value !== undefined) yield entity;
        }
      }
    }),
    get: (entity: Entity, token: Component<object>) => {
      const row = rows.get(entity);
      if (!row) return undefined;
      return token === SHAPE_TOKEN ? row.shape : row.sprite;
    },
    has: (entity: Entity, token: Component<object>) => {
      const row = rows.get(entity);
      if (!row) return false;
      return (token === SHAPE_TOKEN ? row.shape : row.sprite) !== undefined;
    },
    isAlive: (entity: Entity) => rows.has(entity),
    changeEpoch: () => epoch
  };

  return {
    world: facade as unknown as World,
    set: (entity, row) => {
      rows.set(entity, { shape: undefined, sprite: undefined, ...rows.get(entity), ...row });
      epoch += 1;
    },
    despawn: entity => {
      rows.delete(entity);
      epoch += 1;
    },
    bump: () => {
      epoch += 1;
    }
  };
};

/** A mock renderer recording every plain-data call the reconciler makes. */
type MockRenderer = RenderSurface & {
  /** Records `attachPrimitive(entity, spec)` calls; returns `staged`. */
  attachPrimitive: ReturnType<typeof vi.fn<(entity: Entity, spec: PrimitiveSpec) => boolean>>;
  /** Records `attachSprite(entity, spec)` calls; returns `staged`. */
  attachSprite: ReturnType<typeof vi.fn<(entity: Entity, spec: SpriteSpec) => boolean>>;
  /** Records `detach(entity)` calls. */
  detach: ReturnType<typeof vi.fn<(entity: Entity) => void>>;
  /** Records `markDirty(entity)` calls. */
  markDirty: ReturnType<typeof vi.fn<(entity: Entity) => void>>;
};

/**
 * Build the mock renderer.
 *
 * @param staged - What `attachPrimitive`/`attachSprite` return. `false` simulates headless
 *   (the renderer stages no view), which the reconciler must tolerate without throwing.
 * @returns The recording mock renderer.
 * @example
 * ```ts
 * const renderer = createMockRenderer(false); // headless
 * ```
 */
const createMockRenderer = (staged = true): MockRenderer => ({
  attachPrimitive: vi.fn<(entity: Entity, spec: PrimitiveSpec) => boolean>(() => staged),
  attachSprite: vi.fn<(entity: Entity, spec: SpriteSpec) => boolean>(() => staged),
  detach: vi.fn<(entity: Entity) => void>(),
  markDirty: vi.fn<(entity: Entity) => void>()
});

/** A started state: both tokens defined, nothing tracked yet. */
const startedState = (): State => {
  const state = createState({ global: {}, config: {} });
  state.spriteToken = SPRITE_TOKEN;
  state.shapeToken = SHAPE_TOKEN;
  state.started = true;
  return state;
};

/**
 * A controllable assets + asset-store pair for the Phase-2 store-aware / pending paths.
 *
 * `loaded` holds the aliases `assets.get` resolves (an opaque stand-in texture); `stored` holds the
 * aliases the store knows (`has` true, `url` a `blob:` stand-in). A test drives resolution by
 * mutating the two sets between ticks.
 *
 * @returns The two structural lookups plus their backing sets.
 * @example
 * ```ts
 * const { assets, store, loaded, stored } = createStubStore();
 * stored.add("hero"); // store-backed, still loading
 * ```
 */
const createStubStore = (): {
  assets: TextureLookup;
  store: StoreLookup;
  loaded: Set<string>;
  stored: Set<string>;
} => {
  const loaded = new Set<string>();
  const stored = new Set<string>();

  return {
    loaded,
    stored,
    assets: {
      get: alias => (loaded.has(alias) ? { alias } : undefined),
      loadUrl: () => Promise.resolve({})
    },
    store: {
      url: alias => (stored.has(alias) ? `blob:${alias}` : undefined),
      has: alias => stored.has(alias)
    }
  };
};

/**
 * Wire the system under test over a fresh stub world + mock renderer.
 *
 * @param staged - Passed through to {@link createMockRenderer} (`false` = headless).
 * @returns The stub world, mock renderer, plugin state, and a `tick()` that runs the system.
 * @example
 * ```ts
 * const { stub, renderer, tick } = setup();
 * ```
 */
const setup = (staged = true) => {
  const stub = createStubWorld();
  const renderer = createMockRenderer(staged);
  const state = startedState();
  const { assets, store, loaded, stored } = createStubStore();
  const system = createRenderSyncSystem({ state, renderer, world: stub.world, assets, store });

  return {
    stub,
    renderer,
    state,
    loaded,
    stored,
    tick: () => {
      system(stub.world, 1 / 60);
    }
  };
};

/** A red 40x20 rect Shape value. */
const aShape = (): ShapeValue => ({
  kind: "rect",
  width: 40,
  height: 20,
  radius: 50,
  fill: "#ff0000",
  stroke: "#000000",
  strokeWidth: 0
});

/** A "ship" SpriteRenderer value. */
const aSprite = (): SpriteRendererValue => ({
  sprite: "ship",
  tint: "#ffffff",
  flipX: false,
  sortingLayer: "Default",
  orderInLayer: 0
});

/** A "hero" SpriteRenderer value whose alias is store-backed (imported), not a manifest asset. */
const aStoreSprite = (): SpriteRendererValue => ({ ...aSprite(), sprite: "hero" });

describe("createRenderSyncSystem — epoch gate", () => {
  it("early-outs when the change epoch has not advanced since the last run", () => {
    const { stub, renderer, tick } = setup();
    stub.set(entityOf(1), { shape: aShape() });

    tick();
    renderer.attachPrimitive.mockClear();

    tick();
    tick();

    expect(renderer.attachPrimitive).not.toHaveBeenCalled();
    expect(renderer.detach).not.toHaveBeenCalled();
    expect(renderer.markDirty).not.toHaveBeenCalled();
  });

  it("reconciles on the first tick after start (lastEpoch starts at -1)", () => {
    const { stub, renderer, state, tick } = setup();
    stub.set(entityOf(1), { shape: aShape() });

    expect(state.lastEpoch).toBe(-1);
    tick();

    expect(renderer.attachPrimitive).toHaveBeenCalledTimes(1);
    expect(state.lastEpoch).toBe(1);
  });

  it("re-runs but attaches nothing when the epoch advanced with no renderable change", () => {
    const { stub, renderer, tick } = setup();
    stub.set(entityOf(1), { shape: aShape() });
    tick();
    renderer.attachPrimitive.mockClear();

    stub.bump();
    tick();

    expect(renderer.attachPrimitive).not.toHaveBeenCalled();
    expect(renderer.detach).not.toHaveBeenCalled();
  });

  it("does nothing when the tokens are not defined yet (system registered before start finished)", () => {
    const stub = createStubWorld();
    const renderer = createMockRenderer();
    const state = createState({ global: {}, config: {} });
    const { assets, store } = createStubStore();
    const system = createRenderSyncSystem({ state, renderer, world: stub.world, assets, store });
    stub.set(entityOf(1), { shape: aShape() });

    expect(() => {
      system(stub.world, 0);
    }).not.toThrow();
    expect(renderer.attachPrimitive).not.toHaveBeenCalled();
  });
});

describe("createRenderSyncSystem — Shape", () => {
  it("attaches a primitive for an entity that gains a Shape, and tracks it", () => {
    const { stub, renderer, state, tick } = setup();
    const entity = entityOf(1);
    stub.set(entity, { shape: aShape() });

    tick();

    expect(renderer.attachPrimitive).toHaveBeenCalledTimes(1);
    expect(renderer.attachPrimitive).toHaveBeenCalledWith(entity, {
      shape: "rect",
      width: 40,
      height: 20,
      fill: 0xff_00_00,
      strokeWidth: 0,
      label: "Shape"
    });
    expect(state.tracked.get(entity)?.kind).toBe("shape");
  });

  it("does not markDirty on the initial attach (attachPrimitive already stages the view)", () => {
    const { stub, renderer, tick } = setup();
    stub.set(entityOf(1), { shape: aShape() });

    tick();

    expect(renderer.markDirty).not.toHaveBeenCalled();
  });

  it("rebuilds the view when a Shape field changes (detach + attach + markDirty)", () => {
    const { stub, renderer, tick } = setup();
    const entity = entityOf(1);
    stub.set(entity, { shape: aShape() });
    tick();
    renderer.attachPrimitive.mockClear();

    stub.set(entity, { shape: { ...aShape(), width: 99 } });
    tick();

    expect(renderer.detach).toHaveBeenCalledWith(entity);
    expect(renderer.attachPrimitive).toHaveBeenCalledTimes(1);
    expect(renderer.markDirty).toHaveBeenCalledWith(entity);
  });

  it("rebuilds when the primitive kind flips rect → circle (a different Pixi object)", () => {
    const { stub, renderer, tick } = setup();
    const entity = entityOf(1);
    stub.set(entity, { shape: aShape() });
    tick();
    renderer.attachPrimitive.mockClear();

    stub.set(entity, { shape: { ...aShape(), kind: "circle" } });
    tick();

    expect(renderer.attachPrimitive).toHaveBeenCalledWith(
      entity,
      expect.objectContaining({ shape: "circle", radius: 50 })
    );
  });

  it("records the new signature so an unchanged value never rebuilds twice", () => {
    const { stub, renderer, state, tick } = setup();
    const entity = entityOf(1);
    stub.set(entity, { shape: aShape() });
    tick();
    const firstSig = state.tracked.get(entity)?.sig;

    stub.set(entity, { shape: { ...aShape(), width: 99 } });
    tick();
    const secondSig = state.tracked.get(entity)?.sig;
    renderer.detach.mockClear();

    stub.bump();
    tick();

    expect(secondSig).not.toBe(firstSig);
    expect(renderer.detach).not.toHaveBeenCalled();
  });
});

describe("createRenderSyncSystem — SpriteRenderer", () => {
  it("attaches a sprite for an entity that gains a SpriteRenderer", () => {
    const { stub, renderer, state, tick } = setup();
    const entity = entityOf(1);
    stub.set(entity, { sprite: aSprite() });

    tick();

    expect(renderer.attachSprite).toHaveBeenCalledTimes(1);
    expect(renderer.attachSprite).toHaveBeenCalledWith(entity, {
      alias: "ship",
      tint: "#ffffff",
      flipX: false
    });
    expect(state.tracked.get(entity)?.kind).toBe("sprite");
  });

  it("rebuilds on an alias change (detach + attachSprite + markDirty)", () => {
    const { stub, renderer, tick } = setup();
    const entity = entityOf(1);
    stub.set(entity, { sprite: aSprite() });
    tick();
    renderer.attachSprite.mockClear();

    stub.set(entity, { sprite: { ...aSprite(), sprite: "boss" } });
    tick();

    expect(renderer.detach).toHaveBeenCalledWith(entity);
    expect(renderer.attachSprite).toHaveBeenCalledWith(
      entity,
      expect.objectContaining({ alias: "boss" })
    );
    expect(renderer.markDirty).toHaveBeenCalledWith(entity);
  });

  it("rebuilds on a tint or flipX change", () => {
    const { stub, renderer, tick } = setup();
    const entity = entityOf(1);
    stub.set(entity, { sprite: aSprite() });
    tick();
    renderer.attachSprite.mockClear();

    stub.set(entity, { sprite: { ...aSprite(), tint: "#ff0000", flipX: true } });
    tick();

    expect(renderer.attachSprite).toHaveBeenCalledWith(entity, {
      alias: "ship",
      tint: "#ff0000",
      flipX: true
    });
  });

  it("gives SpriteRenderer precedence over Shape on an entity carrying both (P1 one-view rule)", () => {
    const { stub, renderer, state, tick } = setup();
    const entity = entityOf(1);
    stub.set(entity, { shape: aShape(), sprite: aSprite() });

    tick();

    expect(state.tracked.get(entity)?.kind).toBe("sprite");
    expect(renderer.attachSprite).toHaveBeenCalledWith(entity, expect.objectContaining({}));
  });

  it("keeps a both-components entity STABLE across later epochs (no rebuild storm)", () => {
    const { stub, renderer, state, tick } = setup();
    const entity = entityOf(1);
    stub.set(entity, { shape: aShape(), sprite: aSprite() });
    tick(); // converges to the sprite view

    renderer.detach.mockClear();
    renderer.attachSprite.mockClear();
    renderer.attachPrimitive.mockClear();
    renderer.markDirty.mockClear();

    // An unrelated write elsewhere bumps the global epoch; neither component's value changed.
    stub.bump();
    tick();
    stub.bump();
    tick();

    // The shape pass must SKIP this entity (sprite wins the slot) rather than rebuild it back and
    // forth. Pre-fix, each tick did a full detach+attach cycle both ways — a permanent flicker.
    expect(state.tracked.get(entity)?.kind).toBe("sprite");
    expect(renderer.detach).not.toHaveBeenCalled();
    expect(renderer.attachSprite).not.toHaveBeenCalled();
    expect(renderer.attachPrimitive).not.toHaveBeenCalled();
  });

  it("falls back to the Shape view when the SpriteRenderer is removed from a both-components entity", () => {
    const { stub, renderer, state, tick } = setup();
    const entity = entityOf(1);
    stub.set(entity, { shape: aShape(), sprite: aSprite() });
    tick(); // sprite wins

    renderer.attachPrimitive.mockClear();

    stub.set(entity, { sprite: undefined }); // remove the sprite; Shape remains
    tick();

    expect(state.tracked.get(entity)?.kind).toBe("shape");
    expect(renderer.attachPrimitive).toHaveBeenCalledWith(entity, expect.objectContaining({}));
  });
});

describe("createRenderSyncSystem — removal", () => {
  it("detaches and untracks when the component is removed from a LIVE entity", () => {
    const { stub, renderer, state, tick } = setup();
    const entity = entityOf(1);
    stub.set(entity, { shape: aShape() });
    tick();

    stub.set(entity, { shape: undefined });
    tick();

    expect(renderer.detach).toHaveBeenCalledWith(entity);
    expect(state.tracked.has(entity)).toBe(false);
  });

  it("detaches and untracks on despawn", () => {
    const { stub, renderer, state, tick } = setup();
    const entity = entityOf(1);
    stub.set(entity, { shape: aShape() });
    tick();

    stub.despawn(entity);
    tick();

    expect(renderer.detach).toHaveBeenCalledWith(entity);
    expect(state.tracked.has(entity)).toBe(false);
  });

  it("leaves other tracked entities untouched when one is removed", () => {
    const { stub, renderer, state, tick } = setup();
    const kept = entityOf(1);
    const dropped = entityOf(2);
    stub.set(kept, { shape: aShape() });
    stub.set(dropped, { shape: aShape() });
    tick();

    stub.despawn(dropped);
    tick();

    expect(renderer.detach).toHaveBeenCalledTimes(1);
    expect(renderer.detach).toHaveBeenCalledWith(dropped);
    expect(state.tracked.has(kept)).toBe(true);
  });

  it("detaches a removed SpriteRenderer against its own tracked kind", () => {
    const { stub, renderer, state, tick } = setup();
    const entity = entityOf(1);
    stub.set(entity, { sprite: aSprite() });
    tick();

    stub.set(entity, { sprite: undefined });
    tick();

    expect(renderer.detach).toHaveBeenCalledWith(entity);
    expect(state.tracked.has(entity)).toBe(false);
  });
});

describe("createRenderSyncSystem — headless tolerance", () => {
  it("does not throw when the renderer stages nothing (attach returns false)", () => {
    const { stub, tick } = setup(false);
    stub.set(entityOf(1), { shape: aShape() });
    stub.set(entityOf(2), { sprite: aSprite() });

    expect(() => {
      tick();
    }).not.toThrow();
  });

  it("still records the signature headless, so it does not re-attach every epoch", () => {
    const { stub, renderer, state, tick } = setup(false);
    const entity = entityOf(1);
    stub.set(entity, { shape: aShape() });
    tick();

    expect(state.tracked.get(entity)?.sig).toBeDefined();

    renderer.attachPrimitive.mockClear();
    stub.bump();
    tick();

    expect(renderer.attachPrimitive).not.toHaveBeenCalled();
  });
});

describe("createRenderSyncSystem — pending texture (Phase 2)", () => {
  it("marks a sprite pending when its alias is a store asset assets.get cannot resolve yet", () => {
    const { stub, renderer, state, stored, tick } = setup();
    const entity = entityOf(1);
    stored.add("hero"); // the store holds it, but it is not loaded into assets yet
    stub.set(entity, { sprite: aStoreSprite() });

    tick();

    // Attached against the renderer's placeholder (the resolver yields undefined for a store alias),
    // and recorded pending so the retry re-attaches once the JIT load lands.
    expect(renderer.attachSprite).toHaveBeenCalledTimes(1);
    expect(state.pending.has(entity)).toBe(true);
  });

  it("re-attaches a pending sprite once its texture lands, then drops it from pending", () => {
    const { stub, renderer, state, loaded, stored, tick } = setup();
    const entity = entityOf(1);
    stored.add("hero");
    stub.set(entity, { sprite: aStoreSprite() });
    tick(); // pending
    renderer.attachSprite.mockClear();

    loaded.add("hero"); // the JIT load completed — no world write bumped the epoch
    tick(); // the retry runs BEFORE the epoch gate

    expect(renderer.detach).toHaveBeenCalledWith(entity);
    expect(renderer.attachSprite).toHaveBeenCalledWith(entity, {
      alias: "hero",
      tint: "#ffffff",
      flipX: false
    });
    expect(renderer.markDirty).toHaveBeenCalledWith(entity);
    expect(state.pending.has(entity)).toBe(false);
  });

  it("returns to a pure epoch-gated early-out once pending drains", () => {
    const { stub, renderer, state, loaded, stored, tick } = setup();
    const entity = entityOf(1);
    stored.add("hero");
    stub.set(entity, { sprite: aStoreSprite() });
    tick(); // pending
    loaded.add("hero");
    tick(); // re-attaches, drains pending
    expect(state.pending.size).toBe(0);

    renderer.detach.mockClear();
    renderer.attachSprite.mockClear();
    renderer.markDirty.mockClear();

    tick(); // unchanged epoch + empty pending → nothing
    tick();

    expect(renderer.detach).not.toHaveBeenCalled();
    expect(renderer.attachSprite).not.toHaveBeenCalled();
    expect(renderer.markDirty).not.toHaveBeenCalled();
  });

  it("does not mark a sprite pending when assets.get already resolves the alias (fast path)", () => {
    const { stub, state, loaded, tick } = setup();
    const entity = entityOf(1);
    loaded.add("ship"); // a manifest (or already-loaded) alias
    stub.set(entity, { sprite: aSprite() });

    tick();

    expect(state.pending.has(entity)).toBe(false);
  });

  it("does not mark an unknown alias pending (nothing to retry — stays a placeholder)", () => {
    const { stub, state, tick } = setup();
    const entity = entityOf(1);
    stub.set(entity, { sprite: { ...aSprite(), sprite: "ghost" } }); // not loaded, not in the store

    tick();

    expect(state.pending.has(entity)).toBe(false);
  });

  it("drops a pending sprite from pending, without re-attaching, if it despawns before loading", () => {
    const { stub, renderer, state, stored, tick } = setup();
    const entity = entityOf(1);
    stored.add("hero");
    stub.set(entity, { sprite: aStoreSprite() });
    tick();
    expect(state.pending.has(entity)).toBe(true);
    renderer.attachSprite.mockClear();

    stub.despawn(entity);
    tick(); // retry sees it is dead → forget it; the removal pass detaches the view

    expect(state.pending.has(entity)).toBe(false);
    expect(renderer.attachSprite).not.toHaveBeenCalled();
  });

  it("drops a pending sprite that lost its SpriteRenderer before the texture landed", () => {
    const { stub, renderer, state, stored, loaded, tick } = setup();
    const entity = entityOf(1);
    stored.add("hero");
    stub.set(entity, { sprite: aStoreSprite() });
    tick();
    expect(state.pending.has(entity)).toBe(true);

    // The component is removed AND the texture lands on the same tick — the retry must forget the
    // entity (it no longer carries a sprite) rather than re-attach a removed component.
    stub.set(entity, { sprite: undefined });
    loaded.add("hero");
    renderer.attachSprite.mockClear();
    tick();

    expect(state.pending.has(entity)).toBe(false);
    expect(renderer.attachSprite).not.toHaveBeenCalled();
  });
});
