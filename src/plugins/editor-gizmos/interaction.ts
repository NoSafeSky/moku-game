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
 *
 * **Phase-1 F3** generalizes the pipeline over `state.mode`: `onHandleDown` additionally
 * captures the drag's mode + the entity's start rotation/scale + the resolved pivot anchor,
 * and the preview/commit branch on `drag.mode` via {@link sampleDrag}. Every mode reuses the
 * IDENTICAL discipline — fresh `screenToWorld` per event, chrome-only preview, pointerup-only
 * commit through the same `GestureSink`-or-`commands.apply` funnel — so only the pure math
 * (`math.ts`) and the committed `Transform` field(s) differ per mode.
 */
import type { Container, FederatedPointerEvent } from "pixi.js";
import type { Point } from "../camera/types";
import type { Command } from "../commands/types";
import type { GizmosApiContext } from "./api";
import { computeRotation, computeScale, computeTarget } from "./math";
import type { ActiveDrag, GizmoAxis, GizmoMode, State, TransformField } from "./types";

/** One handle child + the drag axis a `pointerdown` on it should start. */
export type AxisChild = {
  /** The Pixi view to wire a `pointerdown` listener onto. */
  readonly view: Container;
  /** The axis a drag started on this child is constrained to. */
  readonly axis: GizmoAxis;
};

/** The handle's per-mode sub-composites — exactly one is shown at a time (the active mode's). */
export type ModeGroups = Readonly<Record<GizmoMode, Container>>;

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
 * Private companion map from a plugin's state object to its handle's per-mode sub-composites
 * (registered once by {@link registerModeGroups} from `lifecycle.ts`), so `syncHandle` can show
 * only the active mode's group — again without adding a Pixi-typed field to the public `State`
 * shape (the {@link dragListeners} precedent). Absent when headless (no handle was built).
 */
const modeGroups = new WeakMap<State, ModeGroups>();

/**
 * Register the handle's per-mode sub-composites for this plugin instance, so `syncHandle` can
 * show only the active mode's group. Called once from `lifecycle.ts`'s `start` when a stage
 * exists.
 *
 * @param state - The plugin state instance the groups belong to.
 * @param groups - The per-mode handle sub-composites (translate / rotate / scale / rect).
 * @example
 * ```ts
 * registerModeGroups(ctx.state, { translate, rotate, scale, rect });
 * ```
 */
export const registerModeGroups = (state: State, groups: ModeGroups): void => {
  modeGroups.set(state, groups);
};

/**
 * Show only the active mode's handle sub-composite and hide the rest. A no-op when no groups
 * were registered (headless — no handle was ever built).
 *
 * @param ctx - The editor-gizmos API context.
 * @example
 * ```ts
 * showActiveModeGroup(ctx); // state.mode === "rotate" → only the ring is visible
 * ```
 */
const showActiveModeGroup = (ctx: GizmosApiContext): void => {
  const groups = modeGroups.get(ctx.state);
  if (!groups) return;
  for (const [mode, group] of Object.entries(groups)) group.visible = mode === ctx.state.mode;
};

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
 * The view's bounds centre in WORLD space: its own `position` (which mirrors the entity's
 * world-space `Transform.x`/`y`, since the renderer's sync system writes it directly) plus the
 * centre of its own untransformed local bounds — the same world-space reference frame
 * `editor-selection`'s `containsPoint` uses, so both plugins agree on what an entity's
 * world-space box is.
 *
 * @param view - The entity's Pixi view.
 * @returns The view's world-space bounds centre.
 * @example
 * ```ts
 * boundsCenter(view); // { x: 60, y: 70 } for a view at (50,60) with bounds (0,0,20,20)
 * ```
 */
const boundsCenter = (view: Container): Point => {
  const local = view.getLocalBounds();
  return {
    x: view.x + local.x + local.width / 2,
    y: view.y + local.y + local.height / 2
  };
};

/**
 * Resolve the world-space anchor a rotate/scale drag measures against: the entity's Transform
 * position for `pivot: "pivot"`, or its world-space bounds centre for `pivot: "center"`.
 * `"rect"` — the P1 bounding-box tool — ALWAYS anchors on the bounds centre, since scaling a
 * bounding box about anything else is not a box resize.
 *
 * @param ctx - The editor-gizmos API context (reads `state.pivot`).
 * @param view - The target entity's Pixi view.
 * @param mode - The mode being resolved for (`"rect"` forces the bounds centre).
 * @returns The world-space anchor point.
 * @example
 * ```ts
 * const pivotWorld = resolvePivot(ctx, view, ctx.state.mode);
 * ```
 */
