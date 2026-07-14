/** @file Island registry → pluginConfigs.spa.islands. */
import { assetBrowser } from "./asset-browser";
import { inspector } from "./inspector";
import { sceneTree } from "./scene-tree";
import { toolbar } from "./toolbar";
import { viewport } from "./viewport";

/**
 * The editor shell's client-hydration islands, in registration order — passed to
 * `pluginConfigs.spa.islands` in `spa.tsx` so the spa kernel mounts each one onto its
 * matching `[data-island]` container. Every island consumes the game runtime through
 * `lib/editor-host` (`getEditor`/`onSnapshot`); none touch `commands`/`ecs` directly.
 *
 * @example
 * ```ts
 * createApp({ pluginConfigs: { spa: { islands } } });
 * ```
 */
export const islands = [viewport, inspector, sceneTree, assetBrowser, toolbar];
