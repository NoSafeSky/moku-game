/**
 * @file scheduler plugin — unit tests for the editor-cycle delta:
 *   `setActiveStages` / `activeStages` forward to the ecs world's stage gate.
 */
import { describe, expect, it, vi } from "vitest";

import type { SchedulerContext } from "../../api";
import { createApi } from "../../api";
import type { Stage, World } from "../../types";

// ─── helpers ──────────────────────────────────────────────────

/** A World double exposing the stage-gate methods (plus the always-required addSystem/tick). */
const makeWorldMock = (activeStagesReturn: readonly Stage[] | undefined = undefined) => ({
  addSystem: vi.fn(() => vi.fn()),
  tick: vi.fn(),
  setActiveStages: vi.fn(),
  activeStages: vi.fn(() => activeStagesReturn)
});

/** Build a SchedulerContext whose `require` returns the given world double. */
const createMockCtx = (world: ReturnType<typeof makeWorldMock>): SchedulerContext => ({
  config: { strictStages: true },
  state: {},
  log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  require: vi.fn(() => world as unknown as World)
});

// ─── setActiveStages ──────────────────────────────────────────

describe("createApi — setActiveStages", () => {
  it("forwards an explicit stage list to world.setActiveStages", () => {
    const world = makeWorldMock();
    const api = createApi(createMockCtx(world));

    api.setActiveStages(["input", "sync", "render"]);
    expect(world.setActiveStages).toHaveBeenCalledWith(["input", "sync", "render"]);
  });

  it("forwards undefined (all stages) to world.setActiveStages", () => {
    const world = makeWorldMock();
    const api = createApi(createMockCtx(world));

    api.setActiveStages(undefined);
    expect(world.setActiveStages).toHaveBeenCalledWith(undefined);
  });
});

// ─── activeStages ─────────────────────────────────────────────

describe("createApi — activeStages", () => {
  it("returns undefined (the default) from world.activeStages", () => {
    const world = makeWorldMock(undefined);
    const api = createApi(createMockCtx(world));

    expect(api.activeStages()).toBeUndefined();
    expect(world.activeStages).toHaveBeenCalledOnce();
  });

  it("returns the world's active-stage list", () => {
    const world = makeWorldMock(["input", "sync", "render"]);
    const api = createApi(createMockCtx(world));

    expect(api.activeStages()).toEqual(["input", "sync", "render"]);
  });
});
