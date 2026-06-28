/**
 * @file renderer plugin — type definitions.
 *
 * All Pixi types are confined to this file and the other renderer domain files.
 * Nothing leaks past the plugin boundary except HTMLCanvasElement (getView) and
 * Container (attach/getStage) — both are structural handles, not Pixi internals.
 */
import type { Application, Container } from "pixi.js";
import type { Component, Entity } from "../ecs/types";

/**
 * JSON-serialisable snapshot of one Pixi display object, returned by {@link Api.tree}.
 *
 * Plain data only — no Pixi types leak past the renderer boundary. `text` is present
 * only for Pixi `Text` nodes. `children` is the recursive sub-tree (depth-capped).
 */
export type SceneNode = {
  /** The display object's `label` (user-set name), or "" when unlabelled. */
  label: string;
  /** Best-effort node kind: "Text", "Graphics", "Sprite", or "Container". */
  type: string;
  /** Local X position in pixels. */
  x: number;
  /** Local Y position in pixels. */
  y: number;
  /** Rotation in radians. */
  rotation: number;
  /** Horizontal scale factor. */
  scaleX: number;
  /** Vertical scale factor. */
  scaleY: number;
  /** Whether the node is visible. */
  visible: boolean;
  /** Node alpha (0–1). */
  alpha: number;
  /** Computed bounds width in pixels. */
  width: number;
  /** Computed bounds height in pixels. */
  height: number;
  /** The string content of a Pixi `Text` node (omitted for non-text nodes). */
  text?: string;
  /** Child nodes, in z-order. */
  children: SceneNode[];
};

/**
 * Shared style fields for every {@link PrimitiveSpec} shape. Plain data — color
 * ints (e.g. `0xff0000`), no Pixi types. `label` sets the resulting node's Pixi
 * label so {@link Api.tree} reports it.
 */
export type PrimitiveStyle = {
  /** Fill color as a hex int (e.g. `0xff0000`), or undefined for no fill. */
  fill?: number;
  /** Stroke color as a hex int, or undefined for no stroke. */
  stroke?: number;
  /** Stroke width in pixels. Default: 1 (when a stroke color is set). */
  strokeWidth?: number;
  /** Node opacity, 0–1. Default: 1. */
  alpha?: number;
  /** Pixi node label so {@link Api.tree} can report it. */
  label?: string;
};

/**
 * JSON-describable primitive shape + style, built into a Pixi `Graphics` by the
 * renderer's `attachPrimitive`. A discriminated union over `shape`; no Pixi types
 * leak past the renderer boundary.
 */
export type PrimitiveSpec =
  | ({ shape: "rect"; width: number; height: number } & PrimitiveStyle)
  | ({ shape: "circle"; radius: number } & PrimitiveStyle)
  | ({ shape: "line"; x2: number; y2: number } & PrimitiveStyle)
  | ({
      shape: "polygon";
      points: ReadonlyArray<{ x: number; y: number }>;
    } & PrimitiveStyle);

/** Transform component value shape (renderer defines and reads it on the ecs world). */
export type TransformValue = {
  /** X position in world-space pixels. */
  x: number;
  /** Y position in world-space pixels. */
  y: number;
  /** Rotation in radians. */
  rotation: number;
  /** Horizontal scale factor. */
  scaleX: number;
  /** Vertical scale factor. */
  scaleY: number;
};

/** renderer plugin configuration. */
export type Config = {
  /** Canvas width in CSS pixels. Default: 800. */
  width: number;
  /** Canvas height in CSS pixels. Default: 600. */
  height: number;
  /** Background fill color (hex). Default: 0x000000. */
  background: number;
  /** Device-pixel-ratio resolution; 0 = window.devicePixelRatio. Default: 0. */
  resolution: number;
  /** Enable antialiasing. Default: true. */
  antialias: boolean;
  /** CSS selector for auto-mounting the canvas, or undefined for headless/manual. Default: undefined. */
  mount: string | undefined;
  /**
   * Run without Pixi/GPU. When true, onStart skips Application creation/init and
   * leaves the app undefined; render()/getView()/getStage() become safe no-ops.
   * Auto-detected when omitted: true if there is no DOM (typeof document === "undefined"),
   * else false. An explicit value always overrides auto-detection.
   *
   * @default auto-detected (no DOM → true)
   */
  headless: boolean;
};

