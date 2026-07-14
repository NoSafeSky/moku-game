/**
 * @file editor-runtime plugin — API unit tests.
 *
 * Drives `createApi` against fresh state and spied dependency fakes resolved through a fake
 * `require` (see `../mock-deps.ts`). Covers: the before-start guard on every mutator + `step`;
 * `enterEdit`'s stage gate + idempotency + emit-on-flip; `enterPlay`'s snapshot/un-gate/loop-start
 * + idempotency; `stop`'s ordered restore-then-reset-then-regate + the outside-play-mode no-op;
 * `step`'s delegation to `loop.step()`; and the mode/isPlaying FSM across a play round-trip.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createApi, type EditorRuntimeApiContext } from "../../api";
import { createState } from "../../state";
import type { Config } from "../../types";
import { EDIT_STAGES, makeLog, makeMockDeps, makeRequire, SENTINEL_SCENE } from "../mock-deps";

// ─────────────────────────────────────────────────────────────────────────────
// Fixtures
// ─────────────────────────────────────────────────────────────────────────────

const defaultConfig: Config = { editStages: EDIT_STAGES };
const ZERO_STEP = { frame: 0, elapsed: 0, dt: 0 };
const STEP_RESULT = { frame: 42, elapsed: 0.7, dt: 1 / 60 };

/** Build a fresh editor-runtime api ctx with mock deps + a spied emit/log. `started` defaults true. */
const makeCtx = (overrides?: { config?: Partial<Config>; started?: boolean }) => {
  const config = { ...defaultConfig, ...overrides?.config };
  const state = createState();
  state.started = overrides?.started ?? true;
  const deps = makeMockDeps(SENTINEL_SCENE, STEP_RESULT);
  const emit = vi.fn();
  const log = makeLog();
  const ctx: EditorRuntimeApiContext = { config, state, log, require: makeRequire(deps), emit };
  return { ctx, state, deps, emit, log, api: createApi(ctx) };
};

beforeEach(() => {
  vi.clearAllMocks();
});

// ─────────────────────────────────────────────────────────────────────────────
// Before-start guard
// ─────────────────────────────────────────────────────────────────────────────

