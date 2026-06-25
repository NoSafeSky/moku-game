/**
 * @file ecs plugin — resource registry unit tests (Cycle 2 delta).
 *
 * Tests for world.defineResource, world.setResource, world.getResource,
 * world.resource, world.hasResource, and world.removeResource.
 * All resource ops are immediate (never buffered) — proven by the iteration-immediacy test.
 */

import { describe, expect, expectTypeOf, it, vi } from "vitest";
import type { Resource } from "../../types";
import { createWorld } from "../../world";

// ─── helpers ──────────────────────────────────────────────────
const makeWorld = () => createWorld({ initialCapacity: 1024, maxStructuralOpsWarn: 0 });

// ─── defineResource WITH a factory ────────────────────────────

describe("resource — defineResource with a factory", () => {
  it("getResource lazily inits from the factory on first read", () => {
    const world = makeWorld();
    const Score = world.defineResource(() => ({ value: 0, combo: 1 }));
    expect(world.getResource(Score)).toStrictEqual({ value: 0, combo: 1 });
  });

  it("factory is called exactly once across multiple getResource reads (memoized)", () => {
    const world = makeWorld();
    let callCount = 0;
    const Score = world.defineResource(() => {
      callCount++;
      return { value: 0 };
    });

    // Multiple reads — factory must only fire once
    world.getResource(Score);
    world.getResource(Score);
    world.getResource(Score);
    expect(callCount).toBe(1);
  });

  it("resource() also lazily inits and memoizes the factory", () => {
    const world = makeWorld();
    let callCount = 0;
    const Score = world.defineResource(() => {
      callCount++;
      return { value: 42 };
    });

    const first = world.resource(Score);
    const second = world.resource(Score);
    expect(first).toStrictEqual({ value: 42 });
    expect(second).toBe(first); // same reference (memoized)
    expect(callCount).toBe(1);
  });

  it("setResource overrides the stored value from the factory", () => {
    const world = makeWorld();
    const Score = world.defineResource(() => ({ value: 0, combo: 1 }));

    // Trigger lazy init
    world.getResource(Score);
    // Override
    world.setResource(Score, { value: 99, combo: 5 });

    expect(world.getResource(Score)).toStrictEqual({ value: 99, combo: 5 });
  });

  it("removeResource clears stored value; factory re-inits on next read", () => {
    const world = makeWorld();
    let callCount = 0;
    const Score = world.defineResource(() => {
      callCount++;
      return { value: 0 };
    });

    // Init, then remove
    world.getResource(Score);
    expect(callCount).toBe(1);

    world.removeResource(Score);

    // Next read re-inits from factory
    const value = world.getResource(Score);
    expect(callCount).toBe(2);
    expect(value).toStrictEqual({ value: 0 });
  });

  it("hasResource returns true when factory is registered (even before init)", () => {
    const world = makeWorld();
    const Score = world.defineResource(() => ({ value: 0 }));
    // Factory exists even before first read — hasResource must return true
    expect(world.hasResource(Score)).toBe(true);
  });

  it("hasResource returns true after setResource overrides the factory value", () => {
    const world = makeWorld();
    const Score = world.defineResource(() => ({ value: 0 }));
    world.setResource(Score, { value: 100 });
    expect(world.hasResource(Score)).toBe(true);
  });

  it("hasResource returns true after removeResource if factory is still registered", () => {
    const world = makeWorld();
    const Score = world.defineResource(() => ({ value: 0 }));
    world.getResource(Score);
    world.removeResource(Score);
    // Factory is still registered — hasResource must still be true
    expect(world.hasResource(Score)).toBe(true);
  });
});

// ─── defineResource WITHOUT a factory ─────────────────────────

