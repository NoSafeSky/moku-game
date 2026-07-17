/**
 * @file editor-gizmos plugin — pointer/drag pipeline unit tests.
 *
 * Uses Pixi-light stubs — plain objects with a tiny `on`/`off`/`emit` event-emitter for
 * the handle's axis children + the stage, and a `position`/`x`/`y` fake for the entity
 * view and handle — cast to the relevant Pixi type, mirroring `editor-selection`'s
 * `pick.test.ts` fakes. A controllable stub `camera.screenToWorld` scripts world points
 * per call so the anti-drift discipline (recomputed fresh on every event) is provable.
 *
 * **Phase-1 F3** adds the rotate / scale / rect drags: the fake view grows `rotation` /
 * `scale` / `getLocalBounds`, and the rig seeds `state.mode` / `state.pivot` so each mode's
 * math, its committed `setField` field(s), its snap interpretation, its anti-drift
 * recomputation, and its GestureSink funnelling are asserted per-mode.
 */
import type { FederatedPointerEvent } from "pixi.js";
import { describe, expect, it, vi } from "vitest";
import type { Api as CameraApi, Point } from "../../../camera/types";
import type { Api as CommandsApi, EditorId } from "../../../commands/types";
import type { Entity } from "../../../ecs/types";
import type { Api as EditorSelectionApi } from "../../../editor-selection/types";
import type { Api as RendererApi } from "../../../renderer/types";
import type { GizmosApiContext } from "../../api";
import {
  type AxisChild,
  abortDrag,
  attachInteraction,
  type ModeGroups,
  registerModeGroups,
  syncHandle
} from "../../interaction";
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

/** The view's untransformed local bounds — the "center" pivot / "rect" anchor input. */
type FakeBounds = { x: number; y: number; width: number; height: number };

/**
 * A view standing in for `renderer.getEntityView(entity)`: a world-space `x`/`y` +
 * `position`, plus the `rotation` / `scale` / `getLocalBounds` the rotate/scale/rect drags
 * read at pointerdown and preview onto.
 */
type FakeView = {
  x: number;
  y: number;
  position: FakePosition;
  rotation: number;
  scale: FakePosition;
  getLocalBounds: () => FakeBounds;
};

/** Local bounds centred on the view origin — "pivot" and "center" coincide (the P1 note). */
const CENTRED_BOUNDS: FakeBounds = { x: -10, y: -10, width: 20, height: 20 };
/** Local bounds offset off the view origin — "center" resolves 10 world units down-right of it. */
const OFFSET_BOUNDS: FakeBounds = { x: 0, y: 0, width: 20, height: 20 };

