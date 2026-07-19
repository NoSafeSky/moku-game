/**
 * @file editor-selection plugin — pick + stamp + marquee helpers.
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
 * from real pointer input (routing an entity hit to toggle vs replace by the toggle
 * modifier read off the federated event itself — `event.ctrlKey`/`event.metaKey` — not the
 * input snapshot, which is a tick stale at the synchronous pointerdown dispatch).
 *
 * The marquee block — `rectIntersectsView` / `selectManyInRect` / `attachMarqueeListener`
 * / `drawMarquee` / `cancelMarquee` — drives the empty-space drag selection off
 * stage-level Pixi federated events (the `editor-gizmos` `globalpointermove`/`pointerup`
 * precedent, no `scheduler` edge) and intersects entity world-AABBs against the world
 * `Rect` the two canvas drag corners project to.
 */
import type { Container, FederatedPointerEvent, Graphics } from "pixi.js";
import type { Api as CameraApi, Point } from "../camera/types";
import type { Entity } from "../ecs/types";
import type { InputSnapshot } from "../input/types";
import type { EditorSelectionApiContext } from "./api";
import type { PickableView, Rect, State } from "./types";

/** Left mouse / primary touch bit within the pointer `buttons` bitmask (the `ui` `PRIMARY_BUTTON` precedent). */
const PRIMARY_BUTTON = 0b0001;

/**
 * Screen-space distance (px) a drag must travel before it becomes a real marquee. Below
 * it a press+release on empty space stays a plain click (which clears), so a click can
 * never degenerate into a zero-area marquee.
 */
const MARQUEE_THRESHOLD = 4;

/** Dash length (px) of the marquee outline. */
const MARQUEE_DASH = 6;

/** Gap length (px) between marquee outline dashes. */
const MARQUEE_GAP = 4;

/** Stroke width (px) of the marquee outline. */
const MARQUEE_STROKE_WIDTH = 1;

/** Marquee outline + fill colour (the editor's sky accent). */
const MARQUEE_COLOR = 0x38_bd_f8;

/** Alpha of the marquee's translucent interior fill. */
const MARQUEE_FILL_ALPHA = 0.08;

/**
 * Whether the toggle modifier (Ctrl on Windows/Linux, Cmd/Meta on macOS) is held, read
 * off the shared per-frame input snapshot's held-key set. The `InputSnapshot` exposes no
 * dedicated modifier field, but `isDown` covers the held-key set — so no `input`
 * extension is needed and the whole pick decision stays consistent within one snapshot.
 *
 * @param snapshot - The shared input snapshot, or `undefined` when input is not captured.
 * @returns `true` when Control or Meta is held.
 * @example
 * ```ts
 * const modifier = isToggleModifier(ctx.state.input?.snapshot());
 * ```
 */
