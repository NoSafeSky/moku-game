/**
 * @file editor-history plugin — public type surface (Config, State, Mutation/HistoryEntry, FieldDiff, Api).
 */
import type { Command, CommandResult, EditorId } from "../commands/types";

/**
 * editor-history plugin configuration — defaults applied when a consumer omits a field.
 */
export type Config = {
  /**
   * Maximum number of undo steps retained (ring-buffer cap). When a new step would exceed this, the
   * OLDEST step is evicted. Values < 1 are treated as 1.
   *
   * @default 100
   */
  maxDepth: number;
};

/**
 * One recorded mutation: the forward command (replayed on redo) and its inverse (replayed on undo),
 * exactly as `commands.applyRaw` returned them. For a `setField` this pair IS the bounded field-diff.
 */
export type Mutation = {
  /** The forward command as applied — replayed on redo. */
  readonly command: Command;
  /** The inverse command that reverses it — replayed on undo. */
  readonly inverse: Command;
};

/**
 * One undo step: a batch of mutations applied together (a single tracked edit, or a coalesced gesture).
 * `undo()` replays `inverse` in REVERSE order; `redo()` replays `command` in forward order.
 */
export type HistoryEntry = {
  /** The mutations forming this step; ≥ 1 (empty steps are never pushed). */
  readonly mutations: readonly Mutation[];
};

/** editor-history plugin state — the two stacks plus the open-gesture buffer. */
export type State = {
  /** Undo stack (top = last-applied step). Oldest entry evicted when length exceeds `config.maxDepth`. */
  readonly undo: HistoryEntry[];
  /** Redo stack (top = last-undone step). Cleared whenever a fresh tracked edit is recorded. */
  readonly redo: HistoryEntry[];
  /**
   * Mutations accumulated during an OPEN gesture, collapsed into one `HistoryEntry` at `endGesture()`.
   * `undefined` when no gesture is open (never `null`).
   */
  gesture: Mutation[] | undefined;
  /** True between `beginGesture()` and `endGesture()`; tracked edits buffer instead of pushing. */
  gestureActive: boolean;
};

/**
 * The bounded field-diff a `setField` step encodes — the readable projection of a `setField` `Mutation`.
 * Not a stored type (steps store replayable `Mutation`s); exposed for inspection/tests.
 */
export type FieldDiff = {
  /** Stable editor id of the target entity (survives despawn/recycle, unlike a raw `Entity`). */
  readonly editorId: EditorId;
  /** Component name whose field changed. */
  readonly component: string;
  /** Field key within the component. */
  readonly field: string;
  /** Value before the edit (what `undo` restores). */
  readonly old: unknown;
  /** Value after the edit (what `redo` restores). */
  readonly new: unknown;
};

/** Public API surface (`app["editor-history"]`). */
export type Api = {
  /** Apply `command` through the single write-authority AND record it as an undo step (or buffer into the open gesture). */
  applyTracked(command: Command): CommandResult;
  /** Reverse the most recent step (replaying its inverses via `commands.applyRaw`); moves it to redo. Returns whether a step was undone. */
  undo(): boolean;
  /** Re-apply the most recently undone step (replaying its forwards); moves it back to undo. Returns whether a step was redone. */
  redo(): boolean;
  /** True when there is at least one step to undo (poll this on the ecs `changeEpoch`). */
  canUndo(): boolean;
  /** True when there is at least one step to redo. */
  canRedo(): boolean;
  /** Open a gesture: subsequent tracked edits buffer into ONE step until `endGesture()`. */
  beginGesture(): void;
  /** Close the open gesture: coalesce the buffer into one undo step (or nothing, if empty). */
  endGesture(): void;
  /** Empty both stacks and drop any open gesture (called on `commands:restored`). */
  clear(): void;
};
