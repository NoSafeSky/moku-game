/**
 * @file mcp plugin — lifecycle (onStart / onStop) and config validation.
 *
 * onStart: validates config; builds the server via transport.ts; registers
 *   tools (tools.ts) and resources (resources.ts); wires a drain system on
 *   the "input" stage and a stats probe on the "render" stage; connects
 *   transports; stores the McpHandle in the module WeakMap keyed on ctx.global.
 *   On any failure, closes whatever opened and rethrows (no half-open server).
 *
 * onStop: reads the handle from the WeakMap via ctx.global (TeardownContext is
 *   { global } only — no state access); calls removeDrainSystem(), removeStatsSystem(),
 *   await handle.close(), set running=false, delete the entry.
 *   Idempotent: a second call is a no-op.
 *
 * validateConfig: exported for unit tests.
 */
import { ecsPlugin } from "../ecs";
import type { Entity, Stage } from "../ecs/types";
import type { inputPlugin } from "../input";
import { loopPlugin } from "../loop";
import { rendererPlugin } from "../renderer";
import { scenePlugin } from "../scene";
import { schedulerPlugin } from "../scheduler";
import { registerResources } from "./resources";
import type { CanvasLike, RendererDep } from "./tools";
import { registerTools } from "./tools";
import { buildMcpHandle } from "./transport";
import type { Config, McpHandle, McpServerLike, State } from "./types";

// ─────────────────────────────────────────────────────────────────────────────
// Module-level WeakMap (mirrors loop's loopRegistry pattern)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Module-level WeakMap: maps each plugin instance's frozen global registry to
 * its McpHandle. Exported so api.ts can read it without a second map.
 */
export const mcpRegistry = new WeakMap<object, McpHandle>();

// ─────────────────────────────────────────────────────────────────────────────
// Structural context types (only fields actually accessed)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Context available in onStart (full PluginContext subset used by this plugin).
 */
type StartContext = {
  /** Resolved mcp configuration. */
  readonly config: Readonly<Config>;
  /** Mcp plugin state (stats are updated by the probe system). */
  readonly state: State;
  /** Global plugin registry — key for the WeakMap. */
  readonly global: object;
  /** Logger from logPlugin. */
  readonly log: {
    /** Log at info level. */
    info(message: string): void;
    /** Log a warning. */
    warn(message: string): void;
    /** Log an error. */
    error(message: string): void;
  };
  /** Require a dependency's API by plugin instance. */
  require: ((plugin: typeof ecsPlugin) => import("../ecs/types").World) &
    ((plugin: typeof schedulerPlugin) => import("../scheduler/types").Api) &
    ((plugin: typeof rendererPlugin) => import("../renderer/types").Api) &
    ((plugin: typeof inputPlugin) => import("../input/types").Api) &
    ((plugin: typeof loopPlugin) => import("../loop/types").Api) &
    ((plugin: typeof scenePlugin) => import("../scene/types").Api);
};

/** Context available in onStop (TeardownContext — global only). */
type StopContext = {
  /** Global plugin registry — key for the WeakMap. */
  readonly global: object;
};

// ─────────────────────────────────────────────────────────────────────────────
// Config validation (exported for unit tests)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Validates the mcp plugin configuration.
 *
 * Throws if `httpAuth === "bearer"` and `bearerToken` is empty — an open bearer
 * endpoint with no token would be an insecure misconfiguration.
 *
 * @param config - Resolved mcp plugin configuration to validate.
 * @throws {Error} When bearer auth is enabled without a token.
 * @example
 * ```ts
 * validateConfig(ctx.config); // throws if misconfigured
 * ```
 */
