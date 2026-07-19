/**
 * @file editor-selection plugin — public type surface (Config, State, Events, PickableView,
 * Rect, MarqueeDrag, Api).
 */
import type { Container, Graphics } from "pixi.js";
import type { Api as CameraApi, Point } from "../camera/types";
import type { Entity, World } from "../ecs/types";
import type { Api as InputApi } from "../input/types";
import type { Api as RendererApi } from "../renderer/types";

/**
 * editor-selection plugin configuration — defaults applied when a consumer omits a field.
 */
export type Config = {
  /**
   * Name of the **camera layer** made interactive + hit-tested for picking. Must be a layer the
   * `camera` plugin knows (`camera.layer(name)`); `"world"` is the camera's default world layer
   * where `renderer.attach` + `camera.world.addChild` place entity views.
   *
   * @default "world"
   */
  pickLayer: string;
  /**
   * When `true`, `select`/`toggle` are **additive** (a new pick adds to the set) and a marquee
   * unions its hits into the current selection; when `false`, a plain `select` **replaces** the
   * selection with the one entity (a held Ctrl/Cmd still toggles the single item). The framework
   * default stays `false` so non-editor games keep single-select; the editor **app** sets `true`.
   *
   * @default false
   */
  multiSelect: boolean;
  /**
   * Enable the **drag marquee**: a primary drag on empty pick-layer space (past the marquee
   * threshold) draws a dashed screen-space overlay rect and, on release, selects every entity
   * whose world-space bounds intersect it. When `false`, the marquee overlay is never built and
   * empty-space drags do nothing (an empty click still clears). Only ever active while `enable()`
   * has run on a real stage.
   *
   * @default true
   */
  marquee: boolean;
};

/**
 * editor-selection event contract — the ONE reactive editor emit (coarse, user-gesture frequency;
 * spec/01 §2 kernel-bypass respected — never per-frame).
 */
export type Events = {
  /** Fired after the selection set actually changes; payload is a fresh immutable snapshot. */
  "editor-selection:changed": { selected: readonly Entity[] };
};

/** A view that may carry the non-enumerable `entity` handle (mirrors the ecs `__id` shape). */
export type PickableView = { entity?: Entity };

/** A world-space axis-aligned rectangle (top-left origin + size) — the `selectInRect` argument. */
export type Rect = { x: number; y: number; width: number; height: number };

/**
 * An in-flight marquee drag — the canvas-space start corner and whether it has crossed the
 * threshold (so a sub-threshold release is treated as an empty click, not a zero-area marquee).
 * `undefined` on `State.marquee` means "no marquee drag in progress".
 */
export type MarqueeDrag = {
  /** Canvas-relative x where the drag started (origin = canvas top-left). */
  readonly startX: number;
  /** Canvas-relative y where the drag started. */
  readonly startY: number;
  /** True once the drag has travelled past the marquee threshold (a real marquee, not a click). */
  active: boolean;
};

/**
 * editor-selection plugin state — the selection set, the enabled flag, the captured deps, the
 * pointer-edge bookkeeping, and the marquee overlay chrome + drag session. All dep handles are
 * captured once in `onStart` (the `camera` precedent).
 */
export type State = {
  /** Set true in `onStart` (deps captured). Pre-start API calls are guarded. */
  started: boolean;
  /** True between `enable()` and `disable()`: the pick layer is interactive and the listener is attached. */
  enabled: boolean;
  /** The current selection. Mutated by `select`/`toggle`/`clear`; `selected()` returns a pruned copy. */
  readonly selected: Set<Entity>;
  /**
   * The ecs world (captured in `onStart`) — `isAlive` recycled-id guard + `liveEntities` for
   * stamping and the marquee scan.
   */
  world: World | undefined;
  /**
   * The renderer API (captured) — `getEntityView` (stamping + marquee bounds), `getView` (canvas),
   * `getStage` (marquee overlay parent).
   */
  renderer: RendererApi | undefined;
  /**
   * The camera API (captured) — `layer` (pick layer) + `screenToWorld` (pipeline + marquee corners).
   */
  camera: CameraApi | undefined;
  /**
   * The input API (captured) — `snapshot()` for the live listener's pointer, button mask, and
   * modifier keys.
   */
  input: InputApi | undefined;
  /** The captured pick-layer Container (`camera.layer(config.pickLayer)`); `undefined` headless / disabled. */
  pickLayer: Container | undefined;
  /** The Pixi canvas (`renderer.getView()`) for `clientX/Y → canvas-relative`; `undefined` headless. */
  canvas: HTMLCanvasElement | undefined;
  /** Detaches the native pick `pointerdown` listener; set by `enable()`, called by `disable()`; else `undefined`. */
  detach: (() => void) | undefined;
  /** The renderer stage captured in `onStart` (marquee overlay parent); `undefined` headless. */
  stage: Container | undefined;
  /** The screen-space marquee overlay Container parented on the stage; `undefined` headless / `marquee:false`. */
  marqueeOverlay: Container | undefined;
  /** The dashed rectangle drawn during a marquee drag (inside `marqueeOverlay`); `undefined` headless / `marquee:false`. */
  marqueeGraphics: Graphics | undefined;
  /** The in-flight marquee drag, or `undefined` when idle. */
  marquee: MarqueeDrag | undefined;
  /** Detaches the marquee `pointerdown` listener; set by `enable()`, called by `disable()`; else `undefined`. */
  marqueeDetach: (() => void) | undefined;
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

/** Public API surface (`app["editor-selection"]`). */
export type Api = {
  /** Enter edit mode: make the pick layer interactive, stamp live views, attach the pointerdown listener, and (when `config.marquee`) show + wire the marquee overlay. No-op headless / before start / if the layer is missing. */
  enable(): void;
  /** Leave edit mode: detach the pick + marquee listeners, hide the marquee overlay, and stop hit-testing. Idempotent. Aborts an in-flight marquee WITHOUT selecting. Does NOT clear the selection. */
  disable(): void;
  /** Select an entity (replaces in single-select, adds with `multiSelect`); ignores a despawned entity. Emits `editor-selection:changed` iff the set changed. */
  select(entity: Entity): void;
  /** Toggle an entity's membership (the Ctrl/Cmd-click path); ignores a despawned entity. Emits `editor-selection:changed` iff the set changed. */
  toggle(entity: Entity): void;
  /** Clear the selection. Emits `editor-selection:changed` iff the set was non-empty. */
  clear(): void;
  /** The current selection as a fresh immutable array, pruned of despawned entities (never the live Set). */
  selected(): readonly Entity[];
  /** Whether an entity is currently selected (and still alive). */
  isSelected(entity: Entity): boolean;
  /** Resolve the topmost entity under a canvas-relative screen point via the non-enumerable handle; `undefined` if nothing hit / headless / disabled. */
  pickAt(screen: Point): Entity | undefined;
  /**
   * Select every stamped, still-alive entity whose **world-space bounds intersect** `rect` (world
   * space). Additive — unions into the current selection — when `config.multiSelect` is on;
   * otherwise it **replaces** the selection. (The marquee passes its own additive flag when the
   * toggle modifier was held for the gesture.) Emits `editor-selection:changed` iff the set
   * changed. No-op before start / headless.
   *
   * @param rect - A world-space axis-aligned rectangle.
   */
  selectInRect(rect: Rect): void;
};
