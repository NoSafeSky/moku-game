/**
 * @file serialization plugin — integration tests.
 *
 * Boots a real headless ecs + storage + commands + reflection + serialization core (via
 * `coreConfig.createCore`, the house pattern every plugin's integration suite uses — see
 * `commands`'/`storage`'s `__tests__/integration/*.test.ts`) and drives the real
 * serialize/save/load/export/import round trip against a real `World`, proving EditorIds survive
 * a reseed, the coarse `serialization:loaded` event reaches a dependent plugin's hook, and a
 * version-bumped app upgrades a pre-seeded stale document on load.
 */
import { describe, expect, it } from "vitest";

import { coreConfig } from "../../../../config";
import { commandsPlugin } from "../../../commands";
import type { EditorId } from "../../../commands/types";
import { ecsPlugin } from "../../../ecs";
import { reflectionPlugin } from "../../../reflection";
import { storagePlugin } from "../../../storage";
import type { Migration } from "../../../storage/types";
import { serializationPlugin } from "../../index";
import type { Config, SceneDocument, SceneEntity } from "../../types";

type PositionValue = { x: number; y: number };

/** A v2 migration that rewrites every entity's Position to (999, 999) — proves on-load upgrade. */
const bumpPositionTo999: Migration = snapshot => ({
  ...snapshot,
  entities: (snapshot.entities as SceneEntity[]).map(entity => ({
    ...entity,
    components: { ...entity.components, Position: { x: 999, y: 999 } }
  }))
});

/** Per-plugin config overrides accepted by `bootApp`. */
type TestPluginConfigs = { serialization?: Partial<Config> };

/** Boot a headless ecs + storage + commands + reflection + serialization app, with "Position" registered. */
const bootApp = async (pluginConfigs: TestPluginConfigs = {}) => {
  const { createApp } = coreConfig.createCore(coreConfig, {
    plugins: [ecsPlugin, storagePlugin, commandsPlugin, reflectionPlugin, serializationPlugin]
  });
  const app = createApp({ pluginConfigs });
  await app.start();
  const Position = app.ecs.defineComponent<PositionValue>(() => ({ x: 0, y: 0 }), {
    name: "Position"
  });
  return { app, Position };
};

describe("serialization plugin — integration", () => {
  it("exposes app.serialization after start", async () => {
    const { app } = await bootApp();

    expect(app.serialization).toBeDefined();

    await app.stop();
  });

  it("save → mutate/despawn → load restores the original entities with their same EditorIds", async () => {
    const { app, Position } = await bootApp();

    const first = app.commands.apply({ kind: "spawn", components: { Position: { x: 1, y: 1 } } });
    const second = app.commands.apply({ kind: "spawn", components: { Position: { x: 2, y: 2 } } });
    if (
      !first.ok ||
      first.inverse.kind !== "despawn" ||
      !second.ok ||
      second.inverse.kind !== "despawn"
    ) {
      throw new Error("setup spawn failed");
    }
    const firstId = first.inverse.id;
    const secondId = second.inverse.id;

    expect(app.serialization.save("s1")).toBe(true);

    app.commands.apply({
      kind: "setField",
      id: firstId,
      component: "Position",
      field: "x",
      value: 999
    });
    app.commands.apply({ kind: "despawn", id: secondId });

    const loaded = app.serialization.load("s1");
    expect(loaded).toBe(true);

    const firstEntity = app.commands.resolve(firstId);
    const secondEntity = app.commands.resolve(secondId);
    if (firstEntity === undefined || secondEntity === undefined) throw new Error("resolve failed");

    expect(app.ecs.get(firstEntity, Position)).toEqual({ x: 1, y: 1 });
    expect(app.ecs.get(secondEntity, Position)).toEqual({ x: 2, y: 2 });

    await app.stop();
  });

  it("an app-level listener receives serialization:loaded { name, entityCount } on load", async () => {
    const received: Array<{ name: string; entityCount: number }> = [];
    const { createApp, createPlugin } = coreConfig.createCore(coreConfig, {
      plugins: [ecsPlugin, storagePlugin, commandsPlugin, reflectionPlugin, serializationPlugin]
    });
    const listenerPlugin = createPlugin("serialization-listener", {
      depends: [serializationPlugin],
      hooks: () => ({
        "serialization:loaded": payload => {
          received.push(payload);
        }
      })
    });

    const app = createApp({ plugins: [listenerPlugin] });
    await app.start();
    app.ecs.defineComponent<PositionValue>(() => ({ x: 0, y: 0 }), { name: "Position" });

    app.commands.apply({ kind: "spawn", components: { Position: { x: 1, y: 1 } } });
    app.serialization.save("s1");
    app.serialization.load("s1");

    expect(received).toEqual([{ name: "s1", entityCount: 1 }]);

    await app.stop();
  });

  it("export() then import() reproduces the world (restore clears + respawns)", async () => {
    const { app, Position } = await bootApp();

    app.commands.apply({ kind: "spawn", components: { Position: { x: 5, y: 5 } } });

    const json = app.serialization.export();
    app.serialization.import(json);

    expect(app.commands.count()).toBe(1);
    const [entity] = app.ecs.liveEntities();
    if (entity === undefined) throw new Error("no live entity after import");
    expect(app.ecs.get(entity, Position)).toEqual({ x: 5, y: 5 });

    await app.stop();
  });

  it("a version-bumped app with a supplied migrations[2] upgrades a pre-seeded v1 scene on load", async () => {
    const { app, Position } = await bootApp({
      serialization: { version: 2, migrations: { 2: bumpPositionTo999 } }
    });

    const staleDoc: SceneDocument = {
      version: 1,
      name: "old",
      entities: [{ id: 1 as EditorId, components: { Position: { x: 3, y: 3 } } }]
    };
    app.storage.set("scene:old", staleDoc);

    const loaded = app.serialization.load("old");
    expect(loaded).toBe(true);

    const [entity] = app.ecs.liveEntities();
    if (entity === undefined) throw new Error("no live entity after migrated load");
    expect(app.ecs.get(entity, Position)).toEqual({ x: 999, y: 999 });

    await app.stop();
  });
});
