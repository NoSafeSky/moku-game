/**
 * @file editor-bridge plugin — onStart lifecycle unit tests.
 *
 * Covers: `commands.setValidator` is wired to a function that forwards to `reflection.validate`
 * (invoked with the same args, relaying the same return); `editor-gizmos.setGestureSink` is wired
 * to an object whose `begin`/`applyTracked`/`end` route to `editor-history`'s
 * `beginGesture`/`applyTracked`/`endGesture`; and `mcp` is captured + probed, logging readiness.
 */
import { describe, expect, it, vi } from "vitest";

import { start } from "../../lifecycle";
import {
  asEditorId,
  makeEditorGizmosMock,
  makeEditorHistoryMock,
  makeMcpMock,
  makeReflectionMock,
  makeStartCtx
} from "../mock-deps";

describe("editor-bridge lifecycle — start()", () => {
  it("wires commands.setValidator to forward to reflection.validate with the same args + return", () => {
    const validationResult = { ok: false as const, errors: [{ key: "x", message: "too big" }] };
    const reflection = makeReflectionMock({ validate: vi.fn(() => validationResult) });
    const { ctx, commands } = makeStartCtx({ reflection });

    start(ctx);

    expect(commands.setValidator).toHaveBeenCalledTimes(1);
    const injectedCall = commands.setValidator.mock.calls[0];
    const injected = injectedCall?.[0] as (
      name: string,
      partial: Record<string, unknown>
    ) => unknown;

    const returned = injected("Transform", { x: 999 });

    expect(reflection.validate).toHaveBeenCalledWith("Transform", { x: 999 });
    expect(returned).toBe(validationResult);
  });

  it("wires the editor-gizmos gesture sink to editor-history's beginGesture/applyTracked/endGesture", () => {
    const editorHistory = makeEditorHistoryMock();
    const editorGizmos = makeEditorGizmosMock();
    const { ctx } = makeStartCtx({ editorHistory, editorGizmos });

    start(ctx);

    expect(editorGizmos.setGestureSink).toHaveBeenCalledTimes(1);
    const sinkCall = editorGizmos.setGestureSink.mock.calls[0];
    const sink = sinkCall?.[0] as {
      begin(): void;
      applyTracked(command: unknown): void;
      end(): void;
    };

    sink.begin();
    const command = { kind: "despawn", id: asEditorId(1) };
    sink.applyTracked(command);
    sink.end();

    expect(editorHistory.beginGesture).toHaveBeenCalledTimes(1);
    expect(editorHistory.applyTracked).toHaveBeenCalledWith(command);
    expect(editorHistory.endGesture).toHaveBeenCalledTimes(1);
  });

  it("captures mcp and logs readiness — present transport, running", () => {
    const mcp = makeMcpMock({
      isRunning: vi.fn(() => true),
      clientTransport: vi.fn(() => ({}) as never)
    });
    const { ctx, log } = makeStartCtx({ mcp });

    start(ctx);

    expect(log.info).toHaveBeenCalledWith(
      "[editor-bridge] ready — MCP mirror not wired (Follow-up F1); " +
        "in-page transport present, mcp running=true."
    );
  });

  it("captures mcp and logs readiness — absent transport, not running", () => {
    const mcp = makeMcpMock({
      isRunning: vi.fn(() => false),
      clientTransport: vi.fn(() => undefined)
    });
    const { ctx, log } = makeStartCtx({ mcp });

    start(ctx);

    expect(log.info).toHaveBeenCalledWith(
      "[editor-bridge] ready — MCP mirror not wired (Follow-up F1); " +
        "in-page transport absent, mcp running=false."
    );
  });
});
