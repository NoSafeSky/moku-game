import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock the framework so importing demo-scene pulls only a lightweight `field` builder (never the
// real graph with pixi). demo-scene uses `field.number(...)` for the Transform schema and nothing else.
vi.mock("@nosafesky/ludemic", () => ({
  field: { number: (opts?: object) => ({ kind: "number", ...opts }) }
}));

const { seedDemoScene } = await import("../../src/lib/demo-scene");

/** One recorded authoring call — verb + name + parent + the minted id the stub returned. */
type Record = {
  verb: "create" | "createShape";
  name: string;
  parent: number | undefined;
  id: number;
  kind?: string;
};

/** A stub of the game app's authoring surface: sequential-id bridge verbs + a reflection/commands spy. */
function makeGameApp(entityCount = 0) {
  let nextId = 1;
  const records: Record[] = [];
  const create = vi.fn((opts: { name: string; parent?: number }) => {
    const id = nextId++;
    records.push({ verb: "create", name: opts.name, parent: opts.parent, id });
    return id;
  });
  const createShape = vi.fn((kind: string, opts: { name: string; parent?: number }) => {
    const id = nextId++;
    records.push({ verb: "createShape", kind, name: opts.name, parent: opts.parent, id });
    return id;
  });
  const setEnabled = vi.fn();
  const register = vi.fn();
  const count = vi.fn(() => entityCount);
  const gameApp = {
    reflection: { register },
    commands: { count },
    "editor-bridge": { create, createShape, setEnabled }
  };
  return { gameApp, create, createShape, setEnabled, register, count, records };
}

/** Seed with a stub game app (cast — the stub is structurally partial, only the touched seams exist). */
const seed = (stub: ReturnType<typeof makeGameApp>): void =>
  seedDemoScene(stub.gameApp as unknown as Parameters<typeof seedDemoScene>[0]);

/** Index the recorded calls by object name. */
const byName = (records: readonly Record[]): Map<string, Record> =>
  new Map(records.map(r => [r.name, r]));

describe("demo-scene", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("registers a typed Transform schema before seeding (so the inspector shows real controls)", () => {
    const stub = makeGameApp();

    seed(stub);

    expect(stub.register).toHaveBeenCalledTimes(1);
    const [name, schema] = stub.register.mock.calls[0] ?? [];
    expect(name).toBe("Transform");
    expect(Object.keys(schema as object)).toEqual(["x", "y", "rotation", "scaleX", "scaleY"]);
  });

  it("builds the whole nested tree through the bridge authoring verbs", () => {
    const stub = makeGameApp();

    seed(stub);

    // 11 objects: 3 bare-transform folders (create) + 8 shapes (createShape).
    expect(stub.create).toHaveBeenCalledTimes(3);
    expect(stub.createShape).toHaveBeenCalledTimes(8);
    expect(stub.records).toHaveLength(11);
  });

  it("parents the three top-level branches at the scene root", () => {
    const stub = makeGameApp();

    seed(stub);

    const named = byName(stub.records);
    for (const root of ["Environment", "Player", "Enemies"]) {
      expect(named.get(root)?.parent).toBeUndefined();
    }
  });

  it("threads each child under its freshly-minted parent id (real nesting)", () => {
    const stub = makeGameApp();

    seed(stub);

    const named = byName(stub.records);
    const environment = named.get("Environment");
    const ground = named.get("Ground");
    expect(ground?.parent).toBe(environment?.id);
    expect(named.get("Platform_A")?.parent).toBe(ground?.id);
    expect(named.get("Platform_B")?.parent).toBe(ground?.id);
    expect(named.get("Camera_Follow")?.parent).toBe(named.get("Player")?.id);
    expect(named.get("Drone_01")?.parent).toBe(named.get("Enemies")?.id);
  });

  it("seeds Platform_B disabled via setEnabled", () => {
    const stub = makeGameApp();

    seed(stub);

    const platformB = byName(stub.records).get("Platform_B");
    expect(stub.setEnabled).toHaveBeenCalledTimes(1);
    expect(stub.setEnabled).toHaveBeenCalledWith(platformB?.id, false);
  });

  it("creates only rect/circle shapes", () => {
    const stub = makeGameApp();

    seed(stub);

    for (const call of stub.createShape.mock.calls) {
      const [kind] = call as unknown as [string];
      expect(["rect", "circle"]).toContain(kind);
    }
  });

  it("is idempotent — a non-empty world (real host game / prior seed) is left untouched", () => {
    const stub = makeGameApp(3); // world already holds editor entities

    seed(stub);

    expect(stub.register).not.toHaveBeenCalled();
    expect(stub.create).not.toHaveBeenCalled();
    expect(stub.createShape).not.toHaveBeenCalled();
    expect(stub.setEnabled).not.toHaveBeenCalled();
  });
});