const makeFakeView = (x: number, y: number, bounds: FakeBounds = CENTRED_BOUNDS): FakeView => {
  const self = { x, y };
  const scale = { x: 1, y: 1 };
  return {
    get x() {
      return self.x;
    },
    get y() {
      return self.y;
    },
    position: makeFakePosition(self),
    rotation: 0,
    scale: makeFakePosition(scale),
    getLocalBounds: () => bounds
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
  /** Seed `state.mode` — the mode the drag is captured with at pointerdown. */
  mode?: State["mode"];
  /** Seed `state.pivot` — which anchor `onHandleDown` resolves. */
  pivot?: State["pivot"];
  /** The fixture view's local bounds (drives the "center" pivot / "rect" anchor). */
  bounds?: FakeBounds;
  /** Seed the fixture view's start rotation (radians). */
  startRotation?: number;
  /** Seed the fixture view's start scale. */
  startScale?: { x: number; y: number };
}) => {
  const entity = asEntity(42);
  const editorId = asEditorId(42);
  const config = makeConfig(options.configOver);
  const state = createState({ global: {}, config });
  const { camera, screenToWorld } = scriptedCamera(options.cameraPoints);
  const view = makeFakeView(50, 60, options.bounds);
  if (options.startRotation !== undefined) view.rotation = options.startRotation;
  if (options.startScale) view.scale.set(options.startScale.x, options.startScale.y);
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
  if (options.mode) state.mode = options.mode;
  if (options.pivot) state.pivot = options.pivot;
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

// ─────────────────────────────────────────────────────────────────────────────
// Rotate — one setField Transform rotation, swept about the pivot
//
// The fixture view sits at (50,60), so with the default `pivot: "pivot"` the anchor is
// (50,60): a pointerdown at (60,60) is 10 units along +x of it (a0 = 0) and a move to
// (50,70) is 10 units along +y (a1 = PI/2) — a clean quarter turn.
// ─────────────────────────────────────────────────────────────────────────────

describe("editor-gizmos — interaction — rotate drag", () => {
  it("commits exactly one setField Transform rotation with the swept angle", () => {
    const rig = setupDrag({
      mode: "rotate",
      cameraPoints: [
        { x: 60, y: 60 }, // pointerdown → originWorld (a0 = 0 about the pivot)
        { x: 50, y: 70 }, // pointermove (a1 = PI/2)
        { x: 50, y: 70 } // pointerup
      ]
    });

    rig.down("xy", { x: 60, y: 60 });
    rig.move({ x: 50, y: 70 });
    rig.up({ x: 50, y: 70 });

    expect(rig.apply).toHaveBeenCalledTimes(1);
    expect(rig.apply).toHaveBeenCalledWith({
      kind: "setField",
      id: asEditorId(42),
      component: "Transform",
      field: "rotation",
      value: Math.PI / 2
    });
    expect(rig.state.drag).toBeUndefined();
  });

  it("adds the sweep to the entity's start rotation (read off the view)", () => {
    const rig = setupDrag({
      mode: "rotate",
      startRotation: 1,
      cameraPoints: [
        { x: 60, y: 60 },
        { x: 50, y: 70 },
        { x: 50, y: 70 }
      ]
    });

    rig.down("xy", { x: 60, y: 60 });
    rig.move({ x: 50, y: 70 });
    rig.up({ x: 50, y: 70 });

    expect(rig.apply).toHaveBeenCalledWith(
      expect.objectContaining({ field: "rotation", value: 1 + Math.PI / 2 })
    );
  });

  it("previews on the view during the move without any ECS write", () => {
    const rig = setupDrag({
      mode: "rotate",
      cameraPoints: [
        { x: 60, y: 60 },
        { x: 50, y: 70 }
      ]
    });

    rig.down("xy", { x: 60, y: 60 });
    rig.move({ x: 50, y: 70 });

    expect(rig.view.rotation).toBeCloseTo(Math.PI / 2, 10);
    expect(rig.apply).not.toHaveBeenCalled(); // commit is pointerup-only
  });

  it("writes no x/y/scale setField — only rotation", () => {
    const rig = setupDrag({
      mode: "rotate",
      cameraPoints: [
        { x: 60, y: 60 },
        { x: 50, y: 70 },
        { x: 50, y: 70 }
      ]
    });

    rig.down("xy", { x: 60, y: 60 });
    rig.move({ x: 50, y: 70 });
    rig.up({ x: 50, y: 70 });

    const fields = rig.apply.mock.calls.map(([command]) => (command as { field: string }).field);
    expect(fields).toEqual(["rotation"]);
  });

  it("snaps the committed angle to the nearest multiple of state.snap radians", () => {
    const rig = setupDrag({
      mode: "rotate",
      cameraPoints: [
        { x: 60, y: 60 },
        { x: 51, y: 63 }, // (1,3) about the pivot → a1 = 1.249 rad
        { x: 51, y: 63 }
      ]
    });
    rig.state.snap = Math.PI / 2; // rotate interprets snap as RADIANS

    rig.down("xy", { x: 60, y: 60 });
    rig.move({ x: 51, y: 63 });
    rig.up({ x: 51, y: 63 });

    expect(rig.apply).toHaveBeenCalledWith(
      expect.objectContaining({ field: "rotation", value: Math.PI / 2 })
    );
  });

  it("skips the setField entirely when the swept angle returns to the start rotation", () => {
    const rig = setupDrag({
      mode: "rotate",
      cameraPoints: [
        { x: 60, y: 60 },
        { x: 50, y: 70 },
        { x: 60, y: 60 } // pointerup back at the grab origin → zero net sweep
      ]
    });

    rig.down("xy", { x: 60, y: 60 });
    rig.move({ x: 50, y: 70 });
    rig.up({ x: 60, y: 60 });

    expect(rig.apply).not.toHaveBeenCalled();
  });

  it("anti-drift: recomputes screenToWorld every event and commits the LATEST projection", () => {
    const rig = setupDrag({
      mode: "rotate",
      cameraPoints: [
        { x: 60, y: 60 }, // pointerdown
        { x: 50, y: 70 }, // move 1 — a1 = PI/2
        { x: 40, y: 60 }, // move 2 — a "camera change" mid-drag → a1 = PI
        { x: 40, y: 60 } // pointerup
      ]
    });

    rig.down("xy", { x: 60, y: 60 });
    rig.move({ x: 50, y: 70 });
    rig.move({ x: 40, y: 60 });
    rig.up({ x: 40, y: 60 });

    expect(rig.screenToWorld).toHaveBeenCalledTimes(4);
    expect(rig.apply).toHaveBeenCalledWith(
      expect.objectContaining({ field: "rotation", value: Math.PI })
    );
  });

  it("routes through the gesture sink: one begin, one applyTracked, one end", () => {
    const rig = setupDrag({
      mode: "rotate",
      withGestureSink: true,
      cameraPoints: [
        { x: 60, y: 60 },
        { x: 50, y: 70 },
        { x: 50, y: 70 }
      ]
    });

    rig.down("xy", { x: 60, y: 60 });
    rig.move({ x: 50, y: 70 });
    rig.up({ x: 50, y: 70 });

    expect(rig.begin).toHaveBeenCalledTimes(1);
    expect(rig.applyTracked).toHaveBeenCalledTimes(1);
    expect(rig.applyTracked).toHaveBeenCalledWith(
      expect.objectContaining({ field: "rotation", value: Math.PI / 2 })
    );
    expect(rig.end).toHaveBeenCalledTimes(1);
    expect(rig.apply).not.toHaveBeenCalled(); // no path skips the funnel
  });

  it("aborting mid-rotate commits nothing", () => {
    const rig = setupDrag({
      mode: "rotate",
      cameraPoints: [
        { x: 60, y: 60 },
        { x: 50, y: 70 }
      ]
    });

    rig.down("xy", { x: 60, y: 60 });
    rig.move({ x: 50, y: 70 });
    abortDrag(rig.ctx);

    expect(rig.state.drag).toBeUndefined();
    expect(rig.apply).not.toHaveBeenCalled();
    expect(rig.markDirty).toHaveBeenCalledWith(asEntity(42));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Scale — setField Transform scaleX + scaleY, factor = dist(current,pivot)/dist(origin,pivot)
// ─────────────────────────────────────────────────────────────────────────────

describe("editor-gizmos — interaction — scale drag", () => {
  it("commits scaleX AND scaleY at start scale × the distance factor", () => {
    const rig = setupDrag({
      mode: "scale",
      startScale: { x: 3, y: 4 },
      cameraPoints: [
        { x: 60, y: 60 }, // pointerdown → 10 units from the pivot (50,60)
        { x: 70, y: 60 }, // pointermove → 20 units → factor 2
        { x: 70, y: 60 }
      ]
    });

    rig.down("xy", { x: 60, y: 60 });
    rig.move({ x: 70, y: 60 });
    rig.up({ x: 70, y: 60 });

    expect(rig.apply).toHaveBeenCalledWith({
      kind: "setField",
      id: asEditorId(42),
      component: "Transform",
      field: "scaleX",
      value: 6
    });
    expect(rig.apply).toHaveBeenCalledWith({
      kind: "setField",
      id: asEditorId(42),
      component: "Transform",
      field: "scaleY",
      value: 8
    });
    expect(rig.apply).toHaveBeenCalledTimes(2);
  });

  it("axis 'x' commits only scaleX — the untouched axis is deduped away", () => {
    const rig = setupDrag({
      mode: "scale",
      cameraPoints: [
        { x: 60, y: 60 },
        { x: 70, y: 60 },
        { x: 70, y: 60 }
      ]
    });

    rig.down("x", { x: 60, y: 60 });
    rig.move({ x: 70, y: 60 });
    rig.up({ x: 70, y: 60 });

    expect(rig.apply).toHaveBeenCalledTimes(1);
    expect(rig.apply).toHaveBeenCalledWith(expect.objectContaining({ field: "scaleX", value: 2 }));
  });

  it("axis 'y' commits only scaleY", () => {
    const rig = setupDrag({
      mode: "scale",
      cameraPoints: [
        { x: 60, y: 60 },
        { x: 70, y: 60 },
        { x: 70, y: 60 }
      ]
    });

    rig.down("y", { x: 60, y: 60 });
    rig.move({ x: 70, y: 60 });
    rig.up({ x: 70, y: 60 });

    expect(rig.apply).toHaveBeenCalledTimes(1);
    expect(rig.apply).toHaveBeenCalledWith(expect.objectContaining({ field: "scaleY", value: 2 }));
  });

  it("previews on the view during the move without any ECS write", () => {
    const rig = setupDrag({
      mode: "scale",
      cameraPoints: [
        { x: 60, y: 60 },
        { x: 70, y: 60 }
      ]
    });

    rig.down("xy", { x: 60, y: 60 });
    rig.move({ x: 70, y: 60 });

    expect(rig.view.scale.x).toBe(2);
    expect(rig.view.scale.y).toBe(2);
    expect(rig.apply).not.toHaveBeenCalled(); // commit is pointerup-only
  });

  it("snaps the committed scale to the nearest multiple of state.snap (a factor increment)", () => {
    const rig = setupDrag({
      mode: "scale",
      cameraPoints: [
        { x: 60, y: 60 }, // d0 = 10
        { x: 62, y: 60 }, // d1 = 12 → factor 1.2
        { x: 62, y: 60 }
      ]
    });
    rig.state.snap = 0.25; // scale interprets snap as a FACTOR increment

    rig.down("xy", { x: 60, y: 60 });
    rig.move({ x: 62, y: 60 });
    rig.up({ x: 62, y: 60 });

    expect(rig.apply).toHaveBeenCalledWith(
      expect.objectContaining({ field: "scaleX", value: 1.25 })
    );
    expect(rig.apply).toHaveBeenCalledWith(
      expect.objectContaining({ field: "scaleY", value: 1.25 })
    );
  });

  it("a pointerdown ON the pivot yields factor 1 — no divide-by-zero, no setField", () => {
    const rig = setupDrag({
      mode: "scale",
      cameraPoints: [
        { x: 50, y: 60 }, // pointerdown exactly on the pivot → d0 = 0
        { x: 90, y: 90 },
        { x: 90, y: 90 }
      ]
    });

    rig.down("xy", { x: 50, y: 60 });
    rig.move({ x: 90, y: 90 });
    rig.up({ x: 90, y: 90 });

    expect(rig.apply).not.toHaveBeenCalled(); // factor 1 → scale equals start → deduped
  });

  it("anti-drift: recomputes screenToWorld every event and commits the LATEST projection", () => {
    const rig = setupDrag({
      mode: "scale",
      cameraPoints: [
        { x: 60, y: 60 }, // pointerdown → d0 = 10
        { x: 70, y: 60 }, // move 1 → factor 2
        { x: 80, y: 60 }, // move 2 → factor 3 (a "camera change" mid-drag)
        { x: 80, y: 60 } // pointerup
      ]
    });

    rig.down("xy", { x: 60, y: 60 });
    rig.move({ x: 70, y: 60 });
    rig.move({ x: 80, y: 60 });
    rig.up({ x: 80, y: 60 });

    expect(rig.screenToWorld).toHaveBeenCalledTimes(4);
    expect(rig.apply).toHaveBeenCalledWith(expect.objectContaining({ field: "scaleX", value: 3 }));
  });

  it("routes through the gesture sink: one begin, both applyTracked calls, one end", () => {
    const rig = setupDrag({
      mode: "scale",
      withGestureSink: true,
      cameraPoints: [
        { x: 60, y: 60 },
        { x: 70, y: 60 },
        { x: 70, y: 60 }
      ]
    });

    rig.down("xy", { x: 60, y: 60 });
    rig.move({ x: 70, y: 60 });
    rig.up({ x: 70, y: 60 });

    expect(rig.begin).toHaveBeenCalledTimes(1);
    expect(rig.applyTracked).toHaveBeenCalledTimes(2);
    expect(rig.end).toHaveBeenCalledTimes(1);
    expect(rig.apply).not.toHaveBeenCalled(); // no path skips the funnel
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Pivot anchor — "pivot" (entity position) vs "center" (world-space bounds centre)
//
// With OFFSET_BOUNDS the fixture view's bounds centre is (60,70) — 10 units down-right
// of its (50,60) position — so the two anchors give provably different results.
// ─────────────────────────────────────────────────────────────────────────────

describe("editor-gizmos — interaction — pivot anchor", () => {
  it("pivot 'center' sweeps rotation about the view's world-space bounds centre", () => {
    const rig = setupDrag({
      mode: "rotate",
      pivot: "center",
      bounds: OFFSET_BOUNDS,
      cameraPoints: [
        { x: 70, y: 70 }, // (10,0) about the bounds centre (60,70) → a0 = 0
        { x: 60, y: 80 }, // (0,10) → a1 = PI/2
        { x: 60, y: 80 }
      ]
    });

    rig.down("xy", { x: 70, y: 70 });
    rig.move({ x: 60, y: 80 });
    rig.up({ x: 60, y: 80 });

    expect(rig.apply).toHaveBeenCalledWith(
      expect.objectContaining({ field: "rotation", value: Math.PI / 2 })
    );
  });

  it("pivot 'pivot' sweeps the SAME pointer path about the entity position instead", () => {
    const rig = setupDrag({
      mode: "rotate",
      pivot: "pivot", // the default — anchor is the view position (50,60)
      bounds: OFFSET_BOUNDS,
      cameraPoints: [
        { x: 70, y: 70 },
        { x: 60, y: 80 },
        { x: 60, y: 80 }
      ]
    });

    rig.down("xy", { x: 70, y: 70 });
    rig.move({ x: 60, y: 80 });
    rig.up({ x: 60, y: 80 });

    // atan2(20,10) - atan2(10,20) = 0.6435… — provably NOT the bounds-centre PI/2.
    expect(rig.apply).toHaveBeenCalledWith(
      expect.objectContaining({
        field: "rotation",
        value: expect.closeTo(Math.atan2(20, 10) - Math.atan2(10, 20), 10)
      })
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Rect — the P1 bounding-box tool: uniform scale anchored on the bounds centre
// ─────────────────────────────────────────────────────────────────────────────

describe("editor-gizmos — interaction — rect drag (P1 scale-on-bounds)", () => {
  it("commits scaleX + scaleY anchored on the bounds centre, even with pivot 'pivot'", () => {
    const rig = setupDrag({
      mode: "rect",
      pivot: "pivot", // rect ALWAYS anchors on the bounds centre (60,70)
      bounds: OFFSET_BOUNDS,
      cameraPoints: [
        { x: 70, y: 70 }, // d0 = 10 from the bounds centre
        { x: 80, y: 70 }, // d1 = 20 → factor 2
        { x: 80, y: 70 }
      ]
    });

    rig.down("xy", { x: 70, y: 70 });
    rig.move({ x: 80, y: 70 });
    rig.up({ x: 80, y: 70 });

    // Anchored on (50,60) instead these distances would give factor ~1.414, not 2.
    expect(rig.apply).toHaveBeenCalledWith(expect.objectContaining({ field: "scaleX", value: 2 }));
    expect(rig.apply).toHaveBeenCalledWith(expect.objectContaining({ field: "scaleY", value: 2 }));
    expect(rig.apply).toHaveBeenCalledTimes(2);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// syncHandle — only the active mode's handle sub-composite is shown
// ─────────────────────────────────────────────────────────────────────────────

/** A stand-in for one per-mode handle sub-composite — only `visible` is exercised. */
type FakeGroup = { visible: boolean };

const makeGroups = (): Record<State["mode"], FakeGroup> => ({
  translate: { visible: false },
  rotate: { visible: false },
  scale: { visible: false },
  rect: { visible: false }
});

describe("editor-gizmos — interaction — syncHandle mode groups", () => {
  it("shows only the active mode's sub-composite and hides the rest", () => {
    const rig = setupDrag({ mode: "rotate", cameraPoints: [{ x: 0, y: 0 }] });
    const groups = makeGroups();
    registerModeGroups(rig.state, groups as unknown as ModeGroups);

    syncHandle(rig.ctx);

    expect(groups.rotate.visible).toBe(true);
    expect(groups.translate.visible).toBe(false);
    expect(groups.scale.visible).toBe(false);
    expect(groups.rect.visible).toBe(false);
    expect(rig.handle.visible).toBe(true);
  });

  it("follows a mode change on the next sync", () => {
    const rig = setupDrag({ cameraPoints: [{ x: 0, y: 0 }] });
    const groups = makeGroups();
    registerModeGroups(rig.state, groups as unknown as ModeGroups);

    syncHandle(rig.ctx);
    expect(groups.translate.visible).toBe(true);

    rig.state.mode = "scale";
    syncHandle(rig.ctx);

    expect(groups.scale.visible).toBe(true);
    expect(groups.translate.visible).toBe(false);
  });

  it("is a no-op when no mode groups were registered (the drag-rig / headless path)", () => {
    const rig = setupDrag({ cameraPoints: [{ x: 0, y: 0 }] });
    expect(() => syncHandle(rig.ctx)).not.toThrow();
  });
});