/** renderer plugin mutable state. */
export type State = {
  /** The Pixi Application, undefined until onStart completes. */
  app: Application | undefined;
  /**
   * The Transform component token, defined once in onStart and shared with
   * the API getter and the sync system. Undefined before onStart.
   */
  transformToken: Component<TransformValue> | undefined;
  /** Per-entity Pixi display objects, keyed by Entity handle. */
  readonly views: Map<Entity, Container>;
  /** Entities whose Transform changed since the last sync tick. */
  readonly dirty: Set<Entity>;
};

/** renderer plugin public API (exposed as app.renderer). */
export type Api = {
  /**
   * The Transform component this plugin defines on the ecs world.
   * Call `app.renderer.Transform({ x, y, rotation, scaleX, scaleY })` to spawn with a transform.
   */
  readonly Transform: Component<TransformValue>;
  /**
   * Attach a Pixi Container to an entity. The sync system will reposition it
   * each tick according to the entity's Transform component.
   *
   * @param entity - The entity to attach the view to.
   * @param view - A Pixi Container (or subclass) to display.
   */
  attach(entity: Entity, view: Container): void;
  /**
   * Detach and dispose the entity's Pixi Container. Idempotent.
   *
   * @param entity - The entity whose view should be removed.
   */
  detach(entity: Entity): void;
  /**
   * Draw the current frame. No-op before start. Called by the loop plugin.
   */
  render(): void;
  /**
   * Return the Pixi canvas for manual DOM mounting, or undefined before start.
   *
   * @returns The HTMLCanvasElement, or undefined.
   */
  getView(): HTMLCanvasElement | undefined;
  /**
   * Return the root Pixi stage Container, or undefined before start.
   *
   * @returns The root Container, or undefined.
   */
  getStage(): Container | undefined;
  /**
   * Mark an entity dirty so the sync system repositions its view on the next tick.
   *
   * @param entity - The entity whose Transform has changed.
   */
  markDirty(entity: Entity): void;
  /**
   * Capture the current frame as a PNG **data URL** via Pixi's `extract` system.
   *
   * Uses `app.renderer.extract.base64(stage)`, which re-renders into an extract target,
   * so the result is correct regardless of frame timing (unlike reading the WebGL
   * backbuffer, which can be blank when not captured immediately after a draw).
   * Resolves to `undefined` when headless / before start.
   *
   * @returns A Promise resolving to a `data:image/png;base64,...` URL, or `undefined`.
   */
  screenshot(): Promise<string | undefined>;
  /**
   * Return a JSON-serialisable snapshot of the Pixi scene graph rooted at the stage,
   * or `undefined` when headless / before start. Useful for reading on-screen
   * positions and text (e.g. an agent inspecting the running game).
   *
   * @returns The root {@link SceneNode}, or `undefined`.
   */
  tree(): SceneNode | undefined;
  /**
   * Build a Pixi `Graphics` from `spec`, add it to the stage, and register it
   * (views + dirty) so the sync system positions it from the entity's `Transform`.
   *
   * Unlike {@link attach}, this method does the `stage.addChild` itself so an
   * MCP-spawned entity actually renders without the caller needing a stage handle.
   * Returns `false` when headless / before start (no app) — nothing is added.
   *
   * @param entity - The entity to associate the primitive view with.
   * @param spec - Plain JSON-describable shape + style (no Pixi types).
   * @returns `true` when the primitive was added to the stage; `false` when headless.
   * @example
   * ```ts
   * const ok = api.attachPrimitive(entity, { shape: "circle", radius: 10, fill: 0xff0000 });
   * ```
   */
  attachPrimitive(entity: Entity, spec: PrimitiveSpec): boolean;
};

/**
 * Shape stored in the module-level WeakMap keyed on ctx.global.
 * onStop reads this because it only receives TeardownContext ({ global }).
 * When headless, app is undefined and app.destroy() is skipped.
 */
export type TeardownEntry = {
  /** The Pixi Application to destroy, or undefined when headless. */
  readonly app: Application | undefined;
  /** The views map, so onStop can dispose managed containers. */
  readonly views: Map<Entity, Container>;
};
