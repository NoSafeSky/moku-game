/** @file Node SSG composition — builds the static editor shell. */
import { buildPlugin, cliPlugin, createApp, deployPlugin } from "@moku-labs/web";
import { SITE } from "./config";
import { routes } from "./routes";

export const app = createApp({
  config: { mode: "ssg" },
  plugins: [buildPlugin, deployPlugin, cliPlugin],
  pluginConfigs: {
    site: { name: SITE.name, url: SITE.url, description: SITE.description },
    router: { routes },
    // minify: false — the client statically bundles Pixi v8 (the game engine), and Bun's identifier
    // minifier drops Pixi's `extensions` binding while keeping its `extensions.add(...)` self-
    // registration, so a minified bundle throws `ReferenceError: <id> is not defined` at boot. This is a
    // real-browser-only failure (Pixi stays headless under happy-dom, so unit tests never exercise it).
    // Unminified is ~1.4× here — acceptable for a developer editor tool. See README "Bundling notes".
    build: { clientEntry: "src/spa.tsx", notFound: true, minify: false }
  }
});
