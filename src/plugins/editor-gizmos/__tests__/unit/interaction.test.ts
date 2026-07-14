/**
 * @file editor-gizmos plugin — pointer/drag pipeline unit tests.
 *
 * Uses Pixi-light stubs — plain objects with a tiny `on`/`off`/`emit` event-emitter for
 * the handle's axis children + the stage, and a `position`/`x`/`y` fake for the entity
 * view and handle — cast to the relevant Pixi type, mirroring `editor-selection`'s
 * `pick.test.ts` fakes. A controllable stub `camera.screenToWorld` scripts world points
 * per call so the anti-drift discipline (recomputed fresh on every event) is provable.
 */
import type { FederatedPointerEvent } from "pixi.js";
import { describe, expect, it, vi } from "vitest";
import type { Api as CameraApi, Point } from "../../../camera/types";
import type { Api as CommandsApi, EditorId } from "../../../commands/types";
import type { Entity } from "../../../ecs/types";
import type { Api as EditorSelectionApi } from "../../../editor-selection/types";
import type { Api as RendererApi } from "../../../renderer/types";
import type { GizmosApiContext } from "../../api";
import { type AxisChild, abortDrag, attachInteraction } from "../../interaction";
import { createState } from "../../state";
import type { Config, GizmoAxis, State } from "../../types";

const asEntity = (n: number): Entity => n as Entity;
const asEditorId = (n: number): EditorId => n as EditorId;

// ─────────────────────────────────────────────────────────────────────────────
// Pixi-light fakes
// ─────────────────────────────────────────────────────────────────────────────

type Listener = (event: unknown) => void;

type FakeEmitter = {
  on: (event: string, fn: Listener) => void;
  off: (event: string, fn: Listener) => void;
  emit: (event: string, payload: unknown) => void;
};

const makeEmitter = (): FakeEmitter => {
  const listeners = new Map<string, Set<Listener>>();
  return {
    on(event, fn) {
      const set = listeners.get(event) ?? new Set<Listener>();
      set.add(fn);
      listeners.set(event, set);
    },
    off(event, fn) {
      listeners.get(event)?.delete(fn);
    },
    emit(event, payload) {
      // Snapshot into a fresh Set so a handler that removes itself mid-emit cannot skip others.
      for (const fn of new Set(listeners.get(event))) fn(payload);
    }
  };
};

type FakeAxisView = FakeEmitter & { eventMode: string };
const makeAxisView = (): FakeAxisView => ({ eventMode: "none", ...makeEmitter() });

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

type FakeHandle = { visible: boolean; position: FakePosition };
const makeFakeHandle = (): FakeHandle => {
  const self = { x: 0, y: 0 };
  return { visible: false, position: makeFakePosition(self) };
};

const pointerEvent = (global: Point): FederatedPointerEvent =>
  ({ global }) as unknown as FederatedPointerEvent;

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

/** A camera stub whose `screenToWorld` returns each `points` entry in call order, then repeats the last. */
const scriptedCamera = (points: readonly Point[]) => {
  let index = 0;
  const screenToWorld = vi.fn((_p: Point) => {
    const point = points[Math.min(index, points.length - 1)];
    index += 1;
    return point;
  });
  const camera = {
    screenToWorld,
    worldToScreen: (p: Point) => p
  } as unknown as CameraApi;
  return { camera, screenToWorld };
};

// ─────────────────────────────────────────────────────────────────────────────
// Test rig — wires attachInteraction against fakes; returns everything for assertions
// ─────────────────────────────────────────────────────────────────────────────

