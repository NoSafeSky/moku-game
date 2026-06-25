/**
 * @file renderer plugin — onStart / onStop lifecycle handlers + detectHeadless.
 *
 * onStart: when config.headless is true, logs an info line and skips Pixi
 *   entirely, but still defines the Transform component and registers the sync
 *   system so ECS/scene code works identically in both modes. When not headless,
 *   creates the Pixi Application, calls app.init(...), optionally mounts the
 *   canvas to the DOM, then stores { app, views } in the WeakMap. On any init
 *   failure, calls app.destroy(...) and rethrows (no half-open GPU).
 *
 * onStop: reads { app, views } from the WeakMap via ctx.global (TeardownContext
 *   provides ONLY { global } — state is inaccessible). Disposes every managed
 *   Container. If app is present (non-headless), destroys it with full
 *   texture/VRAM cleanup. Deletes the WeakMap entry. Idempotent.
 *
 * detectHeadless: pure environment probe — returns true when there is no DOM
 *   (typeof document === "undefined"). Does NOT import or touch Pixi.
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
// detectHeadless — pure env probe, no Pixi at module load
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Detects whether the current runtime has no DOM (i.e. is headless).
 *
 * Returns `true` when `document` is not defined on `globalThis` (Bun/Node
 * environments without jsdom). Returns `false` in a browser or jsdom context.
 * This function does NOT import or touch Pixi — it is a pure environment probe
 * suitable for use as a config default computed at module load time.
 *
 * @returns `true` if there is no DOM (`typeof document === "undefined"`), else `false`.
 * @example
 * ```ts
 * const headless = detectHeadless(); // true under Bun/Node, false in browser
 * ```
 */
export const detectHeadless = (): boolean =>
  typeof (globalThis as GlobalWithDom).document === "undefined";

// ─────────────────────────────────────────────────────────────────────────────
// Shared helper — define Transform component and register sync system
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Defines the Transform component on the ECS world, stores the token on state,
 * and registers the sync system via the scheduler. Called in both headless and
 * non-headless paths so ECS/scene code is identical in both modes.
 *
 * @param ctx - Full plugin context providing config, state, global, log, and require.
 * @example
 * ```ts
 * registerTransformAndSync(ctx);
 * ```
 */
const registerTransformAndSync = (ctx: StartContext): void => {
  const world = ctx.require(ecsPlugin);
  const transformToken = world.defineComponent<TransformValue>(() => ({
    x: 0,
    y: 0,
    rotation: 0,
    scaleX: 1,
    scaleY: 1
  }));
  ctx.state.transformToken = transformToken;

  const scheduler = ctx.require(schedulerPlugin);
  scheduler.addSystem(
    "sync",
    createSyncSystem({
      state: ctx.state,
      transformToken,
      world
    })
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// onStart
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Starts the renderer.
 *
 * When `config.headless` is `true`: logs an info line, skips Pixi entirely
 * (no Application created or initialised), but still defines the Transform
 * component and registers the sync system. Stores `{ app: undefined, views }`
 * in the WeakMap so onStop can clear managed views.
 *
 * When `config.headless` is `false` (or DOM is present): creates a Pixi
 * Application, calls `app.init(...)` with `autoStart:false`, optionally mounts
 * the canvas, then stores `{ app, views }` in the WeakMap. On any init failure,
 * `app.destroy(...)` is called and the error is rethrown (no half-open GPU).
 *
 * @param ctx - Full plugin context providing config, state, global, log, and require.
 * @returns A Promise that resolves when the renderer is ready.
 * @throws {Error} When Pixi Application initialisation fails (non-headless path only).
 * @example
 * ```ts
 * await start(ctx);
 * ```
 */
export const start = async (ctx: StartContext): Promise<void> => {
  if (ctx.config.headless) {
    ctx.log.info("[renderer] headless — Pixi not initialised");

    // Define Transform component + register sync system in headless mode too,
    // so ECS/scene code is identical whether headless or not.
    registerTransformAndSync(ctx);

    // Store headless teardown entry (app is undefined — onStop skips destroy).
    teardownMap.set(ctx.global, { app: undefined, views: ctx.state.views });

    return;
  }

  // ── Non-headless path ─────────────────────────────────────────────────────

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

  // Store app in state so API methods (render, getView, getStage) can reach it.
  ctx.state.app = app;

  // Define the Transform component on the ECS world and store it in state so
  // the API getter and sync system share the exact same token instance.
  registerTransformAndSync(ctx);

  // Stash teardown data in the WeakMap (onStop cannot read state).
  teardownMap.set(ctx.global, { app, views: ctx.state.views });
};

// ─────────────────────────────────────────────────────────────────────────────
// onStop
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Stops the renderer: disposes every managed Container, and (when not headless)
 * destroys the Pixi Application with full texture/VRAM cleanup. Removes the
 * WeakMap entry. Idempotent — a second call with the same global is a safe no-op.
 *
 * Reads teardown data from the module WeakMap via `ctx.global` because onStop
 * only receives TeardownContext (`{ global }`) — state is not accessible.
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

  // Only destroy the Pixi Application when one was actually created.
  if (entry.app) {
    entry.app.destroy(true, { children: true, texture: true, textureSource: true });
  }

  teardownMap.delete(ctx.global);
};
