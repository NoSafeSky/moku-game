import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock the framework so importing demo-scene pulls only a lightweight `field` builder (never the
// real graph with pixi). demo-scene uses `field.number(...)` and nothing else from the framework.
vi.mock("@nosafesky/moku-game", () => ({
  field: { number: (opts?: object) => ({ kind: "number", ...opts }) }
}));

const { seedDemoScene } = await import("../../src/lib/demo-scene");

/** A minimal stub of the game app's authoring surface, with spies on every seam demo-scene touches. */
function makeGameApp(entityCount = 0) {
  let nextId = 1;
  const register = vi.fn();
  const count = vi.fn(() => entityCount);
  const applyRaw = vi.fn(() => ({ ok: true as const, id: nextId++ }));
  const resolve = vi.fn((id: number) => ({ entity: id }));
  const attachPrimitive = vi.fn(() => true);
  const gameApp = {
    reflection: { register },
    commands: { count, applyRaw, resolve },
    renderer: { attachPrimitive }
  };
  return { gameApp, register, count, applyRaw, resolve, attachPrimitive };
}

/** Seed with a stub game app (cast — the stub is structurally partial, only the touched seams exist). */
const seed = (stub: ReturnType<typeof makeGameApp>): void =>
  seedDemoScene(stub.gameApp as unknown as Parameters<typeof seedDemoScene>[0]);

describe("demo-scene", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("registers a typed Transform schema before spawning (so the inspector shows real controls)", () => {
    const stub = makeGameApp();

    seed(stub);

    expect(stub.register).toHaveBeenCalledTimes(1);
    const [name, schema] = stub.register.mock.calls[0] ?? [];
    expect(name).toBe("Transform");
    expect(Object.keys(schema as object)).toEqual(["x", "y", "rotation", "scaleX", "scaleY"]);
  });

  it("spawns each demo entity through commands.applyRaw with a Transform component", () => {
    const stub = makeGameApp();

    seed(stub);

    expect(stub.applyRaw).toHaveBeenCalledTimes(4);
    for (const call of stub.applyRaw.mock.calls) {
      const [command] = call as unknown as [{ kind: string; components: Record<string, unknown> }];
      expect(command.kind).toBe("spawn");
      expect(command.components).toHaveProperty("Transform");
    }
  });

  it("attaches a primitive view to every spawned entity it can resolve", () => {
    const stub = makeGameApp();

    seed(stub);

    expect(stub.resolve).toHaveBeenCalledTimes(4);
    expect(stub.attachPrimitive).toHaveBeenCalledTimes(4);
    for (const call of stub.attachPrimitive.mock.calls) {
      const [, primitive] = call as unknown as [unknown, { shape: string }];
      expect(["rect", "circle"]).toContain(primitive.shape);
    }
  });

  it("is idempotent — a non-empty world (real host game / prior seed) is left untouched", () => {
    const stub = makeGameApp(3); // world already holds editor entities

    seed(stub);

    expect(stub.register).not.toHaveBeenCalled();
    expect(stub.applyRaw).not.toHaveBeenCalled();
    expect(stub.attachPrimitive).not.toHaveBeenCalled();
  });

  it("skips the view attach for an entity whose spawn failed", () => {
    const stub = makeGameApp();
    stub.applyRaw.mockReturnValueOnce({ ok: false, error: "boom" } as never);

    seed(stub);

    // 4 spawn attempts, first failed → 3 resolves + 3 attaches.
    expect(stub.applyRaw).toHaveBeenCalledTimes(4);
    expect(stub.resolve).toHaveBeenCalledTimes(3);
    expect(stub.attachPrimitive).toHaveBeenCalledTimes(3);
  });
});