const resolvePivot = (ctx: GizmosApiContext, view: Container, mode: GizmoMode): Point =>
  mode === "rect" || ctx.state.pivot === "center" ? boundsCenter(view) : { x: view.x, y: view.y };

/**
 * Sync the handle to the current selection: shows only the active mode's sub-composite, places
 * the handle at the mode's pivot anchor (world space, via `renderer.getEntityView`) and shows
 * it — or hides it when nothing is selected / the selected entity has no view. A no-op when
 * headless (no handle). Called by `enable()` and after a drag commits.
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

  showActiveModeGroup(ctx);
  placeHandle(ctx, resolvePivot(ctx, view, ctx.state.mode));
  handle.visible = true;
};

/**
 * Build (and, for a real change, apply) the `setField` `Transform` command for ONE field of
 * the drag's commit, routing through the injected gesture sink when present, else straight
 * through `commands.apply` — the single funnel every mode's commit shares, so no path skips
 * `commands` and a whole drag stays one undo entry. A field whose target equals its start
 * value is skipped (the trivial `commands` CF4 dedupe) — which is also what constrains an
 * axis-locked scale to its one axis.
 *
 * @param ctx - The editor-gizmos API context.
 * @param drag - The drag being committed.
 * @param field - Which `Transform` field to write (`x`/`y`/`rotation`/`scaleX`/`scaleY`).
 * @param value - The target value for that field.
 * @param start - The field's value at pointerdown (the no-op-dedupe comparison base).
 * @example
 * ```ts
 * commitField(ctx, drag, "rotation", sample.rotation, drag.startRotation);
 * ```
 */
