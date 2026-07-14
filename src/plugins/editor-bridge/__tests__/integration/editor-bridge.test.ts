/**
 * @file editor-bridge plugin — integration tests.
 *
 * Boots the full editor stack (headless) via `coreConfig.createCore` — the house
 * `editor-runtime`/`editor-gizmos`/`editor-selection` integration pattern — and drives a real
 * edit round-trip through the facade: snapshot aggregation (id + inferred field descriptors),
 * the undo-tracked `setField` funnel (epoch bump), `undo`/`redo`, selection, the play/stop mode
 * flip, the save/load persistence round trip (which clears history), and the
 * `commands.setValidator(reflection.validate)` decoupling seam rejecting an out-of-range write
 * end-to-end.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { coreConfig } from "../../../../config";
import { assetsPlugin } from "../../../assets";
import { cameraPlugin } from "../../../camera";
import { commandsPlugin } from "../../../commands";
import { ecsPlugin } from "../../../ecs";
import { editorGizmosPlugin } from "../../../editor-gizmos";
import { editorHistoryPlugin } from "../../../editor-history";
import { editorRuntimePlugin } from "../../../editor-runtime";
import { editorSelectionPlugin } from "../../../editor-selection";
import { inputPlugin } from "../../../input";
import { loopPlugin } from "../../../loop";
import { mcpPlugin } from "../../../mcp";
import { field, reflectionPlugin } from "../../../reflection";
import { rendererPlugin } from "../../../renderer";
import { scenePlugin } from "../../../scene";
import { schedulerPlugin } from "../../../scheduler";
import { serializationPlugin } from "../../../serialization";
import { storagePlugin } from "../../../storage";
import { tweenPlugin } from "../../../tween";
import { vfxPlugin } from "../../../vfx";
import { editorBridgePlugin } from "../../index";

type TransformValue = { x: number; y: number };

/** Dependency-ordered plugin array (`depends` is validation-only — order is explicit; mirrors src/index.ts). */
const PLUGINS = [
  ecsPlugin,
  schedulerPlugin,
  rendererPlugin,
  inputPlugin,
  loopPlugin,
  assetsPlugin,
  scenePlugin,
  storagePlugin,
  vfxPlugin,
  tweenPlugin,
  cameraPlugin,
  mcpPlugin,
  commandsPlugin,
  reflectionPlugin,
  serializationPlugin,
  editorSelectionPlugin,
  editorHistoryPlugin,
  editorGizmosPlugin,
  editorRuntimePlugin,
  editorBridgePlugin
];

/** Boot the headless editor-bridge stack (mcp with no transports — nothing to connect/close). */
const bootApp = () => {
  const { createApp } = coreConfig.createCore(coreConfig, { plugins: PLUGINS });
  return createApp({ pluginConfigs: { mcp: { transports: [] } } });
};

describe("editor-bridge integration", () => {
  // editor-selection's input dep resolves "window" -> an EventTarget in onStart (the
  // editor-selection/editor-gizmos integration-test precedent); provide one for Node.
  beforeEach(() => {
    (globalThis as Record<string, unknown>).window = new EventTarget();
  });
  afterEach(() => {
    delete (globalThis as Record<string, unknown>).window;
  });

  it("exposes app['editor-bridge'] with the full surface", async () => {
    const app = bootApp();
    await app.start();

    const bridge = app["editor-bridge"] as unknown as Record<string, unknown>;
    const surface = [
      "snapshot",
      "apply",
      "setField",
      "select",
      "clearSelection",
      "undo",
      "redo",
      "play",
      "stop",
      "step",
      "save",
      "load",
      "describe"
    ];
    for (const method of surface) expect(typeof bridge[method]).toBe("function");

    await app.stop();
  });

  it("headless-safe: snapshot().entities is [] with no live entity", async () => {
    const app = bootApp();
    await app.start();

    const snapshot = app["editor-bridge"].snapshot();
    expect(snapshot.entities).toEqual([]);
    expect(snapshot.selection).toEqual([]);
    expect(snapshot.mode).toBe("edit");
    expect(snapshot.canUndo).toBe(false);
    expect(snapshot.canRedo).toBe(false);

    await app.stop();
  });

  it("aggregates a full edit round-trip: setField, undo, select, play/stop, save/load, validator rejection", async () => {
    const app = bootApp();
    await app.start();

    app.ecs.defineComponent<TransformValue>(() => ({ x: 0, y: 0 }), { name: "Position" });
    const bridge = app["editor-bridge"];

    // ── spawn + initial snapshot: id + inferred x/y descriptors ────────────
    const spawnResult = app.commands.apply({
      kind: "spawn",
      components: { Position: { x: 0, y: 0 } }
    });
    if (!spawnResult.ok || spawnResult.inverse.kind !== "despawn") {
      throw new Error("setup spawn failed");
    }
    const id = spawnResult.inverse.id;

    const initial = bridge.snapshot();
    expect(initial.entities).toHaveLength(1);
    const [entitySnapshot] = initial.entities;
    if (entitySnapshot === undefined) throw new Error("expected an entity snapshot");
    expect(entitySnapshot.id).toBe(id);
    const [transformSnapshot] = entitySnapshot.components;
    if (transformSnapshot === undefined) throw new Error("expected a Transform component");
    expect(transformSnapshot.name).toBe("Position");
    expect(transformSnapshot.value).toEqual({ x: 0, y: 0 });
    expect(transformSnapshot.fields.map(descriptor => descriptor.key).toSorted()).toEqual([
      "x",
      "y"
    ]);

    // ── setField -> undo-tracked write, bumps epoch ───────────────────────
    const setResult = bridge.setField(id, "Position", "x", 42);
    expect(setResult.ok).toBe(true);

    const afterSet = bridge.snapshot();
    expect(afterSet.epoch).toBeGreaterThan(initial.epoch);
    expect(afterSet.entities[0]?.components[0]?.value).toEqual({ x: 42, y: 0 });

    // ── undo reverts it; canRedo flips true ───────────────────────────────
    bridge.undo();
    const afterUndo = bridge.snapshot();
    expect(afterUndo.entities[0]?.components[0]?.value).toEqual({ x: 0, y: 0 });
    expect(afterUndo.canRedo).toBe(true);

    // ── select ──────────────────────────────────────────────────────────
    bridge.select(id);
    expect(bridge.snapshot().selection).toEqual([id]);

    // ── play/stop mode flip ────────────────────────────────────────────────
    expect(bridge.snapshot().mode).toBe("edit");
    bridge.play();
    expect(bridge.snapshot().mode).toBe("play");
    bridge.stop();
    expect(bridge.snapshot().mode).toBe("edit");

    // ── save/load round-trips and clears history (the exit-play revert already did) ──
    expect(bridge.save("s1")).toBe(true);
    expect(bridge.load("s1")).toBe(true);
    expect(bridge.snapshot().canUndo).toBe(false);

    // ── commands.setValidator(reflection.validate) rejects an out-of-range write ──
    app.reflection.register("Position", {
      x: field.number({ min: 0, max: 100 }),
      y: field.number()
    });
    const rejected = bridge.setField(id, "Position", "x", 9999);
    expect(rejected.ok).toBe(false);

    await app.stop();
  });
});