export const validateConfig = (config: Readonly<Config>): void => {
  if (config.httpAuth === "bearer" && config.bearerToken === "") {
    throw new Error(
      "[game] MCP bearer auth requires a non-empty bearerToken.\n  Set config.mcp.bearerToken to a secret string."
    );
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// onStart
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Starts the mcp plugin: validates config, wires drain + stats systems,
 * registers tools and resources, connects transports, stores the handle in
 * the module WeakMap. On any failure, tears down whatever opened and rethrows.
 *
 * @param ctx - Full plugin context providing config, state, global, log, and require.
 * @returns A Promise that resolves once the server is connected.
 * @example
 * ```ts
 * await start(ctx);
 * ```
 */
export const start = async (ctx: StartContext): Promise<void> => {
  // ── 1. Validate config ────────────────────────────────────────────────────
  validateConfig(ctx.config);

  // ── 2. Require dependencies ───────────────────────────────────────────────
  const world = ctx.require(ecsPlugin);
  const scheduler = ctx.require(schedulerPlugin);
  const renderer = ctx.require(rendererPlugin);
  const loop = ctx.require(loopPlugin);
  const scene = ctx.require(scenePlugin);

  // ── 3. Pending mutation queue (drained by the input-stage system) ─────────
  const pending: Array<() => void> = [];

  /**
   * Enqueues a mutation closure to be drained on the next input-stage tick.
   * This keeps all structural ECS ops outside the world's iteration window.
   *
   * @param fn - The mutation to run when the drain system executes.
   * @returns A Promise that resolves with fn's return value after the drain.
   * @example
   * ```ts
   * const id = await enqueueMutation(() => world.spawn());
   * ```
   */
  const enqueueMutation = <T>(fn: () => T): Promise<T> =>
    new Promise(resolve => {
      pending.push(() => {
        resolve(fn());
      });
    });

  // ── 4. MCP-tracked entity set (v1: only entities spawned via MCP tools) ───
  const trackedEntities = new Set<Entity>();

  // ── 5. Drain system: runs on "input" stage, flushes pending mutations ─────

  /**
   * Drain system: splices and runs all pending mutation closures.
   * Registered on the "input" stage so mutations run at the start of each tick.
   *
   * @param _world - ECS world (unused — closures already closed over deps).
   * @param _dt - Delta time (unused — mutations are not time-dependent).
   * @example
   * ```ts
   * // Registered automatically in start() — not called directly.
   * ```
   */
  const drainSystem = (_world: import("../ecs/types").World, _dt: number): void => {
    const batch = pending.splice(0);
    for (const fn of batch) fn();
  };

  const removeDrainSystem = world.addSystem("input" as Stage, drainSystem);

  // ── 6. Stats probe system: runs on "render" stage, updates state.stats ────

  /**
   * Stats probe: increments frame counter and records lastDt and entityCount.
   * entityCount reflects MCP-tracked entities (v1 limitation).
   *
   * @param _world - ECS world (unused here).
   * @param dt - Delta time in seconds for lastDt.
   * @example
   * ```ts
   * // Registered automatically in start() — not called directly.
   * ```
   */
  const statsProbe = (_world: import("../ecs/types").World, dt: number): void => {
    ctx.state.stats.frame += 1;
    ctx.state.stats.lastDt = dt;
    ctx.state.stats.entityCount = trackedEntities.size;
  };

  const removeStatsSystem = world.addSystem("render" as Stage, statsProbe);

  // ── 7. Build tool / resource registrars ───────────────────────────────────

  // Wrap the renderer so its getView() return satisfies CanvasLike | undefined.
  // The renderer's full Api returns HTMLCanvasElement which (without DOM lib) doesn't
  // declare toDataURL. We project to the structural CanvasLike here.

  /**
   * Structural RendererDep wrapper that projects getView() to CanvasLike.
   * Needed because HTMLCanvasElement (without DOM lib) lacks toDataURL.
   */
  const rendererDep: RendererDep = {
    /**
     * Returns the canvas-like view, projecting HTMLCanvasElement to CanvasLike.
     *
     * @returns The canvas-like element or undefined if renderer not started.
     * @example
     * ```ts
     * const view = rendererDep.getView(); // CanvasLike | undefined
     * ```
     */
    getView(): CanvasLike | undefined {
      const view = renderer.getView();
      if (!view) return undefined;
      // HTMLCanvasElement always has toDataURL at runtime; cast to CanvasLike here.
      return view as unknown as CanvasLike;
    }
  };

  /**
   * Registers all tools on the given server instance.
   *
   * @param server - Structural MCP server interface.
   * @example
   * ```ts
   * registerAllTools(serverLike);
   * ```
   */
  const registerAllTools = (server: McpServerLike): void => {
    registerTools(
      server,
      { world, loop, scene, renderer: rendererDep, trackedEntities },
      { enableMutations: ctx.config.enableMutations, enqueueMutation }
    );
  };

  /**
   * Registers all resources on the given server instance.
   *
   * @param server - Structural MCP server interface.
   * @example
   * ```ts
   * registerAllResources(serverLike);
   * ```
   */
  const registerAllResources = (server: McpServerLike): void => {
    registerResources(server, {
      scene,
      scheduler,
      trackedEntities,
      /**
       * Returns a snapshot of the current frame stats.
       *
       * @returns A shallow copy of the current stats object.
       * @example
       * ```ts
       * const stats = getStats(); // { frame, lastDt, entityCount }
       * ```
       */
      getStats: () => ({ ...ctx.state.stats })
    });
  };

  // ── 8. Build handle (connects transports inside buildMcpHandle) ───────────
  let handle: McpHandle;
  try {
    handle = await buildMcpHandle({
      config: ctx.config,
      registerAllTools,
      registerAllResources,
      pending,
      removeDrainSystem,
      removeStatsSystem
    });
  } catch (error) {
    // On failure: remove systems (prevent dangling drain / stats probe)
    removeDrainSystem();
    removeStatsSystem();
    throw error;
  }

  // ── 9. Store in WeakMap so api.ts and onStop can reach it ─────────────────
  mcpRegistry.set(ctx.global, handle);

  ctx.log.info(`[mcp] server connected (transports: ${ctx.config.transports.join(", ")})`);
};

// ─────────────────────────────────────────────────────────────────────────────
// onStop
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Stops the mcp plugin: removes the drain and stats systems, closes the MCP
 * server and any HTTP listener, and deletes the WeakMap entry.
 *
 * Reads teardown data from the module WeakMap via ctx.global because onStop
 * only receives TeardownContext ({ global }) — state is not accessible.
 * Idempotent: a second call with the same ctx.global is a safe no-op.
 *
 * @param ctx - Teardown context providing only the global registry.
 * @returns A Promise that resolves once teardown is complete.
 * @example
 * ```ts
 * await stop(ctx);
 * ```
 */
export const stop = async (ctx: StopContext): Promise<void> => {
  const handle = mcpRegistry.get(ctx.global);
  if (!handle) return;

  // Remove tick systems first so no more pending mutations accumulate
  handle.removeDrainSystem();
  handle.removeStatsSystem();

  try {
    // Close server + transports
    await handle.close();
  } finally {
    // Always mark stopped and drop the WeakMap entry — even if close() throws —
    // so isRunning() can't report a zombie server and a retry stop is a no-op.
    handle.running = false;
    mcpRegistry.delete(ctx.global);
  }
};
