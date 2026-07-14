/**
 * @file editor-gizmos plugin — federated pointer-event drag pipeline.
 *
 * Event-driven (no `scheduler`/`input` edge — see the spec's Dependency note): `onStart`
 * wires each axis child of the handle with `eventMode: "static"` and a `pointerdown`
 * listener carrying that child's {@link GizmoAxis} via {@link attachInteraction}.
 * `onHandleDown` captures the drag's start position + world-space grab origin and
 * subscribes `globalpointermove`/`pointerup`/`pointerupoutside` on `state.stage` for the
 * duration of the drag; `onGlobalMove` recomputes `camera.screenToWorld` FRESH on every
 * event (never cached — the anti-drift discipline) and moves only chrome (the entity's
 * view + the handle) — no ECS write; `onGlobalUp` commits the net delta through `commands`
 * (or an injected `editor-history` sink), gesture-coalesced into one undo step, then
 * unsubscribes. `abortDrag` (called by `api.ts`'s `disable()`) clears an in-flight drag
 * WITHOUT committing and re-syncs the entity's view from its unchanged `Transform`.
 *
 * `syncHandle`/`placeHandle` also live here (not `api.ts`) so both the drag pipeline and
 * `enable()` share the exact same handle-positioning logic — `api.ts` imports them.
 */
import type { Container, FederatedPointerEvent } from "pixi.js";
import type { Point } from "../camera/types";
import type { Command } from "../commands/types";
import type { GizmosApiContext } from "./api";
import { computeTarget } from "./math";
import type { ActiveDrag, GizmoAxis, State } from "./types";

/** One handle child + the drag axis a `pointerdown` on it should start. */
export type AxisChild = {
  /** The Pixi view to wire a `pointerdown` listener onto. */
  readonly view: Container;
  /** The axis a drag started on this child is constrained to. */
  readonly axis: GizmoAxis;
};

/** A drag session's stable `globalpointermove`/`pointerup` listener pair. */
type DragListenerPair = {
  /** The `globalpointermove` handler. */
  readonly move: (event: FederatedPointerEvent) => void;
  /** The `pointerup`/`pointerupoutside` handler. */
  readonly up: (event: FederatedPointerEvent) => void;
};

/**
 * Private companion map from a plugin's state object to its stable move/up listener pair
 * (created once by {@link attachInteraction}), so `onHandleDown` / `onGlobalUp` / `abortDrag`
 * can subscribe/unsubscribe the EXACT SAME function references across the plugin's whole
 * lifetime without adding a Pixi-typed field to the public `State` shape.
 */
const dragListeners = new WeakMap<State, DragListenerPair>();

/**
 * Subscribe the drag session's `globalpointermove`/`pointerup`/`pointerupoutside`
 * listeners onto `state.stage`. A no-op when headless or when `attachInteraction` has not
 * run yet.
 *
 * @param ctx - The editor-gizmos API context.
 * @example
 * ```ts
 * attachDragListeners(ctx); // called by onHandleDown at the start of a drag
 * ```
 */
const attachDragListeners = (ctx: GizmosApiContext): void => {
  const pair = dragListeners.get(ctx.state);
  const { stage } = ctx.state;
  if (!pair || !stage) return;
  stage.on("globalpointermove", pair.move);
  stage.on("pointerup", pair.up);
  stage.on("pointerupoutside", pair.up);
};

/**
 * Unsubscribe the drag session's `globalpointermove`/`pointerup`/`pointerupoutside`
 * listeners from `state.stage`. A no-op when headless or when `attachInteraction` has not
 * run yet; safe to call even when the listeners are already detached.
 *
 * @param ctx - The editor-gizmos API context.
 * @example
 * ```ts
 * detachDragListeners(ctx); // called on pointerup and on abort
 * ```
 */
const detachDragListeners = (ctx: GizmosApiContext): void => {
  const pair = dragListeners.get(ctx.state);
  const { stage } = ctx.state;
  if (!pair || !stage) return;
  stage.off("globalpointermove", pair.move);
  stage.off("pointerup", pair.up);
  stage.off("pointerupoutside", pair.up);
};

/**
 * Place the handle's screen position from a world-space point via `camera.worldToScreen`.
 * A no-op when headless (no handle) or before `onStart` has captured the camera API.
 *
 * @param ctx - The editor-gizmos API context.
 * @param worldPoint - The world-space point to place the handle at.
 * @example
 * ```ts
 * placeHandle(ctx, { x: view.x, y: view.y });
 * ```
 */
