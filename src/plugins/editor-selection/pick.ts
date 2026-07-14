/**
 * @file editor-selection plugin — pick + stamp helpers.
 *
 * Small, mostly Pixi-light functions so the emit gating, the view stamping, and the
 * pointer edge detection are unit-testable in isolation from the kernel: `stampEntity`
 * / `entityOf` implement the non-enumerable `entity` handle (the ecs `__id` pattern —
 * `world.ts:83`), `stampAll` refreshes every live view's handle from the source of
 * truth, `pickTopmost` scans a pick layer top-of-z first for the first stamped, alive
 * entity whose bounds contain a world point, `commitIfChanged` is the "emit only on a
 * real change" gate, `applySelect` / `applyClear` are the shared Set-mutation logic
 * behind both the public `select`/`toggle`/`clear` API and the live pick listener, and
 * `attachPickListener` wires the native Pixi `pointerdown` listener that drives them
 * from real pointer input.
 */
import type { Container, FederatedPointerEvent } from "pixi.js";
import type { Point } from "../camera/types";
import type { Entity } from "../ecs/types";
import type { EditorSelectionApiContext } from "./api";
import type { PickableView, State } from "./types";

/** Left mouse / primary touch bit within the pointer `buttons` bitmask (the `ui` `PRIMARY_BUTTON` precedent). */
const PRIMARY_BUTTON = 0b0001;

/**
 * Stamp the entity onto its view as a hidden, non-enumerable prop — mirrors the ecs
 * component token's `__id` shape (`world.ts:83`), so the handle travels with the view,
 * is invisible to `JSON.stringify` / `for…in` / the renderer's `tree()` walk, and
 * cannot disagree with reality the way a side `Container → Entity` map can.
 *
 * @param view - The Pixi view to stamp.
 * @param entity - The entity the view represents.
 * @example
 * ```ts
 * stampEntity(view, entity);
 * ```
 */
export const stampEntity = (view: Container, entity: Entity): void => {
  Object.defineProperty(view, "entity", {
    value: entity,
    enumerable: false,
    writable: true,
    configurable: true
  });
};

/**
 * Read the entity a view (or the nearest stamped ancestor) was stamped with, walking
 * up the `parent` chain. Returns `undefined` when no ancestor in the chain is stamped.
 *
 * @param view - The view to start the walk from (typically `event.target`).
 * @returns The stamped entity, or `undefined` if none is found in the chain.
 * @example
 * ```ts
 * const entity = entityOf(event.target); // topmost hit view → its entity, or undefined
 * ```
 */
export const entityOf = (view: Container | null): Entity | undefined => {
  let node: Container | null = view;
  while (node) {
    const entity = (node as unknown as PickableView).entity;
    if (entity !== undefined) return entity;
    node = node.parent;
  }
  return undefined;
};

/**
 * Re-stamp every live view from the source of truth (`world.liveEntities()` →
 * `renderer.getEntityView(e)`). Idempotent — safe to call on every `enable()` and
 * lazily before every `pickAt` scan, so a freshly-spawned view is always resolvable.
 * A no-op when the world / renderer handles are not yet captured (before start).
 *
 * @param state - editor-selection plugin state (captured `world` + `renderer`).
 * @example
 * ```ts
 * stampAll(state); // refresh every live view's stamped entity handle
 * ```
 */
export const stampAll = (state: State): void => {
  if (!state.world || !state.renderer) return;
  for (const entity of state.world.liveEntities()) {
    const view = state.renderer.getEntityView(entity);
    if (view) stampEntity(view, entity);
  }
};

/**
 * Whether world-space `point` lies within `view`'s bounds — its own `position` (which
 * mirrors the entity's world-space `Transform.x`/`y`, since the renderer's sync system
 * writes it directly) plus its own untransformed local size (`getLocalBounds()`,
 * ignoring ancestor transforms). This is the same world-space reference frame
 * `camera.screenToWorld` maps into, and the frame the reserved marquee follow-up will
 * intersect entity world-AABBs against.
 *
 * @param view - The candidate view.
 * @param point - A world-space point.
 * @returns `true` when `point` falls inside the view's world-space bounds.
 * @example
 * ```ts
 * if (containsPoint(view, worldPoint)) return entityOf(view);
 * ```
 */
const containsPoint = (view: Container, point: Point): boolean => {
  const local = view.getLocalBounds();
  const left = view.position.x + local.x;
  const top = view.position.y + local.y;
  return (
    point.x >= left &&
    point.x <= left + local.width &&
    point.y >= top &&
    point.y <= top + local.height
  );
};

/**
 * Scan a pick layer's direct children top-of-z first (highest index = topmost paint
 * order) and return the first stamped, still-alive entity whose bounds contain `point`.
 *
 * @param pickLayer - The interactive pick-layer Container to scan.
 * @param point - A world-space point (`camera.screenToWorld` output).
 * @param isAlive - Recycled-id guard (`world.isAlive`) applied to each stamped candidate.
 * @returns The topmost matching entity, or `undefined` when nothing hits.
 * @example
 * ```ts
 * const hit = pickTopmost(pickLayer, worldPoint, world.isAlive);
 * ```
 */
export const pickTopmost = (
  pickLayer: Container,
  point: Point,
  isAlive: (entity: Entity) => boolean
): Entity | undefined => {
  const { children } = pickLayer;
  for (let index = children.length - 1; index >= 0; index--) {
    const child = children[index];
    if (!child) continue;
    const entity = entityOf(child);
    if (entity === undefined || !isAlive(entity)) continue;
    if (containsPoint(child, point)) return entity;
  }
  return undefined;
};

