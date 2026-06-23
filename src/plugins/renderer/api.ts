/**
 * @file renderer plugin — API factory.
 *
 * Exposes the renderer public surface: Transform component token, attach/detach,
 * render, getView, getStage, and markDirty.
 *
 * The Transform token lives in ctx.state.transformToken (written by onStart via
 * world.defineComponent). The getter reads it from state so the api and the sync
 * system always reference the same token instance. Accessing Transform before
 * onStart has run throws — the token is only valid after app.start().
 */
import type { Container } from "pixi.js";
import type { ecsPlugin } from "../ecs";
import type { Component, Entity, World } from "../ecs/types";
import type { schedulerPlugin } from "../scheduler";
import type { Api, Config, State, TransformValue } from "./types";

/**
 * Structural context type required by createApi.
 *
 * Only the fields the API factory actually accesses are included so unit tests
 * can supply a minimal mock without wiring the full kernel.
 */
export type RendererContext = {
  /** Resolved renderer configuration. */
  readonly config: Readonly<Config>;
  /** Renderer plugin state (app, transformToken, views, dirty). */
  readonly state: State;
  /** Global plugin registry (kernel-injected object). */
  readonly global: object;
  /** Logger injected by logPlugin. */
  readonly log: {
    /** Log at debug level. */
    debug: (message: string) => void;
    /** Log at info level. */
    info: (message: string) => void;
    /** Log a warning. */
    warn: (message: string) => void;
    /** Log an error. */
    error: (message: string) => void;
  };
  /** Require a dependency's API by plugin instance. */
  require: ((plugin: typeof ecsPlugin) => World) &
    ((plugin: typeof schedulerPlugin) => {
      addSystem: (stage: "sync", system: (world: World, dt: number) => void) => () => void;
      tick: (dt: number) => void;
      stages: readonly string[];
    });
};

/**
 * Creates the renderer plugin API surface.
 *
 * The Transform token is read from ctx.state.transformToken (set by onStart);
 * accessing it before start throws so the api and sync system never diverge.
 * attach/detach/markDirty mutate state directly. render, getView, and getStage
 * are safe no-ops/undefined before onStart completes.
 *
 * @param ctx - Plugin context supplying config, state, log, and require.
 * @param ctx.config - Resolved renderer configuration.
 * @param ctx.state - Renderer plugin state (app, transformToken, views, dirty).
 * @param ctx.global - Global plugin registry.
 * @param ctx.log - Logger from logPlugin.
 * @param ctx.require - Kernel function to obtain dependency APIs.
 * @returns The renderer API object.
 * @example
 * ```ts
 * const api = createApi(ctx);
 * api.attach(entity, container);
 * api.markDirty(entity);
 * api.render();
 * ```
 */
export const createApi = (ctx: RendererContext): Api => {
  /**
   * Return the Transform token defined on the ECS world by onStart and stored on
   * state, so the api, the sync system, and consumers all share the same token.
   * Throws if accessed before onStart has run — there is no single valid token
   * yet, and silently minting one would diverge from the sync system's token.
   *
   * @returns The Transform component token.
   * @throws {Error} When accessed before app.start() has defined the token.
   * @example
   * ```ts
   * const token = getTransform();
   * world.spawn(token({ x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1 }));
   * ```
   */
  const getTransform = (): Component<TransformValue> => {
    if (!ctx.state.transformToken) {
      throw new Error(
        "[game] renderer.Transform accessed before start.\n  Call app.start() before using app.renderer.Transform."
      );
    }
    return ctx.state.transformToken;
  };

  return {
    /**
     * The Transform component token defined on the ECS world. Use it to spawn
     * entities with a transform or read/write position, rotation, and scale.
     *
     * @returns The memoized Transform component token.
     * @example
     * ```ts
     * const entity = world.spawn(api.Transform({ x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1 }));
     * ```
     */
    get Transform(): Component<TransformValue> {
      return getTransform();
    },

    /**
     * Attach a Pixi Container to an entity and mark it dirty for the next sync.
     *
     * @param entity - The entity to attach the view to.
     * @param view - A Pixi Container to display.
     * @example
     * ```ts
     * api.attach(entity, new Container());
     * ```
     */
    attach(entity: Entity, view: Container): void {
      ctx.state.views.set(entity, view);
      ctx.state.dirty.add(entity);
    },

    /**
     * Detach and destroy the entity's Container. Idempotent.
     *
     * @param entity - The entity whose view should be removed.
     * @example
     * ```ts
     * api.detach(entity);
     * ```
     */
    detach(entity: Entity): void {
      const view = ctx.state.views.get(entity);
      if (!view) return;
      view.destroy();
      ctx.state.views.delete(entity);
    },

    /**
     * Draw the current frame via the Pixi Application. No-op before start.
     *
     * @example
     * ```ts
     * api.render(); // called by the loop plugin each frame
     * ```
     */
    render(): void {
      ctx.state.app?.render();
    },

    /**
     * Return the canvas for manual DOM mounting, or undefined before start.
     *
     * @returns HTMLCanvasElement or undefined.
     * @example
     * ```ts
     * document.body.appendChild(api.getView()!);
     * ```
     */
    getView(): HTMLCanvasElement | undefined {
      return ctx.state.app?.canvas;
    },

    /**
     * Return the root Pixi stage Container, or undefined before start.
     *
     * @returns Root Container or undefined.
     * @example
     * ```ts
     * const stage = api.getStage();
     * if (stage) stage.addChild(sprite);
     * ```
     */
    getStage(): Container | undefined {
      return ctx.state.app?.stage as Container | undefined;
    },

    /**
     * Mark an entity dirty so the sync system repositions its view next tick.
     *
     * @param entity - The entity whose Transform has changed.
     * @example
     * ```ts
     * api.markDirty(entity);
     * api.render();
     * ```
     */
    markDirty(entity: Entity): void {
      ctx.state.dirty.add(entity);
    }
  };
};
