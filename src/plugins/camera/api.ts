/**
 * @file camera plugin — API factory (the `app.camera` surface).
 *
 * Exposes the layer handles (`world` / `addLayer` / `layer`), follow + instant
 * setters, the animated `moveTo` / `zoomTo` / `rotateTo` (which delegate to the
 * captured `app.tween`), decaying `shake`, and the pure `screenToWorld` /
 * `worldToScreen` mapping. Mutating + animated methods are guarded no-ops before
 * start (they warn via `ctx.log`; animated methods return a dead handle) because the
 * tween API is captured in onStart; the pure readers work before start (they read
 * numeric state / config). The API never calls a dependency at call time — every
 * dependency call happens once in onStart — so its context is just
 * `{ config, state, log }`, and it reads the captured `state.tween` + layer `Map`.
 */
import { Container } from "pixi.js";
import { screenToWorld as mapScreenToWorld, worldToScreen as mapWorldToScreen } from "./transform";
import type {
  Api,
  Config,
  FollowTarget,
  Log,
  MoveOptions,
  Point,
  ShakeOptions,
  State,
  TweenApiReference
} from "./types";

/**
 * Structural context required by {@link createApi}, so unit tests can pass a minimal
 * mock without wiring the full kernel. Mirrors the tween / ui / vfx pattern — no
 * `require` (deps are captured in onStart, read here off `state`).
 */
export type CameraApiContext = {
  /** Resolved camera configuration (zoom clamps + follow smoothing + reference viewport). */
  readonly config: Readonly<Config>;
  /** camera plugin state — layers, live transform, shake, and the captured tween API. */
  readonly state: State;
  /** Logger from logPlugin (before-start no-op notices). */
  readonly log: Log;
};

/**
 * Clamp `v` into the inclusive `[lo, hi]` range.
 *
 * @param v - The value to clamp.
 * @param lo - Lower bound.
 * @param hi - Upper bound.
 * @returns `v` constrained to `[lo, hi]`.
 * @example
 * ```ts
 * clamp(50, 0.1, 10); // 10
 * ```
 */
const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

/**
 * A shared inert no-op used for the dead handle's stop/pause/resume.
 *
 * @returns Nothing.
 * @example
 * ```ts
 * const handle = { stop: inert };
 * ```
 */
const inert = (): void => undefined;

/**
 * A shared, already-settled dead handle returned by the before-start guard on the
 * animated methods — inert controls, `active: false`, and an already-resolved `done`.
 */
const DEAD_HANDLE = {
  stop: inert,
  pause: inert,
  resume: inert,
  active: false,
  done: Promise.resolve()
};

/**
 * Creates the camera plugin API surface.
 *
 * @param ctx - Plugin context (structural — only `config`, `state`, `log`).
 * @param ctx.config - Resolved camera configuration.
 * @param ctx.state - camera plugin state (layers, transform, shake, captured tween).
 * @param ctx.log - Logger from logPlugin.
 * @returns The camera plugin {@link Api} object.
 * @example
 * ```ts
 * const api = createApi(ctx);
 * api.follow(player);
 * api.shake(12, 0.4);
 * ```
 */
