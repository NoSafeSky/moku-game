import type { Commands, EditorBridge } from "@nosafesky/ludemic";
import { describe, expect, it } from "vitest";
import {
  buildDataLoader,
  computeRowWindow,
  planDrop,
  ROOT_ID,
  ROW_HEIGHT,
  zoneFromOffset
} from "../../src/lib/tree-adapter";

/** Brand a plain number as an EditorId for fixtures. */
const id = (n: number): Commands.EditorId => n as unknown as Commands.EditorId;

/** Build one entity snapshot with sensible defaults. */
const entity = (
  over: Partial<EditorBridge.EntitySnapshot> & { id: Commands.EditorId }
): EditorBridge.EntitySnapshot => ({
  name: `#${over.id}`,
  enabled: true,
  parent: undefined,
  children: [],
  components: [],
  ...over
});

// A small nested world:  A(1) → [A1(2), A2(3)] ,  B(4)  at root.
const A = id(1);
const A1 = id(2);
const A2 = id(3);
const B = id(4);

const snapshot = (): EditorBridge.EditorSnapshot => ({
  epoch: 1,
  roots: [A, B],
  selection: [],
  mode: "edit",
  canUndo: false,
  canRedo: false,
  entities: [
    entity({
      id: A,
      name: "A",
      children: [A1, A2],
      components: [{ name: "Shape", value: {}, fields: [] }]
    }),
    entity({ id: A1, name: "A1", parent: A }),
    entity({ id: A2, name: "A2", parent: A }),
    entity({ id: B, name: "B" })
  ]
});

describe("tree-adapter · buildDataLoader", () => {
  it("exposes the scene roots as the synthetic root's children", () => {
    const loader = buildDataLoader(snapshot());
    expect(loader.getChildren(ROOT_ID)).toEqual(["1", "4"]);
  });

  it("maps an entity to its node data (name / enabled / isFolder / summary)", () => {
    const loader = buildDataLoader(snapshot());
    expect(loader.getItem("1")).toEqual({
      id: "1",
      name: "A",
      enabled: true,
      isFolder: true,
      summary: "Shape"
    });
  });

  it("marks a childless entity as a leaf with an empty summary", () => {
    const loader = buildDataLoader(snapshot());
    const b = loader.getItem("4");
    expect(b.isFolder).toBe(false);
    expect(b.summary).toBe("");
  });

  it("returns an entity's ordered children as strings", () => {
    const loader = buildDataLoader(snapshot());
    expect(loader.getChildren("1")).toEqual(["2", "3"]);
  });

  it("is total — an unknown id yields a placeholder + no children (never throws)", () => {
    const loader = buildDataLoader(snapshot());
    expect(loader.getItem("999")).toMatchObject({ id: "999", isFolder: false });
    expect(loader.getChildren("999")).toEqual([]);
  });
});

describe("tree-adapter · zoneFromOffset", () => {
  it("splits a nestable row into before / inside / after bands", () => {
    expect(zoneFromOffset(2, 26, true)).toBe("before");
    expect(zoneFromOffset(13, 26, true)).toBe("inside");
    expect(zoneFromOffset(24, 26, true)).toBe("after");
  });

  it("splits a leaf in half (no inside band)", () => {
    expect(zoneFromOffset(6, 26, false)).toBe("before");
    expect(zoneFromOffset(20, 26, false)).toBe("after");
  });

  it("treats an unmeasured (0-height) row as an inside drop", () => {
    expect(zoneFromOffset(0, 0, true)).toBe("inside");
  });
});

describe("tree-adapter · planDrop", () => {
  it("ignores a drop onto itself", () => {
    expect(
      planDrop({ snapshot: snapshot(), dragged: A1, target: A1, zone: "before" })
    ).toBeUndefined();
  });

  it("re-parents under the target on an inside drop (append, no anchors)", () => {
    expect(planDrop({ snapshot: snapshot(), dragged: B, target: A, zone: "inside" })).toEqual({
      verb: "reparent",
      id: B,
      newParent: A,
      before: undefined,
      after: undefined
    });
  });

  it("rejects an inside drop into the node's own subtree", () => {
    expect(
      planDrop({ snapshot: snapshot(), dragged: A, target: A1, zone: "inside" })
    ).toBeUndefined();
  });

  it("reorders within the same parent — before a sibling anchors after=previous", () => {
    // A2 dropped BEFORE A1 (both children of A): lands before A1, after nothing.
    expect(planDrop({ snapshot: snapshot(), dragged: A2, target: A1, zone: "before" })).toEqual({
      verb: "reorder",
      id: A2,
      before: A1,
      after: undefined
    });
  });

  it("reorders within the same parent — after a sibling anchors before=next", () => {
    // A1 dropped AFTER A2 (its only other sibling): after A2, nothing before.
    expect(planDrop({ snapshot: snapshot(), dragged: A1, target: A2, zone: "after" })).toEqual({
      verb: "reorder",
      id: A1,
      before: undefined,
      after: A2
    });
  });

  it("re-parents (positioned) when a before/after drop crosses into a new parent", () => {
    // B (a root) dropped BEFORE A1 (child of A): new parent A, lands before A1.
    expect(planDrop({ snapshot: snapshot(), dragged: B, target: A1, zone: "before" })).toEqual({
      verb: "reparent",
      id: B,
      newParent: A,
      before: A1,
      after: undefined
    });
  });

  it("re-parents to the scene root (undefined) when dropping beside a root", () => {
    // A1 (child of A) dropped AFTER B (a root): new parent = root (undefined), after B.
    expect(planDrop({ snapshot: snapshot(), dragged: A1, target: B, zone: "after" })).toEqual({
      verb: "reparent",
      id: A1,
      newParent: undefined,
      before: undefined,
      after: B
    });
  });
});

describe("tree-adapter · computeRowWindow", () => {
  it("renders all rows for a small list (no windowing, no spacers)", () => {
    const window = computeRowWindow(10, 0, 400);
    expect(window.indices).toHaveLength(10);
    expect(window.indices[0]).toBe(0);
    expect(window.padTop).toBe(0);
    expect(window.padBottom).toBe(0);
  });

  it("renders all rows when the container is unmeasured (0-height, as in tests/SSR)", () => {
    const window = computeRowWindow(500, 0, 0);
    expect(window.indices).toHaveLength(500);
    expect(window.padTop).toBe(0);
  });

  it("windows a large, scrolled list to the viewport + overscan with matching spacers", () => {
    // 1000 rows, scrolled halfway down a 480px viewport (20 rows tall) at 24px/row.
    const window = computeRowWindow(1000, 4800, 480, ROW_HEIGHT);
    expect(window.indices.length).toBeLessThan(1000);
    // The rendered slice is contiguous and centred on the scroll offset (~row 200).
    const first = window.indices[0] as number;
    const last = window.indices.at(-1) as number;
    expect(first).toBeLessThanOrEqual(200);
    expect(last).toBeGreaterThanOrEqual(220);
    // Spacers reserve the exact scroll height of the un-rendered rows above/below.
    expect(window.padTop).toBe(first * ROW_HEIGHT);
    expect(window.padBottom).toBe((1000 - 1 - last) * ROW_HEIGHT);
  });
});
