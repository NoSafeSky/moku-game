/**
 * @file editor-gizmos plugin — public type surface (Config, State, ActiveDrag, GizmoMode/Axis, GestureSink, Api).
 */
import type { Container } from "pixi.js";
import type { Api as CameraApi, Point } from "../camera/types";
import type { Command, Api as CommandsApi, EditorId } from "../commands/types";
import type { Entity } from "../ecs/types";
import type { Api as EditorSelectionApi } from "../editor-selection/types";
import type { Api as RendererApi } from "../renderer/types";

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
   * Translate snap increment in WORLD units — each committed axis value is rounded to the nearest
   * multiple. `0` disables snapping. Overridable at runtime via `setSnap`.
   *
   * @default 0
   */
  snap: number;
  /**
   * MVP gate: when `true`, `setMode("rotate")` / `setMode("scale")` warn via `ctx.log` and no-op
   * (only translate is functional). Set `false` once rotate/scale ship (Follow-up F1).
   *
   * @default true
   */
  translateOnly: boolean;
};

/** The three transform-gizmo modes. MVP: only "translate" is functional; rotate/scale are Follow-up F1. */
export type GizmoMode = "translate" | "rotate" | "scale";

/** Which translate axis a drag is constrained to — "x"/"y" the single-axis arrows, "xy" the free centre handle. */
export type GizmoAxis = "x" | "y" | "xy";

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
 * An in-flight translate drag — the target, its start Transform, the world-space grab origin,
 * and the constrained axis. `undefined` on `State.drag` means "idle".
 */
export type ActiveDrag = {
  /** The entity being dragged (the first of `editor-selection.selected()` at pointerdown). */
  readonly entity: Entity;
  /** Its stable EditorId (from `commands.editorIdOf`) — the target of every `setField` command. */
  readonly editorId: EditorId;
  /** Which axis the drag is constrained to: "x"/"y" arrows, "xy" the free centre handle. */
  readonly axis: GizmoAxis;
  /** The entity's Transform.x at pointerdown (read from `renderer.getEntityView`). */
  readonly startX: number;
  /** The entity's Transform.y at pointerdown. */
  readonly startY: number;
  /** The pointer's WORLD-space position captured at pointerdown — the anchor the delta is measured from. */
  readonly originWorld: Point;
};

/**
 * editor-gizmos plugin state — the overlay chrome, the current mode/snap, the in-flight drag,
 * the optional injected history sink, and the dep APIs captured in onStart.
 */
export type State = {
  /** Set true in onStart (deps captured, overlay built if a stage exists). Pre-start API calls are guarded no-ops. */
  started: boolean;
  /** Whether the gizmo is currently showing + responding to pointer input (toggled by enable/disable). */
  enabled: boolean;
  /** The screen-space overlay Container parented on the renderer stage; `undefined` when headless. */
  overlay: Container | undefined;
  /** The translate handle composite (centre square + X/Y arrows) inside the overlay; `undefined` when headless. */
  handle: Container | undefined;
  /** The active manipulation mode. MVP: effectively always "translate" while `config.translateOnly`. */
  mode: GizmoMode;
  /** Current translate snap increment in world units (0 = off); seeded from `config.snap` in onStart. */
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
  /** Set the active manipulation mode. MVP: only `"translate"` is functional; rotate/scale warn + no-op while `config.translateOnly`. */
  setMode(mode: GizmoMode): void;
  /** Set the translate snap increment in world units (clamped to `>= 0`; `0` disables snapping). */
  setSnap(n: number): void;
  /** The current active manipulation mode. */
  mode(): GizmoMode;
  /** Inject the editor-history gesture sink (the decoupling seam — wired by `editor-bridge`); pass `undefined` to clear. */
  setGestureSink(sink: GestureSink | undefined): void;
};