const isToggleModifier = (snapshot: InputSnapshot | undefined): boolean =>
  snapshot?.isDown("Control") === true || snapshot?.isDown("Meta") === true;

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
 * event it gates on the event's OWN primary-button mask (`event.buttons` — a `pointerdown`
 * fires once per real press, so no press-edge bookkeeping is needed) and — only on a primary
 * press — re-stamps every live view (so a view spawned after `enable()` still carries its entity
 * handle), resolves the entity Pixi already hit-tested (`entityOf(event.target)`), and routes it
 * to `applySelect`, **modifier-aware**: `"toggle"` when the toggle modifier (Ctrl/Cmd) is held
 * on that same event (`event.ctrlKey`/`event.metaKey`), else `"select"` (which replaces in
 * single-select and adds under `config.multiSelect`). Reading the modifier + button off the
 * event — not `input.snapshot()`, which is refreshed a tick later and is stale at this
 * synchronous dispatch — is the fix for a press never registering. An empty click still `applyClear`s
 * — a modifier does not preserve the selection there, since the marquee owns additive
 * empty-space behaviour. Shift-range is deliberately NOT handled: it presupposes a linear
 * order the 2D viewport does not have (it is a hierarchy-panel affordance). A held button
 * (`1 → 1`) or a non-primary button never re-selects.
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
   * Handle one native `pointerdown`: gate on the event's OWN live button mask (a `pointerdown`
   * already fires once per real press, so no press-edge bookkeeping is needed) and route a
   * primary press to `applySelect` (over an alive stamped entity — `"toggle"` under Ctrl/Cmd,
   * else `"select"`) or `applyClear` (empty space).
   *
   * Reads `event.buttons` / `event.ctrlKey` / `event.metaKey` off the federated event itself —
   * NOT `input.snapshot()`, whose pointer/modifier state is refreshed on the `input` scheduler
   * tick and is therefore STALE (buttons `0`) at this synchronous Pixi dispatch. This mirrors the
   * marquee's own `handleDown`, so both empty-space and entity presses read one consistent source.
   *
   * @param event - The Pixi federated pointer event (its `target` is the topmost hit view).
   * @example
   * ```ts
   * layer.on("pointerdown", handleDown);
   * ```
   */
  const handleDown = (event: FederatedPointerEvent): void => {
    if ((event.buttons & PRIMARY_BUTTON) === 0) return; // the event's own live mask: a primary press

    // Lazy re-stamp before resolving — exactly as `pickAt` does — so a view spawned AFTER
    // `enable()` (e.g. the scene loads after the editor turns selection on) still carries its
    // entity handle when Pixi hands us `event.target`. Without this the click resolves to no
    // entity and silently falls through to `applyClear`, which is why canvas-native selection
    // never worked. Idempotent and only runs on a real press.
    stampAll(ctx.state);

    const entity = entityOf(event.target);
    if (entity !== undefined && (ctx.state.world?.isAlive(entity) ?? false)) {
      const toggle = event.ctrlKey || event.metaKey;
      applySelect(ctx, entity, toggle ? "toggle" : "select");
    } else {
      applyClear(ctx);
    }
  };

  layer.on("pointerdown", handleDown);
  return () => layer.off("pointerdown", handleDown);
};

// ─────────────────────────────────────────────────────────────────────────────
// Marquee — empty-space drag selection (screen-space chrome, world-space hit-test)
// ─────────────────────────────────────────────────────────────────────────────

/** A marquee drag session's stable `globalpointermove`/`pointerup` listener pair. */
type MarqueeListenerPair = {
  /** The `globalpointermove` handler that redraws the dashed rect. */
  readonly move: (event: FederatedPointerEvent) => void;
  /** The `pointerup`/`pointerupoutside` handler that finalizes the gesture. */
  readonly up: (event: FederatedPointerEvent) => void;
};

/**
 * Private companion map from a plugin's state object to its stable move/up listener pair
 * (created once by {@link attachMarqueeListener}), so a drag can subscribe/unsubscribe the
 * EXACT SAME function references without adding a Pixi-typed field to the public `State`
 * shape (the `editor-gizmos` `dragListeners` precedent).
 */
const marqueeListeners = new WeakMap<State, MarqueeListenerPair>();

/**
 * Normalize two corner points into a positive-extent axis-aligned {@link Rect}, so a drag
 * that travels up and/or left still yields non-negative `width`/`height`.
 *
 * @param from - The first corner.
 * @param to - The opposite corner.
 * @returns The normalized rectangle spanning both corners.
 * @example
 * ```ts
 * const rect = normalizeRect({ x: 40, y: 40 }, { x: 0, y: 0 }); // { x: 0, y: 0, width: 40, height: 40 }
 * ```
 */
const normalizeRect = (from: Point, to: Point): Rect => ({
  x: Math.min(from.x, to.x),
  y: Math.min(from.y, to.y),
  width: Math.abs(to.x - from.x),
  height: Math.abs(to.y - from.y)
});

