/**
 * @file hierarchy plugin — the pure Node reflection-schema builder (skeleton).
 *
 * Builder form (takes the injected `field` set) so the skeleton references only the FieldBuilders
 * TYPE, never a `field.*` value — the reflection api is reached through the injected dep at
 * onStart, wired by F2. Orphan until then.
 */
import type { FieldBuilders, Schema } from "../reflection/types";

/**
 * Builds the Node reflection schema from the injected reflection `field` builders:
 * `{ name: string, enabled: boolean, order: number, parent: entity-ref }`.
 *
 * @param _field - The reflection field builder set (from the injected reflection api).
 * @throws {Error} Always — this is a skeleton stub, implemented by the F2 build wave.
 * @example
 * ```ts
 * reflection.register("Node", buildNodeSchema(reflection.field));
 * ```
 */
export function buildNodeSchema(_field: FieldBuilders): Schema {
  throw new Error("not implemented");
}