const commitField = (
  ctx: GizmosApiContext,
  drag: ActiveDrag,
  field: TransformField,
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
 * One drag sample — the mode-resolved outcome of projecting the pointer's CURRENT world
 * position through that mode's pure math. Computed once per pointer event and used for both
 * the preview and (on pointerup) the commit, so the two can never disagree.
 */
type DragSample =
  /** A translate drag's target position. */
  | { readonly kind: "translate"; readonly position: Point }
  /** A rotate drag's target rotation in radians. */
  | { readonly kind: "rotate"; readonly rotation: number }
  /** A scale (or P1 rect) drag's target scale. */
  | { readonly kind: "scale"; readonly scale: Point };

/**
 * Project the pointer's current world position through the drag's mode-specific pure math.
 * `"rect"` maps to the SAME uniform-scale math as `"scale"` — the documented P1 simplification
 * (its bounds-centre anchoring is what makes it a box resize; see {@link resolvePivot}).
 *
 * @param drag - The in-flight drag (its captured mode selects the math).
 * @param currentWorld - The pointer's current world-space position (recomputed fresh by the caller).
 * @param snap - The current snap increment, interpreted by the mode (`0` disables).
 * @returns The mode-resolved {@link DragSample}.
 * @example
 * ```ts
 * const sample = sampleDrag(drag, currentWorld, ctx.state.snap);
 * ```
 */
const sampleDrag = (drag: ActiveDrag, currentWorld: Point, snap: number): DragSample => {
  if (drag.mode === "rotate") {
    return { kind: "rotate", rotation: computeRotation(drag, currentWorld, snap) };
  }
  if (drag.mode === "scale" || drag.mode === "rect") {
    return { kind: "scale", scale: computeScale(drag, currentWorld, snap) };
  }
  return { kind: "translate", position: computeTarget(drag, currentWorld, snap) };
};

/**
 * Preview a sample on CHROME ONLY — the entity's live Pixi view (and, for translate, the
 * handle that rides along with it). No ECS write happens here: an aborted drag therefore
 * leaves the world untouched, and the renderer's sync system restores the view from its
 * unchanged `Transform` on the next `markDirty`.
 *
 * @param ctx - The editor-gizmos API context.
 * @param drag - The in-flight drag (identifies the entity whose view to preview on).
 * @param sample - The mode-resolved sample to show.
 * @example
 * ```ts
 * previewSample(ctx, drag, sampleDrag(drag, currentWorld, ctx.state.snap));
 * ```
 */
const previewSample = (ctx: GizmosApiContext, drag: ActiveDrag, sample: DragSample): void => {
  const view = ctx.state.renderer?.getEntityView(drag.entity);

  if (sample.kind === "rotate") {
    if (view) view.rotation = sample.rotation;
    return;
  }
  if (sample.kind === "scale") {
    view?.scale.set(sample.scale.x, sample.scale.y);
    return;
  }

  view?.position.set(sample.position.x, sample.position.y);
  placeHandle(ctx, sample.position);
};

/**
 * Commit a sample as `setField Transform` command(s) through the shared {@link commitField}
 * funnel: rotate writes `rotation`; scale/rect write `scaleX` + `scaleY`; translate writes
 * `x`/`y` for its active axis. Called ONLY from `pointerup`.
 *
 * @param ctx - The editor-gizmos API context.
 * @param drag - The drag being committed (its start values are the dedupe base).
 * @param sample - The final mode-resolved sample.
 * @example
 * ```ts
 * commitSample(ctx, drag, sample); // inside the open gesture
 * ```
 */
const commitSample = (ctx: GizmosApiContext, drag: ActiveDrag, sample: DragSample): void => {
  if (sample.kind === "rotate") {
    commitField(ctx, drag, "rotation", sample.rotation, drag.startRotation);
    return;
  }
  if (sample.kind === "scale") {
    commitField(ctx, drag, "scaleX", sample.scale.x, drag.startScaleX);
    commitField(ctx, drag, "scaleY", sample.scale.y, drag.startScaleY);
    return;
  }

  if (drag.axis !== "y") commitField(ctx, drag, "x", sample.position.x, drag.startX);
  if (drag.axis !== "x") commitField(ctx, drag, "y", sample.position.y, drag.startY);
};

/**
 * Handle one `pointerdown` on an axis child of the handle: only when the gizmo is enabled
 * and no drag is already active, captures the target entity's `EditorId` + its full start
 * Transform (position/rotation/scale — all read off `renderer.getEntityView`, which is why
 * the gizmo needs no `ecs` edge), the mode + resolved pivot anchor, and the pointer's
 * world-space grab origin (`camera.screenToWorld` — the ONE value captured once), opens the
 * gesture sink, and subscribes the drag's move/up listeners onto the stage. Warns + no-ops
 * when nothing is selected, the selection is not editor-owned, or it has no attached view.
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

  const { mode } = ctx.state;
  const originWorld = ctx.state.camera?.screenToWorld(event.global) ?? { x: 0, y: 0 };
  ctx.state.drag = {
    entity,
    editorId,
    mode,
    axis,
    startX: view.x,
    startY: view.y,
    startRotation: view.rotation,
    startScaleX: view.scale.x,
    startScaleY: view.scale.y,
    pivotWorld: resolvePivot(ctx, view, mode),
    originWorld
  };
  ctx.state.gestureSink?.begin();
  attachDragListeners(ctx);
};

/**
 * Handle one `globalpointermove` during an active drag: recomputes `camera.screenToWorld`
 * FRESH from this event (never cached — the anti-drift discipline), derives the drag's
 * mode-resolved sample via {@link sampleDrag}, and previews it via {@link previewSample} —
 * chrome only (the entity's live-preview view + the handle) — no ECS write happens until
 * `pointerup`. A no-op when no drag is active.
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
  const sample = sampleDrag(drag, currentWorld, ctx.state.snap);
  previewSample(ctx, drag, sample);
};

/**
 * Handle one `pointerup`/`pointerupoutside` ending an active drag: always detaches the
 * move/up listeners first, then — only when a drag is active — recomputes the final
 * world-space sample FRESH from this event (the anti-drift discipline holds through the
 * very last event too), settles the entity's view preview on it, commits the drag's
 * mode-resolved `setField Transform` command(s) via {@link commitSample} (rotate →
 * `rotation`; scale/rect → `scaleX` + `scaleY`; translate → `x`/`y` for the active axis;
 * a no-op field is skipped), closes the gesture sink (one undo entry for the whole drag),
 * clears the drag, and re-syncs the handle to settle on the committed state.
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
  const sample = sampleDrag(drag, currentWorld, ctx.state.snap);
  previewSample(ctx, drag, sample);
  commitSample(ctx, drag, sample);

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