/**
 * Map a screen-space drag rectangle (its two dragged corners `a`/`b`, canvas-relative) to the
 * world-space axis-aligned bounding box of the region it covers, mapping **all four** screen
 * corners through `camera.screenToWorld`.
 *
 * Mapping only the two dragged diagonal corners is correct just for an un-rotated camera. Under a
 * rotated camera (`camera.setRotation`/`rotateTo`), a screen rectangle maps to a rotated
 * parallelogram in world space, so its true world AABB must span all four mapped corners — the two
 * off-diagonal corners are where the parallelogram reaches its world extents. With `rotation === 0`
 * the four-corner and two-corner results coincide, so this costs two extra transforms and changes
 * nothing for the default camera.
 *
 * @param camera - The camera API (`screenToWorld` is rotation/zoom/pan-aware).
 * @param a - One dragged screen corner (canvas-relative).
 * @param b - The opposite dragged screen corner (canvas-relative).
 * @returns The world-space AABB covering the dragged screen rectangle.
 * @example
 * ```ts
 * const rect = worldAabbFromScreenRect(camera, { x: 0, y: 0 }, { x: 80, y: 40 });
 * ```
 */
const worldAabbFromScreenRect = (camera: CameraApi, a: Point, b: Point): Rect => {
  const corners = [
    camera.screenToWorld({ x: a.x, y: a.y }),
    camera.screenToWorld({ x: b.x, y: a.y }),
    camera.screenToWorld({ x: a.x, y: b.y }),
    camera.screenToWorld({ x: b.x, y: b.y })
  ];

  const xs = corners.map(c => c.x);
  const ys = corners.map(c => c.y);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);

  return { x: minX, y: minY, width: Math.max(...xs) - minX, height: Math.max(...ys) - minY };
};

/**
 * Whether a view's world-space bounds — its `position` plus its untransformed local size
 * (`getLocalBounds()`, the same reference frame `containsPoint` uses) — overlap `rect`.
 * Edge-touching counts as an intersection (an inclusive AABB test), so a marquee dragged
 * exactly onto a view's border still selects it.
 *
 * @param view - The candidate view.
 * @param rect - A world-space axis-aligned rectangle.
 * @returns `true` when the view's world AABB and `rect` overlap.
 * @example
 * ```ts
 * if (rectIntersectsView(view, { x: 0, y: 0, width: 20, height: 20 })) hits.push(entity);
 * ```
 */
export const rectIntersectsView = (view: Container, rect: Rect): boolean => {
  const local = view.getLocalBounds();
  const left = view.position.x + local.x;
  const top = view.position.y + local.y;
  return (
    left <= rect.x + rect.width &&
    left + local.width >= rect.x &&
    top <= rect.y + rect.height &&
    top + local.height >= rect.y
  );
};

/**
 * Select every stamped, still-alive entity whose world-space bounds intersect `rect`.
 * Re-stamps first (so a freshly-spawned view resolves), scans `world.liveEntities()` →
 * `renderer.getEntityView(e)`, prunes entities `isAlive` reports dead, then either unions
 * the hits into the current selection (`additive`) or replaces it — committing through
 * {@link commitIfChanged}, so at most ONE `editor-selection:changed` is emitted and a
 * marquee that changes nothing emits nothing. A no-op headless (no world / renderer).
 *
 * @param ctx - The editor-selection API context (config + state + emit).
 * @param rect - A world-space axis-aligned rectangle.
 * @param additive - `true` to union the hits into the selection, `false` to replace it.
 * @example
 * ```ts
 * selectManyInRect(ctx, { x: 0, y: 0, width: 200, height: 120 }, ctx.config.multiSelect);
 * ```
 */
export const selectManyInRect = (
  ctx: EditorSelectionApiContext,
  rect: Rect,
  additive: boolean
): void => {
  const { world, renderer, selected } = ctx.state;
  if (!world || !renderer) return;

  stampAll(ctx.state);
  const hits: Entity[] = [];
  for (const entity of world.liveEntities()) {
    if (!world.isAlive(entity)) continue; // recycled-id guard
    const view = renderer.getEntityView(entity);
    if (view && rectIntersectsView(view, rect)) hits.push(entity);
  }

  const before = new Set(selected);
  if (!additive) selected.clear();
  for (const entity of hits) selected.add(entity);
  commitIfChanged(ctx, before);
};

