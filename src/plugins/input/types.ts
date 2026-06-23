/**
 * @file input plugin — type definitions.
 */
import type { schedulerPlugin } from "../scheduler";
import type { World } from "../scheduler/types";

/** Immutable per-frame input snapshot exposed to systems. */
export type InputSnapshot = {
  /**
   * Returns true if the key is currently held.
   *
   * @param key - The key identifier string (e.g. "ArrowRight", "Space").
   * @returns True when the key is currently in the down set.
   * @example
   * ```ts
   * if (snap.isDown("ArrowRight")) entity.position.x += speed * dt;
   * ```
   */
  isDown(key: string): boolean;
  /**
   * Returns true only on the frame the key first went down.
   *
   * @param key - The key identifier string.
   * @returns True only on the frame the key transitioned to down.
   * @example
   * ```ts
   * if (snap.justPressed("Space")) entity.jump();
   * ```
   */
  justPressed(key: string): boolean;
  /**
   * Returns true only on the frame the key went up.
   *
   * @param key - The key identifier string.
   * @returns True only on the frame the key transitioned to released.
   * @example
   * ```ts
   * if (snap.justReleased("Space")) entity.landAnimation();
   * ```
   */
  justReleased(key: string): boolean;
  /** Pointer position + button bitmask for this frame. */
  readonly pointer: { readonly x: number; readonly y: number; readonly buttons: number };
};

/** input plugin configuration. */
export type Config = {
  /** DOM target: "window" or a selector. `@default "window"` */
  target: string;
  /** Track pointer. `@default true` */
  pointer: boolean;
  /** Track keyboard. `@default true` */
  keyboard: boolean;
  /** preventDefault on tracked key events. `@default false` */
  preventDefault: boolean;
};

/** input plugin state. */
export type State = {
  /** Keys currently held. */
  readonly down: Set<string>;
  /** Keys pressed since last frame. */
  readonly pressed: Set<string>;
  /** Keys released since last frame. */
  readonly released: Set<string>;
  /** Pointer position + button bitmask. */
  pointer: { x: number; y: number; buttons: number };
  /** The current frame's snapshot exposed to systems. */
  snapshot: InputSnapshot;
  /** Bound listener handles for teardown. */
  listeners: Array<{ type: string; fn: EventListener; target: EventTarget }>;
};

/** input plugin API. */
export type Api = {
  /**
   * Returns the current frame's immutable input snapshot.
   *
   * @returns The stable InputSnapshot for the current frame/tick.
   * @example
   * ```ts
   * const snap = app.input.snapshot();
   * if (snap.justPressed("Space")) player.jump();
   * ```
   */
  snapshot(): InputSnapshot;
};

/**
 * Structural context type for the input plugin.
 *
 * Only declares the fields the plugin actually accesses so unit tests
 * can supply a minimal mock without wiring the full kernel.
 */
export type InputContext = {
  /** Global plugin registry (frozen by kernel — used as WeakMap key only). */
  readonly global: object;
  /** Resolved plugin configuration. */
  readonly config: Readonly<Config>;
  /** Input plugin mutable state. */
  readonly state: State;
  /** Require a dependency's API by plugin instance. */
  require: (plugin: typeof schedulerPlugin) => {
    /** Register a system to run during the given stage. */
    addSystem(stage: "input", system: (world: World, dt: number) => void): () => void;
  };
};

/**
 * Minimal structural keyboard event shape used by handler factories.
 *
 * Declared here (not imported from lib.dom) because the tsconfig targets
 * ESNext with no DOM lib — only Node-native globals (`EventTarget`, `Event`)
 * are available at compile time.
 */
export type KeyboardEventLike = {
  /** The key identifier string (e.g. "ArrowRight", "Space"). */
  readonly key: string;
  /** Prevents the default browser action for the event. */
  preventDefault(): void;
};

/**
 * Minimal structural pointer event shape used by handler factories.
 *
 * Declared here (not imported from lib.dom) because the tsconfig targets
 * ESNext with no DOM lib.
 */
export type PointerEventLike = {
  /** Pointer X position relative to the viewport. */
  readonly clientX: number;
  /** Pointer Y position relative to the viewport. */
  readonly clientY: number;
  /** Bitmask of currently pressed pointer buttons. */
  readonly buttons: number;
};