export const placeHandle = (ctx: GizmosApiContext, worldPoint: Point): void => {
  const { handle, camera } = ctx.state;
  if (!handle || !camera) return;
  const screen = camera.worldToScreen(worldPoint);
  handle.position.set(screen.x, screen.y);
};

/**
 * Sync the handle to the current selection: places it at the first selected entity's
 * view position (world space, via `renderer.getEntityView`) and shows it, or hides it
 * when nothing is selected / the selected entity has no view. A no-op when headless (no
 * handle). Called by `enable()` and after a drag commits.
 *
 * @param ctx - The editor-gizmos API context.
 * @example
 * ```ts
 * syncHandle(ctx);
 * ```
 */
export const syncHandle = (ctx: GizmosApiContext): void => {
  const { handle, selection, renderer } = ctx.state;
  if (!handle) return;

  const entity = selection?.selected()[0];
  if (entity === undefined) {
    handle.visible = false;
    return;
  }

  const view = renderer?.getEntityView(entity);
  if (!view) {
    handle.visible = false;
    return;
  }

  placeHandle(ctx, { x: view.x, y: view.y });
  handle.visible = true;
};

/**
 * Build (and, for a real axis change, apply) the `setField` `Transform` command for one
 * axis of the drag's commit, routing through the injected gesture sink when present, else
 * straight through `commands.apply`. A no-op axis whose target equals its start value is
 * skipped (the trivial `commands` CF4 dedupe).
 *
 * @param ctx - The editor-gizmos API context.
 * @param drag - The drag being committed.
 * @param field - Which `Transform` field this axis writes.
 * @param value - The target value for this axis.
 * @param start - The axis's value at pointerdown (the no-op-dedupe comparison base).
 * @example
 * ```ts
 * commitAxis(ctx, drag, "x", target.x, drag.startX);
 * ```
 */
const commitAxis = (
  ctx: GizmosApiContext,
  drag: ActiveDrag,
  field: "x" | "y",
  value: number,
  start: number
): void => {
  if (value === start) return;
  const command: Command = {
    kind: "setField",
    id: drag.editorId,
    component: "Transform",
    field,
    value
  };
  if (ctx.state.gestureSink) ctx.state.gestureSink.applyTracked(command);
  else ctx.state.commands?.apply(command);
};

/**
 * Handle one `pointerdown` on an axis child of the handle: only when the gizmo is enabled
 * and no drag is already active, captures the target entity's `EditorId` + start position
 * (`renderer.getEntityView`) and the pointer's world-space grab origin
 * (`camera.screenToWorld` — the ONE value captured once), opens the gesture sink, and
 * subscribes the drag's move/up listeners onto the stage. Warns + no-ops when nothing is
 * selected, the selection is not editor-owned, or it has no attached view.
 *
 * @param ctx - The editor-gizmos API context.
 * @param axis - Which axis this handle child constrains the drag to.
 * @param event - The Pixi federated `pointerdown` event (`event.global` is canvas-relative).
 * @example
 * ```ts
 * view.on("pointerdown", (event) => onHandleDown(ctx, "xy", event));
 * ```
 */
const onHandleDown = (
  ctx: GizmosApiContext,
  axis: GizmoAxis,
  event: FederatedPointerEvent
): void => {
  if (!ctx.state.enabled || ctx.state.drag) return;

  const entity = ctx.state.selection?.selected()[0];
  if (entity === undefined) return;

  const editorId = ctx.state.commands?.editorIdOf(entity);
  if (editorId === undefined) {
    ctx.log.warn(
      `[editor-gizmos] onHandleDown — entity ${entity} is not editor-owned; drag ignored.`
    );
    return;
  }

  const view = ctx.state.renderer?.getEntityView(entity);
  if (!view) {
    ctx.log.warn(
      `[editor-gizmos] onHandleDown — entity ${entity} has no attached view; drag ignored.`
    );
    return;
  }

  const originWorld = ctx.state.camera?.screenToWorld(event.global) ?? { x: 0, y: 0 };
  ctx.state.drag = { entity, editorId, axis, startX: view.x, startY: view.y, originWorld };
  ctx.state.gestureSink?.begin();
  attachDragListeners(ctx);
};

/**
 * Handle one `globalpointermove` during an active drag: recomputes `camera.screenToWorld`
 * FRESH from this event (never cached — the anti-drift discipline), derives the target via
 * `computeTarget`, and moves ONLY chrome (the entity's live-preview view position + the
 * handle) — no ECS write happens until `pointerup`. A no-op when no drag is active.
 *
 * @param ctx - The editor-gizmos API context.
 * @param event - The Pixi federated `globalpointermove` event.
 * @example
 * ```ts
 * stage.on("globalpointermove", (event) => onGlobalMove(ctx, event));
 * ```
 */
