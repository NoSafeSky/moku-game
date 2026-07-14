/**
 * @file editor-history plugin — `commands:restored` hook.
 *
 * Declares the plugin's ONLY hook: a bulk `commands.restore(...)` reseed (a scene
 * reload or an exit-play revert) is never undoable, so the handler's sole action
 * is to clear both stacks via the shared `clearHistory` helper (also used by the
 * public `clear()` API method). Mirrors the `platform`/`prefs.ts`
 * `createPrefsHooks` precedent: a structural context type + a curried hook-map factory.
 */
import { clearHistory } from "./history";
import type { State } from "./types";

/** The single restored-clears handler this plugin attaches. */
export type RestoredHooks = {
  /** Clear the undo/redo stacks when a non-undoable bulk restore reseeds the world. */
  "commands:restored": (payload: { source: "reload" | "exit-play" }) => void;
};

/**
 * The minimal context the hook needs: `state` to clear and `log` for the debug
 * diagnostic. No `require` — clearing touches only this plugin's own state.
 */
export type RestoredHooksContext = {
  /** editor-history plugin state (the two stacks + gesture buffer). */
  readonly state: State;
  /** Logger from `logPlugin` (the cleared-on-restore diagnostic). */
  readonly log: {
    /** Log at debug level. */
    debug(message: string): void;
  };
};

/**
 * Builds the `commands:restored` -> `clear()` hook map.
 *
 * @param ctx - Context providing `state` (to clear) and `log` (for the diagnostic).
 * @returns The `commands:restored` handler map.
 * @example
 * ```ts
 * hooks: (ctx) => createRestoredHooks(ctx);
 * ```
 */
export function createRestoredHooks(ctx: RestoredHooksContext): RestoredHooks {
  return {
    /**
     * Clear the undo/redo stacks on a non-undoable bulk restore.
     *
     * @param payload - The `commands:restored` payload (`source` is logged, not branched on).
     * @param payload.source - Which reseed triggered the restore (`"reload"` | `"exit-play"`).
     * @example
     * ```ts
     * hooks["commands:restored"]({ source: "reload" });
     * ```
     */
    "commands:restored": (payload: { source: "reload" | "exit-play" }): void => {
      clearHistory(ctx.state);
      ctx.log.debug(`[editor-history] cleared on commands:restored (${payload.source})`);
    }
  };
}
