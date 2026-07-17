/**
 * @file editor-gizmos plugin — public type surface (Config, State, ActiveDrag,
 * GizmoMode/Axis/Space/Pivot, GestureSink, Api).
 *
 * **Phase-1 F3** widens `GizmoMode` with `"rect"`, adds the `GizmoSpace` / `GizmoPivot`
 * interaction-state unions, and grows `ActiveDrag` with the mode + start rotation/scale +
 * pivot anchor the rotate/scale drags measure against.
 */
import type { Container } from "pixi.js";
import type { Api as CameraApi, Point } from "../camera/types";
import type { Command, Api as CommandsApi, EditorId } from "../commands/types";
import type { Entity } from "../ecs/types";
import type { Api as EditorSelectionApi } from "../editor-selection/types";
import type { Api as RendererApi, TransformValue } from "../renderer/types";

/**
 * editor-gizmos plugin configuration — defaults applied when a consumer omits a field.
 */
export type Config = {
  /**
   * Pixi node label for the overlay Container (aids `renderer.tree()` / debugging) and the key
   * the overlay is tracked under.
   *
   * @default "editor-gizmos"
   */
  overlayLayer: string;
  /**
   * Snap increment, **mode-interpreted**: translate → world units, scale → scale-factor
   * increment, rotate → radians. `0` disables snapping. Re-seeds `state.snap` in `onStart`;
   * overridable at runtime via `setSnap`.
   *
   * @default 0
   */
  snap: number;
  /**
   * Gate: when `true`, `setMode("rotate"|"scale"|"rect")` warns via `ctx.log` and no-ops (only
   * translate is functional). Set `false` (the editor app does) to enable rotate/scale/rect.
   * The **framework default stays `true`** so non-editor / translate-only consumers are
   * unaffected.
   *
   * @default true
   */
  translateOnly: boolean;
};

/**
 * The four transform-gizmo modes. `"rect"` is the bounding-box tool — **in P1 it maps to
 * scale-on-bounds** (a uniform scale anchored on the selection's bounds centre); a true
 * independent-edge box resize is a later phase.
 */
export type GizmoMode = "translate" | "rotate" | "scale" | "rect";

/** Which axis a drag is constrained to — "x"/"y" the single-axis handles, "xy" the free centre / ring / uniform. */
export type GizmoAxis = "x" | "y" | "xy";

/**
 * The scale axis frame — world axes (`"global"`) or the object's local frame (`"local"`).
 *
 * **P1 simplifications (documented, not hidden):** 2D rotation is a single scalar, so the space
 * is a **no-op for rotate**. For scale, `"global"` is exact, while `"local"` scale-under-rotation
 * is approximated as world-axis scale (an exact local-frame scale of a rotated object is
 * Follow-up F5).
 */
export type GizmoSpace = "local" | "global";

/**
 * The drag anchor — the entity's transform origin (`"pivot"` — `view.x`/`view.y`) or its
 * world-space bounds centre (`"center"`).
 *
 * **P1 note:** for a single target the two coincide whenever the view's local bounds are
 * centred on its origin; they diverge only when the bounds are offset from it.
 */
export type GizmoPivot = "pivot" | "center";

/**
 * A field of the `Transform` component a gizmo drag can commit — the `setField` `field` key.
 * Derived from the renderer's own `TransformValue`, so the two can never drift apart.
 */
export type TransformField = keyof TransformValue;

/**
 * Injected editor-history seam — routes a gizmo drag through history so it is ONE undo entry.
 * The editor shell (`editor-bridge`) wires this to `editor-history.beginGesture` / `applyTracked`
 * / `endGesture`. `undefined` → the gizmo funnels commits straight through `commands.apply`.
 */
export type GestureSink = {
  /** Open an undo gesture at pointerdown (→ `editor-history.beginGesture`). */
  begin(): void;
  /** Apply a command inside the gesture (→ `editor-history.applyTracked`, which funnels through `commands.applyRaw`). */
  applyTracked(command: Command): void;
  /** Close the gesture at pointerup (→ `editor-history.endGesture`) — collapses the drag to one undo entry. */
  end(): void;
};

/**
 * An in-flight drag — the target, its start Transform (position/rotation/scale, all read from
 * the view), the world-space grab origin, the pivot anchor, the constrained axis, and the
 * drag's mode (so the preview + commit branch on it). `undefined` on `State.drag` means "idle".
 */
