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
  /**
   * Accumulated wheel/trackpad delta for this frame (`deltaMode`-normalized to
   * pixels); `{ 0, 0 }` on a frame with no wheel motion.
   */
  readonly wheel: { readonly deltaX: number; readonly deltaY: number };
};

/** input plugin configuration. */
export type Config = {
  /** DOM target: "window" or a selector. `@default "window"` */
  target: string;
  /** Track pointer. `@default true` */
  pointer: boolean;
  /** Track keyboard. `@default true` */
  keyboard: boolean;
  /** Track mouse-wheel / trackpad delta (accumulated per frame). `@default true` */
  wheel: boolean;
  /** preventDefault on tracked key/wheel events. `@default false` */
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
  /**
   * Accumulated wheel delta since the last snapshot (`deltaMode`-normalized to
   * pixels); reset to `{ 0, 0 }` each input-stage tick.
   */
  wheel: { deltaX: number; deltaY: number };
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
  /**
   * Inject a key-down, exactly as a real `keydown` event would. The key is added
   * to the held set (and, if newly down, the just-pressed edge); the next
   * input-stage tick snapshots it. Stays held until {@link Api.keyUp}.
   *
   * Applied immediately (between frames) — NOT command-buffered — so the next
   * snapshot observes it. Lets an agent/test drive gameplay programmatically.
   *
   * @param key - The key identifier (e.g. "ArrowRight", "Space").
   * @example
   * ```ts
   * app.input.keyDown("ArrowRight"); // hold right
   * ```
   */
  keyDown(key: string): void;
  /**
   * Inject a key-up, exactly as a real `keyup` event would — removes the key from
   * the held set and records the just-released edge for the next snapshot.
   *
   * @param key - The key identifier to release.
   * @example
   * ```ts
   * app.input.keyUp("ArrowRight"); // stop holding right
   * ```
   */
  keyUp(key: string): void;
  /**
   * Inject a one-frame tap: the next snapshot reports `justPressed` and
   * `justReleased` for the key, and the key never sticks in the held set. Ideal
   * for discrete actions (jump, fire, confirm) where holding is not required.
   *
   * @param key - The key identifier to tap.
   * @example
   * ```ts
   * app.input.keyPress("Space"); // single tap
   * ```
   */
  keyPress(key: string): void;
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

/**
 * Minimal structural wheel event shape used by the wheel handler factory.
 *
 * Declared here (not imported from lib.dom) because the tsconfig targets
 * ESNext with no DOM lib — mirrors {@link KeyboardEventLike}/{@link PointerEventLike}.
 */
export type WheelEventLike = {
  /** Raw horizontal wheel delta, in units given by `deltaMode`. */
  readonly deltaX: number;
  /** Raw vertical wheel delta, in units given by `deltaMode`. */
  readonly deltaY: number;
  /** `0` = pixels, `1` = lines, `2` = pages (matches `WheelEvent.deltaMode`). */
  readonly deltaMode: number;
  /** Prevents the default browser action for the event. */
  preventDefault(): void;
};
