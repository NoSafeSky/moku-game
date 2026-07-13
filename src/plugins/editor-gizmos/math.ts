/**
 * @file editor-gizmos plugin — pure drag math skeleton (Pixi-free).
 */
import type { Point } from "../camera/types";
import type { ActiveDrag } from "./types";

/**
 * Rounds a value to the nearest multiple of `snap` (world units); `snap <= 0` returns it unchanged.
 *
 * @param _v - The value to snap.
 * @param _snap - The snap increment in world units.
 * @throws {Error} Always in the skeleton — implemented during build.
 * @example
 * ```ts
 * snapValue(37, 32); // 32
 * ```
 */
export function snapValue(_v: number, _snap: number): number {
  throw new Error("not implemented");
}

/**
 * Maps a world-space pointer position to the drag's target Transform, per axis + snap. Pure.
 *
 * @param _drag - The in-flight drag (start position + world-space grab origin + axis).
 * @param _currentWorld - The pointer's current world-space position.
 * @param _snap - The snap increment in world units.
 * @throws {Error} Always in the skeleton — implemented during build.
 * @example
 * ```ts
 * computeTarget(drag, { x: 10, y: 20 }, 0);
 * ```
 */
export function computeTarget(_drag: ActiveDrag, _currentWorld: Point, _snap: number): Point {
  throw new Error("not implemented");
}