describe("resource — defineResource without a factory", () => {
  it("getResource returns undefined when no factory and not set", () => {
    const world = makeWorld();
    const Score = world.defineResource<{ value: number }>();
    expect(world.getResource(Score)).toBeUndefined();
  });

  it("hasResource returns false when no factory and not set", () => {
    const world = makeWorld();
    const Score = world.defineResource<{ value: number }>();
    expect(world.hasResource(Score)).toBe(false);
  });

  it("resource() throws the spec'd actionable message when unset", () => {
    const world = makeWorld();
    const Score = world.defineResource<{ value: number }>();

    // The first resource token gets key "res:0"
    expect(() => world.resource(Score)).toThrow(`world.resource() — resource "res:0" is not set`);
  });

  it("resource() throw message contains the full spec'd format", () => {
    const world = makeWorld();
    const Score = world.defineResource<number>();
    try {
      world.resource(Score);
      expect.fail("should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(Error);
      const message = (error as Error).message;
      expect(message).toContain('[game] world.resource() — resource "res:0" is not set.');
      expect(message).toContain("Set it with world.setResource(token, value)");
      expect(message).toContain("world.defineResource(() => …)");
      expect(message).toContain(
        "Framework resources (Assets, GameContext, Time) are wired at app.start()."
      );
    }
  });

  it("after setResource, hasResource returns true", () => {
    const world = makeWorld();
    const Score = world.defineResource<{ value: number }>();
    expect(world.hasResource(Score)).toBe(false);
    world.setResource(Score, { value: 10 });
    expect(world.hasResource(Score)).toBe(true);
  });

  it("after setResource, resource() returns the value without throwing", () => {
    const world = makeWorld();
    const Score = world.defineResource<{ value: number }>();
    world.setResource(Score, { value: 42 });
    expect(world.resource(Score)).toStrictEqual({ value: 42 });
  });

  it("removeResource on an unset no-factory resource is a no-op", () => {
    const world = makeWorld();
    const Score = world.defineResource<number>();
    expect(() => world.removeResource(Score)).not.toThrow();
    expect(world.hasResource(Score)).toBe(false);
  });

  it("after setResource then removeResource, hasResource returns false again", () => {
    const world = makeWorld();
    const Score = world.defineResource<number>();
    world.setResource(Score, 99);
    world.removeResource(Score);
    expect(world.hasResource(Score)).toBe(false);
    expect(world.getResource(Score)).toBeUndefined();
  });
});

// ─── Immediacy during iteration ────────────────────────────────

describe("resource — immediacy during iteration (never command-buffered)", () => {
  it("setResource is visible to getResource in the same updateEach callback", () => {
    const world = makeWorld();
    const Position = world.defineComponent(() => ({ x: 0, y: 0 }));
    const Score = world.defineResource(() => ({ value: 0 }));

    world.spawn(Position({ x: 1, y: 0 }));
    world.spawn(Position({ x: 2, y: 0 }));

    let visibleInsideCallback = false;

    world.query(Position).updateEach((_values, _entity) => {
      world.setResource(Score, { value: 999 });
      // Must be immediately visible (not deferred)
      const current = world.getResource(Score);
      if (current?.value === 999) visibleInsideCallback = true;
    });

    expect(visibleInsideCallback).toBe(true);
  });

  it("despawn inside updateEach is still deferred (entity alive until flush)", () => {
    const world = makeWorld();
    const Position = world.defineComponent(() => ({ x: 0, y: 0 }));

    const entity = world.spawn(Position({ x: 1, y: 0 }));
    world.spawn(Position({ x: 2, y: 0 }));

    let wasAliveInsideCallback = false;

    world.query(Position).updateEach((_values, iterEntity) => {
      if (iterEntity === entity) {
        world.despawn(entity);
        // Entity despawn is buffered — still alive INSIDE the callback
        wasAliveInsideCallback = world.isAlive(entity);
      }
    });

    // After callback + flush: entity is truly gone
    expect(wasAliveInsideCallback).toBe(true);
    expect(world.isAlive(entity)).toBe(false);
  });

  it("resource ops during tick() system are also immediate", () => {
    const world = makeWorld();
    const Counter = world.defineResource(() => 0);

    let seenValue = -1;
    world.addSystem("update", w => {
      w.setResource(Counter, 42);
      seenValue = w.resource(Counter);
    });

    world.tick(0.016);
    expect(seenValue).toBe(42);
  });
});

// ─── Token identity and fixed-key well-known tokens ───────────

describe("resource — token identity and fixed-key tokens", () => {
  it("distinct defineResource calls produce tokens with distinct monotonic keys", () => {
    const world = makeWorld();
    const A = world.defineResource<number>();
    const B = world.defineResource<string>();
    const C = world.defineResource<boolean>();

    // Keys should be "res:0", "res:1", "res:2"
    expect(A.__key).toBe("res:0");
    expect(B.__key).toBe("res:1");
    expect(C.__key).toBe("res:2");
  });

  it("distinct tokens never collide — writing one does not affect the other", () => {
    const world = makeWorld();
    const A = world.defineResource<number>();
    const B = world.defineResource<number>();

    world.setResource(A, 10);
    world.setResource(B, 20);

    expect(world.getResource(A)).toBe(10);
    expect(world.getResource(B)).toBe(20);
  });

  it("a fixed-key well-known token reads/writes independently of defineResource tokens", () => {
    const world = makeWorld();
    // Consume a few auto-keyed slots
    world.defineResource<number>();
    world.defineResource<string>();

    // Fixed-key token (e.g. framework well-known resource — NOT from defineResource)
    const Assets = { __key: "ctx:assets" } as Resource<{ load: () => void }>;

    const mockAssets = { load: vi.fn() };
    world.setResource(Assets, mockAssets);

    expect(world.getResource(Assets)).toBe(mockAssets);
    expect(world.hasResource(Assets)).toBe(true);

    world.removeResource(Assets);
    expect(world.hasResource(Assets)).toBe(false);
    expect(world.getResource(Assets)).toBeUndefined();
  });

  it("fixed-key token does not collide with auto-keyed res:N tokens", () => {
    const world = makeWorld();
    const Auto = world.defineResource<number>();
    const Fixed = { __key: "ctx:assets" } as Resource<string>;

    world.setResource(Auto, 42);
    world.setResource(Fixed, "hello");

    expect(world.getResource(Auto)).toBe(42);
    expect(world.getResource(Fixed)).toBe("hello");
  });
});

// ─── Type-level tests ─────────────────────────────────────────

describe("resource — type-level safety", () => {
  it("resource(Score) infers the exact shape, not any/unknown", () => {
    const world = makeWorld();
    const Score = world.defineResource(() => ({ value: 0, combo: 1 }));
    expectTypeOf(world.resource(Score)).toEqualTypeOf<{ value: number; combo: number }>();
  });

  it("getResource infers the correct type from the factory", () => {
    const world = makeWorld();
    const Score = world.defineResource(() => ({ value: 0, combo: 1 }));
    expectTypeOf(world.getResource(Score)).toEqualTypeOf<
      { value: number; combo: number } | undefined
    >();
  });

  // eslint-disable-next-line sonarjs/assertions-in-tests -- type-level test, no runtime assertion
  it("Resource<number> is not assignable where Resource<string> is expected", () => {
    const world = makeWorld();
    const numToken = world.defineResource<number>();
    // @ts-expect-error — Resource<number> is not assignable to Resource<string>
    world.setResource(numToken as Resource<string>, "oops");
  });

  // eslint-disable-next-line sonarjs/assertions-in-tests -- type-level test, no runtime assertion
  it("setResource rejects wrong value type", () => {
    const world = makeWorld();
    const Score = world.defineResource(() => ({ value: 0, combo: 1 }));
    // @ts-expect-error — "wrong" is not assignable to { value: number; combo: number }
    world.setResource(Score, "wrong");
  });
});
