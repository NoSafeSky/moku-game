/**
 * @file editor-selection plugin — API factory.
 *
 * `createApi` assembles the public `app["editor-selection"]` surface from the pure
 * pick/stamp/selection helpers in `pick.ts`. The API is a thin guard-and-delegate layer:
 * every mutator is a before-start no-op (warns) and every Pixi-facing method (`enable`/
 * `disable`/`pickAt`) reads the dependency handles captured into `state` by `onStart`.
 * `select`/`toggle`/`clear` drive the `Set<Entity>` through `applySelect`/`applyClear`
 * (the same helpers the live pointer listener uses), so the API and the listener agree on
 * one mutation + emit-gating semantics.
 */
import type { Point } from "../camera/types";
import type { Entity } from "../ecs/types";
import { applyClear, applySelect, attachPickListener, pickTopmost, stampAll } from "./pick";
import type { Api, Config, Events, Log, State } from "./types";

/**
 * Structural context required by {@link createApi}, so unit tests can pass a minimal mock
 * (`{ config, state, log, emit }`) without wiring the full kernel. The dependency APIs are
 * NOT on the context — they are captured into `state` by `onStart` (the `camera` precedent).
 */
export type EditorSelectionApiContext = {
  /** Resolved editor-selection configuration (`pickLayer`, `multiSelect`). */
  readonly config: Readonly<Config>;
  /** Plugin state — the selection set, enabled flag, captured deps, and pointer-edge bookkeeping. */
  readonly state: State;
  /** Logger from the common logPlugin (before-start + missing-layer warnings). */
  readonly log: Log;
  /**
   * Emit the declared `editor-selection:changed` event. A method signature (bivariant params)
   * so the kernel's merged `ctx.emit` is assignable to this narrower editor-selection view.
   *
   * @param event - The event name.
   * @param payload - The event payload matching the declared shape.
   */
  emit<K extends keyof Events>(event: K, payload: Events[K]): void;
};

/**
 * Creates the editor-selection plugin API surface.
 *
 * @param ctx - Plugin context (structural — `config` + `state` + `log` + `emit`).
 * @returns The editor-selection {@link Api} object.
 * @example
 * ```ts
 * const api = createApi(ctx);
 * api.enable();
 * const entity = api.pickAt({ x: 120, y: 80 });
 * ```
 */
export const createApi = (ctx: EditorSelectionApiContext): Api => {
  /**
   * Before-start guard shared by the mutators + `enable`/`disable`: warns and returns `false`
   * when `onStart` has not yet captured the dependency handles.
   *
   * @param method - The API method name, for the warning message.
   * @returns `true` when the plugin has started, else `false`.
   * @example
   * ```ts
   * if (!requireStarted("select")) return;
   * ```
   */
  const requireStarted = (method: string): boolean => {
    if (ctx.state.started) return true;
    ctx.log.warn(`[editor-selection] ${method}() called before the plugin started — no-op.`);
    return false;
  };

  return {
    /**
     * Enter edit mode: make the configured camera pick layer interactive, capture the canvas,
     * re-stamp every live view, and attach the pointerdown listener. No-op (warns) before start
     * or when the pick layer is unavailable (headless / unknown layer). Idempotent — a re-enable
     * detaches the prior listener so it never double-attaches.
     *
     * @example
     * ```ts
     * app["editor-selection"].enable();
     * ```
     */
    enable(): void {
      if (!requireStarted("enable")) return;
      const layer = ctx.state.camera?.layer(ctx.config.pickLayer);
      if (!layer) {
        ctx.log.warn(
          `[editor-selection] enable() — pick layer "${ctx.config.pickLayer}" is unavailable (headless / unknown layer); staying disabled.`
        );
        return;
      }
      layer.eventMode = "static";
      layer.interactiveChildren = true;
      ctx.state.pickLayer = layer;
      ctx.state.canvas = ctx.state.renderer?.getView();
      stampAll(ctx.state);
      ctx.state.detach?.(); // detach any prior listener so a re-enable does not double-attach
      ctx.state.detach = attachPickListener(ctx);
      ctx.state.enabled = true;
    },

    /**
     * Leave edit mode: detach the listener and revert the pick layer's interactivity. Idempotent
     * (safe to call twice and before any `enable()`). Does NOT clear the current selection.
     *
     * @example
     * ```ts
     * app["editor-selection"].disable();
     * ```
     */
    disable(): void {
      if (!requireStarted("disable")) return;
      ctx.state.detach?.();
      ctx.state.detach = undefined;
      const layer = ctx.state.pickLayer;
      if (layer) {
        layer.eventMode = "none";
        layer.interactiveChildren = false;
      }
      ctx.state.pickLayer = undefined;
      ctx.state.enabled = false;
    },

    /**
     * Select an entity (single-select REPLACES the set; `config.multiSelect` ADDS). Ignores a
     * despawned entity (recycled-id guard) and emits `editor-selection:changed` only on a real change.
     *
     * @param entity - The entity to select.
     * @example
     * ```ts
     * app["editor-selection"].select(entity);
     * ```
     */
    select(entity: Entity): void {
      if (!requireStarted("select")) return;
      applySelect(ctx, entity, "select");
    },

    /**
     * Toggle an entity's membership. Ignores a despawned entity and emits only on a real change.
     *
     * @param entity - The entity to toggle.
     * @example
     * ```ts
     * app["editor-selection"].toggle(entity);
     * ```
     */
    toggle(entity: Entity): void {
      if (!requireStarted("toggle")) return;
      applySelect(ctx, entity, "toggle");
    },

    /**
     * Clear the selection, emitting `editor-selection:changed { selected: [] }` only when the set
     * was non-empty.
     *
     * @example
     * ```ts
     * app["editor-selection"].clear();
     * ```
     */
    clear(): void {
      if (!requireStarted("clear")) return;
      applyClear(ctx);
    },

    /**
     * The current selection as a fresh immutable array, pruned of despawned entities (never the
     * live `Set`). Returns `[]` before start.
     *
     * @returns The live, pruned selection snapshot.
     * @example
     * ```ts
     * const entities = app["editor-selection"].selected();
     * ```
     */
    selected(): readonly Entity[] {
      if (!ctx.state.started) return [];
      return [...ctx.state.selected].filter(entity => ctx.state.world?.isAlive(entity) ?? true);
    },

    /**
     * Whether an entity is currently selected AND still alive. A pure reader — works before start.
     *
     * @param entity - The entity to test.
     * @returns `true` when the entity is in the selection and alive.
     * @example
     * ```ts
     * app["editor-selection"].isSelected(entity);
     * ```
     */
    isSelected(entity: Entity): boolean {
      return ctx.state.selected.has(entity) && (ctx.state.world?.isAlive(entity) ?? false);
    },

    /**
     * Resolve the topmost entity under a canvas-relative screen point via the non-enumerable view
     * handle. `undefined` before start, when disabled, headless, or when nothing is hit.
     *
     * @param screen - A canvas-relative screen point.
     * @returns The topmost stamped, alive entity under the point, or `undefined`.
     * @example
     * ```ts
     * const entity = app["editor-selection"].pickAt({ x: 120, y: 80 });
     * ```
     */
    pickAt(screen: Point): Entity | undefined {
      if (!ctx.state.started) return undefined;
      const { pickLayer, camera, world } = ctx.state;
      if (!pickLayer || !camera || !world) return undefined;
      stampAll(ctx.state); // lazy refresh so a freshly-spawned view resolves
      const worldPoint = camera.screenToWorld(screen);
      return pickTopmost(pickLayer, worldPoint, entity => world.isAlive(entity));
    }
  };
};
