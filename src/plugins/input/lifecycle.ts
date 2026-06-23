/**
 * @file input plugin — lifecycle (onStart/onStop) and event handler factories.
 *
 * `onStart` resolves the EventTarget, attaches keyboard/pointer listeners, and
 * registers the input-stage system that rolls the per-frame snapshot.
 * `onStop` removes every tracked listener and clears the array.
 *
 * Listeners are stored in `state.listeners`. For teardown, `onStop` receives
 * only `TeardownContext` (`global` only), so we use the frozen global reference
 * as a WeakMap key to locate the listener list without mutating the frozen object.
 */
import { schedulerPlugin } from "../scheduler";
import type { World } from "../scheduler/types";
import type {
  Config,
  InputContext,
  InputSnapshot,
  KeyboardEventLike,
  PointerEventLike,
  State
} from "./types";

/**
 * Module-level WeakMap keyed on the frozen `global` object.
 *
 * The kernel freezes `ctx.global`, so we cannot write to it directly.
 * Instead we use the global reference as a stable identity key so that
 * `onStop` (which receives only `{ global }`) can locate the listener list
 * without touching the frozen object.
 */
const listenerRegistry = new WeakMap<
  object,
  Array<{ type: string; fn: EventListener; target: EventTarget }>
>();

/**
 * Structural view of `globalThis` exposing the optional DOM surface the input
 * plugin probes — `window` (default target) and `document` (selector lookup).
 * Both are optional so the plugin degrades gracefully in a node (no-DOM) runtime.
 */
type GlobalWithDom = {
  /** The browser window, used as the default `"window"` event target. */
  window?: EventTarget;
  /** The DOM document, used to resolve a selector target. */
  document?: { querySelector<T extends EventTarget>(sel: string): T | undefined };
};

// ─── handler factories (exported for unit-testing) ─────────────

/**
 * Creates a keydown event handler that updates the mutable input state.
 *
 * Ignores key-repeat events (only adds to `pressed` when the key was not
 * already in `down`). Calls `event.preventDefault()` when `doPreventDefault`
 * is true.
 *
 * @param state - The mutable input state to update.
 * @param doPreventDefault - Whether to call preventDefault on every keydown.
 * @returns A keyboard event handler function.
 * @example
 * ```ts
 * const handler = createKeydownHandler(state, config.preventDefault);
 * target.addEventListener("keydown", handler);
 * ```
 */
export const createKeydownHandler =
  (state: State, doPreventDefault: boolean) =>
  (event: KeyboardEventLike): void => {
    if (doPreventDefault) event.preventDefault();
    const { key } = event;
    if (!state.down.has(key)) {
      state.pressed.add(key);
    }
    state.down.add(key);
  };

/**
 * Creates a keyup event handler that updates the mutable input state.
 *
 * Removes the key from `down` and adds it to `released`. Calls
 * `event.preventDefault()` when `doPreventDefault` is true.
 *
 * @param state - The mutable input state to update.
 * @param doPreventDefault - Whether to call preventDefault on every keyup.
 * @returns A keyboard event handler function.
 * @example
 * ```ts
 * const handler = createKeyupHandler(state, config.preventDefault);
 * target.addEventListener("keyup", handler);
 * ```
 */
export const createKeyupHandler =
  (state: State, doPreventDefault: boolean) =>
  (event: KeyboardEventLike): void => {
    if (doPreventDefault) event.preventDefault();
    state.down.delete(event.key);
    state.released.add(event.key);
  };

/**
 * Creates a pointer event handler that keeps `state.pointer` current.
 *
 * Updates x/y from `clientX`/`clientY` and records the `buttons` bitmask.
 * Used for pointermove, pointerdown, and pointerup events.
 *
 * @param state - The mutable input state to update.
 * @returns A pointer event handler function.
 * @example
 * ```ts
 * const handler = createPointerHandler(state);
 * target.addEventListener("pointermove", handler);
 * ```
 */
export const createPointerHandler =
  (state: State) =>
  (event: PointerEventLike): void => {
    state.pointer.x = event.clientX;
    state.pointer.y = event.clientY;
    state.pointer.buttons = event.buttons;
  };

/**
 * Creates the input-stage ECS system.
 *
 * At the start of each tick this system:
 *  1. Produces a new immutable InputSnapshot from the current `down`,
 *     `pressed`, `released`, and `pointer` values.
 *  2. Stores it on `state.snapshot` (replacing the previous frame's object).
 *  3. Clears the per-frame `pressed` and `released` edge sets so that
 *     `justPressed`/`justReleased` are true for exactly one frame.
 *
 * The world and dt parameters are unused — input polling is ECS-independent.
 *
 * @param state - The mutable input state to read from and update.
 * @returns An ECS System function `(world, dt) => void`.
 * @example
 * ```ts
 * const system = createInputSystem(state);
 * scheduler.addSystem("input", system);
 * ```
 */
