/**
 * @file hierarchy plugin — the pure Node reflection-schema builder.
 *
 * Builder form (takes the injected `field` set) so this module references only the FieldBuilders
 * TYPE, never a `field.*` value — the reflection api is reached through the injected dep at
 * onStart. Pure over the injected builder set: no static value import from `reflection`, so a
 * unit test can drive it with a stub `FieldBuilders` with no `createApp`.
 */
import type { FieldBuilders, Schema } from "../reflection/types";

/**
 * Builds the Node reflection schema from the injected reflection `field` builders:
 * `{ name: string, enabled: boolean, order: number, parent: entity-ref }`. `parent` uses the
 * `entity-ref` kind `reflection` originates (Phase-1 F1) — a bare `number` would be ambiguous.
 *
 * @param field - The reflection field builder set (from the injected reflection api).
 * @returns The `Node` component schema, ready for `reflection.register("Node", …)`.
 * @example
 * ```ts
 * reflection.register("Node", buildNodeSchema(reflection.field));
 * ```
 */
export function buildNodeSchema(field: FieldBuilders): Schema {
  return {
    name: field.string(),
    enabled: field.boolean(),
    order: field.number(),
    parent: field.entityRef()
  };
}
