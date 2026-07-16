/**
 * @file hierarchy plugin — pure 2D affine transform math (world-free, unit-testable).
 *
 * No ECS, no renderer, no plugin context: these helpers take and return plain `TransformValue`
 * records so the F2 wave can unit-test the composition/inversion algebra in isolation.
 */
import type { TransformValue } from "../renderer/types";

/** The identity transform — a root's world transform equals its local transform. */
export const IDENTITY: TransformValue = { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1 };

/**
 * Composes a child's local transform under its parent's world transform (parent ∘ local).
 *
 * @param _parent - The parent's world transform.
 * @param _local - The child's local transform.
 * @throws {Error} Always — this is a skeleton stub, implemented by the F2 build wave.
 * @example
 * ```ts
 * const world = compose(parentWorld, childLocal);
 * ```
 */
export function compose(_parent: TransformValue, _local: TransformValue): TransformValue {
  throw new Error("not implemented");
}

/**
 * Inverts a 2D affine transform (scale-0 guarded — returns a 0 inverse-scale, never divides by zero).
 *
 * @param _t - The transform to invert.
 * @throws {Error} Always — this is a skeleton stub, implemented by the F2 build wave.
 * @example
 * ```ts
 * const inv = invert(t); // compose(inv, t) ≈ IDENTITY
 * ```
 */
export function invert(_t: TransformValue): TransformValue {
  throw new Error("not implemented");
}