export type ActiveDrag = {
  /** The entity being dragged (the first of `editor-selection.selected()` at pointerdown). */
  readonly entity: Entity;
  /** Its stable EditorId (from `commands.editorIdOf`) — the target of every `setField` command. */
  readonly editorId: EditorId;
  /** The mode this drag applies (captured from `state.mode` at pointerdown, so a mid-drag switch cannot corrupt it). */
  readonly mode: GizmoMode;
  /** Which axis the drag is constrained to: "x"/"y" arrows/boxes, "xy" the free centre / ring / uniform. */
  readonly axis: GizmoAxis;
  /** The entity's Transform.x at pointerdown (read from `renderer.getEntityView`). */
  readonly startX: number;
  /** The entity's Transform.y at pointerdown. */
  readonly startY: number;
  /** The entity's Transform.rotation (radians) at pointerdown (`view.rotation`). */
  readonly startRotation: number;
  /** The entity's Transform.scaleX at pointerdown (`view.scale.x`). */
  readonly startScaleX: number;
  /** The entity's Transform.scaleY at pointerdown (`view.scale.y`). */
  readonly startScaleY: number;
  /** The rotate/scale anchor in WORLD space (entity position for "pivot", bounds centre for "center"). */
  readonly pivotWorld: Point;
  /** The pointer's WORLD-space position captured at pointerdown — the anchor the delta is measured from. */
  readonly originWorld: Point;
};

/**
 * editor-gizmos plugin state — the overlay chrome, the current mode/snap/space/pivot, the
 * in-flight drag, the optional injected history sink, and the dep APIs captured in onStart.
 */
export type State = {
  /** Set true in onStart (deps captured, overlay built if a stage exists). Pre-start API calls are guarded no-ops. */
  started: boolean;
  /** Whether the gizmo is currently showing + responding to pointer input (toggled by enable/disable). */
  enabled: boolean;
  /** The screen-space overlay Container parented on the renderer stage; `undefined` when headless. */
  overlay: Container | undefined;
  /** The handle composite (translate square+arrows, rotate ring, scale boxes, rect frame) inside the overlay; `undefined` when headless. */
  handle: Container | undefined;
  /** The active manipulation mode. Cannot leave "translate" while `config.translateOnly`. */
  mode: GizmoMode;
  /** The scale axis frame — "global" (world axes) or "local". P1: local scale-under-rotation is approximated. */
  space: GizmoSpace;
  /** The drag anchor — "pivot" (entity position) or "center" (world-space bounds centre). */
  pivot: GizmoPivot;
  /** Current snap increment (0 = off), mode-interpreted; seeded from `config.snap` in onStart. */
  snap: number;
  /** The in-flight drag, or `undefined` when idle. */
  drag: ActiveDrag | undefined;
  /**
   * Optional undo-gesture sink wired by the editor shell (the editor-history decoupling seam).
   * `undefined` → commits go straight through `commands.apply` with no undo recording.
   */
  gestureSink: GestureSink | undefined;
  /** The renderer stage captured in onStart; `undefined` when headless. */
  stage: Container | undefined;
  /** Captured renderer API (set in onStart); `undefined` before start. */
  renderer: RendererApi | undefined;
  /** Captured camera API (set in onStart); `undefined` before start. */
  camera: CameraApi | undefined;
  /** Captured editor-selection API (set in onStart); `undefined` before start. */
  selection: EditorSelectionApi | undefined;
  /** Captured commands API (set in onStart); `undefined` before start. */
  commands: CommandsApi | undefined;
};

/** Logger surface injected by the common logPlugin (`ctx.log`). */
export type Log = {
  /** Log at debug level. */
  debug(message: string): void;
  /** Log at info level. */
  info(message: string): void;
  /** Log a warning. */
  warn(message: string): void;
  /** Log an error. */
  error(message: string): void;
};

/** Public API surface (`app["editor-gizmos"]`). */
export type Api = {
  /** Show the gizmo overlay and begin responding to selection + pointer drags. Idempotent; no-op when headless. */
  enable(): void;
  /** Hide the overlay and stop responding to pointer input (aborts any in-flight drag WITHOUT committing). Idempotent. */
  disable(): void;
  /**
   * Set the active manipulation mode. `"rotate"`/`"scale"`/`"rect"` are accepted only when
   * `config.translateOnly` is `false`; while it is `true` they warn via `ctx.log` and no-op
   * (`mode()` stays `"translate"`).
   */
  setMode(mode: GizmoMode): void;
  /** Set the snap increment (clamped to `>= 0`; `0` disables). Mode-interpreted: world units / scale factor / radians. */
  setSnap(n: number): void;
  /** The current active manipulation mode. */
  mode(): GizmoMode;
  /** Set the scale axis frame (`"local"` / `"global"`). Pure state; works before start / headless. */
  setSpace(space: GizmoSpace): void;
  /** Set the drag anchor (`"pivot"` = entity origin / `"center"` = bounds centre). Pure state; works before start / headless. */
  setPivot(pivot: GizmoPivot): void;
  /** The current scale axis frame. */
  space(): GizmoSpace;
  /** The current drag anchor. */
  pivot(): GizmoPivot;
  /** Inject the editor-history gesture sink (the decoupling seam — wired by `editor-bridge`); pass `undefined` to clear. */
  setGestureSink(sink: GestureSink | undefined): void;
};
