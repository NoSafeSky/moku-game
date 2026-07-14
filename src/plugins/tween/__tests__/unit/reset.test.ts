/**
 * @file tween plugin — unit tests for the editor-cycle `reset()` delta.
 *
 * `reset()` clears all transient tween runtime (killAll semantics): settle + drop every active
 * tween (no `onComplete`), leaving `started` true and `nextId` un-rewound.
 */
import { describe, expect, it, vi } from "vitest";
import { createApi, type TweenApiContext } from "../../api";
import { createState } from "../../state";
import type { Config } from "../../types";

const makeConfig = (): Config => ({
  defaultDuration: 0.3,
  defaultEasing: "easeOutCubic",
  updateStage: "update",
  maxActive: 2048
});

const makeLog = () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() });

/** A STARTED tween api context. */
const startedCtx = () => {
  const config = makeConfig();
  const state = createState({ global: {}, config });
  state.started = true;
  const log = makeLog();
  const ctx: TweenApiContext = { config, state, log };
  return { api: createApi(ctx), state, log };
};

describe("tween — reset()", () => {
  it("settles and drops every active tween; started + nextId are preserved", async () => {
    const { api, state } = startedCtx();
    const target = { x: 0 };
    const h1 = api.to(target, { x: 10 }, { duration: 1 });
    const h2 = api.to(target, { x: 20 }, { duration: 1 });
    expect(api.count()).toBe(2);
    const nextIdBefore = state.nextId;

    api.reset();

    expect(api.count()).toBe(0);
    expect(state.tweens.size).toBe(0);
    expect(state.started).toBe(true); // stays started (unlike a teardown)
    expect(state.nextId).toBe(nextIdBefore); // not rewound
    expect(h1.active).toBe(false);
    await expect(h1.done).resolves.toBeUndefined(); // done settled by reset
    await expect(h2.done).resolves.toBeUndefined();
  });

  it("does NOT fire onComplete on the dropped tweens", () => {
    const { api } = startedCtx();
    const onComplete = vi.fn();
    api.to({ x: 0 }, { x: 1 }, { duration: 1, onComplete });

    api.reset();

    expect(onComplete).not.toHaveBeenCalled();
  });

  it("is a no-op on an empty registry", () => {
    const { api } = startedCtx();
    expect(() => api.reset()).not.toThrow();
    expect(api.count()).toBe(0);
  });
});
