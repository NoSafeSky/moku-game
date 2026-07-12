/**
 * tween plugin — Standard tier.
 *
 * The shared, ECS-agnostic tweening layer: `to`/`from` mutate the numeric props of
 * any plain object over time with easing; `value` drives a scalar `onUpdate`; each
 * tween supports delay / repeat / yoyo and returns an opaque `TweenHandle` with a
 * `done` Promise. Re-exposes the canonical easing table + `lerp` (`app.tween.easing`
 * / `app.tween.lerp`). One scheduler `"update"`-stage system advances all tweens by
 * `dt`, so a paused loop freezes every tween for free. Emits no events. Depends on
 * `scheduler` only. No new package dependency (pure math + scheduler).
 *
 * @see README.md
 */
import { createPlugin } from "../../config";
import { schedulerPlugin } from "../scheduler";
import { createAdvanceSystem } from "./advance";
import { createApi } from "./api";
import { createState } from "./state";
import type { Config } from "./types";

const defaultConfig: Config = {
  defaultDuration: 0.3,
  defaultEasing: "easeOutCubic",
  updateStage: "update",
  maxActive: 2048
};

/**
 * tween plugin instance — Standard tier.
 *
 * Registered after `ui` and before `mcp`. Its only dependency edge is `scheduler`
 * (a real edge — onStart's `addSystem`); it does NOT depend on `ecs`/`renderer`/
 * `loop`. No new package dependency.
 *
 * @see README.md
 */
export const tweenPlugin = createPlugin("tween", {
  depends: [schedulerPlugin],
  config: defaultConfig,
  createState,
  api: createApi,
  /**
   * Deps-ready wiring only: after `scheduler` has started, register the single
   * advance system on `config.updateStage` and flip `started` so the API creators
   * leave their before-start no-op guard.
   *
   * `@no-resource-check` — owns no external resource (no timer/listener/handle);
   * tweens are plain GC-able data in state, so there is deliberately NO onStop (the
   * vfx precedent).
   *
   * @param ctx - Plugin execution context (config, state, require).
   * @example
   * ```ts
   * // Called automatically by the framework during app.start()
   * ```
   */
  onStart: ctx => {
    ctx
      .require(schedulerPlugin)
      .addSystem(ctx.config.updateStage, createAdvanceSystem({ state: ctx.state }));
    ctx.state.started = true;
  }
});
