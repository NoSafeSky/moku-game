/**
 * @file Viewport interaction — the REAL-MOUSE canvas suite. Every other e2e drives selection through
 * hierarchy rows + inspector fields (both route via `editor-bridge`, which always worked); NONE drove a
 * real pointer on the Pixi `<canvas>`. That gap let canvas-native editing ship broken across the whole
 * editor. This spec closes it: it clicks, Ctrl-clicks, marquee-drags, and gizmo-drags the canvas with
 * `page.mouse` (never the bridge) and asserts the framework reacts — the only oracle that exercises the
 * Pixi event boundary, the pick/stamp path, the stage hitArea, the camera-transformed content layer, and
 * the host's gizmo re-sync end to end.
 *
 * Coordinate mapping: `getBounds()` / `getGlobalPosition()` are in Pixi LOGICAL space
 * (`canvas.width / resolution`), which differs from the physical `canvas.width` on a HiDPI display — so a
 * click point is `rect.left + (logicalX / logicalW) * rect.width`, dividing by the DPR-corrected logical
 * width, not the raw canvas width. Selection reads come from `bridge.snapshot()` (fresh, not the memoized
 * poll copy), polled because a pick lands in the snapshot the same tick but the world-write path is async.
 */
import type { Page } from "@playwright/test";
import { boot, expect, settle, snapshot, test } from "./_helpers";

/** Demo entities whose rendered bounds-centre sits comfortably inside the canvas (skyline rects). */
const SKYLINE_BACK = 2;
const SKYLINE_MID = 3;

/** A screen (CSS-pixel) point, canvas-relative once mapped. */
type ScreenPoint = { x: number; y: number };

/**
 * The CSS-screen coordinate of an editor entity's rendered bounds-centre — the point a real click must
 * land on to hit the shape. Maps Pixi logical space → the canvas' on-screen rect, DPR-corrected.
 *
 * @param page - The Playwright page.
 * @param editorId - The entity's editor id.
 * @returns The canvas-relative screen point over the shape's centre.
 */
function entityScreenCenter(page: Page, editorId: number): Promise<ScreenPoint> {
  return page.evaluate(id => {
    const app = (
      globalThis as unknown as { __MOKU_EDITOR__: { getEditor(): { gameApp: EditorGameApp } } }
    ).__MOKU_EDITOR__.getEditor().gameApp;
    const canvas = app.renderer.getView();
    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const logicalW = canvas.width / dpr;
    const logicalH = canvas.height / dpr;
    const bounds = app.renderer.getEntityView(app.commands.resolve(id)).getBounds();
    return {
      x: rect.left + ((bounds.x + bounds.width / 2) / logicalW) * rect.width,
      y: rect.top + ((bounds.y + bounds.height / 2) / logicalH) * rect.height
    };
  }, editorId);
}

/** A canvas-relative point in a corner reliably clear of every shape — an empty-space click target. */
function emptyCanvasPoint(page: Page): Promise<ScreenPoint> {
  return page.evaluate(() => {
    const app = (
      globalThis as unknown as { __MOKU_EDITOR__: { getEditor(): { gameApp: EditorGameApp } } }
    ).__MOKU_EDITOR__.getEditor().gameApp;
    const rect = app.renderer.getView().getBoundingClientRect();
    return { x: rect.left + 14, y: rect.top + 14 };
  });
}

/** The selected editor ids, read fresh from the bridge (not the memoized poll copy). */
async function selection(page: Page): Promise<number[]> {
  const snap = await snapshot(page);
  return snap.selection;
}

/** Poll the live selection until it equals `expected` (order-insensitive). */
async function expectSelection(page: Page, expected: number[]): Promise<void> {
  await expect
    .poll(
      async () => {
        const selected = await selection(page);
        return selected.toSorted();
      },
      { timeout: 3000 }
    )
    .toEqual(expected.toSorted());
}

/** Read one entity's live Transform position from the bridge snapshot. */
async function transformXY(
  page: Page,
  editorId: number
): Promise<{ x: number; y: number } | undefined> {
  const snap = await snapshot(page);
  const value = snap.entities
    .find(entity => entity.id === editorId)
    ?.components.find(component => component.name === "Transform")?.value as
    | { x: number; y: number }
    | undefined;
  return value ? { x: value.x, y: value.y } : undefined;
}

