/**
 * @file editor-gizmos plugin — pure drag math unit tests.
 */
import { describe, expect, it } from "vitest";
import type { EditorId } from "../../../commands/types";
import type { Entity } from "../../../ecs/types";
import { computeTarget, snapValue } from "../../math";
import type { ActiveDrag } from "../../types";

const asEntity = (n: number): Entity => n as Entity;
const asEditorId = (n: number): EditorId => n as EditorId;

describe("editor-gizmos — math — snapValue", () => {
  it("returns the value unchanged when snap <= 0", () => {
    expect(snapValue(37, 0)).toBe(37);
    expect(snapValue(37, -5)).toBe(37);
  });

  it("rounds to the nearest multiple of snap when snap > 0", () => {
    expect(snapValue(37, 32)).toBe(32);
    expect(snapValue(48, 32)).toBe(64);
    expect(snapValue(16, 32)).toBe(32);
  });
});

/** Build an ActiveDrag anchored at start (100,50) with grab origin (200,200), for the given axis. */
const baseDrag = (axis: ActiveDrag["axis"]): ActiveDrag => ({
  entity: asEntity(1),
  editorId: asEditorId(1),
  axis,
  startX: 100,
  startY: 50,
  originWorld: { x: 200, y: 200 }
});

describe("editor-gizmos — math — computeTarget", () => {
  it("axis 'x' maps dx only — y stays pinned to startY", () => {
    const drag = baseDrag("x");
    const target = computeTarget(drag, { x: 230, y: 260 }, 0);
    expect(target).toEqual({ x: 130, y: 50 });
  });

  it("axis 'y' maps dy only — x stays pinned to startX", () => {
    const drag = baseDrag("y");
    const target = computeTarget(drag, { x: 230, y: 260 }, 0);
    expect(target).toEqual({ x: 100, y: 110 });
  });

  it("axis 'xy' maps both dx and dy", () => {
    const drag = baseDrag("xy");
    const target = computeTarget(drag, { x: 230, y: 260 }, 0);
    expect(target).toEqual({ x: 130, y: 110 });
  });

  it("applies snap to the moved axis", () => {
    const drag = baseDrag("xy");
    // dx = 37, dy = 48 → startX + dx = 137 (snaps to 128), startY + dy = 98 (snaps to 96)
    const target = computeTarget(drag, { x: 237, y: 248 }, 32);
    expect(target).toEqual({ x: 128, y: 96 });
  });

  it("a zero delta returns exactly the start position", () => {
    const drag = baseDrag("xy");
    const target = computeTarget(drag, drag.originWorld, 0);
    expect(target).toEqual({ x: drag.startX, y: drag.startY });
  });
});
