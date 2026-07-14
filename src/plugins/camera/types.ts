/**
 * @file camera plugin — type definitions.
 *
 * The whole public surface (`app.camera`) plus the internal config/state/layer
 * shapes. The only Pixi symbol here is the structural `Container` (layer handles),
 * mirroring how `renderer` / `ui` scope Pixi in their public types; the animated
 * options re-use `tween`'s `TweenOptions` / `Easing` / `TweenHandle`, and
 * `updateStage` re-uses `scheduler`'s `Stage` — so nothing here re-declares easing
 * or the stage tuple.
 */
import type { Container } from "pixi.js";
import type { Stage } from "../scheduler/types";
import type { Easing, Api as TweenApi, TweenHandle, TweenOptions } from "../tween/types";

// ─────────────────────────────────────────────────────────────────────────────
// Config
// ─────────────────────────────────────────────────────────────────────────────

/**
 * camera plugin configuration — defaults applied when a consumer omits a field.
 */
export type Config = {
  /**
   * Initial (and seed) zoom — screen units per world unit; must be > 0.
   *
   * @default 1
   */
  zoom: number;
  /**
   * Lower clamp for zoom; `setZoom` / `zoomTo` are clamped into `[minZoom, maxZoom]`.
   *
   * @default 0.1
   */
  minZoom: number;
  /**
   * Upper clamp for zoom.
   *
   * @default 10
   */
  maxZoom: number;
  /**
   * Per-fixed-step follow smoothing in `[0,1]`: 1 = snap to the target each step,
   * smaller = laggier.
   *
   * @default 0.15
   */
  followLerp: number;
  /**
   * Reference viewport width — screen centre is `width / 2`. The renderer exposes no
   * canvas dimensions via its API, so the camera takes a reference viewport.
   *
   * @default 800
   */
  width: number;
  /**
   * Reference viewport height — screen centre is `height / 2`.
   *
   * @default 600
   */
  height: number;
  /**
   * Scheduler stage the apply system runs in. Validated by `scheduler.addSystem`.
   *
   * @default "sync"
   */
  updateStage: Stage;
};

// ─────────────────────────────────────────────────────────────────────────────
// Public surface — points, options, layers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Structural follow target — anything exposing live numeric `x` / `y` (a Pixi
 * `Container`, an entity `Transform` value, or a bare point all satisfy it).
 */
export type FollowTarget = { readonly x: number; readonly y: number };

/** A 2D point in screen or world space. */
export type Point = { x: number; y: number };

/**
 * Options for an animated camera move — the `tween` knobs that make sense for a
 * camera (a repeating / yoyo-ing camera pan is nonsensical, so `repeat` / `yoyo`
 * are intentionally omitted).
 */
export type MoveOptions = Pick<
  TweenOptions,
  "duration" | "easing" | "delay" | "onComplete" | "onUpdate"
>;

/** Options for `shake` — only the intensity → 0 decay curve is configurable. */
export type ShakeOptions = {
  /**
   * Easing curve for the intensity → 0 decay.
   *
   * @default "linear"
   */
  easing?: Easing;
};

/**
 * One transformed plane: its Pixi container + parallax factor (0 = static …
 * 1 = world … >1 = foreground).
 */
export type Layer = {
  /** The Pixi Container the camera transforms each frame. */
  readonly container: Container;
  /** Parallax factor — the container's pivot is `center * factor`, so factor < 1 scrolls slower. */
  factor: number;
};

// ─────────────────────────────────────────────────────────────────────────────
// Public API surface
// ─────────────────────────────────────────────────────────────────────────────

