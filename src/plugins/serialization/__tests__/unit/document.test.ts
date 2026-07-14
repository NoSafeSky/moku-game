/**
 * @file serialization plugin — document.ts pure-helper unit tests.
 */
import { describe, expect, it, vi } from "vitest";

import {
  captureEntities,
  isPlainObject,
  isSceneDocumentShape,
  shallowCopyValue,
  toRecord
} from "../../document";
import { asEditorId, asEntity, makeCommandsMock, makeWorldMock } from "../mocks";

describe("document — isPlainObject", () => {
  it("accepts a non-null, non-array object", () => {
    expect(isPlainObject({ x: 1 })).toBe(true);
  });

  it("rejects an array, null, and a primitive", () => {
    expect(isPlainObject([1, 2])).toBe(false);
    expect(isPlainObject(JSON.parse("null"))).toBe(false); // a runtime null without a `null` literal
    expect(isPlainObject(42)).toBe(false);
  });
});

describe("document — shallowCopyValue", () => {
  it("shallow-copies a plain object one level deep", () => {
    const live = { x: 1, nested: { y: 2 } };
    const copy = shallowCopyValue(live) as typeof live;

    copy.x = 999;
    expect(live.x).toBe(1);
    expect(copy.nested).toBe(live.nested); // one level deep only
  });

  it("shallow-copies an array", () => {
    const live = [1, 2, 3];
    const copy = shallowCopyValue(live) as number[];

    copy.push(4);
    expect(live).toEqual([1, 2, 3]);
  });

  it("returns a primitive unchanged", () => {
    expect(shallowCopyValue(42)).toBe(42);
    expect(shallowCopyValue("hi")).toBe("hi");
  });
});

describe("document — toRecord", () => {
  it("returns a plain object as-is", () => {
    expect(toRecord({ hp: 100 })).toEqual({ hp: 100 });
  });

  it("degrades a non-object value to {}", () => {
    expect(toRecord(42)).toEqual({});
    expect(toRecord([1, 2])).toEqual({});
  });
});

describe("document — isSceneDocumentShape", () => {
  it("accepts a minimally-shaped document", () => {
    expect(isSceneDocumentShape({ version: 1, name: "level1", entities: [] })).toBe(true);
  });

  it("rejects a document missing entities, a wrong-typed version, or a non-object", () => {
    expect(isSceneDocumentShape({ version: 1, name: "level1" })).toBe(false);
    expect(isSceneDocumentShape({ version: "1", name: "level1", entities: [] })).toBe(false);
    expect(isSceneDocumentShape(JSON.parse("null"))).toBe(false); // a runtime null without a `null` literal
    expect(isSceneDocumentShape("not a doc")).toBe(false);
  });
});

describe("document — captureEntities", () => {
  it("skips a non-editor-owned entity and captures the rest keyed by EditorId", () => {
    const owned = asEntity(1);
    const notOwned = asEntity(2);
    const world = makeWorldMock({
      liveEntities: vi.fn(() => [owned, notOwned]),
      componentsOf: vi.fn((entity: unknown) =>
        entity === owned ? [{ name: "Position", value: { x: 1, y: 1 } }] : []
      )
    });
    const commands = makeCommandsMock({
      editorIdOf: vi.fn((entity: unknown) => (entity === owned ? asEditorId(5) : undefined))
    });

    const entities = captureEntities(world, commands);

    expect(entities).toEqual([{ id: asEditorId(5), components: { Position: { x: 1, y: 1 } } }]);
  });

  it("returns [] for an empty world", () => {
    const world = makeWorldMock();
    const commands = makeCommandsMock();

    expect(captureEntities(world, commands)).toEqual([]);
  });
});
