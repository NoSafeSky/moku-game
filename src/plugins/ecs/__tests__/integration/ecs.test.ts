import { describe, expect, expectTypeOf, it } from "vitest";
import { coreConfig, createCore } from "../../../../config";
import { ecsPlugin } from "../../index";

// ─── Minimal test framework (ecs-only) ───────────────────────
// createApp() initialises ALL framework plugins; many are still stubs in Wave 1.
// We build a headless ecs-only framework to test in isolation.
const ecsFramework = createCore(coreConfig, { plugins: [ecsPlugin] });
const createTestApp = () => ecsFramework.createApp();

describe("ecs integration — full lifecycle headless", () => {
  // eslint-disable-next-line sonarjs/assertions-in-tests -- type-level test, no runtime assertion
  it("app starts and stops without error (headless, no renderer)", async () => {
    const app = createTestApp();
    await app.start();
    await app.stop();
  });

  it("app.ecs exposes the World facade", async () => {
    const app = createTestApp();
    await app.start();
    expect(typeof app.ecs.spawn).toBe("function");
    expect(typeof app.ecs.despawn).toBe("function");
    expect(typeof app.ecs.defineComponent).toBe("function");
    expect(typeof app.ecs.query).toBe("function");
    expect(typeof app.ecs.tick).toBe("function");
    await app.stop();
  });

  it("spawn/query/tick round-trip via app.ecs", async () => {
    const app = createTestApp();
    await app.start();

    const Position = app.ecs.defineComponent(() => ({ x: 0, y: 0 }));
    const Velocity = app.ecs.defineComponent(() => ({ dx: 0, dy: 0 }));

    app.ecs.spawn(Position({ x: 0, y: 0 }), Velocity({ dx: 10, dy: 0 }));

    app.ecs.addSystem("update", (w, dt) => {
      w.query(Position, Velocity).updateEach(([pos, vel]) => {
        pos.x += vel.dx * dt;
      });
    });

    app.ecs.tick(1);

    const entity = app.ecs.query(Position).first();
    expect(entity).toBeDefined();
    expect(app.ecs.get(entity!, Position)?.x).toBeCloseTo(10);

    await app.stop();
  });

  it("config override flows through to the world", async () => {
    const app = ecsFramework.createApp({ pluginConfigs: { ecs: { initialCapacity: 64 } } });
    await app.start();
    // World should still function with small initial capacity (auto-grows)
    const Position = app.ecs.defineComponent(() => ({ x: 0, y: 0 }));
    for (let index = 0; index < 100; index++) {
      app.ecs.spawn(Position({ x: index, y: 0 }));
    }
    expect(app.ecs.query(Position).count()).toBe(100);
    await app.stop();
  });

  it("isAlive/despawn cycle works end-to-end", async () => {
    const app = createTestApp();
    await app.start();

    const Tag = app.ecs.defineTag();
    const entity = app.ecs.spawn(Tag({}));
    expect(app.ecs.isAlive(entity)).toBe(true);

    app.ecs.despawn(entity);
    expect(app.ecs.isAlive(entity)).toBe(false);

    await app.stop();
  });
});

// ─── resource integration tests ───────────────────────────────
describe("ecs integration — resource flow (headless, no renderer)", () => {
  it("defines, sets, and gets a resource across start → tick → stop", async () => {
    const app = createTestApp();
    await app.start();

    const Score = app.ecs.defineResource(() => ({ value: 0, combo: 1 }));

    // Before any explicit set, lazy-init fires on first read
    expect(app.ecs.getResource(Score)).toStrictEqual({ value: 0, combo: 1 });

    // Set during active lifetime
    app.ecs.setResource(Score, { value: 10, combo: 2 });
    expect(app.ecs.resource(Score)).toStrictEqual({ value: 10, combo: 2 });

    // Resource accessible from inside a system during tick
    let seenValue = -1;
    app.ecs.addSystem("update", w => {
      seenValue = w.resource(Score).value;
    });
    app.ecs.tick(1 / 60);
    expect(seenValue).toBe(10);

    // hasResource and removeResource work across the full lifecycle
    expect(app.ecs.hasResource(Score)).toBe(true);
    app.ecs.removeResource(Score);
    // Factory re-inits on next read
    expect(app.ecs.getResource(Score)).toStrictEqual({ value: 0, combo: 1 });

    await app.stop();
  });

  it("resource methods are present on app.ecs", async () => {
    const app = createTestApp();
    await app.start();
    expect(typeof app.ecs.defineResource).toBe("function");
    expect(typeof app.ecs.setResource).toBe("function");
    expect(typeof app.ecs.getResource).toBe("function");
    expect(typeof app.ecs.resource).toBe("function");
    expect(typeof app.ecs.hasResource).toBe("function");
    expect(typeof app.ecs.removeResource).toBe("function");
    await app.stop();
  });
});

// ─── type-level tests ─────────────────────────────────────────
describe("ecs integration — type-level", () => {
  it("app.ecs is typed as World", async () => {
    const app = createTestApp();
    await app.start();
    expectTypeOf(app.ecs.spawn).toBeFunction();
    expectTypeOf(app.ecs.tick).parameter(0).toBeNumber();
    await app.stop();
  });

  it("query(Position, Velocity).updateEach yields precise tuple", async () => {
    const app = createTestApp();
    await app.start();

    const Position = app.ecs.defineComponent(() => ({ x: 0, y: 0 }));
    const Velocity = app.ecs.defineComponent(() => ({ dx: 0, dy: 0 }));

    app.ecs.query(Position, Velocity).updateEach(([pos, vel]) => {
      expectTypeOf(pos).toEqualTypeOf<{ x: number; y: number }>();
      expectTypeOf(vel).toEqualTypeOf<{ dx: number; dy: number }>();
    });

    await app.stop();
  });
});