export const createInputSystem =
  (state: State) =>
  (_world: World, _dt: number): void => {
    const downSnapshot = new Set(state.down);
    const pressedSnapshot = new Set(state.pressed);
    const releasedSnapshot = new Set(state.released);
    const pointerSnapshot = { ...state.pointer };

    const snap: InputSnapshot = {
      /**
       * Returns true if the key is currently held this frame.
       *
       * @param key - The key identifier string.
       * @returns True when the key was in the down set when the snapshot was taken.
       * @example
       * ```ts
       * snap.isDown("ArrowRight"); // true while held
       * ```
       */
      isDown: (key: string) => downSnapshot.has(key),

      /**
       * Returns true only on the frame the key first went down.
       *
       * @param key - The key identifier string.
       * @returns True only on the frame the key transitioned to down.
       * @example
       * ```ts
       * snap.justPressed("Space"); // true only on the press frame
       * ```
       */
      justPressed: (key: string) => pressedSnapshot.has(key),

      /**
       * Returns true only on the frame the key went up.
       *
       * @param key - The key identifier string.
       * @returns True only on the frame the key transitioned to released.
       * @example
       * ```ts
       * snap.justReleased("Space"); // true only on the release frame
       * ```
       */
      justReleased: (key: string) => releasedSnapshot.has(key),
      pointer: pointerSnapshot
    };

    state.snapshot = snap;
    state.pressed.clear();
    state.released.clear();
  };

// ─── target resolution ────────────────────────────────────────

/**
 * Resolves `config.target` to a live EventTarget.
 *
 * - `"window"` → `globalThis.window` if present, else `globalThis` (node-safe).
 * - Any other string → `document.querySelector(selector)` if document exists.
 * - Falls back to `globalThis` when neither DOM API is available.
 *
 * @param config - Resolved input plugin configuration.
 * @returns The resolved EventTarget (falls back to globalThis when no DOM).
 * @example
 * ```ts
 * const target = resolveTarget(config);
 * target.addEventListener("keydown", handler);
 * ```
 */
const resolveTarget = (config: Readonly<Config>): EventTarget => {
  const g = globalThis as GlobalWithDom;

  if (config.target === "window") {
    return g.window ?? (globalThis as unknown as EventTarget);
  }

  return (
    g.document?.querySelector<EventTarget>(config.target) ?? (globalThis as unknown as EventTarget)
  );
};

// ─── lifecycle ────────────────────────────────────────────────

/**
 * Starts the input plugin — attaches DOM listeners and registers the input system.
 *
 * Resolves the EventTarget from `config.target`, attaches keydown/keyup
 * (when `keyboard` is true) and pointermove/pointerdown/pointerup
 * (when `pointer` is true) listeners, pushes each `{ type, fn, target }` entry
 * into `state.listeners`, registers the listener list in a module WeakMap keyed
 * on the frozen `ctx.global` for teardown, then registers the input-stage system
 * via `ctx.require(schedulerPlugin).addSystem("input", system)`.
 *
 * @param ctx - Plugin context providing `config`, `state`, and `require`.
 * @param ctx.global - Frozen global registry used as WeakMap key for teardown.
 * @param ctx.config - Resolved input configuration.
 * @param ctx.state - Input plugin mutable state.
 * @param ctx.require - Kernel require for accessing schedulerPlugin API.
 * @returns A promise that resolves when listeners are attached.
 * @example
 * ```ts
 * await start(ctx);
 * ```
 */
export const start = async (ctx: InputContext): Promise<void> => {
  const { config, state } = ctx;
  const eventTarget = resolveTarget(config);
  const system = createInputSystem(state);

  /**
   * Register a listener and track it for teardown.
   *
   * @param type - The DOM event type string.
   * @param fn - The listener function to attach.
   * @example
   * ```ts
   * addListener("keydown", handler);
   * ```
   */
  const addListener = (type: string, fn: EventListener): void => {
    eventTarget.addEventListener(type, fn);
    state.listeners.push({ type, fn, target: eventTarget });
  };

  if (config.keyboard) {
    addListener(
      "keydown",
      createKeydownHandler(state, config.preventDefault) as unknown as EventListener
    );
    addListener(
      "keyup",
      createKeyupHandler(state, config.preventDefault) as unknown as EventListener
    );
  }

  if (config.pointer) {
    const pointerFunction = createPointerHandler(state) as unknown as EventListener;
    addListener("pointermove", pointerFunction);
    addListener("pointerdown", pointerFunction);
    addListener("pointerup", pointerFunction);
  }

  // Register the listener list in the module WeakMap keyed on the frozen global
  // reference so onStop (TeardownContext: { global } only) can locate it.
  listenerRegistry.set(ctx.global, state.listeners);

  ctx.require(schedulerPlugin).addSystem("input", system);
};

/**
 * Stops the input plugin — removes all tracked DOM listeners and clears the array.
 *
 * Reads the listener list from the module WeakMap (keyed on `ctx.global`, stashed
 * by onStart) and calls `target.removeEventListener(type, fn)` for each entry.
 * Empties the array and removes the WeakMap entry so stop() is idempotent.
 *
 * @param ctx - Teardown context (only `global` is available at stop time).
 * @param ctx.global - Frozen global registry used as WeakMap lookup key.
 * @returns A promise that resolves when all listeners have been removed.
 * @example
 * ```ts
 * await stop(ctx);
 * ```
 */
export const stop = async (ctx: { readonly global: object }): Promise<void> => {
  const listeners = listenerRegistry.get(ctx.global);
  if (!listeners) return;
  for (const { type, fn, target } of listeners) {
    target.removeEventListener(type, fn);
  }
  listeners.length = 0;
  listenerRegistry.delete(ctx.global);
};
