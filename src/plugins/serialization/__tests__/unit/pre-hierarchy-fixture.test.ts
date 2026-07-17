/**
 * @file serialization plugin — pre-hierarchy fixture regression test (Phase-1 Wave F4).
 *
 * A hand-authored v1 `SceneDocument` whose entities carry NO `Node` component, upgraded to the
 * target v2 via `{ 2: identityMigration }`. Proves the real `identityMigration` performs a pure
 * version-stamp passthrough — no data transform — so every pre-Phase-1 save slot upgrades
 * cleanly. See spec/19 §Testing-Strategy "pre-hierarchy-fixture" and Verification #3.
 */
import { describe, expect, it } from "vitest";

import { identityMigration, upgradeDocument } from "../../migrate";
import type { SceneDocument } from "../../types";
import { asEditorId, makeLog } from "../mocks";

describe("serialization — pre-hierarchy fixture (v1 document, no Node components)", () => {
  const v1Doc: SceneDocument = {
    version: 1,
    name: "legacy-level",
    entities: [
      { id: asEditorId(1), components: { Position: { x: 3, y: 4 } } },
      { id: asEditorId(2), components: { Position: { x: 7, y: 1 } } }
    ]
  };

  it("upgrades to v2 via the identity migration with entities byte-equal to the input", () => {
    const upgraded = upgradeDocument(v1Doc, 2, { 2: identityMigration }, makeLog());

    expect(upgraded.version).toBe(2);
    expect(upgraded.name).toBe(v1Doc.name);
    expect(upgraded.entities).toEqual(v1Doc.entities);
  });

  it("changes ONLY the version field between the v1 input and the v2 output", () => {
    const upgraded = upgradeDocument(v1Doc, 2, { 2: identityMigration }, makeLog());

    expect(upgraded.version).not.toBe(v1Doc.version);
    expect({ ...upgraded, version: v1Doc.version }).toEqual(v1Doc);
  });

  it("performs no migration at all when the fixture is already at the target version", () => {
    const alreadyV2: SceneDocument = { ...v1Doc, version: 2 };

    const upgraded = upgradeDocument(alreadyV2, 2, { 2: identityMigration }, makeLog());

    expect(upgraded).toBe(alreadyV2);
  });
});
