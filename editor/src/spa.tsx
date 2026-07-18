/** @file Client entry — boots the game app, seeds the fixture scene, then hydrates the island shell. */
import { createApp } from "@moku-labs/web/browser";
import { SITE } from "./config";
import { islands } from "./islands";
import { seedDemoScene } from "./lib/demo-scene";
import { getEditor, onSnapshot, startEditor } from "./lib/editor-host";
import { routes } from "./routes";

/**
 * Dev / e2e handle — read live editor state (`getEditor().bridge.snapshot()`, entity views) and drive
 * the bridge without scraping the DOM. A read-only accessor pair, harmless in production.
 */
type EditorDebugHandle = { getEditor: typeof getEditor; onSnapshot: typeof onSnapshot };

const app = createApp({
  config: { mode: "ssg" },
  pluginConfigs: {
    site: { name: SITE.name, url: SITE.url, description: SITE.description },
    router: { routes },
    spa: { islands }
  }
});

const viewport = document.querySelector<HTMLElement>('[data-island="viewport"]');
// Mount the canvas into the letterboxed stage when present (the viewport chrome frames it 16:9), else the
// panel itself — so the game view is padded, never stretched, within whatever space the panel has.
const stage = viewport?.querySelector<HTMLElement>("[data-stage]") ?? viewport;
if (stage) {
  const { gameApp } = await startEditor(stage); // game app up + canvas mounted BEFORE islands hydrate
  seedDemoScene(gameApp); // the stand-in "game" — a real host game would replace this
  (globalThis as typeof globalThis & { __MOKU_EDITOR__?: EditorDebugHandle }).__MOKU_EDITOR__ = {
    getEditor,
    onSnapshot
  };
}
await app.start(); // hydrate islands (getEditor() is now ready)
