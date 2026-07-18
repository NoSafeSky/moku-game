/** @file Island registry → pluginConfigs.spa.islands. */
import { assetBrowser } from "./asset-browser";
import { inspector } from "./inspector";
import { sceneTree } from "./scene-tree";
import { statusBar } from "./status-bar";
import { toolbar } from "./toolbar";
import { viewport } from "./viewport";
import { workspace } from "./workspace";

/**
 * The editor shell's client-hydration islands, in registration order — passed to
 * `pluginConfigs.spa.islands` in `spa.tsx` so the spa kernel mounts each one onto its
 * matching `[data-island]` container. World-consuming islands reach the game runtime through
 * `lib/editor-host` (`getEditor`/`onSnapshot`); the `workspace` island is pure layout (splitter
 * resize) and touches no runtime. None touch `commands`/`ecs` directly.
 *
 * @example
 * ```ts
 * createApp({ pluginConfigs: { spa: { islands } } });
 * ```
 */
export const islands = [
  viewport,
  inspector,
  sceneTree,
  assetBrowser,
  toolbar,
  workspace,
  statusBar
];