/** The handle's screen-space geometry the drag helper needs, plus the currently-shown mode group. */
type GizmoGeom = {
  visible: boolean;
  origin?: ScreenPoint;
  scaleX?: number;
  scaleY?: number;
  group?: string | undefined;
};

/**
 * The gizmo handle origin (the object's screen point), the logical→CSS scale on each axis (the handle
 * lives in screen/stage space so its children sit at fixed LOGICAL px offsets from the origin), and the
 * label of the one visible per-mode sub-composite (`translate`/`rotate`/`scale`/`rect`).
 */
function gizmoGeom(page: Page): Promise<GizmoGeom> {
  return page.evaluate(() => {
    const app = (
      globalThis as unknown as { __MOKU_EDITOR__: { getEditor(): { gameApp: EditorGameApp } } }
    ).__MOKU_EDITOR__.getEditor().gameApp;
    const stage = app.renderer.getStage();
    const find = (node: DisplayNode, depth: number): DisplayNode | undefined => {
      for (const child of node.children ?? []) {
        const labels = new Set((child.children ?? []).map(grandchild => grandchild.label));
        if (labels.has("translate") && labels.has("rotate")) return child;
        const deeper = depth < 6 ? find(child, depth + 1) : undefined;
        if (deeper) return deeper;
      }
      return undefined;
    };
    const handle = find(stage, 0);
    if (!handle?.visible) return { visible: false };
    const g = handle.getGlobalPosition();
    const canvas = app.renderer.getView();
    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const logicalW = canvas.width / dpr;
    const logicalH = canvas.height / dpr;
    const shown = (handle.children ?? []).find(grp => grp.visible);
    return {
      visible: true,
      origin: {
        x: rect.left + (g.x / logicalW) * rect.width,
        y: rect.top + (g.y / logicalH) * rect.height
      },
      scaleX: rect.width / logicalW,
      scaleY: rect.height / logicalH,
      group: shown?.label
    };
  });
}

/** The label of the currently-shown gizmo mode group, or `undefined` when the handle is hidden. */
async function gizmoGroup(page: Page): Promise<string | undefined> {
  const geom = await gizmoGeom(page);
  return geom.group;
}

/**
 * Grab a gizmo handle child at LOGICAL offset (dx, dy) from the handle origin (e.g. the rotate ring is at
 * radius 50, a scale box at 40) and drag it by a LOGICAL delta (ddx, ddy), converting both through the
 * handle's screen scale. Requires a visible handle (`geom.origin` present).
 */
async function dragGizmo(
  page: Page,
  geom: GizmoGeom,
  dx: number,
  dy: number,
  ddx: number,
  ddy: number
): Promise<void> {
  const origin = geom.origin as ScreenPoint;
  const sx = origin.x + dx * (geom.scaleX ?? 1);
  const sy = origin.y + dy * (geom.scaleY ?? 1);
  const tx = sx + ddx * (geom.scaleX ?? 1);
  const ty = sy + ddy * (geom.scaleY ?? 1);
  await page.mouse.move(sx, sy);
  await page.mouse.down();
  await page.mouse.move((sx + tx) / 2, (sy + ty) / 2, { steps: 5 });
  await page.mouse.move(tx, ty, { steps: 5 });
  await page.mouse.up();
}

/** Read one numeric field of an entity's live Transform (rotation / scaleX / scaleY / x / y). */
async function transformField(
  page: Page,
  editorId: number,
  field: string
): Promise<number | undefined> {
  const snap = await snapshot(page);
  const value = snap.entities
    .find(entity => entity.id === editorId)
    ?.components.find(component => component.name === "Transform")?.value as
    | Record<string, number>
    | undefined;
  return value?.[field];
}

/** Select a shape by a real canvas click and wait for the host poll to sync the gizmo to it. */
async function selectShape(page: Page, editorId: number): Promise<void> {
  const target = await entityScreenCenter(page, editorId);
  await page.mouse.click(target.x, target.y);
  await expectSelection(page, [editorId]);
  await settle(page);
}

