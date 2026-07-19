/**
 * @file Shared e2e harness — a browser-error-guarded `test` fixture, boot/snapshot/settle helpers, and the
 * frozen demo-scene constants every spec asserts against.
 *
 * State in this app is POLL-based (one rAF loop reads `bridge.snapshot()`, memoized by `epoch`, and fans it
 * out to the islands) — so a world write lands in the DOM on the *next* frame. Every assertion therefore
 * uses Playwright's web-first retrying form (`expect(locator)…` / `expect.poll`), never a one-shot read.
 * Field edits commit on the delegated `change` event (not `input`, not Enter), so `.fill()` is always
 * followed by `dispatchEvent("change")`.
 */
import { test as base, expect, type Page } from "@playwright/test";

/**
 * Browser messages that are known-benign and NOT app defects:
 *  - the favicon 404 (the shell ships no favicon);
 *  - the framework `mcp` plugin's colon-in-tool-name validation warnings (`ecs:query`, `scene:load`, … —
 *    a Layer-2 concern, emitted at console.warn, harmless in the browser);
 *  - PixiJS "Asset id … not found in Cache" — only ever provoked by inspecting a `SpriteRenderer` whose
 *    `sprite` alias is unset (the demo loads no assets); a graphics-2d nicety, never a real-use path.
 */
const ALLOWED_MESSAGE = [
  /favicon\.ico/i,
  /tool name/i,
  /Tool registration/i,
  /invalid characters/i,
  /Asset id .* not found in Cache/i,
  /not found in Cache/i
];

/** The live bridge snapshot the dev handle exposes. */
export type EditorSnapshot = {
  epoch: number;
  mode: "edit" | "play";
  canUndo: boolean;
  canRedo: boolean;
  selection: number[];
  roots: number[];
  entities: {
    id: number;
    name: string;
    enabled: boolean;
    parent: number | undefined;
    children: number[];
    components: { name: string; value: Record<string, unknown> }[];
  }[];
};

/**
 * The `test` object every spec imports — a base test extended with an always-on error guard that captures
 * `pageerror`, `console.error`, and 5xx responses across the whole test and asserts ZERO unexpected
 * (non-allowlisted) browser errors at teardown. A feature that works visually but logs an error is a bug.
 */
export const test = base.extend<{ errors: string[] }>({
  errors: [
    async ({ page }, use) => {
      const errors: string[] = [];
      page.on("pageerror", error => errors.push(String(error)));
      page.on("console", message => {
        if (message.type() === "error") errors.push(message.text());
      });
      page.on("response", response => {
        if (response.status() >= 500) errors.push(`HTTP ${response.status()} ${response.url()}`);
      });

      await use(errors);

      const unexpected = errors.filter(
        text => !ALLOWED_MESSAGE.some(pattern => pattern.test(text))
      );
      expect(unexpected, `unexpected browser errors:\n${unexpected.join("\n")}`).toEqual([]);
    },
    { auto: true }
  ]
});

/** A 1×1 red PNG (valid image bytes) — small enough to inline, decodes into a real `<img>` thumbnail. */
export const PNG_1x1_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

/** Boot the shell and wait until the game app has booted and the demo scene is seeded. */
export async function boot(page: Page): Promise<void> {
  await page.goto("/");
  await page.waitForFunction(() => {
    const dbg = (globalThis as unknown as { __MOKU_EDITOR__?: { getEditor(): unknown } })
      .__MOKU_EDITOR__;
    if (!dbg) return false;
    try {
      return (
        (dbg.getEditor() as { bridge: { snapshot(): EditorSnapshot } }).bridge.snapshot().entities
          .length > 0
      );
    } catch {
      return false;
    }
  });
  // Fonts settle before any screenshot (font-swap ghosting).
  await page.evaluate(() => document.fonts.ready);
}

/** Read the live bridge snapshot from the page. */
export function snapshot(page: Page): Promise<EditorSnapshot> {
  return page.evaluate(() => {
    const dbg = (
      globalThis as unknown as {
        __MOKU_EDITOR__: { getEditor(): { bridge: { snapshot(): EditorSnapshot } } };
      }
    ).__MOKU_EDITOR__;
    return dbg.getEditor().bridge.snapshot();
  });
}

/** Two rAF ticks — long enough for the poll loop to re-sync views + fan out the next snapshot. */
export async function settle(page: Page): Promise<void> {
  await page.evaluate(async () => {
    for (let tick = 0; tick < 2; tick++) {
      await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
    }
  });
}

/**
 * Poll a single entity's Transform field until it reaches `expected` — the deterministic oracle for "the
 * world write actually landed" (the epoch-gated poll updates the snapshot a frame later).
 */
export async function expectField(
  page: Page,
  id: number,
  component: string,
  key: string,
  expected: unknown
): Promise<void> {
  await expect
    .poll(
      async () => {
        const snap = await snapshot(page);
        const value = snap.entities
          .find(entity => entity.id === id)
          ?.components.find(candidate => candidate.name === component)?.value as
          | Record<string, unknown>
          | undefined;
        return value?.[key];
      },
      { timeout: 3000 }
    )
    .toBe(expected);
}

/**
 * Wait until the Pixi view x-position for an editor id reaches `expected` — proves the *canvas* (not just
 * the data) moved, via the poll → loop-tick re-sync pipeline.
 */
export async function expectViewX(page: Page, id: number, expected: number): Promise<void> {
  await page.waitForFunction(
    ([editorId, want]) => {
      const handle = (
        globalThis as unknown as {
          __MOKU_EDITOR__: {
            getEditor(): {
              gameApp: {
                commands: { resolve(id: number): unknown };
                renderer: { getEntityView(entity: unknown): { x: number } | undefined };
              };
            };
          };
        }
      ).__MOKU_EDITOR__.getEditor();
      const entity = handle.gameApp.commands.resolve(editorId as number);
      return handle.gameApp.renderer.getEntityView(entity)?.x === want;
    },
    [id, expected] as const,
    { timeout: 3000 }
  );
}

/** Edit a number/text field control and commit it through the island's delegated `change` path. */
export async function editField(page: Page, key: string, value: string): Promise<void> {
  const control = page.locator(`[data-island="inspector"] [data-field-key="${key}"]`);
  await control.fill(value);
  await control.dispatchEvent("change");
}

/**
 * The frozen demo-scene inventory (from `demo-scene.ts`) — declared independently here so the expectations
 * never derive from the code under test. Rows render grouped by root in `[1, 9, 7]` order (Environment,
 * Enemies, Player), so specs address rows by stable `data-id`, never by position.
 */
export const DEMO = {
  entityCount: 11,
  rootIds: [1, 9, 7] as const,
  /** Row names top→bottom (Environment subtree, then Enemies subtree, then Player subtree). */
  rowOrder: [
    "Environment",
    "Skyline_Back",
    "Skyline_Mid",
    "Ground",
    "Platform_A",
    "Platform_B",
    "Enemies",
    "Drone_01",
    "Drone_02",
    "Player",
    "Camera_Follow"
  ] as const,
  environment: { id: 1 },
  ground: { id: 4 },
  platformB: { id: 6, disabled: true },
  player: { id: 7, x: 210, y: 300, fill: "#5cb85c" },
  enemies: { id: 9 },
  drone01: { id: 10 },
  drone02: { id: 11, x: 640, y: 260 }
} as const;

/** A hierarchy row locator addressed by its stable editor id. */
export function row(page: Page, id: number) {
  return page.locator(`[data-island="hierarchy"] [data-tree] [data-row][data-id="${id}"]`);
}

export { expect } from "@playwright/test";
