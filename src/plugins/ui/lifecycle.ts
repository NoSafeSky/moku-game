/**
 * @file ui plugin — onStart lifecycle wiring.
 *
 * `start` runs after renderer/scheduler/input have started (guaranteed by `depends`
 * order) to (1) capture `renderer.getStage()` and — when a stage exists — build the
 * UI root Container and add it over the game entities, and (2) register the pointer
 * hit-test system in the `"update"` stage.
 *
 * This is deps-ready wiring — the renderer/vfx onStart shape — NOT a per-frame or
 * resource-owning path. There is no onStop: every Pixi object ui builds is parented
 * under the renderer-owned stage, so the renderer disposes the whole subtree; in-run
 * disposal is the API's job, and ui's own state is plain GC-able data.
 *
 * **Headless-safe:** the hit-test system is always registered; with no stage the root
 * is never created, so the system and every API method are guarded no-ops.
 */
import { inputPlugin } from "../input";
import type { Api as InputApi } from "../input/types";
import { rendererPlugin } from "../renderer";
import type { Api as RendererApi } from "../renderer/types";
import { schedulerPlugin } from "../scheduler";
import type { Api as SchedulerApi } from "../scheduler/types";
import { createHitTestSystem } from "./system";
import type { State } from "./types";
import { createRoot } from "./widgets";

/**
 * Structural context required by {@link start}. Only the fields onStart accesses, so
 * unit tests can pass a minimal mock without wiring the full kernel.
 */
export type StartContext = {
  /** ui plugin state (mutated to store the built root). */
  readonly state: State;
  /** Require a dependency's API by plugin instance (`renderer` / `scheduler` / `input`). */
  require: ((plugin: typeof rendererPlugin) => RendererApi) &
    ((plugin: typeof schedulerPlugin) => SchedulerApi) &
    ((plugin: typeof inputPlugin) => InputApi);
};

/**
 * Starts the ui plugin: captures the renderer stage (building the UI root over it
 * when present) and registers the pointer hit-test system. Runs identically headless
 * — with no stage the root stays undefined and the system no-ops.
 *
 * @param ctx - Structural start context (state + require).
 * @example
 * ```ts
 * start(ctx); // after renderer/scheduler/input have started
 * ```
 */
export const start = (ctx: StartContext): void => {
  const renderer = ctx.require(rendererPlugin);
  const scheduler = ctx.require(schedulerPlugin);
  const input = ctx.require(inputPlugin);

  // (1) Capture the stage; when present, build the UI root and draw it over the game.
  const stage = renderer.getStage();
  if (stage) {
    const root = createRoot();
    stage.addChild(root);
    ctx.state.root = root;
  }

  // (2) Register the pointer hit-test system (always registered; a no-op when headless).
  scheduler.addSystem("update", createHitTestSystem({ input, state: ctx.state }));
};
