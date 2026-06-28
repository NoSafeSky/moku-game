/**
 * @file ecs plugin — unit tests for `componentByName` (Cycle 5 delta).
 *
 * Covers:
 *  - Known name resolves to the SAME token instance used at definition.
 *  - Resolved token works in a full round-trip: add / set / get / has / remove.
 *  - Unknown name returns `undefined`.
 *  - Anonymous component (no `name`) is never resolvable.
 *  - Duplicate names: first-registered component wins.
 *  - Type-level: return type is `Component<Record<string, unknown>> | undefined`.
 */
import { describe, expect, expectTypeOf, it } from "vitest";
import type { Component } from "../../types";
import { createWorld } from "../../world";

// ─── helpers ──────────────────────────────────────────────────
const makeWorld = () => createWorld({ initialCapacity: 1024, maxStructuralOpsWarn: 0 });

// ─────────────────────────────────────────────────────────────────────────────
// Token identity
// ─────────────────────────────────────────────────────────────────────────────

describe("componentByName — token identity", () => {
  it("returns the same token instance as defineComponent when name matches", () => {
    const world = makeWorld();
    const Position = world.defineComponent(() => ({ x: 0, y: 0 }), { name: "Position" });

    const resolved = world.componentByName("Position");

    // Must be the exact same function reference
    expect(resolved).toBe(Position);
  });

  it("returns the same token instance as defineTag when name matches", () => {
    const world = makeWorld();
    const Alive = world.defineTag({ name: "Alive" });

    const resolved = world.componentByName("Alive");

    expect(resolved).toBe(Alive);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Round-trip: resolve by name, then mutate via add / set / get / has / remove
// ─────────────────────────────────────────────────────────────────────────────

describe("componentByName — round-trip with live entity", () => {
  it("add then get via resolved token reflects the partial value", () => {
    const world = makeWorld();
    world.defineComponent(() => ({ x: 0, y: 0 }), { name: "Position" });

    const token = world.componentByName("Position");
    // token must be defined to proceed
    expect(token).toBeDefined();
    if (token === undefined) return;

    const entity = world.spawn();
    // add via the resolved (widened) token
    world.add(entity, token, { x: 42 });

    // get using the resolved token — value must reflect the partial add
    const value = world.get(entity, token);
    expect(value).toEqual({ x: 42, y: 0 });
  });

  it("set via resolved token updates the stored value", () => {
    const world = makeWorld();
    const Position = world.defineComponent(() => ({ x: 0, y: 0 }), { name: "Position" });

    const token = world.componentByName("Position");
    expect(token).toBeDefined();
    if (token === undefined) return;

    const entity = world.spawn(Position({ x: 1, y: 2 }));

    world.set(entity, token, { x: 99 });
    expect(world.get(entity, Position)).toEqual({ x: 99, y: 2 });
  });

  it("has returns true after add via resolved token", () => {
    const world = makeWorld();
    world.defineComponent(() => ({ x: 0, y: 0 }), { name: "Position" });

    const token = world.componentByName("Position");
    expect(token).toBeDefined();
    if (token === undefined) return;

    const entity = world.spawn();

    expect(world.has(entity, token)).toBe(false);
    world.add(entity, token, { x: 5 });
    expect(world.has(entity, token)).toBe(true);
  });

  it("remove via resolved token leaves the entity without the component", () => {
    const world = makeWorld();
    const Position = world.defineComponent(() => ({ x: 0, y: 0 }), { name: "Position" });

    const token = world.componentByName("Position");
    expect(token).toBeDefined();
    if (token === undefined) return;

    const entity = world.spawn(Position({ x: 1, y: 2 }));

    world.remove(entity, token);
    expect(world.has(entity, Position)).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Unknown / anonymous / duplicate
// ─────────────────────────────────────────────────────────────────────────────

describe("componentByName — unknown name", () => {
  it("returns undefined for a name that was never registered", () => {
    const world = makeWorld();
    world.defineComponent(() => ({ x: 0 }), { name: "Transform" });

    expect(world.componentByName("Nope")).toBeUndefined();
  });

  it("returns undefined on a fresh world with no components", () => {
    const world = makeWorld();
    expect(world.componentByName("anything")).toBeUndefined();
  });
});

describe("componentByName — anonymous component", () => {
  it("is not resolvable by any string", () => {
    const world = makeWorld();
    // Define without opts.name — anonymous
    world.defineComponent(() => ({ x: 0 }));
    world.defineTag();

    // No name at all means no lookup key
    expect(world.componentByName("")).toBeUndefined();
    expect(world.componentByName("0")).toBeUndefined();
    expect(world.componentByName("unknown")).toBeUndefined();
  });
});

describe("componentByName — duplicate names", () => {
  it("returns the FIRST registered component when two share the same name", () => {
    const world = makeWorld();
    const First = world.defineComponent(() => ({ v: 1 }), { name: "Dup" });
    const Second = world.defineComponent(() => ({ v: 2 }), { name: "Dup" });

    const resolved = world.componentByName("Dup");

    // Must be First, not Second
    expect(resolved).toBe(First);
    expect(resolved).not.toBe(Second);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Type-level assertions
// ─────────────────────────────────────────────────────────────────────────────

describe("componentByName — types", () => {
  it("has return type Component<Record<string, unknown>> | undefined (not any)", () => {
    const world = makeWorld();
    world.defineComponent(() => ({ x: 0 }), { name: "X" });

    expectTypeOf(world.componentByName).toEqualTypeOf<
      (name: string) => Component<Record<string, unknown>> | undefined
    >();
  });

  it("the resolved token is not typed as any", () => {
    const world = makeWorld();
    world.defineComponent(() => ({ x: 0 }), { name: "X" });

    const token = world.componentByName("X");
    expectTypeOf(token).toEqualTypeOf<Component<Record<string, unknown>> | undefined>();
  });
});
