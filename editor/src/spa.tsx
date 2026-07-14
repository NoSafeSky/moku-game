/** @file Client entry — boots the game app, then hydrates the island shell. */
import { createApp } from "@moku-labs/web/browser";
import { islands } from "./islands";
import { startEditor } from "./lib/editor-host";
import { routes } from "./routes";

const app = createApp({
  config: { mode: "ssg" },
  pluginConfigs: { router: { routes }, spa: { islands } }
});

const viewport = document.querySelector<HTMLElement>('[data-island="viewport"]');
if (viewport) await startEditor(viewport);
await app.start();
