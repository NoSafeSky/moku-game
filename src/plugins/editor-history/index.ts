/**
 * Standard tier — undo/redo; applyTracked wraps commands.applyRaw; clears on commands:restored.
 *
 * @see README.md
 */
import { createPlugin } from "../../config";
import { commandsPlugin } from "../commands";
import { createApi } from "./api";
import { createRestoredHooks } from "./handlers";
import { createState } from "./state";
import type { Config } from "./types";

const defaultConfig: Config = { maxDepth: 100 };

export const editorHistoryPlugin = createPlugin("editor-history", {
  depends: [commandsPlugin],
  config: defaultConfig,
  createState,
  api: createApi,
  /**
   * Subscribes to `commands:restored` to clear the undo/redo stacks (the ONLY hook).
   *
   * @param ctx - The plugin context.
   * @returns The hook-handler map.
   * @example
   * ```ts
   * hooks: (ctx) => createRestoredHooks(ctx);
   * ```
   */
  hooks: ctx => createRestoredHooks(ctx)
});