/** Public API surface (`app.camera`). */
export type Api = {
  /** The default world layer Container (parallax factor 1); `undefined` when headless. Add world content here. */
  readonly world: Container | undefined;
  /**
   * Create (or return the existing) named parallax layer at `factor`
   * (0 = static … 1 = world … >1 = foreground). `undefined` when headless.
   *
   * @param name - Unique layer name; re-adding an existing name returns its container (factor unchanged).
   * @param factor - Parallax factor for a newly-created layer.
   * @returns The layer Container, or `undefined` when headless.
   */
  addLayer(name: string, factor: number): Container | undefined;
  /**
   * Look up a previously-added layer Container by name.
   *
   * @param name - The layer name.
   * @returns The layer Container, or `undefined` if absent or headless.
   */
  layer(name: string): Container | undefined;

  /**
   * Continuously ease the camera toward `target.x` / `target.y` each frame; call
   * with no argument to stop following.
   *
   * @param target - A structural `{ x, y }` read live each frame, or omitted to clear.
   */
  follow(target?: FollowTarget): void;
  /**
   * Snap the camera centre immediately (clears any follow).
   *
   * @param x - New centre x in world space.
   * @param y - New centre y in world space.
   */
  setPosition(x: number, y: number): void;
  /**
   * Animated pan to `(x, y)` via `app.tween` (clears follow).
   *
   * @param x - Target centre x in world space.
   * @param y - Target centre y in world space.
   * @param opts - Optional duration / easing / delay / callbacks.
   * @returns The tween handle controlling the pan.
   */
  moveTo(x: number, y: number, opts?: MoveOptions): TweenHandle;
  /**
   * The current camera centre in world space (a fresh copy — never the mutable state object).
   *
   * @returns A copy of the current centre.
   */
  getPosition(): Point;

  /**
   * Set zoom immediately, clamped to `[minZoom, maxZoom]`.
   *
   * @param zoom - Desired zoom (screen units per world unit).
   */
  setZoom(zoom: number): void;
  /**
   * Animated zoom via `app.tween` (final value clamped to `[minZoom, maxZoom]`).
   *
   * @param zoom - Target zoom.
   * @param opts - Optional duration / easing / delay / callbacks.
   * @returns The tween handle controlling the zoom.
   */
  zoomTo(zoom: number, opts?: MoveOptions): TweenHandle;
  /**
   * The current zoom.
   *
   * @returns The current zoom.
   */
  getZoom(): number;

  /**
   * Set rotation (radians) immediately.
   *
   * @param radians - New rotation in radians.
   */
  setRotation(radians: number): void;
  /**
   * Animated rotate via `app.tween`.
   *
   * @param radians - Target rotation in radians.
   * @param opts - Optional duration / easing / delay / callbacks.
   * @returns The tween handle controlling the rotation.
   */
  rotateTo(radians: number, opts?: MoveOptions): TweenHandle;
  /**
   * The current rotation in radians.
   *
   * @returns The current rotation.
   */
  getRotation(): number;

  /**
   * Additive screen shake: offsets every layer by a random vector of `intensity`
   * px, decaying to 0 over `duration` s via `app.tween`. Replaces any in-flight shake.
   *
   * @param intensity - Initial shake magnitude in px.
   * @param duration - Decay duration in seconds.
   * @param opts - Optional decay easing.
   */
  shake(intensity: number, duration: number, opts?: ShakeOptions): void;

  /**
   * Clear all transient camera runtime (the editor **exit-play** reset — see editor-runtime's
   * `reset()` Retrofit Convention; realizes camera Follow-up F4). Recentres to `(0, 0)`, sets
   * `zoom → config.zoom` and `rotation → 0`, clears any `follow` target, and stops an in-flight
   * `shake` (`shakeIntensity → 0`). The layer containers and captured tween API stay intact.
   */
  reset(): void;

  /**
   * Map a screen-space point to world space (picking), using the current
   * centre / zoom / rotation / viewport. Works before start (reads numeric state).
   *
   * @param point - The screen-space point.
   * @returns The corresponding world-space point.
   */
  screenToWorld(point: Point): Point;
  /**
   * Map a world-space point to screen space (place UI over a world object).
   *
   * @param point - The world-space point.
   * @returns The corresponding screen-space point.
   */
  worldToScreen(point: Point): Point;
};

// ─────────────────────────────────────────────────────────────────────────────
// State (internal)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * camera plugin state — the layer registry, the live camera transform, shake, and
 * the captured tween API.
 */
export type State = {
  /** Set true in onStart (apply system registered, deps captured). Pre-start API calls are guarded no-ops. */
  started: boolean;
  /** The renderer stage captured in onStart; `undefined` when headless (no stage). */
  stage: Container | undefined;
  /** Named layers; `"world"` (factor 1) is present whenever a stage exists. Empty when headless. */
  readonly layers: Map<string, Layer>;
  /** Current smoothed camera centre in world space. */
  readonly center: { x: number; y: number };
  /** Active follow target read each frame, or `undefined` when not following. */
  follow: FollowTarget | undefined;
  /** Current zoom (seeded from config in onStart; kept within `[minZoom, maxZoom]`). */
  zoom: number;
  /** Current rotation in radians. */
  rotation: number;
  /** Current shake magnitude in px, decayed to 0 by `shakeHandle`. */
  shakeIntensity: number;
  /** The active shake-decay tween handle, or `undefined`; stopped and replaced on a fresh `shake`. */
  shakeHandle: TweenHandle | undefined;
  /** The captured `app.tween` API (set in onStart); `undefined` before start. */
  tween: TweenApi | undefined;
};

// ─────────────────────────────────────────────────────────────────────────────
// Shared structural dependency types
// ─────────────────────────────────────────────────────────────────────────────

/** The captured `app.tween` API surface the camera delegates animated moves + follow-lerp to. */
export type TweenApiReference = TweenApi;

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
