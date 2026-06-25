/**
 * @file context plugin — onStart lifecycle handler.
 *
 * Binds the well-known resources (Assets, GameContext) onto the ECS world so any
 * system can reach them via `world.resource(token)` during gameplay. This is the
 * only lifecycle hook the context plugin uses — no onInit, no onStop.
 *
 * Binding strategy:
 *   1. Acquire the ECS world via ctx.require(ecsPlugin).
 *   2. Always bind the assets API: world.setResource(Assets, ctx.require(assetsPlugin)).
 *   3. When ctx.config.bindGameContext is true, bind the curated facade:
 *      world.setResource(GameContext, { log: ctx.log, emit: ctx.emit, env: ctx.env }).
 *
 * The curated GameContext intentionally omits ctx.require, ctx.has, and ctx.global
 * so systems have no kernel escape hatch.
 */
import type { EnvApi, LogApi } from "@moku-labs/common";
import type { EmitFn } from "@moku-labs/core";
import type { Events as FrameworkEvents } from "../../config";
import { assetsPlugin } from "../assets";
import type { Api as AssetsApi } from "../assets/types";
import { ecsPlugin } from "../ecs";
import type { World } from "../ecs/types";
import { Assets, GameContext } from "./resources";
import type { Config } from "./types";

// ─────────────────────────────────────────────────────────────────────────────
// Structural context type (only fields start() actually accesses)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Structural view of the full PluginContext consumed by start(). Declares only
 * the fields that start() reads, so the type is forward-compatible with future
 * context additions and is easy to mock in unit tests.
 */
type StartContext = {
  /** Resolved context plugin configuration. */
  readonly config: Readonly<Config>;
  /** Structured logger injected by logPlugin. */
  readonly log: LogApi;
  /** Coarse framework event emitter (assets:loaded | scene:loaded). */
  readonly emit: EmitFn<FrameworkEvents>;
  /** Validated environment accessor injected by envPlugin. */
  readonly env: EnvApi;
  /**
   * Require a dependency's API by plugin reference.
   * Overloaded so each call-site gets the narrowest possible return type.
   */
  require: ((plugin: typeof ecsPlugin) => World) & ((plugin: typeof assetsPlugin) => AssetsApi);
};

// ─────────────────────────────────────────────────────────────────────────────
// onStart
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Binds the Assets and (optionally) GameContext resources onto the ECS world.
 *
 * After this hook returns every system running during gameplay can call
 * `world.resource(app.context.assets)` and `world.resource(app.context.game)`
 * without receiving the "resource is not set" error.
 *
 * @param ctx - Plugin context providing config, log, emit, env, and require.
 * @returns A Promise that resolves once both resources are bound.
 * @example
 * ```ts
 * // Wired automatically by contextPlugin.onStart — do not call directly.
 * await start(ctx);
 * ```
 */
export const start = async (ctx: StartContext): Promise<void> => {
  const world = ctx.require(ecsPlugin);

  // Assets is ALWAYS bound regardless of bindGameContext.
  world.setResource(Assets, ctx.require(assetsPlugin));

  // GameContext is the curated, escape-hatch-free facade for systems.
  if (ctx.config.bindGameContext) {
    world.setResource(GameContext, {
      log: ctx.log,
      emit: ctx.emit,
      env: ctx.env
    });
  }
};