/**
 * Stroke one dashed straight segment between two canvas-space points into `graphics`,
 * walking it in `MARQUEE_DASH`-long strokes separated by `MARQUEE_GAP` gaps. Module-scoped
 * (not nested in {@link drawMarquee}) so it stays a pure geometry helper.
 *
 * @param graphics - The Graphics to draw the dashes into.
 * @param from - The segment's start point.
 * @param to - The segment's end point.
 * @example
 * ```ts
 * dashedSegment(graphics, { x: 0, y: 0 }, { x: 40, y: 0 });
 * ```
 */
const dashedSegment = (graphics: Graphics, from: Point, to: Point): void => {
  const length = Math.hypot(to.x - from.x, to.y - from.y);
  if (length === 0) return;
  const unitX = (to.x - from.x) / length;
  const unitY = (to.y - from.y) / length;
  for (let travelled = 0; travelled < length; travelled += MARQUEE_DASH + MARQUEE_GAP) {
    const end = Math.min(travelled + MARQUEE_DASH, length);
    graphics.moveTo(from.x + unitX * travelled, from.y + unitY * travelled);
    graphics.lineTo(from.x + unitX * end, from.y + unitY * end);
  }
};

/**
 * Redraw the dashed marquee rectangle between two canvas-space points. Screen-space chrome
 * — the overlay is parented on the stage, NOT on the camera-transformed pick layer, so the
 * rectangle the user drags is screen-fixed regardless of pan/zoom. A no-op when the overlay
 * was never built (headless / `config.marquee: false`).
 *
 * @param ctx - The editor-selection API context (state holds the overlay Graphics).
 * @param start - The drag's canvas-space start corner.
 * @param current - The drag's current canvas-space corner.
 * @example
 * ```ts
 * drawMarquee(ctx, { x: 0, y: 0 }, { x: 40, y: 40 });
 * ```
 */
export const drawMarquee = (ctx: EditorSelectionApiContext, start: Point, current: Point): void => {
  const graphics = ctx.state.marqueeGraphics;
  if (!graphics) return;

  const { x, y, width, height } = normalizeRect(start, current);
  graphics.clear();
  graphics.rect(x, y, width, height).fill({ color: MARQUEE_COLOR, alpha: MARQUEE_FILL_ALPHA });
  dashedSegment(graphics, { x, y }, { x: x + width, y });
  dashedSegment(graphics, { x: x + width, y }, { x: x + width, y: y + height });
  dashedSegment(graphics, { x: x + width, y: y + height }, { x, y: y + height });
  dashedSegment(graphics, { x, y: y + height }, { x, y });
  graphics.stroke({ width: MARQUEE_STROKE_WIDTH, color: MARQUEE_COLOR });
};

/**
 * End any in-flight marquee: erase the dashed rectangle and drop the drag session. Called
 * on every `pointerup` (after finalizing) and by `disable()` to abort a drag WITHOUT
 * selecting. Idempotent.
 *
 * @param ctx - The editor-selection API context.
 * @example
 * ```ts
 * cancelMarquee(ctx); // abort: no selection change
 * ```
 */
export const cancelMarquee = (ctx: EditorSelectionApiContext): void => {
  ctx.state.marqueeGraphics?.clear();
  ctx.state.marquee = undefined;
};

/**
 * Unsubscribe a drag session's stable move/up listeners from the stage. A no-op when
 * headless or when {@link attachMarqueeListener} has not run; safe to call twice.
 *
 * @param state - editor-selection plugin state (holds the stage + keys the listener map).
 * @example
 * ```ts
 * detachMarqueeDrag(ctx.state); // on pointerup / abort
 * ```
 */
const detachMarqueeDrag = (state: State): void => {
  const pair = marqueeListeners.get(state);
  const { stage } = state;
  if (!pair || !stage) return;
  stage.off("globalpointermove", pair.move);
  stage.off("pointerup", pair.up);
  stage.off("pointerupoutside", pair.up);
};

