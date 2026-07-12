/**
 * @file ui plugin — pointer/touch hit-test system.
 *
 * Registered in the `"update"` stage. Each frame it reads `input.snapshot().pointer`,
 * computes its own press/release edges from the button bitmask (the snapshot exposes
 * `justPressed`/`justReleased` for keys only, not pointer buttons), and fires a
 * button's `onTap` on release **over the same button armed on press**. It also toggles
 * each active button's hover fill as the pointer enters/leaves.
 *
 * **Modal capture:** only the TOP screen's buttons are active while the stack is
 * non-empty; HUD buttons are active only when the stack is empty (gameplay).
 *
 * **Headless-safe:** with no UI root (`state.root` undefined) the whole system is a
 * no-op — it never reads input or touches Pixi.
 */
import type { System, World } from "../ecs/types";
import type { ButtonView, InputDep, State } from "./types";
import { setButtonHover } from "./widgets";

/** Left mouse / primary touch bit within the pointer `buttons` bitmask. */
const PRIMARY_BUTTON = 1;

/** Dependencies the hit-test system reads. */
export type HitTestDeps = {
  /** Input surface — `snapshot().pointer` supplies position + button bitmask each frame. */
  readonly input: InputDep;
  /** ui state — the active button set, edge counters, and armed button. */
  readonly state: State;
};

/**
 * Whether the point `(x, y)` lies within the button's absolute screen-space rect.
 *
 * @param button - The button to test.
 * @param x - Pointer X in screen-space (CSS px).
 * @param y - Pointer Y in screen-space (CSS px).
 * @returns `true` when the point is inside the button's AABB.
 * @example
 * ```ts
 * if (hits(button, pointer.x, pointer.y)) { ... }
 * ```
 */
const hits = (button: ButtonView, x: number, y: number): boolean => {
  const r = button.rect;
  return x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;
};

/**
 * The currently-tappable buttons: the top screen's (modal capture) when the stack
 * is non-empty, else the HUD's (gameplay).
 *
 * @param state - The ui state.
 * @returns The active button set.
 * @example
 * ```ts
 * const active = activeButtons(state);
 * ```
 */
const activeButtons = (state: State): ButtonView[] => {
  const top = state.screens.at(-1);
  return top ? top.buttons : state.hudButtons;
};

/**
 * The topmost active button under the pointer (later-built paints on top), or
 * `undefined` when the pointer is over none.
 *
 * @param buttons - The active button set.
 * @param x - Pointer X (CSS px).
 * @param y - Pointer Y (CSS px).
 * @returns The hit button, or `undefined`.
 * @example
 * ```ts
 * const hit = pickButton(active, pointer.x, pointer.y);
 * ```
 */
const pickButton = (buttons: ButtonView[], x: number, y: number): ButtonView | undefined => {
  for (let index = buttons.length - 1; index >= 0; index--) {
    const button = buttons[index];
    if (button && hits(button, x, y)) return button;
  }
  return undefined;
};

/**
 * Create the pointer hit-test system for the `"update"` stage.
 *
 * @param deps - Input surface + ui state.
 * @returns A `System` that updates hover, tracks the press→release edge, and fires `onTap`.
 * @example
 * ```ts
 * scheduler.addSystem("update", createHitTestSystem({ input, state }));
 * ```
 */
export const createHitTestSystem = (deps: HitTestDeps): System => {
  return (_world: World, _dt: number): void => {
    const { state } = deps;

    // Headless / before start — nothing is built, so there is nothing to hit-test.
    if (!state.root) return;

    const pointer = deps.input.snapshot().pointer;
    const active = activeButtons(state);
    const hit = pickButton(active, pointer.x, pointer.y);

    // Repaint hover fills only where the state actually changed.
    for (const button of active) {
      const nowHovered = button === hit;
      if (nowHovered !== button.hovered) setButtonHover(button, nowHovered);
    }

    // Edge-detect the primary button; arm on press, fire on release over the same button.
    const wasDown = (state.prevButtons & PRIMARY_BUTTON) !== 0;
    const isDown = (pointer.buttons & PRIMARY_BUTTON) !== 0;

    const releasedOverArmedButton = state.armed !== undefined && state.armed === hit;
    if (isDown && !wasDown) {
      state.armed = hit;
    } else if (!isDown && wasDown) {
      if (releasedOverArmedButton) state.armed?.onTap();
      state.armed = undefined;
    }

    state.prevButtons = pointer.buttons;
  };
};
