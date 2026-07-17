/**
 * @file editor-gizmos plugin — pure drag math (Pixi-free).
 *
 * `snapValue` / `snapAngle` and `computeTarget` / `computeRotation` / `computeScale` are pure
 * functions over plain numbers/points, so the per-mode axis + snap logic is unit-testable
 * without Pixi and without a live camera. Each `compute*` is the ONE place a world-space
 * pointer position becomes its mode's drag target: each is called both from the live
 * `pointermove` preview and from the `pointerup` commit, so both paths agree on the exact same
 * math (the anti-drift discipline — see `interaction.ts`).
 *
 * The single `snap` knob is **mode-interpreted**: translate rounds each axis position to world
 * units (`snapValue`), scale rounds each scale value to a factor increment (`snapValue` again),
 * and rotate rounds the angle to radians (`snapAngle`). `0` disables snapping everywhere.
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
 * Rounds an angle (radians) to the nearest multiple of `snap` radians; `snap <= 0` returns
 * it unchanged (snapping disabled). The rotate mode's reading of the single `snap` knob.
 *
 * @param radians - The angle to snap, in radians.
 * @param snap - The snap increment in radians.
 * @returns `radians` rounded to the nearest multiple of `snap`, or unchanged when `snap <= 0`.
 * @example
 * ```ts
 * snapAngle(1.249, Math.PI / 2); // Math.PI / 2 (nearest quarter turn)
 * snapAngle(1.249, 0);           // 1.249 (snapping disabled)
 * ```
 */
export const snapAngle = (radians: number, snap: number): number =>
  snap > 0 ? Math.round(radians / snap) * snap : radians;

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

/**
 * Maps a world-space pointer position to the drag's target rotation (radians): the angle
 * swept about `drag.pivotWorld` from the grab origin to `currentWorld`, added to the entity's
 * start rotation, then angularly snapped. Pure — no Pixi, no camera calls.
 *
 * The sweep is measured from the two ABSOLUTE angles (origin → pivot and current → pivot)
 * rather than an incremental per-event delta, so the result depends only on where the pointer
 * is NOW — the anti-drift property that survives a camera pan/zoom/rotate mid-drag.
 *
 * @param drag - The in-flight drag (start rotation + pivot anchor + world-space grab origin).
 * @param currentWorld - The pointer's current world-space position (from `camera.screenToWorld`,
 *   recomputed fresh on every call by the caller — never cached).
 * @param snap - The snap increment in radians (`0` disables snapping).
 * @returns The drag's target rotation in radians.
 * @example
 * ```ts
 * computeRotation(drag, { x: 0, y: 10 }, 0); // start rotation + the swept angle
 * ```
 */
export const computeRotation = (drag: ActiveDrag, currentWorld: Point, snap: number): number => {
  const originAngle = Math.atan2(
    drag.originWorld.y - drag.pivotWorld.y,
    drag.originWorld.x - drag.pivotWorld.x
  );
  const currentAngle = Math.atan2(
    currentWorld.y - drag.pivotWorld.y,
    currentWorld.x - drag.pivotWorld.x
  );

  // Both angles come from atan2, so each sits in (−π, π]; their raw difference can therefore
  // land in (−2π, 2π). Wrap it back into (−π, π] via atan2(sin, cos) so a drag whose pointer
  // sweeps across the branch cut (the ray opposite the grab direction — reached any time the
  // user spins the handle past ~180°) reads as a small continuous step, not a ~2π jump. Without
  // this, snapping the un-wrapped delta commits a wildly wrong rotation near the discontinuity.
  const rawDelta = currentAngle - originAngle;
  const sweptDelta = Math.atan2(Math.sin(rawDelta), Math.cos(rawDelta));

  return snapAngle(drag.startRotation + sweptDelta, snap);
};

/**
 * Maps a world-space pointer position to the drag's target scale: `dist(current, pivot) /
 * dist(origin, pivot)` times the entity's start scale, per the drag's constrained axis, then
 * scalar-snapped. `dist(origin, pivot) === 0` yields factor `1` (no divide-by-zero). Pure —
 * no Pixi, no camera calls.
 *
 * Like {@link computeRotation}, the factor is a ratio of two ABSOLUTE distances rather than an
 * accumulated per-event delta, so it is anti-drift by construction.
 *
 * @param drag - The in-flight drag (start scale + pivot anchor + world-space grab origin + axis).
 * @param currentWorld - The pointer's current world-space position (from `camera.screenToWorld`,
 *   recomputed fresh on every call by the caller — never cached).
 * @param snap - The snap increment as a scale-factor increment (`0` disables snapping).
 * @returns The drag's target `{ x, y }` scale, with the non-active axis pinned to its start value.
 * @example
 * ```ts
 * computeScale(drag, { x: 20, y: 0 }, 0); // start scale × dist(current,pivot)/dist(origin,pivot)
 * ```
 */
export const computeScale = (drag: ActiveDrag, currentWorld: Point, snap: number): Point => {
  const originDistance = Math.hypot(
    drag.originWorld.x - drag.pivotWorld.x,
    drag.originWorld.y - drag.pivotWorld.y
  );
  const currentDistance = Math.hypot(
    currentWorld.x - drag.pivotWorld.x,
    currentWorld.y - drag.pivotWorld.y
  );
  const factor = originDistance > 0 ? currentDistance / originDistance : 1;

  const x = drag.axis === "y" ? drag.startScaleX : snapValue(drag.startScaleX * factor, snap);
  const y = drag.axis === "x" ? drag.startScaleY : snapValue(drag.startScaleY * factor, snap);
  return { x, y };
};
