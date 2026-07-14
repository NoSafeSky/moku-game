/**
 * @file editor-history plugin — API factory.
 *
 * `applyTracked` wraps `commands.apply` (NOT `commands.applyRaw`) for the forward
 * write: only `apply` computes and returns the inverse `Command` this plugin needs
 * to store — `applyRaw`'s `RawResult` carries no inverse, and editor-history has no
 * `ecs`/`reflection` edge with which to compute one itself (only the write-authority
 * can read the pre-write value / snapshot a despawned entity at the right instant).
 * `undo`/`redo` replay purely through `commands.applyRaw` — replaying a stored step
 * needs no NEW inverse, so the cheaper, non-recording primitive is correct there and
 * guarantees no re-record / no feedback loop. Both entry points stay inside the
 * single write-authority (`commands`) — there is no second mutation path.
 */
import { commandsPlugin } from "../commands";
import type { Command, CommandResult, Api as CommandsApi } from "../commands/types";
import { clearHistory, coalesce, pushEntry, pushUndoAfterRedo } from "./history";
import type { Api, Config, HistoryEntry, State } from "./types";

/** The subset of the `commands` API editor-history calls. */
type RequiredCommandsApi = Pick<CommandsApi, "apply" | "applyRaw">;

/**
 * Structural context required by {@link createApi}, so unit tests can pass a
 * minimal mock without wiring the full kernel. Mirrors the `commands` plugin's own
 * `CommandsApiContext` pattern for a plugin that reaches a dependency's API at call
 * time (via `require`) rather than capturing it in `onStart`.
 */
export type EditorHistoryApiContext = {
  /** Resolved editor-history configuration (`maxDepth`). */
  readonly config: Readonly<Config>;
  /** editor-history plugin state — the two stacks + the open-gesture buffer. */
  readonly state: State;
  /** Logger from `logPlugin` (before-warn no-ops, replay-failure errors). */
  readonly log: {
    /** Log at debug level. */
    debug(message: string): void;
    /** Log a warning. */
    warn(message: string): void;
    /** Log an error. */
    error(message: string): void;
  };
  /** Require the `commands` plugin's API. Called per-method (no `onStart` to capture it in). */
  require: (plugin: typeof commandsPlugin) => RequiredCommandsApi;
};

/**
 * Apply `command` through `commands.apply` and, on success, record its inverse —
 * buffered into the open gesture if one is active, else pushed as its own step.
 *
 * @param ctx - The editor-history API context.
 * @param command - The command to apply and track.
 * @returns The {@link CommandResult} from `commands.apply`.
 * @example
 * ```ts
 * applyTracked(ctx, { kind: "setField", id, component: "Position", field: "x", value: 5 });
 * ```
 */
function applyTracked(ctx: EditorHistoryApiContext, command: Command): CommandResult {
  const result = ctx.require(commandsPlugin).apply(command);

  if (result.ok) {
    const mutation = { command, inverse: result.inverse };
    if (ctx.state.gestureActive && ctx.state.gesture) {
      ctx.state.gesture.push(mutation);
    } else {
      pushEntry(ctx.state, ctx.config, { mutations: [mutation] });
    }
  }

  return result;
}

/**
 * Replays an entry's inverses through `commands.applyRaw`, in REVERSE mutation
 * order. A replayed inverse returning `{ ok: false }` is logged (should-not-happen)
 * and the remaining inverses still run, keeping the stacks consistent.
 *
 * @param ctx - The editor-history API context.
 * @param entry - The step being undone.
 * @example
 * ```ts
 * replayInverses(ctx, entry); // undo()
 * ```
 */
function replayInverses(ctx: EditorHistoryApiContext, entry: HistoryEntry): void {
  const commands = ctx.require(commandsPlugin);
  for (const mutation of entry.mutations.toReversed()) {
    const result = commands.applyRaw(mutation.inverse);
    if (!result.ok) {
      ctx.log.error(`[editor-history] undo: replay of inverse failed: ${result.error}`);
    }
  }
}

/**
 * Replays an entry's forward commands through `commands.applyRaw`, in forward
 * mutation order. A replayed command returning `{ ok: false }` is logged
 * (should-not-happen) and the remaining commands still run.
 *
 * @param ctx - The editor-history API context.
 * @param entry - The step being redone.
 * @example
 * ```ts
 * replayForward(ctx, entry); // redo()
 * ```
 */
function replayForward(ctx: EditorHistoryApiContext, entry: HistoryEntry): void {
  const commands = ctx.require(commandsPlugin);
  for (const mutation of entry.mutations) {
    const result = commands.applyRaw(mutation.command);
    if (!result.ok) {
      ctx.log.error(`[editor-history] redo: replay of command failed: ${result.error}`);
    }
  }
}

/**
 * Reverses the most recent undo step: pops it, replays its inverses (reverse
 * order) through `commands.applyRaw`, and moves it onto the redo stack.
 *
 * @param ctx - The editor-history API context.
 * @returns `true` if a step was undone, `false` if the undo stack was empty.
 * @example
 * ```ts
 * undo(ctx);
 * ```
 */
function undo(ctx: EditorHistoryApiContext): boolean {
  const entry = ctx.state.undo.pop();
  if (!entry) {
    ctx.log.debug("[editor-history] undo: nothing to undo");
    return false;
  }

  replayInverses(ctx, entry);
  ctx.state.redo.push(entry);
  return true;
}

