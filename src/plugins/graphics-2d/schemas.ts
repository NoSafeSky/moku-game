/**
 * @file graphics-2d plugin — the two reflection schemas.
 *
 * Authored at MODULE SCOPE from the `field.*` builders re-exported standalone by `reflection` — the
 * builders are pure and stateless, so a schema needs no kernel and no injected builder set.
 * `lifecycle.start` registers them, which makes `reflection.describe` return these typed
 * descriptors (registered always wins over inference) and gives `reflection.validate` — wired into
 * `commands.setValidator` by `editor-bridge` — the range/option rules that reject a bad write
 * before it reaches SoA storage.
 */
import { field } from "../reflection";
import type { Schema } from "../reflection/types";

/** The sorting layers a SpriteRenderer may be assigned to, in back-to-front paint order. */
const SORTING_LAYERS = ["Background", "Default", "Enemies", "Player", "UI"] as const;

/**
 * The SpriteRenderer inspector + validation schema.
 *
 * `sprite` uses the `asset-ref` field kind, so the inspector renders an asset picker over the
 * loaded aliases rather than a free-text box — inference could never originate that kind, since a
 * bare `string` is ambiguous between free text and an alias. `sortingLayer`/`orderInLayer` are
 * authored and serialized now; applying them to view z-order is a roadmap item.
 *
 * @example
 * ```ts
 * reflection.register("SpriteRenderer", spriteRendererSchema);
 * reflection.describe("SpriteRenderer"); // [{ key: "sprite", kind: "asset-ref", … }, …]
 * ```
 */
export const spriteRendererSchema: Schema = {
  sprite: field.assetRef(),
  tint: field.color(),
  flipX: field.boolean(),
  sortingLayer: field.select(SORTING_LAYERS),
  orderInLayer: field.number({ step: 1 })
};

/**
 * The Shape inspector + validation schema.
 *
 * Every measurement is floored at `0` so `validate` rejects a negative width/radius/stroke before
 * it reaches storage, and `kind` is a closed select over the two primitives the reconciler builds.
 *
 * @example
 * ```ts
 * reflection.register("Shape", shapeSchema);
 * reflection.validate("Shape", { width: -1 }); // { ok: false, errors: [{ key: "width", … }] }
 * ```
 */
export const shapeSchema: Schema = {
  kind: field.select(["rect", "circle"]),
  width: field.number({ min: 0 }),
  height: field.number({ min: 0 }),
  radius: field.number({ min: 0 }),
  fill: field.color(),
  stroke: field.color(),
  strokeWidth: field.number({ min: 0 })
};
