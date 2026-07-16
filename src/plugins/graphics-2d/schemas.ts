/**
 * @file graphics-2d plugin — reflection schema builders (skeleton).
 *
 * Builder form (takes the injected `field` set) so the skeleton references only the FieldBuilders
 * TYPE, never `field.assetRef()` (a reflection F1 extension not present at skeleton time). The F3
 * delta build finalizes these — as builders, or as the spec's module-scope consts once
 * `field.assetRef()` ships — either satisfies onStart. See "Skeleton Revisit TODOs".
 */
import type { FieldBuilders, Schema } from "../reflection/types";

/**
 * Builds the SpriteRenderer inspector/validation schema (sprite → asset-ref, tint → color, …).
 *
 * @param _field - The reflection field builder set.
 * @throws {Error} Always — this is a skeleton stub, implemented by the F3 build wave.
 * @example
 * ```ts
 * reflection.register("SpriteRenderer", buildSpriteRendererSchema(reflection.field));
 * ```
 */
export function buildSpriteRendererSchema(_field: FieldBuilders): Schema {
  throw new Error("not implemented");
}

/**
 * Builds the Shape inspector/validation schema (kind → select, width/height/… → number, …).
 *
 * @param _field - The reflection field builder set.
 * @throws {Error} Always — this is a skeleton stub, implemented by the F3 build wave.
 * @example
 * ```ts
 * reflection.register("Shape", buildShapeSchema(reflection.field));
 * ```
 */
export function buildShapeSchema(_field: FieldBuilders): Schema {
  throw new Error("not implemented");
}
