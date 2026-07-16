/**
 * @file hierarchy plugin — unit tests for the sync-stage world-transform system (`system.ts`).
 */
import { describe, expect, it, vi } from "vitest";
import type { Entity } from "../../../ecs/types";
import { createWorldTransformSystem } from "../../system";
import {
  asEditorId,
  asEntity,
  makeCommands,
  makeCommandsFixture,
  makeRenderer,
  makeWorld,
  makeWorldFixture,
  NODE_TOKEN
} from "../mock-deps";

/** Builds a small root(disabled-parent)→child scene shared by every test below. */
const buildScene = () => {
  const root: Entity = asEntity(1);
  const parent: Entity = asEntity(2); // disabled
  const child: Entity = asEntity(3); // itself enabled, but parent is disabled

  const rootId = asEditorId(1);
  const parentId = asEditorId(2);
  const childId = asEditorId(3);

  const worldFixture = makeWorldFixture({
    nodes: new Map([
      [root, { parent: undefined, order: 0, name: "root", enabled: true }],
      [parent, { parent: undefined, order: 0, name: "parent", enabled: false }],
      [child, { parent: parentId, order: 0, name: "child", enabled: true }]
    ])
  });
  const commandsFixture = makeCommandsFixture({
    byId: new Map([
      [rootId, root],
      [parentId, parent],
      [childId, child]
    ]),
    byEntity: new Map([
      [root, rootId],
      [parent, parentId],
      [child, childId]
    ])
  });

  return { root, parent, child, worldFixture, commandsFixture };
};

describe("hierarchy — system", () => {
  it("edit mode: recomputes only when changeEpoch() has advanced", () => {
    const { worldFixture, commandsFixture } = buildScene();
    const world = makeWorld(worldFixture);
    const commands = makeCommands(commandsFixture);
    const renderer = makeRenderer();
    const system = createWorldTransformSystem({
      renderer,
      commands,
      nodeToken: NODE_TOKEN,
      maxDepth: 64
    });

    system(world, 0); // first tick — always recomputes
    expect(renderer.markDirty).toHaveBeenCalledTimes(3);

    vi.mocked(renderer.markDirty).mockClear();
    system(world, 0); // same epoch, no write — no-op
    expect(renderer.markDirty).not.toHaveBeenCalled();

    worldFixture.epoch = 1; // simulate a write bumping the epoch
    system(world, 0);
    expect(renderer.markDirty).toHaveBeenCalledTimes(3);
  });

  it("play mode: recomputes every tick regardless of epoch", () => {
    const { worldFixture, commandsFixture } = buildScene();
    worldFixture.editStages = false; // activeStages() === undefined
    const world = makeWorld(worldFixture);
    const commands = makeCommands(commandsFixture);
    const renderer = makeRenderer();
    const system = createWorldTransformSystem({
      renderer,
      commands,
      nodeToken: NODE_TOKEN,
      maxDepth: 64
    });

    system(world, 0);
    vi.mocked(renderer.markDirty).mockClear();
    system(world, 0); // same epoch, play mode — still recomputes

    expect(renderer.markDirty).toHaveBeenCalledTimes(3);
  });

  it("setEntityVisible reflects effectiveEnabled — a disabled ancestor hides an enabled child", () => {
    const { root, parent, child, worldFixture, commandsFixture } = buildScene();
    const world = makeWorld(worldFixture);
    const commands = makeCommands(commandsFixture);
    const renderer = makeRenderer();
    const system = createWorldTransformSystem({
      renderer,
      commands,
      nodeToken: NODE_TOKEN,
      maxDepth: 64
    });

    system(world, 0);

    expect(renderer.setEntityVisible).toHaveBeenCalledWith(root, true);
    expect(renderer.setEntityVisible).toHaveBeenCalledWith(parent, false);
    expect(renderer.setEntityVisible).toHaveBeenCalledWith(child, false);
  });
});