export const createApi = (ctx: CameraApiContext): Api => {
  /**
   * Guard a mutating method against the before-start condition.
   *
   * @param method - The method name, for the warning message.
   * @returns `true` when the call should no-op (not started), else `false`.
   * @example
   * ```ts
   * if (guardMutate("setZoom")) return;
   * ```
   */
  const guardMutate = (method: string): boolean => {
    if (ctx.state.started) return false;
    ctx.log.warn(`[camera] ${method} called before start — no-op.`);
    return true;
  };

  /**
   * Resolve the captured tween API for an animated method, or warn + return
   * undefined before start (so the caller returns a dead handle without a non-null
   * assertion on `state.tween`).
   *
   * @param method - The method name, for the warning message.
   * @returns The captured tween API, or `undefined` when not started.
   * @example
   * ```ts
   * const tween = requireTween("moveTo");
   * if (!tween) return DEAD_HANDLE;
   * ```
   */
  const requireTween = (method: string): TweenApiReference | undefined => {
    if (ctx.state.started && ctx.state.tween) return ctx.state.tween;
    ctx.log.warn(`[camera] ${method} called before start — no-op.`);
    return undefined;
  };

  /**
   * Write the tweened zoom back to state — the `onUpdate` sink for `zoomTo`.
   *
   * @param v - The interpolated zoom for this frame.
   * @example
   * ```ts
   * tween.value(from, to, { onUpdate: writeZoom });
   * ```
   */
  const writeZoom = (v: number): void => {
    ctx.state.zoom = v;
  };

  /**
   * Write the tweened rotation back to state — the `onUpdate` sink for `rotateTo`.
   *
   * @param v - The interpolated rotation (radians) for this frame.
   * @example
   * ```ts
   * tween.value(from, to, { onUpdate: writeRotation });
   * ```
   */
  const writeRotation = (v: number): void => {
    ctx.state.rotation = v;
  };

  /**
   * Write the decaying shake magnitude back to state — the `onUpdate` sink for `shake`.
   *
   * @param v - The interpolated shake magnitude for this frame.
   * @example
   * ```ts
   * tween.value(intensity, 0, { onUpdate: writeShakeIntensity });
   * ```
   */
  const writeShakeIntensity = (v: number): void => {
    ctx.state.shakeIntensity = v;
  };

  return {
    /**
     * The default world layer Container (parallax factor 1), or `undefined` when
     * headless. Add world content here so it rides the camera transform.
     *
     * @returns The world layer Container, or `undefined` when headless.
     * @example
     * ```ts
     * camera.world?.addChild(sprite);
     * ```
     */
    get world(): Container | undefined {
      return ctx.state.layers.get("world")?.container;
    },

    /**
     * Create (or return the existing) named parallax layer, stacked above `world`
     * and below the ui overlay. Idempotent by name (an existing layer's `factor` is
     * not overwritten). Returns `undefined` when headless (no stage).
     *
     * @param name - Unique layer name.
     * @param factor - Parallax factor for a newly-created layer.
     * @returns The layer Container, or `undefined` when headless.
     * @example
     * ```ts
     * const bg = api.addLayer("background", 0.5);
     * ```
     */
    addLayer(name: string, factor: number): Container | undefined {
      const { stage } = ctx.state;
      if (!stage) {
        ctx.log.warn(`[camera] addLayer("${name}") ignored — no renderer stage (headless).`);
        return undefined;
      }

      const existing = ctx.state.layers.get(name);
      if (existing) return existing.container;

      const container = new Container();
      stage.addChildAt(container, ctx.state.layers.size); // above world, below the ui overlay
      ctx.state.layers.set(name, { container, factor });
      return container;
    },

    /**
     * Look up a previously-added layer Container by name.
     *
     * @param name - The layer name.
     * @returns The layer Container, or `undefined` if absent or headless.
     * @example
     * ```ts
     * const bg = api.layer("background");
     * ```
     */
    layer(name: string): Container | undefined {
      return ctx.state.layers.get(name)?.container;
    },

    /**
     * Continuously ease the camera toward `target` each frame; omit `target` to stop
     * following. Guarded no-op before start.
     *
     * @param target - A structural `{ x, y }` read live each frame, or omitted to clear.
     * @example
     * ```ts
     * api.follow(player.transform); // follow; api.follow() to stop
     * ```
     */
    follow(target?: FollowTarget): void {
      if (guardMutate("follow")) return;
      ctx.state.follow = target;
    },

    /**
     * Snap the camera centre immediately (clears any follow). Guarded no-op before start.
     *
     * @param x - New centre x in world space.
     * @param y - New centre y in world space.
     * @example
     * ```ts
     * api.setPosition(640, 360);
     * ```
     */
    setPosition(x: number, y: number): void {
      if (guardMutate("setPosition")) return;
      ctx.state.follow = undefined;
      ctx.state.center.x = x;
      ctx.state.center.y = y;
    },

    /**
     * Animated pan to `(x, y)` via `app.tween` (clears follow). Returns a dead handle
     * before start.
     *
     * @param x - Target centre x in world space.
     * @param y - Target centre y in world space.
     * @param opts - Optional duration / easing / delay / callbacks.
     * @returns The tween handle controlling the pan.
     * @example
     * ```ts
     * await api.moveTo(640, 360, { duration: 0.6, easing: "easeOutCubic" }).done;
     * ```
     */
    moveTo(x: number, y: number, opts?: MoveOptions) {
      const tween = requireTween("moveTo");
      if (!tween) return DEAD_HANDLE;
      ctx.state.follow = undefined;
      return tween.to(ctx.state.center, { x, y }, opts);
    },

    /**
     * The current camera centre in world space (a fresh copy — mutating it does not
     * change camera state). Works before start.
     *
     * @returns A copy of the current centre.
     * @example
     * ```ts
     * const { x, y } = api.getPosition();
     * ```
     */
    getPosition(): Point {
      return { x: ctx.state.center.x, y: ctx.state.center.y };
    },

    /**
     * Set zoom immediately, clamped to `[minZoom, maxZoom]`. Guarded no-op before start.
     *
     * @param zoom - Desired zoom (screen units per world unit).
     * @example
     * ```ts
     * api.setZoom(2);
     * ```
     */
    setZoom(zoom: number): void {
      if (guardMutate("setZoom")) return;
      ctx.state.zoom = clamp(zoom, ctx.config.minZoom, ctx.config.maxZoom);
    },

    /**
     * Animated zoom via `app.tween` (final value clamped to `[minZoom, maxZoom]`).
     * Returns a dead handle before start.
     *
     * @param zoom - Target zoom.
     * @param opts - Optional duration / easing / delay / callbacks.
     * @returns The tween handle controlling the zoom.
     * @example
     * ```ts
     * api.zoomTo(1.5, { duration: 0.4 });
     * ```
     */
    zoomTo(zoom: number, opts?: MoveOptions) {
      const tween = requireTween("zoomTo");
      if (!tween) return DEAD_HANDLE;
      const target = clamp(zoom, ctx.config.minZoom, ctx.config.maxZoom);
      return tween.value(ctx.state.zoom, target, { ...opts, onUpdate: writeZoom });
    },

    /**
     * The current zoom.
     *
     * @returns The current zoom.
     * @example
     * ```ts
     * const z = api.getZoom();
     * ```
     */
    getZoom(): number {
      return ctx.state.zoom;
    },

    /**
     * Set rotation (radians) immediately. Guarded no-op before start.
     *
     * @param radians - New rotation in radians.
     * @example
     * ```ts
     * api.setRotation(Math.PI / 8);
     * ```
     */
    setRotation(radians: number): void {
      if (guardMutate("setRotation")) return;
      ctx.state.rotation = radians;
    },

    /**
     * Animated rotate via `app.tween`. Returns a dead handle before start.
     *
     * @param radians - Target rotation in radians.
     * @param opts - Optional duration / easing / delay / callbacks.
     * @returns The tween handle controlling the rotation.
     * @example
     * ```ts
     * api.rotateTo(Math.PI / 4, { duration: 0.5 });
     * ```
     */
    rotateTo(radians: number, opts?: MoveOptions) {
      const tween = requireTween("rotateTo");
      if (!tween) return DEAD_HANDLE;
      return tween.value(ctx.state.rotation, radians, { ...opts, onUpdate: writeRotation });
    },

    /**
     * The current rotation in radians.
     *
     * @returns The current rotation.
     * @example
     * ```ts
     * const r = api.getRotation();
     * ```
     */
    getRotation(): number {
      return ctx.state.rotation;
    },

    /**
     * Additive screen shake: sets the magnitude to `intensity` px and decays it to 0
     * over `duration` s via `app.tween`, replacing any in-flight shake. Guarded no-op
     * before start.
     *
     * @param intensity - Initial shake magnitude in px.
     * @param duration - Decay duration in seconds.
     * @param opts - Optional decay easing (default `"linear"`).
     * @example
     * ```ts
     * api.shake(16, 0.4); // hit impact
     * ```
     */
    shake(intensity: number, duration: number, opts?: ShakeOptions): void {
      const tween = requireTween("shake");
      if (!tween) return;
      ctx.state.shakeHandle?.stop(); // replace any in-flight shake
      ctx.state.shakeIntensity = intensity;
      ctx.state.shakeHandle = tween.value(intensity, 0, {
        duration,
        easing: opts?.easing ?? "linear",
        onUpdate: writeShakeIntensity
      });
    },

    /**
     * Map a screen-space point to world space (picking). Pure — works before start.
     *
     * @param point - The screen-space point.
     * @returns The corresponding world-space point.
     * @example
     * ```ts
     * const world = api.screenToWorld({ x: pointerX, y: pointerY });
     * ```
     */
    screenToWorld(point: Point): Point {
      return mapScreenToWorld(
        point,
        ctx.state.center,
        ctx.state.zoom,
        ctx.state.rotation,
        ctx.config.width,
        ctx.config.height
      );
    },

    /**
     * Map a world-space point to screen space (place UI over a world object). Pure —
     * works before start.
     *
     * @param point - The world-space point.
     * @returns The corresponding screen-space point.
     * @example
     * ```ts
     * const screen = api.worldToScreen({ x: enemy.x, y: enemy.y });
     * ```
     */
    worldToScreen(point: Point): Point {
      return mapWorldToScreen(
        point,
        ctx.state.center,
        ctx.state.zoom,
        ctx.state.rotation,
        ctx.config.width,
        ctx.config.height
      );
    }
  };
};
