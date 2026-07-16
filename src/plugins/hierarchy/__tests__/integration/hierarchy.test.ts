/**
 * @file hierarchy plugin — integration tests.
 *
 * Boots a real ecs + scheduler + renderer + commands + reflection + hierarchy stack via
 * `createApp` (headless — renderer auto-detects no DOM in Node). Proves: `hierarchy.onStart`
 * self-registers the `Node` reflection schema (incl. the `entity-ref` `parent` field); a spawned
 * child composes its WORLD transform up the parent chain; despawning the parent root-heals the
 * child's `worldOf` to its local transform with no throw; and `childrenOf` reflects the resulting
 * (empty) child set.
 */
import { describe, expect, it } from "vitest";
import { coreConfig } from "../../../../config";
import { commandsPlugin } from "../../../commands";
import { ecsPlugin } from "../../../ecs";
import { reflectionPlugin } from "../../../reflection";
import { rendererPlugin } from "../../../renderer";
import { schedulerPlugin } from "../../../scheduler";
import { hierarchyPlugin } from "../../index";

/** Dependency-ordered plugin array (`depends` is validation-only — order is explicit). */
const PLUGINS = [
  ecsPlugin,
  schedulerPlugin,
  rendererPlugin,
  commandsPlugin,
  reflectionPlugin,
  hierarchyPlugin
];

/** Boot the headless hierarchy stack. */
const bootApp = () => {
  const { createApp } = coreConfig.createCore(coreConfig, { plugins: PLUGINS });
  return createApp();
};

describe("hierarchy integration", () => {
  it("self-registers the Node reflection schema at start", async () => {
    const app = bootApp();
    await app.start();

    const fields = app.reflection.describe("Node");
    const byKey = Object.fromEntries(fields.map(field => [field.key, field.kind]));

    expect(byKey.name).toBe("string");
    expect(byKey.enabled).toBe("boolean");
    expect(byKey.order).toBe("number");
    expect(byKey.parent).toBe("entity-ref");

    await app.stop();
  });

  it("composes a child's WORLD transform under its parent, and root-heals on despawn", async () => {
    const app = bootApp();
    await app.start();

    const parent = app.commands.applyRaw({
      kind: "spawn",
      components: {
        Transform: { x: 10, y: 5, rotation: Math.PI / 2, scaleX: 2, scaleY: 2 },
        Node: { parent: undefined, order: 0, name: "parent", enabled: true }
      }
    });
    if (!parent.ok) throw new Error("setup spawn failed");

    const child = app.commands.applyRaw({
      kind: "spawn",
      components: {
        Transform: { x: 1, y: 0, rotation: 0, scaleX: 1, scaleY: 1 },
        Node: { parent: parent.id, order: 0, name: "child", enabled: true }
      }
    });
    if (!child.ok) throw new Error("setup spawn failed");

    const childEntity = app.commands.resolve(child.id);
    if (!childEntity) throw new Error("child did not resolve to a live entity");

    const world = app.hierarchy.worldOf(childEntity);
    expect(world.x).toBeCloseTo(10);
    expect(world.y).toBeCloseTo(7);
    expect(world.rotation).toBeCloseTo(Math.PI / 2);
    expect(world.scaleX).toBeCloseTo(2);
    expect(world.scaleY).toBeCloseTo(2);

    expect(app.hierarchy.childrenOf(parent.id)).toEqual([child.id]);

    // Despawn the parent — worldOf must root-heal to the child's LOCAL transform, no throw.
    app.commands.applyRaw({ kind: "despawn", id: parent.id });

    expect(() => app.hierarchy.worldOf(childEntity)).not.toThrow();
    const healed = app.hierarchy.worldOf(childEntity);
    expect(healed.x).toBeCloseTo(1);
    expect(healed.y).toBeCloseTo(0);
    expect(healed.rotation).toBeCloseTo(0);
    expect(healed.scaleX).toBeCloseTo(1);
    expect(healed.scaleY).toBeCloseTo(1);

    expect(app.hierarchy.childrenOf(parent.id)).toEqual([]);

    await app.stop();
  });
});
