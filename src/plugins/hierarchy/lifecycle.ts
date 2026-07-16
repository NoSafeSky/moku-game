/**
 * @file hierarchy plugin — onStart lifecycle wiring.
 *
 * Deps-ready wiring — `@no-resource-check` (no owned external resource). Runs after
 * ecs/renderer/commands/reflection have started (guaranteed by `depends`) to:
 *   1. Define the Node component token and flip the `started` guard.
 *   2. Capture renderer/commands + the renderer's Transform token into a tight closure — the
 *      resolver installed in step 5 runs once per view on every renderer-sync tick, so it must
 *      not call `ctx.require` per invocation.
 *   3. Self-register the Node reflection schema (the `graphics-2d` precedent).
 *   4. Register the sync-stage world-transform system.
 *   5. Inject the world-transform resolver so the renderer positions views in WORLD space.
 *
 * No `onStop`: the Node token and the sync system live on ecs/renderer-owned structures (the
 * world's component registry + system list, the renderer's resolver slot) that are discarded
 * with the app on stop; unwiring them would be dead work on objects about to be collected.
 */
import { commandsPlugin } from "../commands";
import type { Api as CommandsApi } from "../commands/types";
import { ecsPlugin } from "../ecs";
import type { World } from "../ecs/types";
import { reflectionPlugin } from "../reflection";
import type { Api as ReflectionApi } from "../reflection/types";
import { rendererPlugin } from "../renderer";
import type { Api as RendererApi } from "../renderer/types";
import { composeWorldOf } from "./api";
import { buildNodeSchema } from "./schema";
import { createWorldTransformSystem } from "./system";
import type { Config, NodeValue, State } from "./types";

/**
 * Structural context required by {@link start} — only the fields onStart accesses, so tests can
 * exercise it without wiring the full kernel.
 */
export type StartContext = {
  /** Resolved hierarchy configuration (`maxDepth`). */
  readonly config: Readonly<Config>;
  /** hierarchy plugin state (mutated to store the Node token + started flag). */
  readonly state: State;
  /** Require a dependency's API by plugin instance. */
  require: ((plugin: typeof ecsPlugin) => World) &
    ((plugin: typeof rendererPlugin) => RendererApi) &
    ((plugin: typeof commandsPlugin) => CommandsApi) &
    ((plugin: typeof reflectionPlugin) => ReflectionApi);
};

/**
 * Starts the hierarchy plugin: defines the Node component token, self-registers the Node
 * reflection schema, registers the sync-stage world-transform system, and injects the renderer's
 * world-transform resolver.
 *
 * @param ctx - Structural start context (config + state + require).
 * @example
 * ```ts
 * start(ctx); // after ecs/renderer/commands/reflection have started
 * ```
 */
export const start = (ctx: StartContext): void => {
  const world = ctx.require(ecsPlugin);

  // (1) Define the Node token and flip the before-start guard.
  const nodeToken = world.defineComponent<NodeValue>(
    () => ({ parent: undefined, order: 0, name: "", enabled: true }),
    { name: "Node" }
  );
  ctx.state.nodeToken = nodeToken;
  ctx.state.started = true;

  // (2) Capture renderer/commands + the Transform token into a tight closure.
  const renderer = ctx.require(rendererPlugin);
  const commands = ctx.require(commandsPlugin);
  const transformToken = renderer.Transform;

  // (3) Self-register the Node reflection schema.
  const reflection = ctx.require(reflectionPlugin);
  reflection.register("Node", buildNodeSchema(reflection.field));

  // (4) Register the sync-stage world-transform system.
  world.addSystem(
    "sync",
    createWorldTransformSystem({
      renderer,
      commands,
      nodeToken,
      maxDepth: ctx.config.maxDepth
    })
  );

  // (5) Inject the world-transform resolver so the renderer positions views in WORLD space.
  renderer.setWorldTransformResolver(entity =>
    composeWorldOf(
      entity,
      world,
      nodeToken,
      transformToken,
      id => commands.resolve(id),
      ctx.config.maxDepth
    )
  );
};
