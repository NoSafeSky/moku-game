/**
 * @file editor-bridge plugin — integration tests.
 *
 * Boots the full editor stack (headless) via `coreConfig.createCore` — the house
 * `editor-runtime`/`editor-gizmos`/`editor-selection` integration pattern — and drives a real
 * edit round-trip through the facade: snapshot aggregation (id + inferred field descriptors),
 * the undo-tracked `setField` funnel (epoch bump), `undo`/`redo`, selection, the play/stop mode
 * flip, the save/load persistence round trip (which clears history), the
 * `commands.setValidator(reflection.validate)` decoupling seam rejecting an out-of-range write
 * end-to-end, and — the Phase-1 widening — the hierarchical snapshot + authoring verbs
 * (`create*`/`reparent`/`delete`/`duplicate`/`addComponent`/`listComponents`) against the real
 * `hierarchy`/`component-registry`/`graphics-2d` plugins.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { coreConfig } from "../../../../config";
import { assetStorePlugin } from "../../../asset-store";
import { assetsPlugin } from "../../../assets";
import { cameraPlugin } from "../../../camera";
import { commandsPlugin } from "../../../commands";
import { componentRegistryPlugin } from "../../../component-registry";
import { ecsPlugin } from "../../../ecs";
import { editorGizmosPlugin } from "../../../editor-gizmos";
import { editorHistoryPlugin } from "../../../editor-history";
import { editorRuntimePlugin } from "../../../editor-runtime";
import { editorSelectionPlugin } from "../../../editor-selection";
import { graphics2dPlugin } from "../../../graphics-2d";
import { hierarchyPlugin } from "../../../hierarchy";
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
  assetStorePlugin,
  assetsPlugin,
  scenePlugin,
  storagePlugin,
  vfxPlugin,
  tweenPlugin,
  cameraPlugin,
  mcpPlugin,
  commandsPlugin,
  reflectionPlugin,
  componentRegistryPlugin,
  hierarchyPlugin,
  graphics2dPlugin,
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
      "create",
      "createShape",
      "createSprite",
      "delete",
      "duplicate",
      "reparent",
      "reorder",
      "rename",
      "setEnabled",
      "addComponent",
      "removeComponent",
      "listComponents",
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

  it("headless-safe: snapshot().entities/roots are [] with no live entity", async () => {
    const app = bootApp();
    await app.start();

    const snapshot = app["editor-bridge"].snapshot();
    expect(snapshot.entities).toEqual([]);
    expect(snapshot.roots).toEqual([]);
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

  it("hierarchical round-trip: create/reparent/delete/duplicate/addComponent/listComponents", async () => {
    const app = bootApp();
    await app.start();
    const bridge = app["editor-bridge"];

    // ── create a parented pair: hierarchical snapshot shape ──────────────
    const parent = bridge.create({ name: "Parent", transform: { x: 100, y: 50 } });
    const child = bridge.create({ name: "Child", parent, transform: { x: 10, y: 20 } });

    const afterCreate = bridge.snapshot();
    const parentSnap = afterCreate.entities.find(entity => entity.id === parent);
    const childSnap = afterCreate.entities.find(entity => entity.id === child);
    if (parentSnap === undefined || childSnap === undefined) {
      throw new Error("expected parent + child snapshots");
    }
    expect(childSnap.parent).toBe(parent);
    expect(parentSnap.children).toEqual([child]);
    expect(afterCreate.roots).toEqual([parent]);
    expect(parentSnap.components.some(component => component.name === "Node")).toBe(false);
    expect(childSnap.components.some(component => component.name === "Node")).toBe(false);

    // ── reparent(child, undefined), preserve-world: WORLD transform unchanged; undo is drift-free ──
    const childEntity = app.commands.resolve(child);
    if (childEntity === undefined) throw new Error("expected a live child entity");
    const worldBefore = app.hierarchy.worldOf(childEntity);

    const reparentResult = bridge.reparent(child, undefined, { mode: "preserve-world" });
    expect(reparentResult.ok).toBe(true);
    expect(app.hierarchy.worldOf(childEntity)).toEqual(worldBefore);
    expect(bridge.snapshot().roots.toSorted()).toEqual([parent, child].toSorted());

    bridge.undo();
    expect(bridge.snapshot().entities.find(entity => entity.id === child)?.parent).toBe(parent);
    expect(app.hierarchy.worldOf(childEntity)).toEqual(worldBefore);

    // ── delete(parent) cascades in ONE undo step; undo() respawns the subtree re-linked ──
    bridge.delete(parent);
    expect(bridge.snapshot().entities).toEqual([]);

    bridge.undo();
    const afterDeleteUndo = bridge.snapshot();
    expect(afterDeleteUndo.entities).toHaveLength(2);
    expect(afterDeleteUndo.entities.find(entity => entity.id === child)?.parent).toBe(parent);
    expect(afterDeleteUndo.roots).toEqual([parent]);

    // ── duplicate(parent) clones the subtree in ONE undo step + selects the top-level clone ──
    const clones = bridge.duplicate(parent);
    expect(clones).toHaveLength(1);
    const [parentClone] = clones;
    if (parentClone === undefined) throw new Error("expected a top-level clone id");

    const afterDuplicate = bridge.snapshot();
    expect(afterDuplicate.entities).toHaveLength(4);
    expect(afterDuplicate.selection).toEqual([parentClone]);
    const parentCloneSnap = afterDuplicate.entities.find(entity => entity.id === parentClone);
    if (parentCloneSnap === undefined) throw new Error("expected the parent clone's snapshot");
    expect(parentCloneSnap.children).toHaveLength(1);
    const [childCloneId] = parentCloneSnap.children;
    const childCloneSnap = afterDuplicate.entities.find(entity => entity.id === childCloneId);
    expect(childCloneSnap?.parent).toBe(parentClone);

    bridge.undo();
    expect(bridge.snapshot().entities).toHaveLength(2);

    // ── addComponent + listComponents ─────────────────────────────────────
    const addResult = bridge.addComponent(parent, "Shape");
    expect(addResult.ok).toBe(true);
    const afterAdd = bridge.snapshot();
    const parentAfterAdd = afterAdd.entities.find(entity => entity.id === parent);
    expect(parentAfterAdd?.components.some(component => component.name === "Shape")).toBe(true);

    const catalog = bridge.listComponents();
    const shapeEntry = catalog.find(entry => entry.name === "Shape");
    const spriteEntry = catalog.find(entry => entry.name === "SpriteRenderer");
    expect(shapeEntry).toBeDefined();
    expect(spriteEntry).toBeDefined();
    expect(shapeEntry?.fields.length).toBeGreaterThan(0);
    expect(spriteEntry?.fields.length).toBeGreaterThan(0);

    // ── createShape/createSprite: defaults + overrides land on the spawned components ──
    const rectId = bridge.createShape("rect", { name: "Rect" });
    const rectSnap = bridge.snapshot().entities.find(entity => entity.id === rectId);
    expect(rectSnap?.components.some(component => component.name === "Shape")).toBe(true);

    const spriteId = bridge.createSprite("hero.png", { name: "Hero" });
    const spriteSnap = bridge.snapshot().entities.find(entity => entity.id === spriteId);
    const spriteComponent = spriteSnap?.components.find(
      component => component.name === "SpriteRenderer"
    );
    expect((spriteComponent?.value as { sprite: string } | undefined)?.sprite).toBe("hero.png");

    await app.stop();
  });
});