describe("editor-runtime api — before-start guard", () => {
  it("enterEdit warns + no-ops before start", () => {
    const { api, log, deps, emit } = makeCtx({ started: false });
    api.enterEdit();
    expect(deps.scheduler.setActiveStages).not.toHaveBeenCalled();
    expect(emit).not.toHaveBeenCalled();
    expect(log.warn).toHaveBeenCalledWith(
      "[editor-runtime] enterEdit() called before start — no-op."
    );
  });

  it("enterPlay warns + no-ops before start", () => {
    const { api, log, deps, emit } = makeCtx({ started: false });
    api.enterPlay();
    expect(deps.serialization.serialize).not.toHaveBeenCalled();
    expect(deps.loop.start).not.toHaveBeenCalled();
    expect(emit).not.toHaveBeenCalled();
    expect(log.warn).toHaveBeenCalledWith(
      "[editor-runtime] enterPlay() called before start — no-op."
    );
  });

  it("stop warns + no-ops before start", () => {
    const { api, log, deps, emit } = makeCtx({ started: false });
    api.stop();
    expect(deps.commands.restore).not.toHaveBeenCalled();
    expect(emit).not.toHaveBeenCalled();
    expect(log.warn).toHaveBeenCalledWith("[editor-runtime] stop() called before start — no-op.");
  });

  it("step returns a zeroed clock before start, without calling loop.step", () => {
    const { api, deps } = makeCtx({ started: false });
    expect(api.step()).toEqual(ZERO_STEP);
    expect(deps.loop.step).not.toHaveBeenCalled();
  });

  it("mode/isPlaying work before start (read seeded state directly, unguarded)", () => {
    const { api } = makeCtx({ started: false });
    expect(api.mode()).toBe("edit");
    expect(api.isPlaying()).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// enterEdit
// ─────────────────────────────────────────────────────────────────────────────

describe("editor-runtime api — enterEdit", () => {
  it("gates the scheduler to config.editStages", () => {
    const { api, deps } = makeCtx();
    api.enterEdit();
    expect(deps.scheduler.setActiveStages).toHaveBeenCalledWith(EDIT_STAGES);
  });

  it("is idempotent while already in edit mode — re-gates, does not emit", () => {
    const { api, deps, emit } = makeCtx();
    api.enterEdit();
    expect(deps.scheduler.setActiveStages).toHaveBeenCalledTimes(1);
    expect(emit).not.toHaveBeenCalled();
  });

  it("from play mode, flips mode -> edit and emits modeChanged exactly once", () => {
    const { api, emit } = makeCtx();
    api.enterPlay();
    emit.mockClear();

    api.enterEdit();

    expect(api.mode()).toBe("edit");
    expect(emit).toHaveBeenCalledTimes(1);
    expect(emit).toHaveBeenCalledWith("editor-runtime:modeChanged", { mode: "edit" });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// enterPlay
// ─────────────────────────────────────────────────────────────────────────────

describe("editor-runtime api — enterPlay", () => {
  it("snapshots the scene, un-gates to all stages, starts the loop, flips mode, emits once", () => {
    const { api, deps, emit, state } = makeCtx();

    api.enterPlay();

    expect(deps.serialization.serialize).toHaveBeenCalledTimes(1);
    expect(state.preplaySnapshot).toBe(SENTINEL_SCENE);
    expect(deps.scheduler.setActiveStages).toHaveBeenCalledWith(undefined);
    expect(deps.loop.start).toHaveBeenCalledTimes(1);
    expect(api.mode()).toBe("play");
    expect(api.isPlaying()).toBe(true);
    expect(emit).toHaveBeenCalledTimes(1);
    expect(emit).toHaveBeenCalledWith("editor-runtime:modeChanged", { mode: "play" });
  });

  it("a second enterPlay call warns + no-ops (no second snapshot, no second emit)", () => {
    const { api, deps, emit, log } = makeCtx();
    api.enterPlay();
    deps.serialization.serialize.mockClear();
    emit.mockClear();

    api.enterPlay();

    expect(deps.serialization.serialize).not.toHaveBeenCalled();
    expect(emit).not.toHaveBeenCalled();
    expect(log.warn).toHaveBeenCalledWith(
      "[editor-runtime] enterPlay() called while already playing — no-op."
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// stop
// ─────────────────────────────────────────────────────────────────────────────

describe("editor-runtime api — stop", () => {
  it("restores then resets tween/vfx/camera IN ORDER, then re-gates, clears snapshot, flips mode, emits once", () => {
    const { api, deps, emit, state } = makeCtx();
    api.enterPlay();
    deps.scheduler.setActiveStages.mockClear();
    emit.mockClear();

    const order: string[] = [];
    deps.commands.restore.mockImplementation(() => order.push("restore"));
    deps.tween.reset.mockImplementation(() => order.push("tween"));
    deps.vfx.reset.mockImplementation(() => order.push("vfx"));
    deps.camera.reset.mockImplementation(() => order.push("camera"));

    api.stop();

    expect(deps.commands.restore).toHaveBeenCalledWith(SENTINEL_SCENE.entities, "exit-play");
    expect(deps.tween.reset).toHaveBeenCalledTimes(1);
    expect(deps.vfx.reset).toHaveBeenCalledTimes(1);
    expect(deps.camera.reset).toHaveBeenCalledTimes(1);
    expect(order).toEqual(["restore", "tween", "vfx", "camera"]);
    expect(deps.scheduler.setActiveStages).toHaveBeenCalledWith(EDIT_STAGES);
    expect(state.preplaySnapshot).toBeUndefined();
    expect(api.mode()).toBe("edit");
    expect(emit).toHaveBeenCalledTimes(1);
    expect(emit).toHaveBeenCalledWith("editor-runtime:modeChanged", { mode: "edit" });
  });

  it("outside play mode, warns + no-ops (no restore, no reset, no emit)", () => {
    const { api, deps, emit, log } = makeCtx();

    api.stop();

    expect(deps.commands.restore).not.toHaveBeenCalled();
    expect(deps.tween.reset).not.toHaveBeenCalled();
    expect(deps.vfx.reset).not.toHaveBeenCalled();
    expect(deps.camera.reset).not.toHaveBeenCalled();
    expect(emit).not.toHaveBeenCalled();
    expect(log.warn).toHaveBeenCalledWith(
      "[editor-runtime] stop() called outside play mode — no-op."
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// step
// ─────────────────────────────────────────────────────────────────────────────

describe("editor-runtime api — step", () => {
  it("delegates to loop.step() and returns exactly what it returned", () => {
    const { api, deps } = makeCtx();
    expect(api.step()).toEqual(STEP_RESULT);
    expect(deps.loop.step).toHaveBeenCalledTimes(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// mode / isPlaying across a play round-trip
// ─────────────────────────────────────────────────────────────────────────────

describe("editor-runtime api — mode/isPlaying across a play round-trip", () => {
  it("tracks edit -> play -> edit", () => {
    const { api } = makeCtx();
    expect(api.mode()).toBe("edit");
    expect(api.isPlaying()).toBe(false);

    api.enterPlay();
    expect(api.mode()).toBe("play");
    expect(api.isPlaying()).toBe(true);

    api.stop();
    expect(api.mode()).toBe("edit");
    expect(api.isPlaying()).toBe(false);
  });
});
