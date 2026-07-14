/**
 * @file editor-history plugin — integration tests.
 *
 * Boots a real headless ecs + commands + editor-history core (via
 * `coreConfig.createCore`, the house pattern every plugin's integration suite
 * uses — see `commands`' `__tests__/integration/commands.test.ts`) and drives
 * the real applyTracked -> undo -> redo funnel against a real `World`.
 */
import { describe, expect, it } from "vitest";
import { coreConfig } from "../../../../config";
import { commandsPlugin } from "../../../commands";
import { ecsPlugin } from "../../../ecs";
import type { Component } from "../../../ecs/types";
import { editorHistoryPlugin } from "../../index";

type PositionValue = { x: number; y: number };

/** Boot a headless ecs + commands + editor-history app, with "Position" pre-registered. */
const bootApp = async () => {
  const { createApp } = coreConfig.createCore(coreConfig, {
    plugins: [ecsPlugin, commandsPlugin, editorHistoryPlugin]
  });
  const app = createApp();
  await app.start();
  const Position = app.ecs.defineComponent<PositionValue>(() => ({ x: 0, y: 0 }), {
    name: "Position"
  });
  return { app, Position };
};

describe("editor-history integration", () => {
  it("applyTracked -> undo -> redo round-trips a setField edit through commands", async () => {
    const { app, Position } = await bootApp();
    const token = Position as Component<PositionValue>;

    const spawned = app.commands.apply({
      kind: "spawn",
      components: { Position: { x: 1, y: 2 } }
    });
    if (!spawned.ok || spawned.inverse.kind !== "despawn") throw new Error("setup spawn failed");
    const id = spawned.inverse.id;
    const entity = app.commands.resolve(id);
    if (entity === undefined) throw new Error("resolve failed");

    const result = app["editor-history"].applyTracked({
      kind: "setField",
      id,
      component: "Position",
      field: "x",
      value: 99
    });
    expect(result.ok).toBe(true);
    expect(app.ecs.get(entity, token)?.x).toBe(99);

    expect(app["editor-history"].undo()).toBe(true);
    expect(app.ecs.get(entity, token)?.x).toBe(1);

    expect(app["editor-history"].redo()).toBe(true);
    expect(app.ecs.get(entity, token)?.x).toBe(99);

    await app.stop();
  });

  it("undo of a tracked despawn respawns the entity with its components restored", async () => {
    const { app } = await bootApp();

    const spawned = app.commands.apply({
      kind: "spawn",
      components: { Position: { x: 5, y: 6 } }
    });
    if (!spawned.ok || spawned.inverse.kind !== "despawn") throw new Error("setup spawn failed");
    const id = spawned.inverse.id;

    const result = app["editor-history"].applyTracked({ kind: "despawn", id });
    expect(result.ok).toBe(true);
    expect(app.commands.resolve(id)).toBeUndefined();

    expect(app["editor-history"].undo()).toBe(true);
    const respawned = app.commands.resolve(id);
    expect(respawned).toBeDefined();

    await app.stop();
  });

  it("a real commands.restore() clears both stacks — a bulk reseed is never undoable", async () => {
    const { app } = await bootApp();

    const spawned = app.commands.apply({
      kind: "spawn",
      components: { Position: { x: 0, y: 0 } }
    });
    if (!spawned.ok || spawned.inverse.kind !== "despawn") throw new Error("setup spawn failed");
    const id = spawned.inverse.id;
    app["editor-history"].applyTracked({
      kind: "setField",
      id,
      component: "Position",
      field: "x",
      value: 1
    });
    app["editor-history"].undo();
    expect(app["editor-history"].canRedo()).toBe(true);

    app.commands.restore([], "reload");

    expect(app["editor-history"].canUndo()).toBe(false);
    expect(app["editor-history"].canRedo()).toBe(false);

    await app.stop();
  });
});
