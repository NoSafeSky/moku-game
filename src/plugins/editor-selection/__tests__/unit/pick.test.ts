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
import type { Container, FederatedPointerEvent } from "pixi.js";
import { describe, expect, it, vi } from "vitest";
import type { Api as CameraApi, Point } from "../../../camera/types";
import type { Entity, World } from "../../../ecs/types";
import type { Api as InputApi } from "../../../input/types";
import type { Api as RendererApi } from "../../../renderer/types";
import { createApi, type EditorSelectionApiContext } from "../../api";
import { attachPickListener, entityOf, pickTopmost, stampEntity } from "../../pick";
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
  const input = {
    snapshot: () => ({
      isDown: () => false,
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
