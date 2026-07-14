/**
 * @file editor-gizmos plugin — API factory unit tests.
 *
 * Uses Pixi-light stubs for the overlay/handle (a plain object exposing `visible` /
 * `eventMode` / `interactiveChildren` / a `position.set`) and stubbed dependency APIs
 * placed directly on `state` (the `camera`/`editor-selection` captured-deps pattern),
 * mirroring `editor-selection`'s `pick.test.ts` fakes.
 */
import { describe, expect, it, vi } from "vitest";
import type { Api as CameraApi, Point } from "../../../camera/types";
import type { Api as CommandsApi, EditorId } from "../../../commands/types";
import type { Entity } from "../../../ecs/types";
import type { Api as EditorSelectionApi } from "../../../editor-selection/types";
import type { Api as RendererApi } from "../../../renderer/types";
import { createApi, type GizmosApiContext } from "../../api";
import { createState } from "../../state";
import type { ActiveDrag, Config, State } from "../../types";

const asEntity = (n: number): Entity => n as Entity;
const asEditorId = (n: number): EditorId => n as EditorId;

// ─────────────────────────────────────────────────────────────────────────────
// Pixi-light fakes
// ─────────────────────────────────────────────────────────────────────────────

type FakePosition = { x: number; y: number; set: (x: number, y: number) => void };

const makeFakePosition = (self: { x: number; y: number }): FakePosition => ({
  get x() {
    return self.x;
  },
  set x(v: number) {
    self.x = v;
  },
  get y() {
    return self.y;
  },
  set y(v: number) {
    self.y = v;
  },
  set(x: number, y: number) {
    self.x = x;
    self.y = y;
  }
});

type FakeContainer = {
  visible: boolean;
  eventMode: string;
  interactiveChildren: boolean;
  position: FakePosition;
};

const makeFakeContainer = (): FakeContainer => {
  const self = { x: 0, y: 0 };
  return {
    visible: false,
    eventMode: "none",
    interactiveChildren: false,
    position: makeFakePosition(self)
  };
};

/** A view standing in for `renderer.getEntityView(entity)` — carries a world-space x/y. */
type FakeView = { x: number; y: number; position: FakePosition };

const makeFakeView = (x: number, y: number): FakeView => {
  const self = { x, y };
  return {
    get x() {
      return self.x;
    },
    get y() {
      return self.y;
    },
    position: makeFakePosition(self)
  };
};

// ─────────────────────────────────────────────────────────────────────────────
// Stubbed dependency APIs
// ─────────────────────────────────────────────────────────────────────────────

const makeConfig = (over: Partial<Config> = {}): Config => ({
  overlayLayer: "editor-gizmos",
  snap: 0,
  translateOnly: true,
  ...over
});

const makeLog = () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() });

const makeCamera = (): CameraApi =>
  ({
    screenToWorld: (p: Point) => p,
    worldToScreen: (p: Point) => p
  }) as unknown as CameraApi;

const makeSelection = (selected: readonly Entity[]): EditorSelectionApi =>
  ({
    selected: () => selected
  }) as unknown as EditorSelectionApi;

const makeRenderer = (views: ReadonlyMap<Entity, FakeView>) => {
  const markDirty = vi.fn();
  const renderer = {
    getEntityView: (entity: Entity) => views.get(entity),
    markDirty
  } as unknown as RendererApi;
  return { renderer, markDirty };
};

const makeCommands = () => {
  const apply = vi.fn();
  const commands = { apply, editorIdOf: () => asEditorId(1) } as unknown as CommandsApi;
  return { commands, apply };
};

/** A STARTED, non-headless ctx: overlay/handle chrome + all four deps captured. */
const startedCtx = (
  configOver: Partial<Config> = {},
  selected: readonly Entity[] = [],
  views: ReadonlyMap<Entity, FakeView> = new Map()
) => {
  const config = makeConfig(configOver);
  const state = createState({ global: {}, config });
  const overlay = makeFakeContainer();
  const handle = makeFakeContainer();
  const { renderer, markDirty } = makeRenderer(views);
  const { commands, apply } = makeCommands();

  state.started = true;
  state.overlay = overlay as unknown as State["overlay"];
  state.handle = handle as unknown as State["handle"];
  state.camera = makeCamera();
  state.selection = makeSelection(selected);
  state.renderer = renderer;
  state.commands = commands;

  const log = makeLog();
  const ctx: GizmosApiContext = { config, state, log };
  const api = createApi(ctx);

  return { api, ctx, state, overlay, handle, log, apply, markDirty };
};

// ─────────────────────────────────────────────────────────────────────────────
// enable() / disable()
// ─────────────────────────────────────────────────────────────────────────────

