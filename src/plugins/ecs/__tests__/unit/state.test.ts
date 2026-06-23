import { describe, expect, it } from "vitest";
import { createState } from "../../state";

const defaultConfig = { initialCapacity: 1024, maxStructuralOpsWarn: 0 };

describe("createState — world instance", () => {
  it("returns a state object with a world property", () => {
    const state = createState({ global: {}, config: defaultConfig });
    expect(state).toHaveProperty("world");
    expect(typeof state.world).toBe("object");
  });

  it("world exposes the expected API methods", () => {
    const state = createState({ global: {}, config: defaultConfig });
    const { world } = state;
    expect(typeof world.defineComponent).toBe("function");
    expect(typeof world.defineTag).toBe("function");
    expect(typeof world.spawn).toBe("function");
    expect(typeof world.despawn).toBe("function");
    expect(typeof world.isAlive).toBe("function");
    expect(typeof world.add).toBe("function");
    expect(typeof world.remove).toBe("function");
    expect(typeof world.has).toBe("function");
    expect(typeof world.get).toBe("function");
    expect(typeof world.set).toBe("function");
    expect(typeof world.query).toBe("function");
    expect(typeof world.addSystem).toBe("function");
    expect(typeof world.tick).toBe("function");
  });

  it("two calls to createState produce independent worlds", () => {
    const state1 = createState({ global: {}, config: defaultConfig });
    const state2 = createState({ global: {}, config: defaultConfig });
    expect(state1.world).not.toBe(state2.world);
  });

  it("respects initialCapacity in config without throwing", () => {
    // Small initial capacity — should not throw; grows automatically
    expect(() =>
      createState({ global: {}, config: { initialCapacity: 4, maxStructuralOpsWarn: 0 } })
    ).not.toThrow();
  });
});