const setupDrag = (options: {
  configOver?: Partial<Config>;
  cameraPoints: readonly Point[];
  withGestureSink?: boolean;
}) => {
  const entity = asEntity(42);
  const editorId = asEditorId(42);
  const config = makeConfig(options.configOver);
  const state = createState({ global: {}, config });
  const { camera, screenToWorld } = scriptedCamera(options.cameraPoints);
  const view = makeFakeView(50, 60);
  const handle = makeFakeHandle();
  const stage = { ...makeEmitter() };
  const markDirty = vi.fn();
  const apply = vi.fn();
  const editorIdOf = vi.fn(() => editorId);
  const applyTracked = vi.fn();
  const begin = vi.fn();
  const end = vi.fn();

  state.started = true;
  state.enabled = true;
  state.stage = stage as unknown as State["stage"];
  state.handle = handle as unknown as State["handle"];
  state.camera = camera;
  state.selection = { selected: () => [entity] } as unknown as EditorSelectionApi;
  state.renderer = {
    getEntityView: () => view,
    markDirty
  } as unknown as RendererApi;
  state.commands = { apply, editorIdOf } as unknown as CommandsApi;
  if (options.withGestureSink) state.gestureSink = { begin, applyTracked, end };

  const square = makeAxisView();
  const xArrow = makeAxisView();
  const yArrow = makeAxisView();
  const axisChildren: AxisChild[] = [
    { view: square as unknown as AxisChild["view"], axis: "xy" },
    { view: xArrow as unknown as AxisChild["view"], axis: "x" },
    { view: yArrow as unknown as AxisChild["view"], axis: "y" }
  ];

  const ctx: GizmosApiContext = { config, state, log: makeLog() };
  attachInteraction(ctx, axisChildren);

  const axisView = (axis: GizmoAxis): FakeAxisView => {
    if (axis === "xy") return square;
    if (axis === "x") return xArrow;
    return yArrow;
  };

  return {
    ctx,
    state,
    stage,
    view,
    handle,
    apply,
    applyTracked,
    begin,
    end,
    markDirty,
    screenToWorld,
    down: (axis: GizmoAxis, global: Point) =>
      axisView(axis).emit("pointerdown", pointerEvent(global)),
    move: (global: Point) => stage.emit("globalpointermove", pointerEvent(global)),
    up: (global: Point) => stage.emit("pointerup", pointerEvent(global))
  };
};

// ─────────────────────────────────────────────────────────────────────────────
// Screen delta → world delta → command
// ─────────────────────────────────────────────────────────────────────────────

describe("editor-gizmos — interaction — xy drag commits both x and y", () => {
  it("commits setField x and y equal to start + (currentWorld - originWorld)", () => {
    const rig = setupDrag({
      cameraPoints: [
        { x: 100, y: 100 }, // pointerdown → originWorld
        { x: 130, y: 125 }, // pointermove
        { x: 130, y: 125 } // pointerup — same projection as the last move
      ]
    });

    rig.down("xy", { x: 100, y: 100 });
    rig.move({ x: 130, y: 125 });
    rig.up({ x: 130, y: 125 });

    expect(rig.apply).toHaveBeenCalledWith({
      kind: "setField",
      id: asEditorId(42),
      component: "Transform",
      field: "x",
      value: 80 // startX 50 + dx 30
    });
    expect(rig.apply).toHaveBeenCalledWith({
      kind: "setField",
      id: asEditorId(42),
      component: "Transform",
      field: "y",
      value: 85 // startY 60 + dy 25
    });
    expect(rig.apply).toHaveBeenCalledTimes(2);
    expect(rig.state.drag).toBeUndefined();
  });
});

