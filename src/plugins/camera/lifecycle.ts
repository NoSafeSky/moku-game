/**
 * @file camera plugin — onStart lifecycle wiring.
 *
 * `start` runs after `renderer` / `scheduler` / `tween` have started (guaranteed by
 * `depends`) to (1) capture the tween API and seed `zoom` from config, (2) capture
 * `renderer.getStage()` and — when a stage exists — build the default `world`
 * Container at stage index 0 (below the ui overlay), and (3) register the `"sync"`-stage
 * apply system, then flip `started` so the API leaves its before-start guard.
 *
 * This is deps-ready wiring — the renderer / ui / vfx onStart shape — NOT a per-frame
 * or resource-owning path. There is no onStop: every Container the camera builds is
 * parented under the renderer-owned stage (the renderer disposes the subtree), the
 * apply system holds no external resource, and `state.tween` is a captured reference.
 *
 * **Headless-safe:** with no stage the `world` layer is never created, so the apply
 * system's container writes are guarded no-ops while the numeric state still updates.
 */
import { Container } from "pixi.js";
import { rendererPlugin } from "../renderer";
import type { Api as RendererApi } from "../renderer/types";
import { schedulerPlugin } from "../scheduler";
import type { Api as SchedulerApi } from "../scheduler/types";
import { tweenPlugin } from "../tween";
import type { Api as TweenApi } from "../tween/types";
import { createApplySystem } from "./apply";
import type { Config, State } from "./types";

/**
 * Structural context required by {@link start}. Only the fields onStart accesses, so
 * unit tests can pass a minimal mock without wiring the full kernel.
 */
export type StartContext = {
  /** Resolved camera configuration (seed zoom + apply-system stage). */
  readonly config: Readonly<Config>;
  /** camera plugin state (mutated to store the captured stage / tween / world layer). */
  readonly state: State;
  /** Require a dependency's API by plugin instance (`renderer` / `scheduler` / `tween`). */
  require: ((plugin: typeof rendererPlugin) => RendererApi) &
    ((plugin: typeof schedulerPlugin) => SchedulerApi) &
    ((plugin: typeof tweenPlugin) => TweenApi);
};

/**
 * Starts the camera plugin: captures the tween API + stage, builds the default `world`
 * layer when a stage exists, and registers the apply system. Runs identically headless
 * — with no stage the world layer stays absent and the apply system's container writes
 * no-op, while the numeric camera state still tracks.
 *
 * @param ctx - Structural start context (config + state + require).
 * @example
 * ```ts
 * start(ctx); // after renderer/scheduler/tween have started
 * ```
 */
export const start = (ctx: StartContext): void => {
  // (1) Capture the tween API + seed zoom from config.
  ctx.state.tween = ctx.require(tweenPlugin);
  ctx.state.zoom = ctx.config.zoom;

  // (2) Capture the stage; when present, build the default `world` layer at the BOTTOM
  //     (index 0) so it renders beneath the ui overlay — the HUD stays screen-fixed.
  const stage = ctx.require(rendererPlugin).getStage();
  if (stage) {
    ctx.state.stage = stage;
    const world = new Container();
    stage.addChildAt(world, 0);
    ctx.state.layers.set("world", { container: world, factor: 1 });
  }

  // (3) Register the apply system, then leave the before-start guard.
  ctx
    .require(schedulerPlugin)
    .addSystem(ctx.config.updateStage, createApplySystem({ state: ctx.state, config: ctx.config }));
  ctx.state.started = true;
};
