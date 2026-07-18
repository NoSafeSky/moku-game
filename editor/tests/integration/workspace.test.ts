// @vitest-environment happy-dom
import { mountIsland } from "@moku-labs/web/testing";
import { describe, expect, it } from "vitest";
import { workspace } from "../../src/islands/workspace";
import { query } from "../helpers/dom";

// The workspace chrome: three splitter handles the island seeds + drags (no editor-host dependency —
// this island is pure layout state, so no vi.mock is needed).
const WORKSPACE_HTML = [
  '<div data-splitter="hierarchy"></div>',
  '<div data-region="center"><div data-splitter="project"></div></div>',
  '<div data-splitter="inspector"></div>'
].join("");

// Dispatch a pointer-family event carrying a client coordinate (happy-dom has no PointerEvent ctor, but a
// MouseEvent of the same type is structurally identical for the island's `.clientX`/`.clientY` reads).
const pointer = (type: string, coord: { clientX?: number; clientY?: number }): MouseEvent =>
  new MouseEvent(type, { bubbles: true, ...coord });

const cssVar = (el: HTMLElement, prop: string): string => el.style.getPropertyValue(prop).trim();

describe("workspace island", () => {
  it("seeds each band to its initial clamped size on mount", () => {
    const handle = mountIsland(workspace, { html: WORKSPACE_HTML });

    expect(cssVar(handle.el, "--w-hierarchy")).toBe("240px");
    expect(cssVar(handle.el, "--w-inspector")).toBe("300px");
    expect(cssVar(handle.el, "--h-project")).toBe("160px");
  });

  it("resizes the hierarchy column as the splitter is dragged (grows rightward)", () => {
    const handle = mountIsland(workspace, { html: WORKSPACE_HTML });

    query(handle.el, '[data-splitter="hierarchy"]').dispatchEvent(
      pointer("pointerdown", { clientX: 240 })
    );
    expect(handle.el.dataset.resizing).toBe("hierarchy");
    document.dispatchEvent(pointer("pointermove", { clientX: 300 })); // +60px

    expect(cssVar(handle.el, "--w-hierarchy")).toBe("300px");

    document.dispatchEvent(pointer("pointerup", {}));
    expect(handle.el.dataset.resizing).toBeUndefined();
  });

  it("clamps the hierarchy column to its max (400px) past the bound", () => {
    const handle = mountIsland(workspace, { html: WORKSPACE_HTML });

    query(handle.el, '[data-splitter="hierarchy"]').dispatchEvent(
      pointer("pointerdown", { clientX: 240 })
    );
    document.dispatchEvent(pointer("pointermove", { clientX: 9000 }));

    expect(cssVar(handle.el, "--w-hierarchy")).toBe("400px");
  });

  it("clamps the inspector column to its min (240px) — it grows against the pointer", () => {
    const handle = mountIsland(workspace, { html: WORKSPACE_HTML });

    // Inspector is right-docked (dir -1): dragging right shrinks it toward the min.
    query(handle.el, '[data-splitter="inspector"]').dispatchEvent(
      pointer("pointerdown", { clientX: 500 })
    );
    document.dispatchEvent(pointer("pointermove", { clientX: 9000 }));

    expect(cssVar(handle.el, "--w-inspector")).toBe("240px");
  });

  it("resizes the project row on the y axis (grows against the pointer)", () => {
    const handle = mountIsland(workspace, { html: WORKSPACE_HTML });

    query(handle.el, '[data-splitter="project"]').dispatchEvent(
      pointer("pointerdown", { clientY: 400 })
    );
    document.dispatchEvent(pointer("pointermove", { clientY: 360 })); // up 40 → +40px height

    expect(cssVar(handle.el, "--h-project")).toBe("200px");
  });

  it("ignores pointer moves after the drag ends", () => {
    const handle = mountIsland(workspace, { html: WORKSPACE_HTML });

    query(handle.el, '[data-splitter="hierarchy"]').dispatchEvent(
      pointer("pointerdown", { clientX: 240 })
    );
    document.dispatchEvent(pointer("pointermove", { clientX: 300 }));
    document.dispatchEvent(pointer("pointerup", {}));

    document.dispatchEvent(pointer("pointermove", { clientX: 380 })); // no active drag → no effect
    expect(cssVar(handle.el, "--w-hierarchy")).toBe("300px");
  });

  it("detaches its document listeners on unmount", () => {
    const handle = mountIsland(workspace, { html: WORKSPACE_HTML });
    query(handle.el, '[data-splitter="hierarchy"]').dispatchEvent(
      pointer("pointerdown", { clientX: 240 })
    );

    handle.unmount();
    document.dispatchEvent(pointer("pointermove", { clientX: 500 })); // listeners gone → no throw, no effect

    expect(cssVar(handle.el, "--w-hierarchy")).toBe("240px");
  });
});