describe("editor-gizmos — interaction — axis-locked drags commit only their axis", () => {
  it("axis 'x' commits only a setField x", () => {
    const rig = setupDrag({
      cameraPoints: [
        { x: 100, y: 100 },
        { x: 130, y: 999 },
        { x: 130, y: 999 }
      ]
    });
    rig.down("x", { x: 100, y: 100 });
    rig.move({ x: 130, y: 999 });
    rig.up({ x: 130, y: 999 });

    expect(rig.apply).toHaveBeenCalledTimes(1);
    expect(rig.apply).toHaveBeenCalledWith(expect.objectContaining({ field: "x", value: 80 }));
  });

  it("axis 'y' commits only a setField y", () => {
    const rig = setupDrag({
      cameraPoints: [
        { x: 100, y: 100 },
        { x: 999, y: 125 },
        { x: 999, y: 125 }
      ]
    });
    rig.down("y", { x: 100, y: 100 });
    rig.move({ x: 999, y: 125 });
    rig.up({ x: 999, y: 125 });

    expect(rig.apply).toHaveBeenCalledTimes(1);
    expect(rig.apply).toHaveBeenCalledWith(expect.objectContaining({ field: "y", value: 85 }));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Gesture coalescing — one drag → one gesture
// ─────────────────────────────────────────────────────────────────────────────

describe("editor-gizmos — interaction — gesture coalescing", () => {
  it("with a sink: begin() once, applyTracked (not commands.apply), end() once", () => {
    const rig = setupDrag({
      cameraPoints: [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 20, y: 0 },
        { x: 20, y: 0 }
      ],
      withGestureSink: true
    });

    rig.down("xy", { x: 0, y: 0 });
    rig.move({ x: 10, y: 0 });
    rig.move({ x: 20, y: 0 });
    rig.up({ x: 20, y: 0 });

    expect(rig.begin).toHaveBeenCalledTimes(1);
    expect(rig.end).toHaveBeenCalledTimes(1);
    expect(rig.applyTracked).toHaveBeenCalledWith(
      expect.objectContaining({ field: "x", value: 70 })
    );
    expect(rig.apply).not.toHaveBeenCalled();
  });

  it("without a sink: commands.apply is used, begin/end are never called", () => {
    const rig = setupDrag({
      cameraPoints: [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 10, y: 0 }
      ]
    });

    rig.down("xy", { x: 0, y: 0 });
    rig.move({ x: 10, y: 0 });
    rig.up({ x: 10, y: 0 });

    expect(rig.apply).toHaveBeenCalled();
    expect(rig.begin).not.toHaveBeenCalled();
    expect(rig.end).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Anti-drift — screenToWorld recomputed fresh on every event
// ─────────────────────────────────────────────────────────────────────────────

describe("editor-gizmos — interaction — anti-drift (never cached)", () => {
  it("invokes screenToWorld on every move/up and commits from the LATEST projection", () => {
    const rig = setupDrag({
      cameraPoints: [
        { x: 0, y: 0 }, // pointerdown
        { x: 5, y: 0 }, // move 1 — simulated camera state A
        { x: 50, y: 0 }, // move 2 — simulated camera state B (a "zoom" change mid-drag)
        { x: 50, y: 0 } // pointerup — same as latest move
      ]
    });

    rig.down("xy", { x: 0, y: 0 });
    rig.move({ x: 5, y: 0 });
    rig.move({ x: 50, y: 0 });
    rig.up({ x: 50, y: 0 });

    expect(rig.screenToWorld).toHaveBeenCalledTimes(4);
    expect(rig.apply).toHaveBeenCalledWith(
      expect.objectContaining({ field: "x", value: 100 }) // startX 50 + latest dx 50
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Snap rounding
// ─────────────────────────────────────────────────────────────────────────────

describe("editor-gizmos — interaction — snap rounding", () => {
  it("commits the snapped multiple when state.snap > 0", () => {
    const rig = setupDrag({
      cameraPoints: [
        { x: 0, y: 0 },
        { x: 37, y: 0 },
        { x: 37, y: 0 }
      ]
    });
    rig.state.snap = 32;

    rig.down("xy", { x: 0, y: 0 });
    rig.move({ x: 37, y: 0 });
    rig.up({ x: 37, y: 0 });

    // startX 50 + dx 37 = 87 → nearest multiple of 32 = 96
    expect(rig.apply).toHaveBeenCalledWith(expect.objectContaining({ field: "x", value: 96 }));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// No-op axis dedupe
// ─────────────────────────────────────────────────────────────────────────────

describe("editor-gizmos — interaction — no-op axis dedupe", () => {
  it("skips a setField for an axis whose snapped target equals its start value", () => {
    const rig = setupDrag({
      cameraPoints: [
        { x: 0, y: 0 },
        { x: 1, y: 0 }, // a tiny move that snaps back to the start value
        { x: 1, y: 0 }
      ]
    });
    // The fixture view's startX is 50 — a multiple of 25, so a 1px move still snaps
    // back to exactly 50 (25 * round(51/25) = 50): the dedupe case.
    rig.state.snap = 25;

    rig.down("x", { x: 0, y: 0 });
    rig.move({ x: 1, y: 0 });
    rig.up({ x: 1, y: 0 });

    expect(rig.apply).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Headless / disabled no-op
// ─────────────────────────────────────────────────────────────────────────────

describe("editor-gizmos — interaction — disabled/headless no-op", () => {
  it("a pointerdown while disabled starts no drag and calls no commands method", () => {
    const rig = setupDrag({ cameraPoints: [{ x: 0, y: 0 }] });
    rig.state.enabled = false;

    rig.down("xy", { x: 0, y: 0 });

    expect(rig.state.drag).toBeUndefined();
    expect(rig.apply).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Abort
// ─────────────────────────────────────────────────────────────────────────────

describe("editor-gizmos — interaction — abortDrag", () => {
  it("clears the drag, marks the entity dirty, and issues no commands.apply", () => {
    const rig = setupDrag({
      cameraPoints: [
        { x: 0, y: 0 },
        { x: 40, y: 40 }
      ]
    });

    rig.down("xy", { x: 0, y: 0 });
    rig.move({ x: 40, y: 40 }); // moves chrome only — no ECS write

    expect(rig.state.drag).toBeDefined();
    abortDrag(rig.ctx);

    expect(rig.state.drag).toBeUndefined();
    expect(rig.apply).not.toHaveBeenCalled();
    expect(rig.markDirty).toHaveBeenCalledWith(asEntity(42));
  });

  it("is a no-op when no drag is active", () => {
    const rig = setupDrag({ cameraPoints: [{ x: 0, y: 0 }] });
    expect(() => abortDrag(rig.ctx)).not.toThrow();
    expect(rig.markDirty).not.toHaveBeenCalled();
  });
});