/**
 * Compare the current selection `Set` against a `before` snapshot and, only on a real
 * change (size or membership differs), emit `editor-selection:changed` with a fresh,
 * despawned-pruned `readonly Entity[]` snapshot. The "emit only on flip" gate — a
 * redundant re-select/toggle never re-emits.
 *
 * @param ctx - The editor-selection API context (state + emit).
 * @param before - A snapshot of the selection `Set` taken before the mutation.
 * @example
 * ```ts
 * const before = new Set(ctx.state.selected);
 * ctx.state.selected.add(entity);
 * commitIfChanged(ctx, before);
 * ```
 */
export const commitIfChanged = (
  ctx: EditorSelectionApiContext,
  before: ReadonlySet<Entity>
): void => {
  const current = ctx.state.selected;
  const changed = current.size !== before.size || [...current].some(entity => !before.has(entity));
  if (!changed) return;
  const selected = [...current].filter(entity => ctx.state.world?.isAlive(entity) ?? true);
  ctx.emit("editor-selection:changed", { selected });
};

/**
 * Apply a select/toggle mutation to the selection `Set`, honouring `config.multiSelect`,
 * then commit iff the set actually changed. Ignores a despawned entity (the recycled-id
 * guard). Shared by the public `select`/`toggle` API methods and the live pick listener
 * so both paths agree on exactly one mutation semantics.
 *
 * - `mode: "select"` — single-select REPLACES the set with `{entity}` (a no-op if
 *   already the sole member); `multiSelect` ADDS.
 * - `mode: "toggle"` — removes `entity` if already selected, else applies the same
 *   replace/add rule as `"select"`.
 *
 * @param ctx - The editor-selection API context (config + state + emit).
 * @param entity - The entity to select/toggle.
 * @param mode - `"select"` (replace/add) or `"toggle"` (flip membership).
 * @example
 * ```ts
 * applySelect(ctx, entity, "select");
 * applySelect(ctx, entity, "toggle");
 * ```
 */
export const applySelect = (
  ctx: EditorSelectionApiContext,
  entity: Entity,
  mode: "select" | "toggle"
): void => {
  if (!ctx.state.world?.isAlive(entity)) return;
  const before = new Set(ctx.state.selected);
  const { selected } = ctx.state;
  if (mode === "toggle" && selected.has(entity)) {
    selected.delete(entity);
  } else if (ctx.config.multiSelect) {
    selected.add(entity);
  } else if (!(selected.size === 1 && selected.has(entity))) {
    selected.clear();
    selected.add(entity);
  }
  commitIfChanged(ctx, before);
};

/**
 * Clear the selection, emitting `editor-selection:changed { selected: [] }` iff the
 * set was non-empty (no redundant emit on an already-empty clear).
 *
 * @param ctx - The editor-selection API context (state + emit).
 * @example
 * ```ts
 * applyClear(ctx);
 * ```
 */
export const applyClear = (ctx: EditorSelectionApiContext): void => {
  if (ctx.state.selected.size === 0) return;
  ctx.state.selected.clear();
  ctx.emit("editor-selection:changed", { selected: [] });
};

/**
 * Attach the native Pixi `pointerdown` pick listener to `ctx.state.pickLayer`. On each
 * event it reads `input.snapshot().pointer`, derives the primary-button press edge
 * (`buttons` `0 → 1` against `state.prevButtons`), and — only on a real press —
 * resolves the entity Pixi already hit-tested (`entityOf(event.target)`) and routes it
 * to `applySelect` (`"toggle"` when `config.multiSelect`, else `"select"`) when alive,
 * or `applyClear` when the click hit nothing. A held button (`1 → 1`) or a non-primary
 * button never re-selects.
 *
 * @param ctx - The editor-selection API context (config + state + emit).
 * @returns A detach function that removes the listener; a no-op detach when there is no
 *   pick layer to attach to (headless / disabled).
 * @example
 * ```ts
 * ctx.state.detach = attachPickListener(ctx);
 * // later:
 * ctx.state.detach();
 * ```
 */
export const attachPickListener = (ctx: EditorSelectionApiContext): (() => void) => {
  const layer = ctx.state.pickLayer;
  if (!layer) {
    return () => {
      /* no pick layer to attach to (headless / disabled) — detach is a no-op */
    };
  }

  /**
   * Handle one native `pointerdown`: derive the primary-button press edge and route a fresh
   * press to `applySelect` (over an alive stamped entity) or `applyClear` (empty space).
   *
   * @param event - The Pixi federated pointer event (its `target` is the topmost hit view).
   * @example
   * ```ts
   * layer.on("pointerdown", handleDown);
   * ```
   */
  const handleDown = (event: FederatedPointerEvent): void => {
    const pointer = ctx.state.input?.snapshot().pointer;
    if (!pointer) return;

    const isDown = (pointer.buttons & PRIMARY_BUTTON) !== 0;
    const wasDown = (ctx.state.prevButtons & PRIMARY_BUTTON) !== 0;
    ctx.state.prevButtons = pointer.buttons;
    if (!isDown || wasDown) return; // only a fresh primary-button press selects

    const entity = entityOf(event.target);
    if (entity !== undefined && (ctx.state.world?.isAlive(entity) ?? false)) {
      applySelect(ctx, entity, ctx.config.multiSelect ? "toggle" : "select");
    } else {
      applyClear(ctx);
    }
  };

  layer.on("pointerdown", handleDown);
  return () => layer.off("pointerdown", handleDown);
};
