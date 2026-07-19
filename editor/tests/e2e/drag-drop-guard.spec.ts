/**
 * @file Page-wide native-drop safety net (human-QA finding, Wave A6 gate). The asset-browser → viewport
 * drag is the only drag this app wants to *handle a drop for*; everything else that can reach `dragover`/
 * `drop` — an OS file dragged in from Explorer/Finder, a URL or text selection dragged from elsewhere in
 * the browser — must never be allowed to fall through to the browser's native default, which is to
 * navigate the whole tab to open/display the dropped item and blow away the in-memory editor session.
 * Reproduces via a synthetic `DragEvent` carrying `dataTransfer.types = ["Files"]` (no
 * `application/x-moku-asset`) — exactly what a real OS file drag looks like to a `dragover`/`drop`
 * handler — and asserts the event's default gets prevented (`dispatchEvent` returns `false`) wherever it
 * lands, including directly on the viewport's own drop zone (whose asset-specific guard only reacts to
 * the custom DND type and, before this fix, left every other payload completely unhandled).
 */
import { boot, expect, snapshot, test } from "./_helpers";

test.describe("global drag-drop guard — no accidental tab navigation", () => {
  test("dropping a non-asset (OS file) payload outside any drop zone never navigates the tab", async ({
    page
  }) => {
    await boot(page);
    const before = page.url();

    const result = await page.evaluate(() => {
      // The menu bar is not a drop zone at all — the worst case (nothing claims the drop).
      const target = document.querySelector('[data-island="menu-bar"]');
      if (!target) throw new Error("no menu-bar");
      const dataTransfer = new DataTransfer();
      Object.defineProperty(dataTransfer, "types", { value: ["Files"] });
      const init: DragEventInit = { bubbles: true, cancelable: true, dataTransfer };
      const overPrevented = !target.dispatchEvent(new DragEvent("dragover", init));
      const dropPrevented = !target.dispatchEvent(new DragEvent("drop", init));
      return { overPrevented, dropPrevented };
    });

    expect(result.overPrevented, "dragover default prevented").toBe(true);
    expect(result.dropPrevented, "drop default prevented").toBe(true);
    expect(page.url()).toBe(before);
  });

  test("dropping a real OS file directly on the Scene View canvas is swallowed, not navigated, and spawns no sprite", async ({
    page
  }) => {
    await boot(page);
    const before = await snapshot(page);
    const beforeUrl = page.url();

    const result = await page.evaluate(() => {
      const stage = document.querySelector('[data-island="viewport"] [data-stage]');
      if (!stage) throw new Error("no viewport stage");
      const rect = stage.getBoundingClientRect();
      const dataTransfer = new DataTransfer();
      // No application/x-moku-asset entry — exactly what an OS file drag's dataTransfer looks like.
      Object.defineProperty(dataTransfer, "types", { value: ["Files"] });
      const init: DragEventInit = {
        bubbles: true,
        cancelable: true,
        dataTransfer,
        clientX: rect.left + rect.width / 2,
        clientY: rect.top + rect.height / 2
      };
      const overPrevented = !stage.dispatchEvent(new DragEvent("dragover", init));
      const dropPrevented = !stage.dispatchEvent(new DragEvent("drop", init));
      return { overPrevented, dropPrevented };
    });

    expect(result.overPrevented, "dragover default prevented on the stage").toBe(true);
    expect(result.dropPrevented, "drop default prevented on the stage").toBe(true);

    const after = await snapshot(page);
    expect(after.entities.length, "no sprite was spawned from a non-asset drop").toBe(
      before.entities.length
    );
    expect(page.url()).toBe(beforeUrl);
  });
});
