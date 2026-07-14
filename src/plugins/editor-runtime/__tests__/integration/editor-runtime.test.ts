/**
 * @file editor-runtime plugin — integration tests.
 *
 * Boots the real ecs + storage + reflection + commands + serialization + scheduler + renderer
 * (headless) + loop + tween + vfx + camera + editor-runtime stack via `createApp` (the house
 * `coreConfig.createCore` pattern — see `camera`/`vfx`/`serialization`'s integration suites) and
 * proves the ghost-free exit-play revert acceptance from the spec: boot lands UNGATED (a non-editor
 * game runs all stages — `activeStages()` is `undefined`; the editor shell calls `enterEdit()` to
 * apply the `config.editStages` gate); `enterPlay()` snapshots the scene and
 * un-gates to ALL stages; mutating the world + starting tween/vfx/camera juice during play is a
 * REAL write to the single authoring world; `stop()` restores the pre-play snapshot, sweeps
 * tween/vfx/camera ghost state, and re-gates to author mode — leaving no residual runtime behind.
 * Also asserts `editor-runtime:modeChanged` fires exactly once per real flip.
 */
import { describe, expect, it } from "vitest";

import { coreConfig } from "../../../../config";
import { cameraPlugin } from "../../../camera";
import { commandsPlugin } from "../../../commands";
import { ecsPlugin } from "../../../ecs";
import { loopPlugin } from "../../../loop";
import { reflectionPlugin } from "../../../reflection";
import { rendererPlugin } from "../../../renderer";
import { schedulerPlugin } from "../../../scheduler";
import { serializationPlugin } from "../../../serialization";
import { storagePlugin } from "../../../storage";
import { tweenPlugin } from "../../../tween";
import { vfxPlugin } from "../../../vfx";
import { editorRuntimePlugin } from "../../index";
import type { Mode } from "../../types";

type PositionValue = { x: number; y: number };

/** Boot the full headless editor-runtime dependency stack + a `modeChanged` listener plugin. */
const bootApp = async () => {
  const received: Mode[] = [];
  const { createApp, createPlugin } = coreConfig.createCore(coreConfig, {
    plugins: [
      ecsPlugin,
      storagePlugin,
      reflectionPlugin,
      commandsPlugin,
      serializationPlugin,
      schedulerPlugin,
      rendererPlugin,
      loopPlugin,
      tweenPlugin,
      vfxPlugin,
      cameraPlugin,
      editorRuntimePlugin
    ]
  });
  const listenerPlugin = createPlugin("editor-runtime-listener", {
    depends: [editorRuntimePlugin],
    hooks: () => ({
      "editor-runtime:modeChanged": payload => {
        received.push(payload.mode);
      }
    })
  });

  const app = createApp({ plugins: [listenerPlugin] });
  await app.start();
  const Position = app.ecs.defineComponent<PositionValue>(() => ({ x: 0, y: 0 }), {
    name: "Position"
  });
  return { app, Position, received };
};

/** Count live entities carrying the named component (via ecs introspection). */
const countByName = (app: Awaited<ReturnType<typeof bootApp>>["app"], name: string): number => {
  const token = app.ecs.componentByName(name);
  return token ? app.ecs.query(token).count() : 0;
};