test.describe("viewport interaction — real mouse on the canvas", () => {
  test("a click on a shape selects it (bridge selection reflects the canvas pick)", async ({
    page
  }) => {
    await boot(page);
    await expectSelection(page, []);

    const target = await entityScreenCenter(page, SKYLINE_BACK);
    await page.mouse.click(target.x, target.y);

    await expectSelection(page, [SKYLINE_BACK]);
  });

  test("a Ctrl-click toggles an entity's membership on and off", async ({ page }) => {
    await boot(page);
    const target = await entityScreenCenter(page, SKYLINE_BACK);

    await page.mouse.click(target.x, target.y);
    await expectSelection(page, [SKYLINE_BACK]);

    await page.keyboard.down("Control");
    await page.mouse.click(target.x, target.y);
    await page.keyboard.up("Control");
    await expectSelection(page, []);
  });

  test("a click on empty canvas clears the selection", async ({ page }) => {
    await boot(page);
    const target = await entityScreenCenter(page, SKYLINE_BACK);
    await page.mouse.click(target.x, target.y);
    await expectSelection(page, [SKYLINE_BACK]);

    const empty = await emptyCanvasPoint(page);
    await page.mouse.click(empty.x, empty.y);
    await expectSelection(page, []);
  });

  test("a marquee drag from empty space across two shapes selects both", async ({ page }) => {
    await boot(page);
    await expectSelection(page, []);

    // The marquee starts ONLY on empty space (a press over a shape is a pick), and the skyline shapes
    // are large — so sweep from the guaranteed-empty top-left corner across both of them.
    const start = await emptyCanvasPoint(page);
    const a = await entityScreenCenter(page, SKYLINE_BACK);
    const b = await entityScreenCenter(page, SKYLINE_MID);
    const endX = Math.max(a.x, b.x) + 30;
    const endY = Math.max(a.y, b.y) + 30;

    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move((start.x + endX) / 2, (start.y + endY) / 2, { steps: 4 });
    await page.mouse.move(endX, endY, { steps: 4 });
    await page.mouse.up();

    // A drag multi-selects (unlike a click). Assert both skyline shapes are caught — a superset is
    // fine; the point is that the sweep selected more than the single shape a click would.
    await expect
      .poll(
        async () => {
          const selected = await selection(page);
          return (
            selected.includes(SKYLINE_BACK) &&
            selected.includes(SKYLINE_MID) &&
            selected.length >= 2
          );
        },
        { timeout: 3000 }
      )
      .toBe(true);
  });

  test("selecting a shape shows the gizmo at it, and dragging the handle moves the object", async ({
    page
  }) => {
    await boot(page);

    // selectShape clicks the shape + waits for the host to sync the gizmo (Move mode by default).
    await selectShape(page, SKYLINE_MID);
    const geom = await gizmoGeom(page);
    expect(geom.visible, "gizmo handle should appear at the selected object").toBe(true);
    expect(geom.group).toBe("translate");

    const before = await transformXY(page, SKYLINE_MID);
    expect(before).toBeDefined();

    // Grab the free-move square at the handle origin and drag it a generous distance; the object's
    // Transform must change (the drag commits a setField Transform through commands).
    await dragGizmo(page, geom, 0, 0, 55, 40);

    await expect
      .poll(
        async () => {
          const now = await transformXY(page, SKYLINE_MID);
          if (!now || !before) return false;
          return (
            Math.round(now.x) !== Math.round(before.x) || Math.round(now.y) !== Math.round(before.y)
          );
        },
        { timeout: 3000 }
      )
      .toBe(true);
  });

  test("switching the active tool refreshes the visible gizmo handle group", async ({ page }) => {
    await boot(page);
    await selectShape(page, SKYLINE_MID);

    // A real toolbar click must swap the shown handle sub-composite — not just highlight the button.
    await page.locator('[data-tool="rotate"]').click();
    await expect.poll(() => gizmoGroup(page), { timeout: 3000 }).toBe("rotate");

    await page.locator('[data-tool="scale"]').click();
    await expect.poll(() => gizmoGroup(page), { timeout: 3000 }).toBe("scale");

    await page.locator('[data-tool="translate"]').click();
    await expect.poll(() => gizmoGroup(page), { timeout: 3000 }).toBe("translate");
  });

  test("dragging the Rotate ring rotates the selected object", async ({ page }) => {
    await boot(page);
    await selectShape(page, SKYLINE_MID);
    await page.locator('[data-tool="rotate"]').click();
    await expect.poll(() => gizmoGroup(page), { timeout: 3000 }).toBe("rotate");

    // Grab the top of the ring (radius 50) and swing it to the right → the object rotates.
    const geom = await gizmoGeom(page);
    await dragGizmo(page, geom, 0, -50, 45, 0);

    await expect
      .poll(async () => Math.abs((await transformField(page, SKYLINE_MID, "rotation")) ?? 0), {
        timeout: 3000
      })
      .toBeGreaterThan(0.05);
  });

  test("dragging a Scale handle scales the selected object", async ({ page }) => {
    await boot(page);
    await selectShape(page, SKYLINE_MID);
    await page.locator('[data-tool="scale"]').click();
    await expect.poll(() => gizmoGroup(page), { timeout: 3000 }).toBe("scale");

    // Grab the X-axis box (at +40) and drag it further out → scaleX grows (Y stays put — axis-locked).
    const geom = await gizmoGeom(page);
    await dragGizmo(page, geom, 40, 0, 45, 0);

    await expect
      .poll(async () => (await transformField(page, SKYLINE_MID, "scaleX")) ?? 1, { timeout: 3000 })
      .toBeGreaterThan(1.2);
  });

  test("dragging the Rect frame uniformly scales the selected object", async ({ page }) => {
    await boot(page);
    await selectShape(page, SKYLINE_MID);
    await page.locator('[data-tool="rect"]').click();
    await expect.poll(() => gizmoGroup(page), { timeout: 3000 }).toBe("rect");

    // Grab the frame's right edge (at +40) and drag out → the bounding box scales BOTH axes uniformly.
    const geom = await gizmoGeom(page);
    await dragGizmo(page, geom, 40, 0, 45, 0);

    await expect
      .poll(
        async () => {
          const sx = (await transformField(page, SKYLINE_MID, "scaleX")) ?? 1;
          const sy = (await transformField(page, SKYLINE_MID, "scaleY")) ?? 1;
          return sx > 1.2 && sy > 1.2;
        },
        { timeout: 3000 }
      )
      .toBe(true);
  });

  test("camera zoom moves the rendered scene (content rides the camera transform)", async ({
    page
  }) => {
    await boot(page);

    // The Pixi global position of a shape's view must change when the camera zooms — proof the content
    // layer is parented under the camera-transformed world layer, not the raw stage.
    const moved = await page.evaluate(editorId => {
      const app = (
        globalThis as unknown as { __MOKU_EDITOR__: { getEditor(): { gameApp: EditorGameApp } } }
      ).__MOKU_EDITOR__.getEditor().gameApp;
      const view = app.renderer.getEntityView(app.commands.resolve(editorId));
      const before = view.getGlobalPosition();
      const b = { x: before.x, y: before.y };
      app.camera.setZoom(2);
      app.scheduler.tick(1 / 60);
      const after = view.getGlobalPosition();
      const a = { x: after.x, y: after.y };
      app.camera.setZoom(1);
      app.scheduler.tick(1 / 60);
      return Math.abs(a.x - b.x) > 1 || Math.abs(a.y - b.y) > 1;
    }, SKYLINE_MID);

    expect(moved, "a camera zoom must move the shape on screen").toBe(true);
  });
});

/** Minimal structural shape of the game app surface these helpers reach through the dev handle. */
type EditorGameApp = {
  renderer: {
    getView(): HTMLCanvasElement;
    getStage(): DisplayNode;
    getEntityView(entity: unknown): {
      getBounds(): { x: number; y: number; width: number; height: number };
      getGlobalPosition(): { x: number; y: number };
    };
  };
  commands: { resolve(id: number): unknown };
  camera: { setZoom(zoom: number): void };
  scheduler: { tick(dt: number): void };
};

/** Minimal structural shape of a Pixi display node the gizmo walk reads. */
type DisplayNode = {
  label?: string;
  visible?: boolean;
  children?: DisplayNode[];
  getGlobalPosition(): { x: number; y: number };
};