/**
 * Re-applies the most recently undone step: pops it off redo, replays its forward
 * commands through `commands.applyRaw`, and moves it back onto undo (with eviction).
 *
 * @param ctx - The editor-history API context.
 * @returns `true` if a step was redone, `false` if the redo stack was empty.
 * @example
 * ```ts
 * redo(ctx);
 * ```
 */
function redo(ctx: EditorHistoryApiContext): boolean {
  const entry = ctx.state.redo.pop();
  if (!entry) {
    ctx.log.debug("[editor-history] redo: nothing to redo");
    return false;
  }

  replayForward(ctx, entry);
  pushUndoAfterRedo(ctx.state, ctx.config, entry);
  return true;
}

/**
 * Opens a gesture: subsequent `applyTracked` calls buffer into ONE step until
 * `endGesture()`. A gesture already open is a caller bug — warns and keeps the
 * open buffer (does not reset it).
 *
 * @param ctx - The editor-history API context.
 * @example
 * ```ts
 * beginGesture(ctx); // e.g. on gizmo drag pointerdown
 * ```
 */
function beginGesture(ctx: EditorHistoryApiContext): void {
  if (ctx.state.gestureActive) {
    ctx.log.warn("[editor-history] beginGesture: a gesture is already open");
    return;
  }

  ctx.state.gesture = [];
  ctx.state.gestureActive = true;
}

/**
 * Closes the open gesture: coalesces the buffer into one undo step (pushed only
 * if non-empty). No open gesture is a caller bug — warns and no-ops.
 *
 * @param ctx - The editor-history API context.
 * @example
 * ```ts
 * endGesture(ctx); // e.g. on gizmo drag pointerup
 * ```
 */
function endGesture(ctx: EditorHistoryApiContext): void {
  if (!ctx.state.gestureActive) {
    ctx.log.warn("[editor-history] endGesture: no open gesture");
    return;
  }

  const mutations = coalesce(ctx.state.gesture ?? []);
  if (mutations.length > 0) pushEntry(ctx.state, ctx.config, { mutations });

  ctx.state.gesture = undefined;
  ctx.state.gestureActive = false;
}

/**
 * Creates the editor-history plugin API surface.
 *
 * @param ctx - Plugin context (structural — only the fields this API uses).
 * @returns The editor-history plugin {@link Api} object.
 * @example
 * ```ts
 * const api = createApi(ctx);
 * const result = api.applyTracked({ kind: "spawn", components: { Position: { x: 0, y: 0 } } });
 * ```
 */
export function createApi(ctx: EditorHistoryApiContext): Api {
  return {
    /**
     * Apply `command` through the single write-authority AND record it as an undo
     * step (or buffer it into the open gesture). Returns the `commands.apply` result;
     * a rejected command records nothing.
     *
     * @param command - The command to apply and track.
     * @returns The {@link CommandResult} — `{ ok: true, inverse }` or `{ ok: false, error }`.
     * @example
     * ```ts
     * app["editor-history"].applyTracked({ kind: "setField", id, component: "Position", field: "x", value: 5 });
     * ```
     */
    applyTracked: (command: Command): CommandResult => applyTracked(ctx, command),

    /**
     * Reverse the most recent step (replaying its inverses via `commands.applyRaw`);
     * moves it to redo.
     *
     * @returns Whether a step was undone.
     * @example
     * ```ts
     * app["editor-history"].undo();
     * ```
     */
    undo: (): boolean => undo(ctx),

    /**
     * Re-apply the most recently undone step (replaying its forwards via
     * `commands.applyRaw`); moves it back to undo.
     *
     * @returns Whether a step was redone.
     * @example
     * ```ts
     * app["editor-history"].redo();
     * ```
     */
    redo: (): boolean => redo(ctx),

    /**
     * True when there is at least one step to undo (poll this on the ecs `changeEpoch`).
     *
     * @returns Whether the undo stack is non-empty.
     * @example
     * ```ts
     * app["editor-history"].canUndo();
     * ```
     */
    canUndo: (): boolean => ctx.state.undo.length > 0,

    /**
     * True when there is at least one step to redo.
     *
     * @returns Whether the redo stack is non-empty.
     * @example
     * ```ts
     * app["editor-history"].canRedo();
     * ```
     */
    canRedo: (): boolean => ctx.state.redo.length > 0,

    /**
     * Open a gesture: subsequent tracked edits buffer into ONE step until `endGesture()`.
     *
     * @example
     * ```ts
     * app["editor-history"].beginGesture(); // gizmo drag pointerdown
     * ```
     */
    beginGesture: (): void => {
      beginGesture(ctx);
    },

    /**
     * Close the open gesture: coalesce the buffer into one undo step (or nothing, if empty).
     *
     * @example
     * ```ts
     * app["editor-history"].endGesture(); // gizmo drag pointerup
     * ```
     */
    endGesture: (): void => {
      endGesture(ctx);
    },

    /**
     * Empty both stacks and drop any open gesture (also called on `commands:restored`).
     *
     * @example
     * ```ts
     * app["editor-history"].clear();
     * ```
     */
    clear: (): void => {
      clearHistory(ctx.state);
    }
  };
}
