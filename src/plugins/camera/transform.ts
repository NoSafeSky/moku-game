/**
 * @file camera plugin — coordinate math (pure, Pixi-free).
 *
 * The forward (world → screen) and inverse (screen → world) transforms for the
 * factor-1 world plane, as pure functions over plain numbers so both `api.ts` and
 * `apply.ts` share ONE transform definition and unit tests need no Pixi. Shake is
 * deliberately excluded from the mapping — it is a transient render-only jitter, not
 * part of the logical camera transform, so `screenToWorld` / `worldToScreen` remain
 * exact inverses.
 *
 * - Forward:  `d = p − center`; `d' = R(rotation)·d`; `screen = d'·zoom + (w/2, h/2)`.
 * - Inverse:  `d = screen − (w/2, h/2)`; `d' = R(−rotation)·(d / zoom)`; `world = d' + center`.
 *
 * **Phase-1 F2** adds {@link screenDeltaToWorld} — the delta-only (no translation)
 * counterpart of the inverse mapping, used by `panBy` / `panByScreen` to convert a
 * screen-pixel drag delta into a world-space delta.
 */
import type { Point } from "./types";

/**
 * Map a screen-space point to world space for the factor-1 world plane (the inverse
 * of the layer transform; shake is ignored).
 *
 * @param p - The screen-space point.
 * @param center - The current camera centre in world space.
 * @param zoom - The current zoom (screen units per world unit).
 * @param rotation - The current rotation in radians.
 * @param width - The reference viewport width.
 * @param height - The reference viewport height.
 * @returns The corresponding world-space point.
 * @example
 * ```ts
 * screenToWorld({ x: 400, y: 300 }, { x: 0, y: 0 }, 1, 0, 800, 600); // { x: 0, y: 0 }
 * ```
 */
export const screenToWorld = (
  p: Point,
  center: Point,
  zoom: number,
  rotation: number,
  width: number,
  height: number
): Point => {
  // Offset from screen centre, then undo the zoom.
  const dx = (p.x - width / 2) / zoom;
  const dy = (p.y - height / 2) / zoom;

  // Inverse-rotate by −rotation and translate by the camera centre.
  const cos = Math.cos(-rotation);
  const sin = Math.sin(-rotation);
  return {
    x: dx * cos - dy * sin + center.x,
    y: dx * sin + dy * cos + center.y
  };
};

/**
 * Map a world-space point to screen space for the factor-1 world plane (the forward
 * transform; shake is ignored).
 *
 * @param p - The world-space point.
 * @param center - The current camera centre in world space.
 * @param zoom - The current zoom (screen units per world unit).
 * @param rotation - The current rotation in radians.
 * @param width - The reference viewport width.
 * @param height - The reference viewport height.
 * @returns The corresponding screen-space point.
 * @example
 * ```ts
 * worldToScreen({ x: 0, y: 0 }, { x: 0, y: 0 }, 1, 0, 800, 600); // { x: 400, y: 300 }
 * ```
 */
export const worldToScreen = (
  p: Point,
  center: Point,
  zoom: number,
  rotation: number,
  width: number,
  height: number
): Point => {
  // Offset from the camera centre.
  const dx = p.x - center.x;
  const dy = p.y - center.y;

  // Rotate by rotation, apply the zoom, and translate to the screen centre.
  const cos = Math.cos(rotation);
  const sin = Math.sin(rotation);
  return {
    x: (dx * cos - dy * sin) * zoom + width / 2,
    y: (dx * sin + dy * cos) * zoom + height / 2
  };
};

/**
 * Convert a screen-pixel delta to a world-space delta (rotation-aware, zoom-scaled) —
 * no translation, since a delta has no origin to offset. Used by `panBy` / `panByScreen`
 * to turn a pointer-drag delta into a world-space pan.
 *
 * @param dxScreen - Horizontal screen-pixel delta.
 * @param dyScreen - Vertical screen-pixel delta.
 * @param zoom - The current zoom (screen units per world unit).
 * @param rotation - The current rotation in radians.
 * @returns The corresponding world-space delta.
 * @example
 * ```ts
 * screenDeltaToWorld(10, 0, 2, 0); // { x: 5, y: 0 }
 * ```
 */
export const screenDeltaToWorld = (
  dxScreen: number,
  dyScreen: number,
  zoom: number,
  rotation: number
): Point => {
  // Undo the zoom, then inverse-rotate by −rotation (no translation — this is a delta).
  const dx = dxScreen / zoom;
  const dy = dyScreen / zoom;
  const cos = Math.cos(-rotation);
  const sin = Math.sin(-rotation);
  return {
    x: dx * cos - dy * sin,
    y: dx * sin + dy * cos
  };
};
