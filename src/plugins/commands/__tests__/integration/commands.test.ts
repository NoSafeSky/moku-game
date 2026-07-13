/**
 * @file commands plugin — integration tests.
 *
 * Boots a real headless ecs + commands core (via `coreConfig.createCore`, the
 * house pattern every plugin's integration suite uses — see scene's /
 * vfx's `__tests__/integration/*.test.ts`) and drives the real funnel against
 * a real `World` with named components registered. Also proves the coarse
 * `commands:restored` event reaches a dependent plugin's hook.
 */
import { describe, expect, it } from "vitest";
import { coreConfig } from "../../../../config";
import { ecsPlugin } from "../../../ecs";
import type { Component } from "../../../ecs/types";
import { commandsPlugin } from "../../index";
import type { EditorId } from "../../types";

type PositionValue = { x: number; y: number };

/** Boot a headless ecs + commands app, with a "Position" named component pre-registered. */
const bootApp = async () => {
  const { createApp } = coreConfig.createCore(coreConfig, {
    plugins: [ecsPlugin, commandsPlugin]
  });
  const app = createApp();
  await app.start();
  const Position = app.ecs.defineComponent<PositionValue>(() => ({ x: 0, y: 0 }), {
    name: "Position"
  });
  return { app, Position };
};

describe("commands integration", () => {
  it("apply(spawn) creates a live entity carrying the components; count() reflects it", async () => {
    const { app } = await bootApp();

    const result = app.commands.apply({
      kind: "spawn",
      components: { Position: { x: 1, y: 2 } }
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.inverse.kind).toBe("despawn");
    if (result.inverse.kind !== "despawn") return;

    const entity = app.commands.resolve(result.inverse.id);
    expect(entity).toBeDefined();
    expect(entity !== undefined && app.ecs.isAlive(entity)).toBe(true);
    expect(app.commands.count()).toBe(1);

    await app.stop();
  });

  it("apply(setField) mutates the real component; the inverse restores the old value", async () => {
    const { app, Position } = await bootApp();
    const token = Position as Component<PositionValue>;

    const spawned = app.commands.apply({ kind: "spawn", components: { Position: { x: 1, y: 2 } } });
    if (!spawned.ok || spawned.inverse.kind !== "despawn") throw new Error("setup spawn failed");
    const id = spawned.inverse.id;
    const entity = app.commands.resolve(id);
    if (entity === undefined) throw new Error("resolve failed");

    const setResult = app.commands.apply({
      kind: "setField",
      id,
      component: "Position",
      field: "x",
      value: 99
    });
    expect(setResult.ok).toBe(true);
    expect(app.ecs.get(entity, token)?.x).toBe(99);

    if (!setResult.ok) return;
    const undo = app.commands.apply(setResult.inverse);
    expect(undo.ok).toBe(true);
    expect(app.ecs.get(entity, token)?.x).toBe(1);

    await app.stop();
  });

  it("apply(despawn) makes resolve() undefined; its inverse re-binds the same EditorId", async () => {
    const { app } = await bootApp();

    const spawned = app.commands.apply({ kind: "spawn", components: { Position: { x: 5, y: 5 } } });
    if (!spawned.ok || spawned.inverse.kind !== "despawn") throw new Error("setup spawn failed");
    const id = spawned.inverse.id;

    const despawnResult = app.commands.apply({ kind: "despawn", id });
    expect(despawnResult.ok).toBe(true);
    expect(app.commands.resolve(id)).toBeUndefined();

    if (!despawnResult.ok) return;
    expect(despawnResult.inverse.kind).toBe("spawn");
    if (despawnResult.inverse.kind !== "spawn") return;
    expect(despawnResult.inverse.id).toBe(id);

    const undo = app.commands.apply(despawnResult.inverse);
    expect(undo.ok).toBe(true);
    expect(app.commands.resolve(id)).toBeDefined();

    await app.stop();
  });

  it("restore() reseeds the world and a hooked listener receives commands:restored", async () => {
    const received: Array<{ source: string }> = [];
    const { createApp, createPlugin } = coreConfig.createCore(coreConfig, {
      plugins: [ecsPlugin, commandsPlugin]
    });
    const listenerPlugin = createPlugin("commands-listener", {
      depends: [commandsPlugin],
      hooks: () => ({
        "commands:restored": payload => {
          received.push(payload);
        }
      })
    });

    const app = createApp({ plugins: [listenerPlugin] });
    await app.start();
    app.ecs.defineComponent<PositionValue>(() => ({ x: 0, y: 0 }), { name: "Position" });

    const restoreId = 42 as EditorId;
    app.commands.restore([{ id: restoreId, components: { Position: { x: 7, y: 7 } } }], "reload");

    expect(received).toEqual([{ source: "reload" }]);
    expect(app.commands.resolve(restoreId)).toBeDefined();

    await app.stop();
  });
});