/**
 * Wire the stage-level marquee drag off Pixi's federated pointer dispatch (the
 * `editor-gizmos` drag model — no `scheduler` edge; a marquee is a gesture, not a poll).
 * A primary `pointerdown` resolving NO entity under the pointer (empty space — an entity
 * click is the pick listener's, so the two paths never conflict) starts a candidate drag;
 * `globalpointermove` redraws the dashed rect once the drag passes `MARQUEE_THRESHOLD`;
 * `pointerup`/`pointerupoutside` projects both canvas corners through `camera.screenToWorld`
 * into a normalized world `Rect` and `selectManyInRect`s it (additive under the toggle
 * modifier or `config.multiSelect`) — or, sub-threshold, treats the gesture as an empty
 * click and `applyClear`s.
 *
 * The move/up listeners live only for the span of a drag; their stable refs are held in a
 * per-`State` `WeakMap` so no Pixi-typed field leaks onto the public `State`.
 *
 * @param ctx - The editor-selection API context (config + state + emit).
 * @returns A detach function removing the `pointerdown` listener and any live move/up
 *   listeners; a no-op detach when there is no stage (headless).
 * @example
 * ```ts
 * ctx.state.marqueeDetach = attachMarqueeListener(ctx);
 * ```
 */
export const attachMarqueeListener = (ctx: EditorSelectionApiContext): (() => void) => {
  const { stage } = ctx.state;
  if (!stage) {
    return () => {
      /* no stage to attach to (headless) — detach is a no-op */
    };
  }

  /**
   * Redraw the dashed rect for one `globalpointermove`, activating the drag the first time
   * it travels past `MARQUEE_THRESHOLD` (so a jittery click never draws a marquee).
   *
   * @param event - The Pixi federated move event (`global` is canvas-relative).
   * @example
   * ```ts
   * stage.on("globalpointermove", handleMove);
   * ```
   */
  const handleMove = (event: FederatedPointerEvent): void => {
    const drag = ctx.state.marquee;
    if (!drag) return;
    const current = { x: event.global.x, y: event.global.y };
    const travelled = Math.hypot(current.x - drag.startX, current.y - drag.startY);
    if (!drag.active && travelled < MARQUEE_THRESHOLD) return;
    drag.active = true;
    drawMarquee(ctx, { x: drag.startX, y: drag.startY }, current);
  };

  /**
   * Finalize the gesture: an active drag projects its two canvas corners into a world `Rect`
   * and selects through it; a sub-threshold drag is an empty click and clears.
   *
   * @param event - The Pixi federated up event (`global` is canvas-relative).
   * @example
   * ```ts
   * stage.on("pointerup", handleUp);
   * ```
   */
  const handleUp = (event: FederatedPointerEvent): void => {
    const drag = ctx.state.marquee;
    detachMarqueeDrag(ctx.state);
    if (!drag) return;

    const { camera } = ctx.state;
    if (!drag.active) {
      applyClear(ctx); // a sub-threshold empty press+release is a plain empty click
    } else if (camera) {
      const start = { x: drag.startX, y: drag.startY };
      const end = { x: event.global.x, y: event.global.y };
      const additive = isToggleModifier(ctx.state.input?.snapshot()) || ctx.config.multiSelect;
      selectManyInRect(ctx, worldAabbFromScreenRect(camera, start, end), additive);
    }
    cancelMarquee(ctx);
  };

  /**
   * Start a marquee candidate on a primary press over empty space, and subscribe the drag's
   * move/up listeners for the span of the gesture.
   *
   * @param event - The Pixi federated `pointerdown` (`target` is the topmost hit view).
   * @example
   * ```ts
   * stage.on("pointerdown", handleDown);
   * ```
   */
  const handleDown = (event: FederatedPointerEvent): void => {
    if ((event.buttons & PRIMARY_BUTTON) === 0) return; // the event's own live mask: a press
    if (entityOf(event.target) !== undefined) return; //   over an entity is the pick's click
    ctx.state.marquee = { startX: event.global.x, startY: event.global.y, active: false };
    stage.on("globalpointermove", handleMove);
    stage.on("pointerup", handleUp);
    stage.on("pointerupoutside", handleUp);
  };

  marqueeListeners.set(ctx.state, { move: handleMove, up: handleUp });
  stage.on("pointerdown", handleDown);

  return () => {
    stage.off("pointerdown", handleDown);
    detachMarqueeDrag(ctx.state);
    marqueeListeners.delete(ctx.state);
  };
};
