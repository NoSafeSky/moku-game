/** @file Island registry → pluginConfigs.spa.islands. */
import { assetBrowser } from "./asset-browser";
import { hierarchy } from "./hierarchy";
import { inspector } from "./inspector";
import { menuBar } from "./menu-bar";
import { shortcuts } from "./shortcuts";
import { statusBar } from "./status-bar";
import { toolbar } from "./toolbar";
import { viewport } from "./viewport";
import { workspace } from "./workspace";

/**
 * The editor shell's client-hydration islands, in registration order — passed to
 * `pluginConfigs.spa.islands` in `spa.tsx` so the spa kernel mounts each one onto its
 * matching `[data-island]` container. World-consuming islands reach the game runtime through
 * `lib/editor-host` (`getEditor`/`onSnapshot`); the `workspace` island is pure layout (splitter
 * resize) and the `shortcuts` island is a global keymap with no visible surface. None touch
 * `commands`/`ecs` directly.
 *
 * @example
 * ```ts
 * createApp({ pluginConfigs: { spa: { islands } } });
 * ```
 */
export const islands = [
  viewport,
  inspector,
  hierarchy,
  assetBrowser,
  menuBar,
  toolbar,
  workspace,
  statusBar,
  shortcuts
];
