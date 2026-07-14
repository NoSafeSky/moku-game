/**
 * @file editor-gizmos plugin — pure drag math (Pixi-free).
 *
 * `snapValue` and `computeTarget` are pure functions over plain numbers/points, so the
 * axis + snap logic is unit-testable without Pixi and without a live camera. `computeTarget`
 * is the ONE place a world-space pointer position becomes a drag target: it is called both
 * from the live `pointermove` preview and from the `pointerup` commit, so both paths agree
 * on the exact same math (the anti-drift discipline — see `interaction.ts`).
 */
import type { Point } from "../camera/types";
import type { ActiveDrag } from "./types";

/**
 * Rounds `v` to the nearest multiple of `snap` (world units); `snap <= 0` returns `v`
 * unchanged (snapping disabled).
 *
 * @param v - The value to snap.
 * @param snap - The snap increment in world units.
 * @returns `v` rounded to the nearest multiple of `snap`, or `v` unchanged when `snap <= 0`.
 * @example
 * ```ts
 * snapValue(37, 32); // 32
 * snapValue(48, 32); // 64
 * snapValue(37, 0);  // 37 (snapping disabled)
 * ```
 */
export const snapValue = (v: number, snap: number): Point["x"] =>
  snap > 0 ? Math.round(v / snap) * snap : v;

/**
 * Maps a world-space pointer position to the drag's target `Transform` position, per the
 * drag's constrained axis and the current snap increment. Pure — no Pixi, no camera calls.
 *
 * @param drag - The in-flight drag (start position + world-space grab origin + axis).
 * @param currentWorld - The pointer's current world-space position (from `camera.screenToWorld`,
 *   recomputed fresh on every call by the caller — never cached).
 * @param snap - The snap increment in world units (`0` disables snapping).
 * @returns The drag's target `{ x, y }`, with the non-active axis pinned to its start value.
 * @example
 * ```ts
 * computeTarget(drag, { x: 130, y: 125 }, 0);
 * ```
 */
export const computeTarget = (drag: ActiveDrag, currentWorld: Point, snap: number): Point => {
  const dx = currentWorld.x - drag.originWorld.x;
  const dy = currentWorld.y - drag.originWorld.y;
  const x = drag.axis === "y" ? drag.startX : snapValue(drag.startX + dx, snap);
  const y = drag.axis === "x" ? drag.startY : snapValue(drag.startY + dy, snap);
  return { x, y };
};