describe("editor-gizmos — api — enable()/disable() before start / headless", () => {
  it("warns and no-ops before the plugin has started", () => {
    const config = makeConfig();
    const state = createState({ global: {}, config });
    const log = makeLog();
    const api = createApi({ config, state, log });

    api.enable();
    api.disable();

    expect(log.warn).toHaveBeenCalledTimes(2);
    expect(state.enabled).toBe(false);
  });

  it("warns and no-ops on enable() when headless (started, no overlay)", () => {
    const config = makeConfig();
    const state = createState({ global: {}, config });
    state.started = true; // started, but no renderer stage → overlay stayed undefined
    const log = makeLog();
    const api = createApi({ config, state, log });

    api.enable();

    expect(log.warn).toHaveBeenCalled();
    expect(state.enabled).toBe(false);
  });
});

describe("editor-gizmos — api — enable()", () => {
  it("shows the overlay, makes it interactive, and syncs the handle to the selection", () => {
    const entity = asEntity(1);
    const { api, overlay, handle } = startedCtx(
      {},
      [entity],
      new Map([[entity, makeFakeView(10, 20)]])
    );

    api.enable();

    expect(overlay.visible).toBe(true);
    expect(overlay.eventMode).toBe("static");
    expect(overlay.interactiveChildren).toBe(true);
    expect(handle.visible).toBe(true);
    expect(handle.position.x).toBe(10);
    expect(handle.position.y).toBe(20);
  });

  it("hides the handle when nothing is selected", () => {
    const { api, handle } = startedCtx({}, []);
    api.enable();
    expect(handle.visible).toBe(false);
  });

  it("is idempotent — a second enable() re-syncs without error", () => {
    const entity = asEntity(1);
    const { api, handle } = startedCtx({}, [entity], new Map([[entity, makeFakeView(5, 5)]]));
    api.enable();
    expect(() => api.enable()).not.toThrow();
    expect(handle.visible).toBe(true);
  });
});

describe("editor-gizmos — api — disable()", () => {
  it("clears enabled and hides the overlay", () => {
    const { api, overlay } = startedCtx();
    api.enable();
    api.disable();
    expect(overlay.visible).toBe(false);
    expect(overlay.interactiveChildren).toBe(false);
  });

  it("aborts an in-flight drag WITHOUT any commands.apply call, and marks the entity dirty", () => {
    const entity = asEntity(7);
    const { api, state, apply, markDirty } = startedCtx({}, [entity]);
    api.enable();

    const drag: ActiveDrag = {
      entity,
      editorId: asEditorId(7),
      axis: "xy",
      startX: 0,
      startY: 0,
      originWorld: { x: 0, y: 0 }
    };
    state.drag = drag;

    api.disable();

    expect(state.drag).toBeUndefined();
    expect(apply).not.toHaveBeenCalled();
    expect(markDirty).toHaveBeenCalledWith(entity);
  });

  it("is idempotent (safe to call twice; safe before any enable())", () => {
    const { api } = startedCtx();
    expect(() => api.disable()).not.toThrow();
    api.enable();
    api.disable();
    expect(() => api.disable()).not.toThrow();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// setMode / mode / setSnap / setGestureSink
// ─────────────────────────────────────────────────────────────────────────────

describe("editor-gizmos — api — setMode()/mode() MVP guard", () => {
  it("warns and stays translate when translateOnly and mode !== translate", () => {
    const config = makeConfig({ translateOnly: true });
    const state = createState({ global: {}, config });
    const log = makeLog();
    const api = createApi({ config, state, log });

    api.setMode("rotate");
    expect(api.mode()).toBe("translate");
    expect(log.warn).toHaveBeenCalled();

    api.setMode("scale");
    expect(api.mode()).toBe("translate");
  });

  it("allows switching mode once translateOnly is false", () => {
    const config = makeConfig({ translateOnly: false });
    const state = createState({ global: {}, config });
    const api = createApi({ config, state, log: makeLog() });

    api.setMode("rotate");
    expect(api.mode()).toBe("rotate");
  });

  it("works before start and headless (never touches Pixi)", () => {
    const config = makeConfig({ translateOnly: false });
    const state = createState({ global: {}, config });
    const api = createApi({ config, state, log: makeLog() });
    expect(() => api.setMode("scale")).not.toThrow();
    expect(api.mode()).toBe("scale");
  });
});

describe("editor-gizmos — api — setSnap()", () => {
  it("clamps a negative value to 0", () => {
    const config = makeConfig();
    const state = createState({ global: {}, config });
    const api = createApi({ config, state, log: makeLog() });

    api.setSnap(-5);
    expect(state.snap).toBe(0);
  });

  it("sets a positive value as given", () => {
    const config = makeConfig();
    const state = createState({ global: {}, config });
    const api = createApi({ config, state, log: makeLog() });

    api.setSnap(32);
    expect(state.snap).toBe(32);
  });
});

describe("editor-gizmos — api — setGestureSink()", () => {
  it("sets and clears the injected sink", () => {
    const config = makeConfig();
    const state = createState({ global: {}, config });
    const api = createApi({ config, state, log: makeLog() });
    const sink = { begin: vi.fn(), applyTracked: vi.fn(), end: vi.fn() };

    api.setGestureSink(sink);
    expect(state.gestureSink).toBe(sink);

    api.setGestureSink(undefined);
    expect(state.gestureSink).toBeUndefined();
  });
});
