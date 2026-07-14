/**
 * @file editor-selection plugin — public type surface (Config, State, Events, PickableView, Api).
 */
import type { Container } from "pixi.js";
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
   * **Reserved (MVP: single-select).** When `true`, `select`/`toggle` are additive; when `false`,
   * `select` replaces the selection with the one entity. The marquee / multi-select follow-up
   * flips this on. MVP ships `false`.
   *
   * @default false
   */
  multiSelect: boolean;
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

/**
 * editor-selection plugin state — the selection set, the enabled flag, the captured deps, and the
 * pointer-edge bookkeeping. All dep handles are captured once in `onStart` (the `camera` precedent).
 */
export type State = {
  /** Set true in `onStart` (deps captured). Pre-start API calls are guarded. */
  started: boolean;
  /** True between `enable()` and `disable()`: the pick layer is interactive and the listener is attached. */
  enabled: boolean;
  /** The current selection. Mutated by `select`/`toggle`/`clear`; `selected()` returns a pruned copy. */
  readonly selected: Set<Entity>;
  /** The ecs world (captured in `onStart`) — `isAlive` recycled-id guard + `liveEntities` for stamping. */
  world: World | undefined;
  /** The renderer API (captured) — `getEntityView` (stamping), `getView` (canvas rect). */
  renderer: RendererApi | undefined;
  /** The camera API (captured) — `layer` (pick layer) + `screenToWorld` (pipeline). */
  camera: CameraApi | undefined;
  /** The input API (captured) — `snapshot().pointer` for the live listener's pointer + button mask. */
  input: InputApi | undefined;
  /** The captured pick-layer Container (`camera.layer(config.pickLayer)`); `undefined` headless / disabled. */
  pickLayer: Container | undefined;
  /** The Pixi canvas (`renderer.getView()`) for `clientX/Y → canvas-relative`; `undefined` headless. */
  canvas: HTMLCanvasElement | undefined;
  /** Previous-frame primary-button mask, for press-edge derivation (the `ui` `prevButtons` precedent). */
  prevButtons: number;
  /** Detaches the native `pointerdown` listener; set by `enable()`, called by `disable()`; else `undefined`. */
  detach: (() => void) | undefined;
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
  /** Enter edit mode: make the pick layer interactive, stamp live views, attach the pointerdown listener. No-op headless / before start / if the layer is missing. */
  enable(): void;
  /** Leave edit mode: detach the listener and stop hit-testing. Idempotent. Does NOT clear the selection. */
  disable(): void;
  /** Select an entity (replaces in single-select, adds with `multiSelect`); ignores a despawned entity. Emits `editor-selection:changed` iff the set changed. */
  select(entity: Entity): void;
  /** Toggle an entity's membership; ignores a despawned entity. Emits `editor-selection:changed` iff the set changed. */
  toggle(entity: Entity): void;
  /** Clear the selection. Emits `editor-selection:changed` iff the set was non-empty. */
  clear(): void;
  /** The current selection as a fresh immutable array, pruned of despawned entities (never the live Set). */
  selected(): readonly Entity[];
  /** Whether an entity is currently selected (and still alive). */
  isSelected(entity: Entity): boolean;
  /** Resolve the topmost entity under a canvas-relative screen point via the non-enumerable handle; `undefined` if nothing hit / headless / disabled. */
  pickAt(screen: Point): Entity | undefined;
};
