/**
 * @file serialization plugin — upgradeDocument() unit tests + its integration through deserialize.
 */
import { describe, expect, it, vi } from "vitest";
import type { Migration } from "../../../storage/types";
import { createApi } from "../../api";
import { upgradeDocument } from "../../migrate";
import type { SceneDocument } from "../../types";
import { asEditorId, makeCtx, makeLog } from "../mocks";

describe("serialization — upgradeDocument()", () => {
  it("runs migrations[2] then migrations[3] in order, upgrading a v1 doc to v3", () => {
    const order: number[] = [];
    const migrations: Record<number, Migration> = {
      2: snapshot => {
        order.push(2);
        return { ...snapshot, name: `${String(snapshot.name)}-v2` };
      },
      3: snapshot => {
        order.push(3);
        return { ...snapshot, name: `${String(snapshot.name)}-v3` };
      }
    };
    const doc: SceneDocument = { version: 1, name: "level1", entities: [] };

    const upgraded = upgradeDocument(doc, 3, migrations, makeLog());

    expect(order).toEqual([2, 3]);
    expect(upgraded.version).toBe(3);
    expect(upgraded.name).toBe("level1-v2-v3");
  });

  it("passes a document already at the target version through unchanged — no migration fn runs", () => {
    const migrate = vi.fn((snapshot: Record<string, unknown>) => snapshot);
    const doc: SceneDocument = { version: 2, name: "level1", entities: [] };

    const upgraded = upgradeDocument(doc, 2, { 2: migrate }, makeLog());

    expect(migrate).not.toHaveBeenCalled();
    expect(upgraded).toBe(doc);
  });

  it("logs a downgrade warn and passes an ahead-of-version document through intact", () => {
    const log = makeLog();
    const doc: SceneDocument = {
      version: 5,
      name: "level1",
      entities: [{ id: asEditorId(1), components: {} }]
    };

    const upgraded = upgradeDocument(doc, 2, {}, log);

    expect(log.warn).toHaveBeenCalledOnce();
    expect(upgraded).toBe(doc);
  });

  it("skips a missing migration function in the chain without throwing", () => {
    const doc: SceneDocument = { version: 1, name: "level1", entities: [] };
    const migrations: Record<number, Migration> = {
      3: snapshot => ({ ...snapshot, name: "bumped" })
    };

    expect(() => upgradeDocument(doc, 3, migrations, makeLog())).not.toThrow();
    expect(upgradeDocument(doc, 3, migrations, makeLog()).name).toBe("bumped");
  });
});

describe("serialization — migration reaches restore via deserialize", () => {
  it("the migrated document is what reaches commands.restore, and currentVersion becomes config.version", () => {
    const bump: Migration = snapshot => ({
      ...snapshot,
      entities: [{ id: asEditorId(1), components: { Position: { x: 1, y: 1 } } }]
    });
    const { ctx, commands } = makeCtx({ config: { version: 2, migrations: { 2: bump } } });
    const api = createApi(ctx);
    const staleDoc: SceneDocument = { version: 1, name: "level1", entities: [] };

    api.deserialize(staleDoc);

    expect(commands.restore).toHaveBeenCalledWith(
      [{ id: asEditorId(1), components: { Position: { x: 1, y: 1 } } }],
      "reload"
    );
    expect(ctx.state.currentVersion).toBe(2);
  });
});
