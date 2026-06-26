/**
 * @file ecs plugin — unit tests for the Cycle 4 introspection facet.
 *
 * Covers: liveEntities / entityCount (including bare-spawned + recycled slots),
 * componentNames (named only, registration order), and componentsOf (named
 * components with live values; anonymous omitted; dead entity → []; both storage
 * strategies surfaced). Also asserts the optional `name` on defineComponent/defineTag.
 */
import { describe, expect, expectTypeOf, it } from "vitest";
import type { Component, Entity } from "../../types";
import { createWorld } from "../../world";

// ─── helpers ──────────────────────────────────────────────────
const makeWorld = () => createWorld({ initialCapacity: 1024, maxStructuralOpsWarn: 0 });

// ─────────────────────────────────────────────────────────────────────────────
// liveEntities / entityCount
// ─────────────────────────────────────────────────────────────────────────────

describe("introspection — liveEntities / entityCount", () => {
  it("counts and lists every live entity, including bare-spawned ones", () => {
    const world = makeWorld();
    const Position = world.defineComponent(() => ({ x: 0, y: 0 }), { name: "Position" });
    const a = world.spawn(Position({ x: 1, y: 1 }));
    const b = world.spawn(); // no components
    const c = world.spawn(Position({ x: 2, y: 2 }));

    expect(world.entityCount()).toBe(3);
    const live = world.liveEntities();
    expect(live).toHaveLength(3);
    expect([...live]).toEqual(expect.arrayContaining([a, b, c]));
  });

  it("reflects despawns and recycled slots", () => {
    const world = makeWorld();
    const e1 = world.spawn();
    const e2 = world.spawn();
    expect(world.entityCount()).toBe(2);

    world.despawn(e1);
    expect(world.entityCount()).toBe(1);
    expect(world.liveEntities()).not.toContain(e1);
    expect(world.liveEntities()).toContain(e2);

    // Recycled slot is counted once, and the stale handle is not listed.
    const e3 = world.spawn();
    expect(world.entityCount()).toBe(2);
    expect(world.liveEntities()).toContain(e3);
    expect(world.liveEntities()).not.toContain(e1);
  });

  it("returns an empty list for a fresh world", () => {
    const world = makeWorld();
    expect(world.entityCount()).toBe(0);
    expect(world.liveEntities()).toEqual([]);
  });

  it("liveEntities returns a fresh copy each call (mutating it is harmless)", () => {
    const world = makeWorld();
    world.spawn();
    const first = world.liveEntities() as Entity[];
    first.pop();
    expect(world.entityCount()).toBe(1);
    expect(world.liveEntities()).toHaveLength(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// componentNames
// ─────────────────────────────────────────────────────────────────────────────

describe("introspection — componentNames", () => {
  it("lists only named components, in registration order", () => {
    const world = makeWorld();
    world.defineComponent(() => ({ x: 0 }), { name: "Transform" });
    world.defineComponent(() => ({ dx: 0 })); // anonymous — must not appear
    world.defineComponent(() => ({ hp: 0 }), { name: "Health" });
    world.defineTag({ name: "Paddle" });

    expect(world.componentNames()).toEqual(["Transform", "Health", "Paddle"]);
  });

  it("is empty when no component is named", () => {
    const world = makeWorld();
    world.defineComponent(() => ({ x: 0 }));
    world.defineTag();
    expect(world.componentNames()).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// componentsOf
// ─────────────────────────────────────────────────────────────────────────────

describe("introspection — componentsOf", () => {
  it("returns named components with their live values, omitting anonymous ones", () => {
    const world = makeWorld();
    const Transform = world.defineComponent(() => ({ x: 0, y: 0 }), { name: "Transform" });
    const Velocity = world.defineComponent(() => ({ dx: 0, dy: 0 })); // anonymous
    const ball = world.spawn(Transform({ x: 10, y: 5 }), Velocity({ dx: 1, dy: 0 }));

    const comps = world.componentsOf(ball);
    expect(comps).toEqual([{ name: "Transform", value: { x: 10, y: 5 } }]);
  });

  it("reflects live values after a set() mutation", () => {
    const world = makeWorld();
    const Transform = world.defineComponent(() => ({ x: 0, y: 0 }), { name: "Transform" });
    const ball = world.spawn(Transform({ x: 10, y: 5 }));
    world.set(ball, Transform, { x: 99 });

    expect(world.componentsOf(ball)).toEqual([{ name: "Transform", value: { x: 99, y: 5 } }]);
  });

  it("surfaces both archetype- and sparse-stored named components", () => {
    const world = makeWorld();
    const Transform = world.defineComponent(() => ({ x: 0, y: 0 }), { name: "Transform" });
    const Paddle = world.defineTag({ name: "Paddle" }); // sparse by default
    const entity = world.spawn(Transform({ x: 3, y: 4 }), Paddle({}));

    const byName = Object.fromEntries(world.componentsOf(entity).map(c => [c.name, c.value]));
    expect(byName.Transform).toEqual({ x: 3, y: 4 });
    expect(byName.Paddle).toEqual({});
  });

  it("omits a named component the entity does not have", () => {
    const world = makeWorld();
    const Transform = world.defineComponent(() => ({ x: 0, y: 0 }), { name: "Transform" });
    world.defineComponent(() => ({ hp: 0 }), { name: "Health" });
    const entity = world.spawn(Transform({ x: 1, y: 2 }));

    expect(world.componentsOf(entity).map(c => c.name)).toEqual(["Transform"]);
  });

  it("returns [] for a dead entity", () => {
    const world = makeWorld();
    const Transform = world.defineComponent(() => ({ x: 0, y: 0 }), { name: "Transform" });
    const entity = world.spawn(Transform({ x: 1, y: 2 }));
    world.despawn(entity);
    expect(world.componentsOf(entity)).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Type-level assertions
// ─────────────────────────────────────────────────────────────────────────────

describe("introspection — types", () => {
  it("exposes the four introspection method signatures", () => {
    const world = makeWorld();
    expectTypeOf(world.liveEntities).toEqualTypeOf<() => readonly Entity[]>();
    expectTypeOf(world.entityCount).toEqualTypeOf<() => number>();
    expectTypeOf(world.componentNames).toEqualTypeOf<() => readonly string[]>();
    expectTypeOf(world.componentsOf).toMatchTypeOf<
      (entity: Entity) => ReadonlyArray<{ name: string; value: unknown }>
    >();
  });

  it("accepts an optional name in defineComponent/defineTag opts", () => {
    const world = makeWorld();
    const Named: Component<{ x: number }> = world.defineComponent(() => ({ x: 0 }), {
      name: "X",
      storage: "sparse"
    });
    expectTypeOf(Named.__id).toEqualTypeOf<number>();
  });
});
