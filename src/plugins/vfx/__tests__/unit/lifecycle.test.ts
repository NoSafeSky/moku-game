/**
 * @file vfx plugin — onStart wiring unit tests.
 *
 * Drives `start` with a real ecs world + mock scheduler/renderer and asserts it
 * captures renderer.Transform, defines the four named components, and registers
 * the five systems (4 in "update", 1 in "render"). Also exercises each component's
 * default-value factory (the `add`-without-value merge base).
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("pixi.js", () => ({
  Application: class {},
  Graphics: class {},
  Container: class {},
  Text: class {
    anchor = { set: vi.fn() };
    alpha = 1;
    constructor(public opts: unknown) {}
  }
}));

import { ecsPlugin } from "../../../ecs";
import { createWorld } from "../../../ecs/world";
import type { TransformValue } from "../../../renderer/types";
import { schedulerPlugin } from "../../../scheduler";
import { type StartContext, start } from "../../lifecycle";
import { createState } from "../../state";
import { makeConfig, makeLog, makeRenderer, makeStage } from "../helpers";

/** No-op unsubscribe returned by the mock scheduler's addSystem. */
const noop = (): void => {};

/** Boot `start` against a real world + mock scheduler/renderer; return the pieces. */
const runStart = () => {
  const world = createWorld({ initialCapacity: 1024, maxStructuralOpsWarn: 0 });
  const transform = world.defineComponent<TransformValue>(
    () => ({ x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1 }),
    { name: "Transform" }
  );
  const addSystem = vi.fn((_stage: string, _system: unknown) => noop);
  const scheduler = { addSystem, tick: vi.fn(), stages: [] };
  const renderer = { Transform: transform, ...makeRenderer(makeStage()) };

  const require = ((plugin: unknown) => {
    if (plugin === ecsPlugin) return world;
    if (plugin === schedulerPlugin) return scheduler;
    return renderer;
  }) as unknown as StartContext["require"];

  const config = makeConfig();
  const state = createState({ global: {}, config });
  start({ config, state, log: makeLog(), require });

  return { world, state, transform, addSystem };
};

describe("vfx onStart", () => {
  it("captures renderer.Transform and defines the five named components", () => {
    const { world, state, transform } = runStart();

    expect(state.transform).toBe(transform);
    expect(world.componentNames()).toEqual(
      expect.arrayContaining(["Emitter", "Particle", "Pop", "Flash", "FloatingText"])
    );
    expect(state.Emitter).toBeDefined();
    expect(state.Particle).toBeDefined();
    expect(state.Pop).toBeDefined();
    expect(state.Flash).toBeDefined();
    expect(state.FloatingText).toBeDefined();
  });

  it("registers six systems — five in update, one in render", () => {
    const { addSystem } = runStart();

    expect(addSystem).toHaveBeenCalledTimes(6);
    const stages = addSystem.mock.calls.map(call => call[0]);
    expect(stages.filter(s => s === "update")).toHaveLength(5);
    expect(stages.filter(s => s === "render")).toHaveLength(1);
  });

  it("each component's default factory yields a valid merge base", () => {
    const { world, state } = runStart();
    const { Emitter, Particle, Pop, Flash, FloatingText } = state;
    if (!Emitter || !Particle || !Pop || !Flash || !FloatingText)
      throw new Error("tokens undefined");

    const a = world.spawn();
    world.add(a, Emitter);
    expect(world.get(a, Emitter)?.enabled).toBe(false);
    expect(world.get(a, Emitter)?.color).toBe(makeConfig().defaultColor);

    const b = world.spawn();
    world.add(b, Particle);
    expect(world.get(b, Particle)?.emitter).toBe(-1);

    const c = world.spawn();
    world.add(c, Pop);
    expect(world.get(c, Pop)?.amplitude).toBe(1);

    const d = world.spawn();
    world.add(d, FloatingText);
    expect(world.get(d, FloatingText)?.riseSpeed).toBe(40);

    const e = world.spawn();
    world.add(e, Flash);
    expect(world.get(e, Flash)?.baseTint).toBe(0xff_ff_ff);
  });
});
