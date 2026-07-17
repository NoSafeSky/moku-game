/**
 * @file serialization plugin — type-level tests.
 *
 * `Api` method return types, `EditorId` brand isolation on `SceneEntity.id`, the no-adapter
 * `SceneEntity` → `RestoreEntity` structural compatibility, and `serialization:loaded` emit
 * typing. Vitest transforms this file with esbuild (no type-checking at test-run time) — the
 * `@ts-expect-error` directives are validated by `tsc --noEmit`.
 */
import { describe, expect, expectTypeOf, it, vi } from "vitest";

import type { RestoreEntity } from "../../../commands/types";
import type { SerializationApiContext } from "../../api";
import type { Api, SceneDocument, SceneEntity } from "../../types";

describe("serialization types — Api method shapes", () => {
  it("serialize/deserialize/save/load/list/export/import return their documented shapes", () => {
    expectTypeOf<Api["serialize"]>().returns.toEqualTypeOf<SceneDocument>();
    expectTypeOf<Api["deserialize"]>().returns.toEqualTypeOf<void>();
    expectTypeOf<Api["save"]>().returns.toEqualTypeOf<boolean>();
    expectTypeOf<Api["load"]>().returns.toEqualTypeOf<boolean>();
    expectTypeOf<Api["list"]>().returns.toEqualTypeOf<string[]>();
    expectTypeOf<Api["export"]>().returns.toEqualTypeOf<string>();
    expectTypeOf<Api["import"]>().returns.toEqualTypeOf<void>();
  });
});

describe("serialization types — SceneDocument stays FLAT (no structural parent field)", () => {
  it("a parent field on a SceneDocument literal is a type error — hierarchy rides via the Node component", () => {
    // @ts-expect-error -- SceneDocument has no parent field; hierarchy is expressed via the Node component
    const doc: SceneDocument = { version: 2, name: "level1", entities: [], parent: undefined };

    expect(doc.entities).toEqual([]);
  });
});

describe("serialization types — EditorId brand on SceneEntity.id", () => {
  it("a SceneEntity.id is not assignable from a plain number", () => {
    // @ts-expect-error -- a plain number literal is not an EditorId without the brand
    const entity: SceneEntity = { id: 1, components: {} };
    expect(entity).toBeDefined();
  });
});

describe("serialization types — SceneEntity ↔ RestoreEntity (no-adapter guarantee)", () => {
  it("a SceneEntity is structurally assignable to commands' RestoreEntity", () => {
    const sceneEntity: SceneEntity = { id: 1 as SceneEntity["id"], components: { Position: {} } };
    const restoreEntity: RestoreEntity = sceneEntity;

    expect(restoreEntity.id).toBe(sceneEntity.id);
  });
});

describe("serialization types — serialization:loaded emit typing", () => {
  it("a valid payload type-checks; a payload missing entityCount is a type error", () => {
    const emit: SerializationApiContext["emit"] = vi.fn();

    emit("serialization:loaded", { name: "level1", entityCount: 3 });

    // @ts-expect-error -- entityCount is required on the serialization:loaded payload
    emit("serialization:loaded", { name: "level1" });

    expect(emit).toHaveBeenCalledWith("serialization:loaded", { name: "level1", entityCount: 3 });
  });
});
