/**
 * @file hierarchy plugin — pure 2D affine transform math (world-free, unit-testable).
 *
 * No ECS, no renderer, no plugin context: these helpers take and return plain `TransformValue`
 * records so the F2 wave can unit-test the composition/inversion algebra in isolation. `compose`
 * treats rotation/scale as independent of translation's own rotate+scale (the standard
 * simplified 2D scene-graph model this engine's `TransformValue` supports — it carries no skew,
 * so a non-uniform parent scale composed with a rotated child is intentionally NOT
 * shear-corrected, matching how Pixi's own Container transform behaves).
 */
import type { TransformValue } from "../renderer/types";

/** The identity transform — a root's world transform equals its local transform. */
export const IDENTITY: TransformValue = { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1 };

/**
 * Composes a child's local transform under its parent's world transform (parent ∘ local).
 * Translation is rotated + scaled by the parent before being added to the parent's own
 * position; rotation and scale simply accumulate. `compose(IDENTITY, local) === local`.
 *
 * @param parent - The parent's world transform.
 * @param local - The child's local transform.
 * @returns The child's resulting WORLD transform.
 * @example
 * ```ts
 * const world = compose(parentWorld, childLocal);
 * ```
 */
export function compose(parent: TransformValue, local: TransformValue): TransformValue {
  const cos = Math.cos(parent.rotation);
  const sin = Math.sin(parent.rotation);
  return {
    x: parent.x + (local.x * parent.scaleX * cos - local.y * parent.scaleY * sin),
    y: parent.y + (local.x * parent.scaleX * sin + local.y * parent.scaleY * cos),
    rotation: parent.rotation + local.rotation,
    scaleX: parent.scaleX * local.scaleX,
    scaleY: parent.scaleY * local.scaleY
  };
}

/**
 * Inverts a 2D affine transform such that `compose(invert(t), t)` is the identity transform
 * (within floating-point epsilon). Scale-0 guarded — a zero-scale axis inverts to `0` rather
 * than dividing by zero (no `Infinity`/`NaN`).
 *
 * @param t - The transform to invert.
 * @returns The inverse transform.
 * @example
 * ```ts
 * const inv = invert(t); // compose(inv, t) ≈ IDENTITY
 * ```
 */
export function invert(t: TransformValue): TransformValue {
  const inverseScaleX = t.scaleX === 0 ? 0 : 1 / t.scaleX;
  const inverseScaleY = t.scaleY === 0 ? 0 : 1 / t.scaleY;
  const cos = Math.cos(t.rotation);
  const sin = Math.sin(t.rotation);
  return {
    x: -(t.x * inverseScaleX * cos + t.y * inverseScaleY * sin),
    y: t.x * inverseScaleX * sin - t.y * inverseScaleY * cos,
    rotation: -t.rotation,
    scaleX: inverseScaleX,
    scaleY: inverseScaleY
  };
}
