/**
 * @file renderer plugin — onStart / onStop lifecycle handlers.
 *
 * onStart: creates the Pixi Application, calls app.init(...), optionally mounts
 *   the canvas to the DOM, registers the sync system via the scheduler, stores
 *   { app, views } in a module-level WeakMap keyed on ctx.global, and writes
 *   app into state so the API methods can reach it.
 *   On any init failure, calls app.destroy(...) and rethrows (no half-open GPU).
 *
 * onStop: reads { app, views } from the WeakMap via ctx.global (TeardownContext
 *   provides ONLY { global } — state is inaccessible), disposes every managed
 *   Container, destroys the Pixi Application, and deletes the WeakMap entry.
 */
import { Application } from "pixi.js";
import { ecsPlugin } from "../ecs";
import type { World } from "../ecs/types";
import { schedulerPlugin } from "../scheduler";
import { createSyncSystem } from "./sync";
import type { Config, State, TeardownEntry, TransformValue } from "./types";

// ─────────────────────────────────────────────────────────────────────────────
// Module-level WeakMap for teardown (keyed on ctx.global)
// ─────────────────────────────────────────────────────────────────────────────

/** Maps each plugin instance's global registry to its teardown entry. */
const teardownMap = new WeakMap<object, TeardownEntry>();

// ─────────────────────────────────────────────────────────────────────────────
// globalThis structural view (DOM surface — optional so we degrade gracefully
// in a headless/Node runtime where neither property exists)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Structural view of `globalThis` exposing the optional DOM surface the renderer
 * plugin probes — `devicePixelRatio` (resolution fallback) and `document`
 * (mount-selector lookup). Both are optional so the plugin degrades gracefully
 * in a headless / non-browser runtime.
 */
type GlobalWithDom = {
  /** Device pixel ratio for HiDPI canvas resolution. */
  devicePixelRatio?: number;
  /** The DOM document, used to resolve a CSS mount selector. */
  document?: { querySelector(sel: string): { append(node: unknown): void } | undefined };
};

// ─────────────────────────────────────────────────────────────────────────────
// Context types (structural — only fields actually accessed)
// ─────────────────────────────────────────────────────────────────────────────

/** Context available in onStart (full PluginContext). */
type StartContext = {
  /** Resolved renderer configuration. */
  readonly config: Readonly<Config>;
  /** Renderer plugin state (mutated to store app). */
  readonly state: State;
  /** Global plugin registry — key for the WeakMap. */
  readonly global: object;
  /** Logger from logPlugin. */
  readonly log: {
    info: (message: string) => void;
    warn: (message: string) => void;
    error: (message: string) => void;
    debug: (message: string) => void;
  };
  /** Require a dependency's API by plugin instance. */
  require: ((plugin: typeof ecsPlugin) => World) &
    ((plugin: typeof schedulerPlugin) => {
      addSystem: (stage: "sync", system: (world: World, dt: number) => void) => () => void;
    });
};

/** Context available in onStop (TeardownContext — global only). */
type StopContext = {
  /** Global plugin registry — key for the WeakMap. */
  readonly global: object;
};

// ─────────────────────────────────────────────────────────────────────────────
// onStart
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Starts the renderer: initialises a Pixi Application, optionally mounts the
 * canvas, registers the sync system in the scheduler, and stores teardown data
 * in the module WeakMap.
 *
 * On any failure during app.init(), app.destroy() is called and the error is
 * rethrown so no half-open GPU context is left behind.
 *
 * @param ctx - Full plugin context providing config, state, global, log, and require.
 * @returns A Promise that resolves when the Pixi Application is ready.
 * @throws {Error} When Pixi Application initialisation fails.
 * @example
 * ```ts
 * await start(ctx);
 * ```
 */
export const start = async (ctx: StartContext): Promise<void> => {
  const app = new Application();

  try {
    await app.init({
      width: ctx.config.width,
      height: ctx.config.height,
      background: ctx.config.background,
      antialias: ctx.config.antialias,
      autoStart: false,
      resolution: ctx.config.resolution || (globalThis as GlobalWithDom).devicePixelRatio || 1
    });
  } catch (error) {
    app.destroy(true, { children: true, texture: true, textureSource: true });
    throw error;
  }

  if (ctx.config.mount) {
    const target = (globalThis as GlobalWithDom).document?.querySelector(ctx.config.mount);
    if (target) {
      target.append(app.canvas);
    } else {
      ctx.log.warn(
        `[renderer] Mount selector "${ctx.config.mount}" did not match any element.\n  Canvas was not appended to the DOM.`
      );
    }
  }

  // Store app in state so API methods (render, getView, getStage) can reach it
  ctx.state.app = app;

  // Define the Transform component on the ECS world and store it in state so
  // the API getter and sync system share the exact same token instance.
  const world = ctx.require(ecsPlugin);
  const transformToken = world.defineComponent<TransformValue>(() => ({
    x: 0,
    y: 0,
    rotation: 0,
    scaleX: 1,
    scaleY: 1
  }));
  ctx.state.transformToken = transformToken;

  // Register the sync system via the scheduler
  const scheduler = ctx.require(schedulerPlugin);
  scheduler.addSystem(
    "sync",
    createSyncSystem({
      state: ctx.state,
      transformToken,
      world
    })
  );

  // Stash teardown data in the WeakMap (onStop cannot read state)
  teardownMap.set(ctx.global, { app, views: ctx.state.views });
};

// ─────────────────────────────────────────────────────────────────────────────
// onStop
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Stops the renderer: disposes every managed Container, destroys the Pixi
 * Application with full texture/VRAM cleanup, and removes the WeakMap entry.
 *
 * Reads teardown data from the module WeakMap via ctx.global because onStop
 * only receives TeardownContext ({ global }) — state is not accessible.
 *
 * @param ctx - Teardown context providing only the global registry.
 * @returns A Promise that resolves when teardown is complete.
 * @example
 * ```ts
 * await stop(ctx);
 * ```
 */
export const stop = async (ctx: StopContext): Promise<void> => {
  const entry = teardownMap.get(ctx.global);
  if (!entry) return;

  for (const container of entry.views.values()) {
    container.destroy();
  }
  entry.views.clear();

  entry.app.destroy(true, { children: true, texture: true, textureSource: true });

  teardownMap.delete(ctx.global);
};
