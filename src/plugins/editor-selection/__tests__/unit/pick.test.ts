/**
 * @file editor-selection plugin — pick + stamp helper unit tests.
 *
 * Uses Pixi-light stubs — plain objects with `eventMode` / `interactiveChildren` /
 * `children` / `parent` / `position` / `getLocalBounds` / a tiny `on`/`off`/`emit`
 * event-emitter — cast to `Container`, so the pick/stamp logic and the `enable()` /
 * `disable()` / `pickAt` mechanics (exercised through `createApi`) are unit-tested
 * without a real Pixi renderer. Covers: `stampEntity`'s non-enumerable handle;
 * `entityOf`'s parent-chain walk; `enable()`/`disable()` toggling `eventMode` /
 * `interactiveChildren` (idempotent; missing layer / headless → warn + no-op);
 * `pickAt` returning the topmost stamped, alive entity via `pickTopmost`; and the
 * live listener's primary-button press-edge derivation.
 */
import type { Container, FederatedPointerEvent, Graphics } from "pixi.js";
import { describe, expect, it, vi } from "vitest";
import type { Api as CameraApi, Point } from "../../../camera/types";
import type { Entity, World } from "../../../ecs/types";
import type { Api as InputApi } from "../../../input/types";
import type { Api as RendererApi } from "../../../renderer/types";
import { createApi, type EditorSelectionApiContext } from "../../api";
import {
  attachMarqueeListener,
  attachPickListener,
  entityOf,
  pickTopmost,
  rectIntersectsView,
  stampEntity
} from "../../pick";
import { createState } from "../../state";
import type { Config } from "../../types";

const asEntity = (n: number): Entity => n as Entity;

// ─────────────────────────────────────────────────────────────────────────────
// Pixi-light fakes
// ─────────────────────────────────────────────────────────────────────────────

type Listener = (event: unknown) => void;

/** A minimal fake Pixi Container: position + local bounds + parent chain + a tiny emitter. */
type FakeContainer = {
  parent: FakeContainer | undefined;
  children: FakeContainer[];
  position: { x: number; y: number };
  eventMode: string;
  interactiveChildren: boolean;
  visible: boolean;
  getLocalBounds: () => { x: number; y: number; width: number; height: number };
  on: (event: string, fn: Listener) => void;
  off: (event: string, fn: Listener) => void;
  emit: (event: string, payload: unknown) => void;
};

const makeFakeContainer = (
  over: Partial<{
    position: { x: number; y: number };
    bounds: { x: number; y: number; width: number; height: number };
    children: FakeContainer[];
  }> = {}
): FakeContainer => {
  const listeners = new Map<string, Set<Listener>>();
  const bounds = over.bounds ?? { x: -5, y: -5, width: 10, height: 10 };
  const container: FakeContainer = {
    parent: undefined,
    children: over.children ?? [],
    position: over.position ?? { x: 0, y: 0 },
    eventMode: "none",
    interactiveChildren: false,
    visible: true,
    getLocalBounds: () => bounds,
    on(event, fn) {
      const set = listeners.get(event) ?? new Set<Listener>();
      set.add(fn);
      listeners.set(event, set);
    },
    off(event, fn) {
      listeners.get(event)?.delete(fn);
    },
    emit(event, payload) {
      for (const fn of listeners.get(event) ?? []) fn(payload);
    }
  };
  for (const child of container.children) child.parent = container;
  return container;
};

const asContainer = (fake: FakeContainer): Container => fake as unknown as Container;

// ─────────────────────────────────────────────────────────────────────────────
// stampEntity / entityOf
// ─────────────────────────────────────────────────────────────────────────────

