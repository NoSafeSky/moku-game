/**
 * @file input plugin — type definitions.
 */

/** Immutable per-frame input snapshot exposed to systems. */
export type InputSnapshot = {
  /** True if the key is currently held. */
  isDown(key: string): boolean;
  /** True only on the frame the key went down. */
  justPressed(key: string): boolean;
  /** True only on the frame the key went up. */
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
  /** The current frame's immutable input snapshot. */
  snapshot(): InputSnapshot;
};
