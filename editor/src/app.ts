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
    build: { clientEntry: "src/spa.tsx", notFound: true }
  }
});
