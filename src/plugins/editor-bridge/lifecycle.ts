/**
 * @file editor-bridge plugin — onStart lifecycle wiring.
 *
 * `start` runs after all nine dependencies have started (guaranteed by `depends`) and does ONLY
 * deps-ready wiring — no resource is opened. It composes two decoupling seams that the plugins on
 * either side of them cannot wire themselves (they are same-wave siblings and must not edge each
 * other):
 *
 *   1. `commands.setValidator(reflection.validate)` — gives `commands` rich field validation
 *      without a `commands -> reflection` edge (the E1 pair).
 *   2. `editor-gizmos.setGestureSink({ … })` → `editor-history` — routes a gizmo drag through the
 *      undo-tracked funnel as ONE undo entry (the E3 pair).
 *
 * It then captures + probes `mcp` for Follow-up F1 readiness (`isRunning`/`clientTransport`) and
 * logs the result — the ONE MVP touch of the `mcp` edge; the schema/apply mirror itself is F1, not
 * this cycle. `@no-resource-check` — the bridge owns no external resource; see `index.ts` for why
 * there is no `onStop`.
 */
import { commandsPlugin } from "../commands";
import type { Command } from "../commands/types";
import { editorGizmosPlugin } from "../editor-gizmos";
import { editorHistoryPlugin } from "../editor-history";
import { mcpPlugin } from "../mcp";
import { reflectionPlugin } from "../reflection";
import type { EditorBridgeRequire, Log } from "./types";

/**
 * Structural context required by {@link start} — only `require` (to reach the five deps this
 * wiring touches) and `log` (the readiness notice). No `config`/`state` — the bridge's `onStart`
 * mutates nothing on `state` (the memoization cache is written lazily by `snapshot()` instead).
 */
export type StartContext = {
  /** Require a dependency's API by plugin instance, resolved at call time. */
  readonly require: EditorBridgeRequire;
  /** Logger from `logPlugin` (the MCP-readiness notice). */
  readonly log: Log;
};

/**
 * Starts the editor-bridge plugin: wires the `commands.setValidator(reflection.validate)`
 * decoupling seam, wires `editor-gizmos`' gesture sink to `editor-history` so a drag is one undo
 * entry, then captures + probes `mcp` and logs readiness. Owns no external resource.
 *
 * @param ctx - Structural start context (require + log).
 * @example
 * ```ts
 * start(ctx); // after ecs/reflection/commands/…/mcp have started
 * ```
 */
export const start = (ctx: StartContext): void => {
  const commands = ctx.require(commandsPlugin);
  const reflection = ctx.require(reflectionPlugin);
  const history = ctx.require(editorHistoryPlugin);

  // Seam 1 (E1 pair): give commands rich field validation without a commands -> reflection edge.
  commands.setValidator((name, partial) => reflection.validate(name, partial));

  // Seam 2 (E3 pair): route editor-gizmos drags through editor-history so a drag is ONE undo entry.
  // gizmos and history are E3 wave-siblings and cannot edge each other — the bridge (E4) composes
  // them, exactly as it wires commands.setValidator(reflection.validate) for the E1 pair.
  ctx.require(editorGizmosPlugin).setGestureSink({
    /**
     * Opens an undo gesture at pointerdown.
     *
     * @example
     * ```ts
     * sink.begin();
     * ```
     */
    begin: (): void => {
      history.beginGesture();
    },

    /**
     * Applies a command inside the open gesture (buffered into one undo step).
     *
     * @param command - The command to apply.
     * @example
     * ```ts
     * sink.applyTracked(command);
     * ```
     */
    applyTracked: (command: Command): void => {
      history.applyTracked(command);
    },

    /**
     * Closes the open gesture, collapsing the drag to one undo entry.
     *
     * @example
     * ```ts
     * sink.end();
     * ```
     */
    end: (): void => {
      history.endGesture();
    }
  });

  const mcp = ctx.require(mcpPlugin);
  ctx.log.info(
    `[editor-bridge] ready — MCP mirror not wired (Follow-up F1); ` +
      `in-page transport ${mcp.clientTransport() ? "present" : "absent"}, mcp running=${mcp.isRunning()}.`
  );
};
