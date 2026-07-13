/**
 * @file editor-history plugin — commands:restored hook skeleton.
 */

/** The single restored-clears handler this plugin attaches. */
export type RestoredHooks = {
  /** Clear the undo/redo stacks when a non-undoable bulk restore reseeds the world. */
  "commands:restored": (payload: { source: "reload" | "exit-play" }) => void;
};

/**
 * Builds the `commands:restored` → `clear()` hook map (skeleton).
 *
 * @param _ctx - Plugin context (unused in skeleton).
 * @throws {Error} Always in the skeleton — implemented during build.
 * @example
 * ```ts
 * hooks: (ctx) => createRestoredHooks(ctx);
 * ```
 */
export function createRestoredHooks(_ctx: unknown): RestoredHooks {
  throw new Error("not implemented");
}