const onGlobalMove = (ctx: GizmosApiContext, event: FederatedPointerEvent): void => {
  const { drag } = ctx.state;
  if (!drag) return;

  const currentWorld = ctx.state.camera?.screenToWorld(event.global) ?? drag.originWorld;
  const target = computeTarget(drag, currentWorld, ctx.state.snap);

  const view = ctx.state.renderer?.getEntityView(drag.entity);
  view?.position.set(target.x, target.y);
  placeHandle(ctx, target);
};

/**
 * Handle one `pointerup`/`pointerupoutside` ending an active drag: always detaches the
 * move/up listeners first, then — only when a drag is active — recomputes the final
 * world-space target FRESH from this event, settles the entity's view on it, commits up
 * to two `setField Transform` commands (`x`/`y`, skipping a no-op axis), closes the
 * gesture sink (one undo entry for the whole drag), clears the drag, and re-syncs the
 * handle to settle on the committed position.
 *
 * @param ctx - The editor-gizmos API context.
 * @param event - The Pixi federated `pointerup`/`pointerupoutside` event.
 * @example
 * ```ts
 * stage.on("pointerup", (event) => onGlobalUp(ctx, event));
 * ```
 */
const onGlobalUp = (ctx: GizmosApiContext, event: FederatedPointerEvent): void => {
  detachDragListeners(ctx);

  const { drag } = ctx.state;
  if (!drag) return;

  const currentWorld = ctx.state.camera?.screenToWorld(event.global) ?? drag.originWorld;
  const target = computeTarget(drag, currentWorld, ctx.state.snap);

  const view = ctx.state.renderer?.getEntityView(drag.entity);
  view?.position.set(target.x, target.y);

  if (drag.axis !== "y") commitAxis(ctx, drag, "x", target.x, drag.startX);
  if (drag.axis !== "x") commitAxis(ctx, drag, "y", target.y, drag.startY);

  ctx.state.gestureSink?.end();
  ctx.state.drag = undefined;
  syncHandle(ctx);
};

/**
 * Abort an in-flight drag WITHOUT committing (called by `api.ts`'s `disable()`): detaches
 * the move/up listeners, clears `state.drag`, and marks the entity dirty so the renderer's
 * sync system re-confirms its view from its (unchanged) `Transform` on the next tick — no
 * `commands` write ever happened, so this leaves the world exactly as it was. A no-op when
 * no drag is active.
 *
 * @param ctx - The editor-gizmos API context.
 * @example
 * ```ts
 * abortDrag(ctx); // disable() mid-drag
 * ```
 */
export const abortDrag = (ctx: GizmosApiContext): void => {
  const { drag } = ctx.state;
  if (!drag) return;
  detachDragListeners(ctx);
  ctx.state.drag = undefined;
  ctx.state.renderer?.markDirty(drag.entity);
};

/**
 * Wire the federated pointer-event drag pipeline onto the handle's axis children: creates
 * this plugin instance's stable move/up listener pair (registered once in `dragListeners`)
 * and attaches a `pointerdown` listener to each axis child that starts a drag constrained
 * to that child's axis. Called once from `lifecycle.ts`'s `start` when a stage exists.
 *
 * @param ctx - The editor-gizmos API context.
 * @param axisChildren - The handle's axis children (centre square + X/Y arrows).
 * @example
 * ```ts
 * attachInteraction(ctx, [{ view: square, axis: "xy" }, { view: xArrow, axis: "x" }]);
 * ```
 */
export const attachInteraction = (
  ctx: GizmosApiContext,
  axisChildren: readonly AxisChild[]
): void => {
  /**
   * Forward a global pointermove to the drag handler (recomputes the world delta each event).
   *
   * @param event - The Pixi federated pointer-move event.
   * @example
   * ```ts
   * stage.on("globalpointermove", move);
   * ```
   */
  const move = (event: FederatedPointerEvent): void => {
    onGlobalMove(ctx, event);
  };
  /**
   * Forward a global pointerup to the drag-commit handler (commits the net delta via `commands`).
   *
   * @param event - The Pixi federated pointer-up event.
   * @example
   * ```ts
   * stage.on("pointerup", up);
   * ```
   */
  const up = (event: FederatedPointerEvent): void => {
    onGlobalUp(ctx, event);
  };
  dragListeners.set(ctx.state, { move, up });

  for (const { view, axis } of axisChildren) {
    view.eventMode = "static";
    view.on("pointerdown", (event: FederatedPointerEvent) => {
      onHandleDown(ctx, axis, event);
    });
  }
};