describe("editor-runtime integration", () => {
  it("boots UNGATED (pay-for-what-you-use); enterEdit() applies the config.editStages gate", async () => {
    const { app } = await bootApp();

    // onStart does NOT gate — editor-runtime is in the default framework set, so a non-editor
    // game must run all stages (activeStages() stays undefined). `mode()` seeds to "edit" intent.
    expect(app.scheduler.activeStages()).toBeUndefined();
    expect(app["editor-runtime"].mode()).toBe("edit");
    expect(app["editor-runtime"].isPlaying()).toBe(false);

    // The editor shell engages edit mode explicitly → the gate is applied.
    app["editor-runtime"].enterEdit();
    expect(app.scheduler.activeStages()).toEqual(["input", "sync", "render"]);

    await app.stop();
  });

  it("enterPlay un-gates to ALL stages and snapshots the scene", async () => {
    const { app } = await bootApp();

    app["editor-runtime"].enterPlay();

    expect(app.scheduler.activeStages()).toBeUndefined();
    expect(app["editor-runtime"].mode()).toBe("play");
    expect(app["editor-runtime"].isPlaying()).toBe(true);
    await app.stop();
  });

  it("ghost-free revert: play-mode mutations + tween/vfx/camera juice are fully cleared on stop", async () => {
    const { app, Position, received } = await bootApp();

    // Spawn a baseline entity BEFORE play — this is what the pre-play snapshot captures.
    const spawnResult = app.commands.apply({
      kind: "spawn",
      components: { Position: { x: 1, y: 1 } }
    });
    if (!spawnResult.ok || spawnResult.inverse.kind !== "despawn") {
      throw new Error("setup spawn failed");
    }
    const baselineId = spawnResult.inverse.id;

    app["editor-runtime"].enterPlay();

    // Real write to the SAME world (one-world stage-gating, not a play-world copy).
    app.commands.apply({
      kind: "setField",
      id: baselineId,
      component: "Position",
      field: "x",
      value: 999
    });

    // Start juice: a live vfx emitter, an in-flight tween, and camera follow/shake/zoom.
    const emitter = app.vfx.createEmitter({ rate: 200, speed: 50, lifetime: 5 });
    const tweenTarget = { value: 0 };
    app.tween.to(tweenTarget, { value: 100 }, { duration: 10 });
    const followTarget = { x: 50, y: 50 };
    app.camera.follow(followTarget);
    app.camera.shake(10, 5);
    app.camera.setZoom(3);

    for (let i = 0; i < 5; i++) app["editor-runtime"].step();
    expect(countByName(app, "Particle")).toBeGreaterThan(0);
    expect(app.tween.count()).toBeGreaterThan(0);

    app["editor-runtime"].stop();

    // Mode + gate restored.
    expect(app["editor-runtime"].mode()).toBe("edit");
    expect(app["editor-runtime"].isPlaying()).toBe(false);
    expect(app.scheduler.activeStages()).toEqual(["input", "sync", "render"]);

    // World restored to the pre-play baseline.
    const resolved = app.commands.resolve(baselineId);
    if (resolved === undefined) throw new Error("baseline entity missing after restore");
    expect(app.ecs.get(resolved, Position)).toEqual({ x: 1, y: 1 });

    // No ghost tween/vfx/camera runtime remains.
    expect(app.tween.count()).toBe(0);
    expect(countByName(app, "Particle")).toBe(0);
    expect(app.camera.getZoom()).toBe(1); // config default zoom
    expect(app.camera.getRotation()).toBe(0);
    expect(app.camera.getPosition()).toEqual({ x: 0, y: 0 });

    // Follow was cleared (not merely coincidentally at 0,0): further steps do not chase the
    // still-live followTarget away from the recentred origin.
    followTarget.x = 500;
    for (let i = 0; i < 10; i++) app["editor-runtime"].step();
    expect(app.camera.getPosition()).toEqual({ x: 0, y: 0 });

    // Emitter entity from play mode is gone too (vfx.reset despawns all live effect entities).
    expect(app.ecs.isAlive(emitter)).toBe(false);

    // modeChanged fired exactly once per real flip: edit(boot, no emit) -> play -> edit.
    expect(received).toEqual(["play", "edit"]);

    await app.stop();
  });

  it("step() before app.start() returns a zeroed clock (guarded no-op)", async () => {
    const { createApp } = coreConfig.createCore(coreConfig, {
      plugins: [
        ecsPlugin,
        storagePlugin,
        reflectionPlugin,
        commandsPlugin,
        serializationPlugin,
        schedulerPlugin,
        rendererPlugin,
        loopPlugin,
        tweenPlugin,
        vfxPlugin,
        cameraPlugin,
        editorRuntimePlugin
      ]
    });
    const app = createApp();

    expect(app["editor-runtime"].step()).toEqual({ frame: 0, elapsed: 0, dt: 0 });

    await app.start();
    await app.stop();
  });
});
