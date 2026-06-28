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
import { buildPrimitive } from "./primitives";
import type { Api, Config, PrimitiveSpec, SceneNode, State, TransformValue } from "./types";

// ─────────────────────────────────────────────────────────────────────────────
// Scene-graph walk (Pixi → plain SceneNode data — keeps Pixi types out of the result)
// ─────────────────────────────────────────────────────────────────────────────

/** Depth cap for the scene-graph walk, guarding against pathological trees. */
const MAX_TREE_DEPTH = 64;

/**
 * Structural view of a Pixi display object — only the fields {@link buildSceneNode}
 * reads. Using a structural type (rather than Pixi's `Container`) keeps the walk
 * decoupled from Pixi's class hierarchy; the caller projects `app.stage` to it.
 */
type DisplayNodeLike = {
  /** User-set node name ("" when unset). */
  label?: string;
  /** Local position. */
  position: { x: number; y: number };
  /** Rotation in radians. */
  rotation: number;
  /** Local scale. */
  scale: { x: number; y: number };
  /** Visibility flag. */
  visible: boolean;
  /** Alpha (0–1). */
  alpha: number;
  /** Computed bounds width. */
  width: number;
  /** Computed bounds height. */
  height: number;
  /** Child display objects. */
  children: readonly DisplayNodeLike[];
  /** Present (string) on Pixi `Text` nodes. */
  text?: unknown;
  /** Present (object `_GraphicsContext`) on Pixi `Graphics` nodes. */
  context?: unknown;
  /** Present on Pixi `Sprite` nodes (absent on `Graphics`, which has `context` instead). */
  texture?: unknown;
};

/**
 * Classify a display object by duck-typing the fields Pixi subclasses add.
 *
 * Classification order:
 *   1. `Text`     — carries a string `text` field.
 *   2. `Graphics` — carries a `context` field (a `_GraphicsContext` object).
 *                   Checked BEFORE Sprite because Pixi v8 `Graphics` also has
 *                   a `texture` getter, which would otherwise mislabel it.
 *   3. `Sprite`   — carries `texture` but no `context`.
 *   4. `Container` — the default fallback.
 *
 * @param node - The display object to classify.
 * @returns "Text", "Graphics", "Sprite", or "Container".
 * @example
 * ```ts
 * nodeType(stage); // "Container"
 * nodeType(new Graphics()); // "Graphics"
 * ```
 */
const nodeType = (node: DisplayNodeLike): string => {
  if (typeof node.text === "string") return "Text";
  if (typeof node.context === "object" && node.context !== null) return "Graphics";
  if (node.texture !== undefined) return "Sprite";
  return "Container";
};

/**
 * Recursively project a Pixi display object into a plain {@link SceneNode}.
 *
 * @param node - The display object to serialise (structural projection of a Pixi Container).
 * @param depth - Current recursion depth; children are dropped past {@link MAX_TREE_DEPTH}.
 * @returns A JSON-serialisable scene node.
 * @example
 * ```ts
 * const tree = buildSceneNode(stage, 0);
 * ```
 */
const buildSceneNode = (node: DisplayNodeLike, depth: number): SceneNode => {
  const type = nodeType(node);

  const result: SceneNode = {
    label: node.label ?? "",
    type,
    x: node.position.x,
    y: node.position.y,
    rotation: node.rotation,
    scaleX: node.scale.x,
    scaleY: node.scale.y,
    visible: node.visible,
    alpha: node.alpha,
    width: node.width,
    height: node.height,
    children:
      depth >= MAX_TREE_DEPTH ? [] : node.children.map(child => buildSceneNode(child, depth + 1))
  };

  // Only Text nodes carry a text string — set it conditionally (exactOptionalPropertyTypes).
  if (type === "Text") result.text = String(node.text);

  return result;
};

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
    },

    /**
     * Capture the current frame as a PNG data URL via Pixi's `extract` system.
     *
     * Re-renders the stage into an extract target, so the capture is reliable
     * regardless of frame timing. Resolves to undefined when headless / before start.
     *
     * @returns A Promise resolving to a `data:image/png;base64,...` URL, or undefined.
     * @example
     * ```ts
     * const dataUrl = await api.screenshot();
     * ```
     */
    async screenshot(): Promise<string | undefined> {
      const app = ctx.state.app;
      if (!app) return undefined;
      return app.renderer.extract.base64(app.stage);
    },

    /**
     * Return a JSON-serialisable snapshot of the Pixi scene graph, or undefined
     * when headless / before start.
     *
     * @returns The root SceneNode (positions, labels, text, children), or undefined.
     * @example
     * ```ts
     * const tree = api.tree();
     * ```
     */
    tree(): SceneNode | undefined {
      const app = ctx.state.app;
      if (!app) return undefined;
      return buildSceneNode(app.stage as unknown as DisplayNodeLike, 0);
    },

    /**
     * Build a Pixi Graphics from `spec`, add it to `app.stage`, and register it
     * (views + dirty) so the sync system positions it from the entity's Transform.
     *
     * Unlike `attach()`, this method calls `stage.addChild` itself so an
     * MCP-spawned entity actually appears on screen without the caller holding a
     * stage reference. Returns `false` when headless / before start (no app) —
     * nothing is added.
     *
     * @param entity - The entity to associate the primitive view with.
     * @param spec - Plain JSON-describable shape + style spec.
     * @returns `true` when the primitive was staged; `false` when headless.
     * @example
     * ```ts
     * const ok = api.attachPrimitive(entity, { shape: "circle", radius: 10, fill: 0xff0000 });
     * ```
     */
    attachPrimitive(entity: Entity, spec: PrimitiveSpec): boolean {
      const app = ctx.state.app;
      if (!app) return false;

      const view = buildPrimitive(spec);
      app.stage.addChild(view);
      ctx.state.views.set(entity, view);
      ctx.state.dirty.add(entity);
      return true;
    }
  };
};