describe("editor-selection — pick — stampEntity / entityOf", () => {
  it("stamps a non-enumerable entity handle; Object.keys excludes it, entityOf reads it", () => {
    const view = makeFakeContainer();
    const entity = asEntity(7);
    stampEntity(asContainer(view), entity);

    expect(Object.keys(view)).not.toContain("entity");
    expect(entityOf(asContainer(view))).toBe(entity);
  });

  it("walks the parent chain to the first stamped ancestor", () => {
    const root = makeFakeContainer();
    const mid = makeFakeContainer();
    const leaf = makeFakeContainer();
    mid.parent = root;
    leaf.parent = mid;
    stampEntity(asContainer(root), asEntity(3));

    expect(entityOf(asContainer(leaf))).toBe(asEntity(3));
  });

  it("returns undefined when no ancestor in the chain is stamped", () => {
    const root = makeFakeContainer();
    const leaf = makeFakeContainer();
    leaf.parent = root;
    expect(entityOf(asContainer(leaf))).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// pickTopmost
// ─────────────────────────────────────────────────────────────────────────────

describe("editor-selection — pick — pickTopmost", () => {
  it("returns the topmost (highest-index) matching entity when views overlap", () => {
    const bottom = makeFakeContainer({ position: { x: 0, y: 0 } });
    const top = makeFakeContainer({ position: { x: 0, y: 0 } });
    stampEntity(asContainer(bottom), asEntity(1));
    stampEntity(asContainer(top), asEntity(2));
    const layer = makeFakeContainer({ children: [bottom, top] }); // top is last → highest z

    const hit = pickTopmost(asContainer(layer), { x: 0, y: 0 }, () => true);
    expect(hit).toBe(asEntity(2));
  });

  it("returns undefined when the point is over nothing", () => {
    const child = makeFakeContainer({ position: { x: 100, y: 100 } });
    stampEntity(asContainer(child), asEntity(1));
    const layer = makeFakeContainer({ children: [child] });

    expect(pickTopmost(asContainer(layer), { x: 0, y: 0 }, () => true)).toBeUndefined();
  });

  it("skips a stamped-but-dead entity", () => {
    const child = makeFakeContainer({ position: { x: 0, y: 0 } });
    stampEntity(asContainer(child), asEntity(1));
    const layer = makeFakeContainer({ children: [child] });

    expect(pickTopmost(asContainer(layer), { x: 0, y: 0 }, () => false)).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// enable() / disable() / pickAt — through createApi with stub deps
// ─────────────────────────────────────────────────────────────────────────────

const makeConfig = (over: Partial<Config> = {}): Config => ({
  pickLayer: "world",
  multiSelect: false,
  marquee: true,
  ...over
});

const makeLog = () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() });

/** A STARTED ctx with a stub pick layer + camera/renderer/world/input, for enable/disable/pickAt. */
const startedCtxWithLayer = (
  over: Partial<Config> = {},
  viewsByEntity: ReadonlyMap<Entity, FakeContainer> = new Map()
) => {
  const config = makeConfig(over);
  const state = createState({ global: {}, config });
  const alive = new Set(viewsByEntity.keys());
  const layer = makeFakeContainer({ children: [...viewsByEntity.values()] });

  const world = {
    isAlive: (e: Entity) => alive.has(e),
    liveEntities: () => [...alive]
  } as unknown as World;

  // The camera only ever knows a layer named "world" — a config.pickLayer override
  // ("does-not-exist") must miss, exercising the missing-layer guard.
  const camera = {
    layer: (name: string) => (name === "world" ? asContainer(layer) : undefined),
    screenToWorld: (point: Point) => point // identity mapping — simplifies bounds math in tests
  } as unknown as CameraApi;

  const renderer = {
    getEntityView: (e: Entity) => {
      const view = viewsByEntity.get(e);
      return view ? asContainer(view) : undefined;
    },
    getView: () => undefined
  } as unknown as RendererApi;

  let pointer = { x: 0, y: 0, buttons: 0 };
  const held = new Set<string>(); // modifier keys the stubbed snapshot reports as down
  const input = {
    snapshot: () => ({
      isDown: (key: string) => held.has(key),
      justPressed: () => false,
      justReleased: () => false,
      pointer
    })
  } as unknown as InputApi;

  state.world = world;
  state.renderer = renderer;
  state.camera = camera;
  state.input = input;
  state.started = true;

  const log = makeLog();
  const emit = vi.fn();
  const ctx: EditorSelectionApiContext = { config, state, log, emit };
  const api = createApi(ctx);

  return {
    api,
    ctx,
    state,
    log,
    emit,
    layer,
    held,
    setPointer: (next: Partial<typeof pointer>) => {
      pointer = { ...pointer, ...next };
    }
  };
};

describe("editor-selection — pick — enable()/disable()", () => {
  it("enable() sets eventMode/interactiveChildren on the pick layer; disable() reverts them", () => {
    const { api, layer } = startedCtxWithLayer();

    api.enable();
    expect(layer.eventMode).toBe("static");
    expect(layer.interactiveChildren).toBe(true);

    api.disable();
    expect(layer.eventMode).toBe("none");
    expect(layer.interactiveChildren).toBe(false);
  });

  it("is idempotent — a second enable() re-stamps without double-attaching the listener", () => {
    const view = makeFakeContainer({ position: { x: 0, y: 0 } });
    const entity = asEntity(1);
    const { api, layer, emit, setPointer } = startedCtxWithLayer({}, new Map([[entity, view]]));

    api.enable();
    api.enable(); // idempotent re-enable

    setPointer({ buttons: 1 });
    layer.emit("pointerdown", { target: asContainer(view) } as unknown as FederatedPointerEvent);
    expect(emit).toHaveBeenCalledTimes(1); // exactly one selection, not one per attached listener
  });

  it("disable() is idempotent (safe to call twice; safe before any enable())", () => {
    const { api, layer } = startedCtxWithLayer();
    expect(() => api.disable()).not.toThrow();
    api.enable();
    api.disable();
    expect(() => api.disable()).not.toThrow();
    expect(layer.eventMode).toBe("none");
  });

  it("warns and no-ops when the configured pick layer is unavailable (headless / unknown layer)", () => {
    const { api, log } = startedCtxWithLayer({ pickLayer: "does-not-exist" });
    api.enable();
    expect(log.warn).toHaveBeenCalled();
  });
});

describe("editor-selection — pick — pickAt", () => {
  it("resolves the topmost entity via the stamped handle at a canvas-relative point", () => {
    const view = makeFakeContainer({
      position: { x: 10, y: 10 },
      bounds: { x: -5, y: -5, width: 10, height: 10 }
    });
    const entity = asEntity(1);
    const { api } = startedCtxWithLayer({}, new Map([[entity, view]]));

    api.enable();
    expect(api.pickAt({ x: 10, y: 10 })).toBe(entity);
    expect(api.pickAt({ x: 1000, y: 1000 })).toBeUndefined();
  });

  it("returns undefined when disabled (even with a valid pick layer)", () => {
    const view = makeFakeContainer({ position: { x: 0, y: 0 } });
    const entity = asEntity(1);
    const { api } = startedCtxWithLayer({}, new Map([[entity, view]]));

    expect(api.pickAt({ x: 0, y: 0 })).toBeUndefined();
  });

  it("returns undefined headless (no pick layer available)", () => {
    const { api } = startedCtxWithLayer({ pickLayer: "does-not-exist" });
    api.enable(); // warns + no-ops, stays disabled
    expect(api.pickAt({ x: 0, y: 0 })).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Live pick listener — press-edge derivation
// ─────────────────────────────────────────────────────────────────────────────

describe("editor-selection — pick — attachPickListener press-edge", () => {
  it("selects on the primary down transition (0 → 1) and not on a held button (1 → 1)", () => {
    const view = makeFakeContainer({ position: { x: 0, y: 0 } });
    const entity = asEntity(1);
    const { emit, layer, setPointer, api } = startedCtxWithLayer({}, new Map([[entity, view]]));
    api.enable();

    setPointer({ buttons: 1 }); // 0 → 1: fresh primary press
    layer.emit("pointerdown", { target: asContainer(view) } as unknown as FederatedPointerEvent);
    expect(emit).toHaveBeenCalledTimes(1);

    layer.emit("pointerdown", { target: asContainer(view) } as unknown as FederatedPointerEvent); // still 1 → 1
    expect(emit).toHaveBeenCalledTimes(1); // no re-select on a held button
  });

  it("does not select on a secondary (non-primary) button press", () => {
    const view = makeFakeContainer({ position: { x: 0, y: 0 } });
    const entity = asEntity(1);
    const { emit, layer, setPointer, api } = startedCtxWithLayer({}, new Map([[entity, view]]));
    api.enable();

    setPointer({ buttons: 0b10 }); // secondary button only — primary bit unset
    layer.emit("pointerdown", { target: asContainer(view) } as unknown as FederatedPointerEvent);
    expect(emit).not.toHaveBeenCalled();
  });

  it("clicking empty space clears the selection", () => {
    const view = makeFakeContainer({ position: { x: 0, y: 0 } });
    const entity = asEntity(1);
    const { api, emit, layer, setPointer } = startedCtxWithLayer({}, new Map([[entity, view]]));
    api.enable();
    api.select(entity);
    emit.mockClear();

    const empty = makeFakeContainer({ position: { x: 999, y: 999 } }); // unstamped — nothing resolves
    setPointer({ buttons: 1 });
    layer.emit("pointerdown", { target: asContainer(empty) } as unknown as FederatedPointerEvent);

    expect(api.selected()).toEqual([]);
    expect(emit).toHaveBeenCalledWith("editor-selection:changed", { selected: [] });
  });

  it("returns a no-op detach when there is no pick layer", () => {
    const config = makeConfig();
    const state = createState({ global: {}, config });
    const log = makeLog();
    const emit = vi.fn();
    const ctx: EditorSelectionApiContext = { config, state, log, emit };
    expect(() => attachPickListener(ctx)()).not.toThrow();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Live pick listener — modifier-aware routing (Ctrl/Cmd = toggle, plain = replace)
// ─────────────────────────────────────────────────────────────────────────────

/** Fire one fresh primary press over `view` with the given modifier keys held. */
const clickEntity = (
  harness: ReturnType<typeof startedCtxWithLayer>,
  view: FakeContainer,
  modifiers: readonly string[] = []
): void => {
  harness.held.clear();
  for (const key of modifiers) harness.held.add(key);
  harness.setPointer({ buttons: 0 }); // reset the press edge so each click is a fresh 0 → 1
  harness.layer.emit("pointerdown", {
    target: asContainer(view)
  } as unknown as FederatedPointerEvent);
  harness.setPointer({ buttons: 1 });
  harness.layer.emit("pointerdown", {
    target: asContainer(view)
  } as unknown as FederatedPointerEvent);
};

describe("editor-selection — pick — modifier-aware routing", () => {
  it("a plain click REPLACES the selection (single-select default)", () => {
    const view1 = makeFakeContainer({ position: { x: 0, y: 0 } });
    const view2 = makeFakeContainer({ position: { x: 0, y: 0 } });
    const e1 = asEntity(1);
    const e2 = asEntity(2);
    const harness = startedCtxWithLayer(
      {},
      new Map([
        [e1, view1],
        [e2, view2]
      ])
    );
    harness.api.enable();

    clickEntity(harness, view1);
    expect(harness.api.selected()).toEqual([e1]);

    clickEntity(harness, view2);
    expect(harness.api.selected()).toEqual([e2]); // replaced, not accumulated
  });

  it("a Ctrl-click routes to TOGGLE — a second Ctrl-click deselects", () => {
    const view = makeFakeContainer({ position: { x: 0, y: 0 } });
    const entity = asEntity(1);
    const harness = startedCtxWithLayer({}, new Map([[entity, view]]));
    harness.api.enable();

    clickEntity(harness, view, ["Control"]);
    expect(harness.api.isSelected(entity)).toBe(true);

    clickEntity(harness, view, ["Control"]);
    expect(harness.api.isSelected(entity)).toBe(false);
  });

  it("a Meta (Cmd) click routes to TOGGLE just like Ctrl", () => {
    const view = makeFakeContainer({ position: { x: 0, y: 0 } });
    const entity = asEntity(1);
    const harness = startedCtxWithLayer({}, new Map([[entity, view]]));
    harness.api.enable();

    clickEntity(harness, view, ["Meta"]);
    expect(harness.api.isSelected(entity)).toBe(true);

    clickEntity(harness, view, ["Meta"]);
    expect(harness.api.isSelected(entity)).toBe(false);
  });

  it("Ctrl-click ACCUMULATES with multiSelect on; plain click still replaces the modifier-free way", () => {
    const view1 = makeFakeContainer({ position: { x: 0, y: 0 } });
    const view2 = makeFakeContainer({ position: { x: 0, y: 0 } });
    const e1 = asEntity(1);
    const e2 = asEntity(2);
    const harness = startedCtxWithLayer(
      { multiSelect: true },
      new Map([
        [e1, view1],
        [e2, view2]
      ])
    );
    harness.api.enable();

    clickEntity(harness, view1);
    clickEntity(harness, view2, ["Control"]);
    expect(new Set(harness.api.selected())).toEqual(new Set([e1, e2]));

    clickEntity(harness, view2, ["Control"]); // toggles e2 back off
    expect(harness.api.selected()).toEqual([e1]);
  });

  it("with multiSelect on, a plain click ADDS (accumulation is the multiSelect path, not the modifier)", () => {
    const view1 = makeFakeContainer({ position: { x: 0, y: 0 } });
    const view2 = makeFakeContainer({ position: { x: 0, y: 0 } });
    const e1 = asEntity(1);
    const e2 = asEntity(2);
    const harness = startedCtxWithLayer(
      { multiSelect: true },
      new Map([
        [e1, view1],
        [e2, view2]
      ])
    );
    harness.api.enable();

    clickEntity(harness, view1);
    clickEntity(harness, view2);
    expect(new Set(harness.api.selected())).toEqual(new Set([e1, e2]));
  });

  it("a modifier does NOT preserve the selection on an empty click — the marquee owns additive empty space", () => {
    const view = makeFakeContainer({ position: { x: 0, y: 0 } });
    const entity = asEntity(1);
    const harness = startedCtxWithLayer({}, new Map([[entity, view]]));
    harness.api.enable();
    harness.api.select(entity);

    const empty = makeFakeContainer({ position: { x: 999, y: 999 } }); // unstamped
    clickEntity(harness, empty, ["Control"]);

    expect(harness.api.selected()).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// rectIntersectsView — world-space AABB overlap
// ─────────────────────────────────────────────────────────────────────────────

const viewAt = (x: number, y: number): Container =>
  asContainer(
    makeFakeContainer({ position: { x, y }, bounds: { x: 0, y: 0, width: 10, height: 10 } })
  );

describe("editor-selection — pick — rectIntersectsView", () => {
  it("is true for an overlapping AABB", () => {
    expect(rectIntersectsView(viewAt(5, 5), { x: 0, y: 0, width: 20, height: 20 })).toBe(true);
  });

  it("is false for a disjoint AABB", () => {
    expect(rectIntersectsView(viewAt(500, 500), { x: 0, y: 0, width: 20, height: 20 })).toBe(false);
  });

  it("counts an edge-touching AABB as intersecting", () => {
    expect(rectIntersectsView(viewAt(20, 0), { x: 0, y: 0, width: 20, height: 20 })).toBe(true);
    expect(rectIntersectsView(viewAt(-10, 0), { x: 0, y: 0, width: 20, height: 20 })).toBe(true);
  });

  it("is false when only one axis overlaps", () => {
    expect(rectIntersectsView(viewAt(5, 500), { x: 0, y: 0, width: 20, height: 20 })).toBe(false);
    expect(rectIntersectsView(viewAt(500, 5), { x: 0, y: 0, width: 20, height: 20 })).toBe(false);
  });

  it("honours a local-bounds offset (bounds not anchored at the position)", () => {
    const offset = asContainer(
      makeFakeContainer({
        position: { x: 0, y: 0 },
        bounds: { x: 100, y: 100, width: 10, height: 10 }
      })
    );
    expect(rectIntersectsView(offset, { x: 0, y: 0, width: 20, height: 20 })).toBe(false);
    expect(rectIntersectsView(offset, { x: 95, y: 95, width: 20, height: 20 })).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Marquee drag — stage-level federated pointerdown → globalpointermove → pointerup
// ─────────────────────────────────────────────────────────────────────────────

/** A fake Pixi Graphics recording the draw calls `drawMarquee` / `cancelMarquee` make. */
const makeFakeGraphics = () => {
  const calls = { clear: 0, rect: 0, fill: 0, moveTo: 0, lineTo: 0, stroke: 0 };
  const graphics = {
    clear: () => {
      calls.clear++;
      return graphics;
    },
    rect: () => {
      calls.rect++;
      return graphics;
    },
    fill: () => {
      calls.fill++;
      return graphics;
    },
    moveTo: () => {
      calls.moveTo++;
      return graphics;
    },
    lineTo: () => {
      calls.lineTo++;
      return graphics;
    },
    stroke: () => {
      calls.stroke++;
      return graphics;
    }
  };
  return { graphics: graphics as unknown as Graphics, calls };
};

/** A STARTED ctx with a fake stage + marquee overlay chrome already built (the onStart product). */
const startedMarqueeCtx = (
  over: Partial<Config> = {},
  viewsByEntity: ReadonlyMap<Entity, FakeContainer> = new Map()
) => {
  const config = makeConfig(over);
  const state = createState({ global: {}, config });
  const alive = new Set(viewsByEntity.keys());
  const stage = makeFakeContainer();
  const layer = makeFakeContainer({ children: [...viewsByEntity.values()] });
  const overlay = makeFakeContainer();
  const { graphics, calls } = makeFakeGraphics();

  const world = {
    isAlive: (e: Entity) => alive.has(e),
    liveEntities: () => [...viewsByEntity.keys()]
  } as unknown as World;

  const camera = {
    layer: () => asContainer(layer),
    screenToWorld: (point: Point) => point // identity — canvas px == world px in these tests
  } as unknown as CameraApi;

  const renderer = {
    getEntityView: (e: Entity) => {
      const view = viewsByEntity.get(e);
      return view ? asContainer(view) : undefined;
    },
    getView: () => undefined,
    getStage: () => asContainer(stage)
  } as unknown as RendererApi;

  const held = new Set<string>();
  const input = {
    snapshot: () => ({
      isDown: (key: string) => held.has(key),
      justPressed: () => false,
      justReleased: () => false,
      pointer: { x: 0, y: 0, buttons: 0 }
    })
  } as unknown as InputApi;

  state.world = world;
  state.renderer = renderer;
  state.camera = camera;
  state.input = input;
  state.stage = asContainer(stage);
  state.marqueeOverlay = asContainer(overlay);
  state.marqueeGraphics = graphics;
  state.started = true;

  const log = makeLog();
  const emit = vi.fn();
  const ctx: EditorSelectionApiContext = { config, state, log, emit };

  return { api: createApi(ctx), ctx, state, stage, layer, overlay, calls, emit, held, alive };
};

/** Build a fake federated pointer event: `global` is canvas-relative (the gizmos precedent). */
const pointerEvent = (
  x: number,
  y: number,
  over: { target?: FakeContainer; buttons?: number } = {}
): FederatedPointerEvent =>
  ({
    global: { x, y },
    buttons: over.buttons ?? 1,
    target: over.target ? asContainer(over.target) : undefined
  }) as unknown as FederatedPointerEvent;

describe("editor-selection — pick — attachMarqueeListener", () => {
  it("returns a no-op detach when there is no stage (headless)", () => {
    const config = makeConfig();
    const state = createState({ global: {}, config });
    const log = makeLog();
    const emit = vi.fn();
    const ctx: EditorSelectionApiContext = { config, state, log, emit };
    expect(() => attachMarqueeListener(ctx)()).not.toThrow();
  });

  it("a sub-threshold empty-space drag never activates, draws nothing, and clears on release", () => {
    const entity = asEntity(1);
    const view = makeFakeContainer({ position: { x: 0, y: 0 } });
    const harness = startedMarqueeCtx({}, new Map([[entity, view]]));
    harness.api.select(entity);
    harness.emit.mockClear();
    const detach = attachMarqueeListener(harness.ctx);

    const empty = makeFakeContainer(); // unstamped → empty space
    harness.stage.emit("pointerdown", pointerEvent(0, 0, { target: empty }));
    harness.stage.emit("globalpointermove", pointerEvent(2, 1)); // hypot ≈ 2.24 < MARQUEE_THRESHOLD

    expect(harness.state.marquee?.active).toBe(false);
    expect(harness.calls.clear).toBe(0); // nothing drawn below the threshold

    harness.stage.emit("pointerup", pointerEvent(2, 1));

    expect(harness.api.selected()).toEqual([]); // sub-threshold release == an empty click
    expect(harness.emit).toHaveBeenCalledWith("editor-selection:changed", { selected: [] });
    expect(harness.state.marquee).toBeUndefined();
    detach();
  });

  it("a past-threshold drag activates, draws the dashed rect, and selectInRects the world rect on release", () => {
    const inside = asEntity(1);
    const outside = asEntity(2);
    const harness = startedMarqueeCtx(
      {},
      new Map([
        [
          inside,
          makeFakeContainer({
            position: { x: 5, y: 5 },
            bounds: { x: 0, y: 0, width: 10, height: 10 }
          })
        ],
        [
          outside,
          makeFakeContainer({
            position: { x: 500, y: 500 },
            bounds: { x: 0, y: 0, width: 10, height: 10 }
          })
        ]
      ])
    );
    const detach = attachMarqueeListener(harness.ctx);

    const empty = makeFakeContainer();
    harness.stage.emit("pointerdown", pointerEvent(0, 0, { target: empty }));
    harness.stage.emit("globalpointermove", pointerEvent(40, 40));

    expect(harness.state.marquee?.active).toBe(true);
    expect(harness.calls.clear).toBeGreaterThan(0);
    expect(harness.calls.stroke).toBeGreaterThan(0); // the dashed outline is stroked

    harness.stage.emit("pointerup", pointerEvent(40, 40));

    expect(harness.api.selected()).toEqual([inside]);
    expect(harness.emit).toHaveBeenCalledWith("editor-selection:changed", { selected: [inside] });
    expect(harness.state.marquee).toBeUndefined();
    detach();
  });

  it("normalizes a drag that travels up-left into a positive-extent world rect", () => {
    const entity = asEntity(1);
    const harness = startedMarqueeCtx(
      {},
      new Map([
        [
          entity,
          makeFakeContainer({
            position: { x: 5, y: 5 },
            bounds: { x: 0, y: 0, width: 10, height: 10 }
          })
        ]
      ])
    );
    const detach = attachMarqueeListener(harness.ctx);

    harness.stage.emit("pointerdown", pointerEvent(40, 40, { target: makeFakeContainer() }));
    harness.stage.emit("globalpointermove", pointerEvent(0, 0)); // drags back toward the origin
    harness.stage.emit("pointerup", pointerEvent(0, 0));

    expect(harness.api.selected()).toEqual([entity]);
    detach();
  });

  it("an entity-space pointerdown never starts a marquee (the pick listener owns that click)", () => {
    const entity = asEntity(1);
    const view = makeFakeContainer({ position: { x: 0, y: 0 } });
    stampEntity(asContainer(view), entity);
    const harness = startedMarqueeCtx({}, new Map([[entity, view]]));
    const detach = attachMarqueeListener(harness.ctx);

    harness.stage.emit("pointerdown", pointerEvent(0, 0, { target: view }));

    expect(harness.state.marquee).toBeUndefined();
    detach();
  });

  it("a non-primary press never starts a marquee", () => {
    const harness = startedMarqueeCtx();
    const detach = attachMarqueeListener(harness.ctx);

    harness.stage.emit(
      "pointerdown",
      pointerEvent(0, 0, { target: makeFakeContainer(), buttons: 0b10 })
    );

    expect(harness.state.marquee).toBeUndefined();
    detach();
  });

  it("UNIONS into the current selection when the toggle modifier is held for the gesture", () => {
    const previous = asEntity(1);
    const hit = asEntity(2);
    const harness = startedMarqueeCtx(
      {},
      new Map([
        [
          previous,
          makeFakeContainer({
            position: { x: 500, y: 500 },
            bounds: { x: 0, y: 0, width: 10, height: 10 }
          })
        ],
        [
          hit,
          makeFakeContainer({
            position: { x: 5, y: 5 },
            bounds: { x: 0, y: 0, width: 10, height: 10 }
          })
        ]
      ])
    );
    harness.api.select(previous);
    const detach = attachMarqueeListener(harness.ctx);

    harness.held.add("Control");
    harness.stage.emit("pointerdown", pointerEvent(0, 0, { target: makeFakeContainer() }));
    harness.stage.emit("globalpointermove", pointerEvent(40, 40));
    harness.stage.emit("pointerup", pointerEvent(40, 40));

    expect(new Set(harness.api.selected())).toEqual(new Set([previous, hit]));
    detach();
  });

  it("UNIONS when config.multiSelect is on even with no modifier held", () => {
    const previous = asEntity(1);
    const hit = asEntity(2);
    const harness = startedMarqueeCtx(
      { multiSelect: true },
      new Map([
        [
          previous,
          makeFakeContainer({
            position: { x: 500, y: 500 },
            bounds: { x: 0, y: 0, width: 10, height: 10 }
          })
        ],
        [
          hit,
          makeFakeContainer({
            position: { x: 5, y: 5 },
            bounds: { x: 0, y: 0, width: 10, height: 10 }
          })
        ]
      ])
    );
    harness.api.select(previous);
    const detach = attachMarqueeListener(harness.ctx);

    harness.stage.emit("pointerdown", pointerEvent(0, 0, { target: makeFakeContainer() }));
    harness.stage.emit("globalpointermove", pointerEvent(40, 40));
    harness.stage.emit("pointerup", pointerEvent(40, 40));

    expect(new Set(harness.api.selected())).toEqual(new Set([previous, hit]));
    detach();
  });

  it("REPLACES the selection with no modifier and multiSelect off", () => {
    const previous = asEntity(1);
    const hit = asEntity(2);
    const harness = startedMarqueeCtx(
      {},
      new Map([
        [
          previous,
          makeFakeContainer({
            position: { x: 500, y: 500 },
            bounds: { x: 0, y: 0, width: 10, height: 10 }
          })
        ],
        [
          hit,
          makeFakeContainer({
            position: { x: 5, y: 5 },
            bounds: { x: 0, y: 0, width: 10, height: 10 }
          })
        ]
      ])
    );
    harness.api.select(previous);
    const detach = attachMarqueeListener(harness.ctx);

    harness.stage.emit("pointerdown", pointerEvent(0, 0, { target: makeFakeContainer() }));
    harness.stage.emit("globalpointermove", pointerEvent(40, 40));
    harness.stage.emit("pointerup", pointerEvent(40, 40));

    expect(harness.api.selected()).toEqual([hit]);
    detach();
  });

  it("maps ALL FOUR screen corners under a rotated camera, not just the dragged diagonal", () => {
    // A 45° camera: screenToWorld rotates the screen point, so an axis-aligned screen drag maps to
    // a DIAMOND in world space. The two dragged diagonal corners (0,0) & (40,40) both land on the
    // world y-axis (x == 0), so building the world rect from only those two corners yields a
    // degenerate zero-width strip that misses an entity sitting off-axis inside the real dragged
    // region — the rotated-camera bug. The correct four-corner AABB spans the diamond's full
    // x-extent and includes it. (With rotation 0 both mappings coincide, so the other marquee
    // tests — identity camera — still pin the un-rotated behaviour.)
    const rot = Math.PI / 4;
    const cos = Math.cos(rot);
    const sin = Math.sin(rot);

    const hit = asEntity(1);
    const harness = startedMarqueeCtx(
      {},
      new Map([
        [
          hit,
          makeFakeContainer({
            position: { x: 20, y: 20 },
            bounds: { x: 0, y: 0, width: 10, height: 10 }
          })
        ]
      ])
    );
    (harness.state.camera as unknown as { screenToWorld(p: Point): Point }).screenToWorld = (
      p: Point
    ) => ({ x: p.x * cos - p.y * sin, y: p.x * sin + p.y * cos });
    const detach = attachMarqueeListener(harness.ctx);

    harness.stage.emit("pointerdown", pointerEvent(0, 0, { target: makeFakeContainer() }));
    harness.stage.emit("globalpointermove", pointerEvent(40, 40));
    harness.stage.emit("pointerup", pointerEvent(40, 40));

    expect(harness.api.selected()).toEqual([hit]);
    detach();
  });

  it("finalizes on pointerupoutside too (the pointer left the canvas mid-drag)", () => {
    const hit = asEntity(1);
    const harness = startedMarqueeCtx(
      {},
      new Map([
        [
          hit,
          makeFakeContainer({
            position: { x: 5, y: 5 },
            bounds: { x: 0, y: 0, width: 10, height: 10 }
          })
        ]
      ])
    );
    const detach = attachMarqueeListener(harness.ctx);

    harness.stage.emit("pointerdown", pointerEvent(0, 0, { target: makeFakeContainer() }));
    harness.stage.emit("globalpointermove", pointerEvent(40, 40));
    harness.stage.emit("pointerupoutside", pointerEvent(40, 40));

    expect(harness.api.selected()).toEqual([hit]);
    expect(harness.state.marquee).toBeUndefined();
    detach();
  });

  it("detach() stops the marquee from starting on later stage presses", () => {
    const harness = startedMarqueeCtx();
    const detach = attachMarqueeListener(harness.ctx);
    detach();

    harness.stage.emit("pointerdown", pointerEvent(0, 0, { target: makeFakeContainer() }));
    expect(harness.state.marquee).toBeUndefined();
  });

  it("a drag's move/up listeners are unsubscribed after the gesture ends", () => {
    const harness = startedMarqueeCtx();
    const detach = attachMarqueeListener(harness.ctx);

    harness.stage.emit("pointerdown", pointerEvent(0, 0, { target: makeFakeContainer() }));
    harness.stage.emit("globalpointermove", pointerEvent(40, 40));
    harness.stage.emit("pointerup", pointerEvent(40, 40));

    const drawsAfterGesture = harness.calls.clear;
    harness.stage.emit("globalpointermove", pointerEvent(80, 80)); // stray move after the drag
    expect(harness.calls.clear).toBe(drawsAfterGesture); // no redraw — the listener is gone
    detach();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// enable()/disable() — marquee overlay + listener wiring
// ─────────────────────────────────────────────────────────────────────────────

describe("editor-selection — pick — marquee overlay lifecycle", () => {
  it("enable() shows the marquee overlay and wires the drag; disable() hides it and unwires", () => {
    const harness = startedMarqueeCtx();

    harness.api.enable();
    expect(harness.overlay.visible).toBe(true);
    expect(harness.state.marqueeDetach).toBeDefined();

    harness.api.disable();
    expect(harness.overlay.visible).toBe(false);
    expect(harness.state.marqueeDetach).toBeUndefined();

    harness.stage.emit("pointerdown", pointerEvent(0, 0, { target: makeFakeContainer() }));
    expect(harness.state.marquee).toBeUndefined(); // the drag listener is gone
  });

  it("config.marquee:false never wires the drag even with an overlay present", () => {
    const harness = startedMarqueeCtx({ marquee: false });

    harness.api.enable();
    expect(harness.state.marqueeDetach).toBeUndefined();

    harness.stage.emit("pointerdown", pointerEvent(0, 0, { target: makeFakeContainer() }));
    expect(harness.state.marquee).toBeUndefined();
  });

  it("disable() aborts an in-flight marquee WITHOUT selecting and keeps the selection", () => {
    const previous = asEntity(1);
    const hit = asEntity(2);
    const harness = startedMarqueeCtx(
      {},
      new Map([
        [
          previous,
          makeFakeContainer({
            position: { x: 500, y: 500 },
            bounds: { x: 0, y: 0, width: 10, height: 10 }
          })
        ],
        [
          hit,
          makeFakeContainer({
            position: { x: 5, y: 5 },
            bounds: { x: 0, y: 0, width: 10, height: 10 }
          })
        ]
      ])
    );
    harness.api.enable();
    harness.api.select(previous);
    harness.emit.mockClear();

    harness.stage.emit("pointerdown", pointerEvent(0, 0, { target: makeFakeContainer() }));
    harness.stage.emit("globalpointermove", pointerEvent(40, 40));
    expect(harness.state.marquee?.active).toBe(true);

    harness.api.disable();

    expect(harness.state.marquee).toBeUndefined(); // the session is dropped
    expect(harness.api.selected()).toEqual([previous]); // selection kept, nothing marquee-selected
    expect(harness.emit).not.toHaveBeenCalled();
  });

  it("a re-enable does not double-wire the marquee drag", () => {
    const harness = startedMarqueeCtx();

    harness.api.enable();
    harness.api.enable();

    harness.stage.emit("pointerdown", pointerEvent(0, 0, { target: makeFakeContainer() }));
    harness.stage.emit("globalpointermove", pointerEvent(40, 40));
    expect(harness.calls.clear).toBe(1); // one redraw, not one per attached listener
  });
});
