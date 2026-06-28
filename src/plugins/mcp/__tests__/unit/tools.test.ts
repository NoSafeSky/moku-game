/**
 * @file mcp plugin — unit tests for tools.ts
 *
 * Tests that:
 * - The full catalog (15 tools) registers; enableMutations:false leaves only read-only tools
 * - Mutating ECS tools enqueue (drained, not synchronous); loop + input tools call directly
 * - ecs:query reads the WHOLE world by component name (Cycle 4), with values + unknown-name error
 * - renderer:screenshot (extract) and renderer:tree degrade to not-available results
 * - input:key injects via the input API directly (not command-buffered)
 * - Cycle 5: real ECS mutation triad, renderer:attach, honest results, polish
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Entity } from "../../../ecs/types";
import type { PrimitiveSpec, SceneNode } from "../../../renderer/types";
import type { RendererDep, ToolDeps } from "../../tools";
import { registerTools } from "../../tools";
import type { McpServerLike, McpToolResult } from "../../types";

// ─────────────────────────────────────────────────────────────────────────────
// Fake McpServerLike — records registered tools for assertion
// ─────────────────────────────────────────────────────────────────────────────

type ToolRecord = {
  name: string;
  annotations: {
    readOnlyHint?: boolean;
    destructiveHint?: boolean;
  };
  handler: (args: Record<string, unknown>) => Promise<McpToolResult> | McpToolResult;
};

const createFakeServer = (): McpServerLike & { tools: ToolRecord[] } => {
  const tools: ToolRecord[] = [];
  return {
    tools,
    registerTool(name, config, handler) {
      tools.push({ name, annotations: config.annotations ?? {}, handler });
    },
    registerResource(_name, _uri, _config, _cb) {
      /* no-op for tool tests */
    }
  };
};

// ─────────────────────────────────────────────────────────────────────────────
// Fake world / deps — typed to match ToolDeps exactly (Cycle 5 — adds componentByName/has/add/set/remove)
// ─────────────────────────────────────────────────────────────────────────────

/** Typed fake world — casts the generic World methods to their structural equivalents. */
type FakeWorld = {
  spawn: ReturnType<typeof vi.fn>;
  despawn: ReturnType<typeof vi.fn>;
  isAlive: ReturnType<typeof vi.fn>;
  has: ReturnType<typeof vi.fn>;
  add: ReturnType<typeof vi.fn>;
  set: ReturnType<typeof vi.fn>;
  remove: ReturnType<typeof vi.fn>;
  componentByName: ReturnType<typeof vi.fn>;
  liveEntities: ReturnType<typeof vi.fn>;
  entityCount: ReturnType<typeof vi.fn>;
  componentNames: ReturnType<typeof vi.fn>;
  componentsOf: ReturnType<typeof vi.fn>;
} & ToolDeps["world"];

const createFakeWorld = (): FakeWorld =>
  ({
    spawn: vi.fn(() => 42 as unknown as Entity),
    despawn: vi.fn<(entity: Entity) => void>(),
    isAlive: vi.fn(() => true),
    has: vi.fn(() => false),
    add: vi.fn(),
    set: vi.fn(),
    remove: vi.fn(),
    componentByName: vi.fn(() => undefined),
    liveEntities: vi.fn((): readonly Entity[] => []),
    entityCount: vi.fn(() => 0),
    componentNames: vi.fn((): readonly string[] => []),
    componentsOf: vi.fn((_entity: Entity): ReadonlyArray<{ name: string; value: unknown }> => [])
  }) as unknown as FakeWorld;

const createFakeLoop = () => ({
  start: vi.fn(),
  stop: vi.fn(),
  step: vi.fn(() => ({ frame: 1, elapsed: 0.016, dt: 0.016 }))
});

const createFakeScene = () => ({
  load: vi.fn(() => Promise.resolve()),
  unload: vi.fn(),
  currentScene: vi.fn((): string | undefined => undefined),
  sceneNames: vi.fn((): readonly string[] => []),
  ownedEntities: vi.fn((): readonly Entity[] => [])
});

// RendererDep-typed fake — screenshot (extract) + scene tree + attachPrimitive
const createFakeRenderer = (): RendererDep & {
  screenshot: ReturnType<typeof vi.fn>;
  tree: ReturnType<typeof vi.fn>;
  attachPrimitive: ReturnType<typeof vi.fn>;
} => ({
  screenshot: vi.fn(async (): Promise<string | undefined> => undefined),
  tree: vi.fn((): SceneNode | undefined => undefined),
  attachPrimitive: vi.fn((_entity: Entity, _spec: PrimitiveSpec): boolean => true)
});

// InputDep fake — injection methods (typed vi.fn so .toHaveBeenCalledWith works)
const createFakeInput = () => ({
  keyDown: vi.fn<(key: string) => void>(),
  keyUp: vi.fn<(key: string) => void>(),
  keyPress: vi.fn<(key: string) => void>()
});

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

const getToolHandler = (server: ReturnType<typeof createFakeServer>, name: string) => {
  const found = server.tools.find(tool => tool.name === name);
  if (!found) throw new Error(`Tool ${name} not registered`);
  return found.handler;
};

const getToolRecord = (server: ReturnType<typeof createFakeServer>, name: string) => {
  const found = server.tools.find(tool => tool.name === name);
  if (!found) throw new Error(`Tool ${name} not registered`);
  return found;
};

const parseText = (result: McpToolResult): Record<string, unknown> =>
  JSON.parse(result.content[0]?.text ?? "{}") as Record<string, unknown>;

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

describe("registerTools", () => {
  let server: ReturnType<typeof createFakeServer>;
  let world: ReturnType<typeof createFakeWorld>;
  let loop: ReturnType<typeof createFakeLoop>;
  let scene: ReturnType<typeof createFakeScene>;
  let renderer: ReturnType<typeof createFakeRenderer>;
  let input: ReturnType<typeof createFakeInput>;
  let trackedEntities: Set<Entity>;
  let pending: Array<() => void>;
  let enqueueMutation: <T>(fn: () => T) => Promise<T>;
  let emitReset: ReturnType<typeof vi.fn<() => void>>;

  beforeEach(() => {
    server = createFakeServer();
    world = createFakeWorld();
    loop = createFakeLoop();
    scene = createFakeScene();
    renderer = createFakeRenderer();
    input = createFakeInput();
    trackedEntities = new Set<Entity>();
    pending = [];
    emitReset = vi.fn<() => void>();
    enqueueMutation = <T>(fn: () => T): Promise<T> =>
      new Promise(resolve => {
        pending.push(() => {
          resolve(fn());
        });
      });
  });

  // ── Catalog registration ───────────────────────────────────────────────────

  describe("catalog", () => {
    it("registers all 15 tools when enableMutations=true", () => {
      registerTools(
        server,
        { world, loop, scene, renderer, input, trackedEntities, emitReset },
        { enableMutations: true, enqueueMutation }
      );
      const names = server.tools.map(t => t.name);
      for (const expected of [
        "ecs:spawn",
        "ecs:despawn",
        "ecs:setComponent",
        "ecs:removeComponent",
        "ecs:query",
        "input:key",
        "renderer:tree",
        "renderer:attach",
        "loop:step",
        "loop:pause",
        "loop:resume",
        "renderer:screenshot",
        "scene:load",
        "scene:getInfo",
        "game:reset"
      ]) {
        expect(names).toContain(expected);
      }
      expect(server.tools).toHaveLength(15);
    });

    it("registers only read-only tools when enableMutations=false", () => {
      registerTools(
        server,
        { world, loop, scene, renderer, input, trackedEntities, emitReset },
        { enableMutations: false, enqueueMutation }
      );
      const names = server.tools.map(t => t.name);
      // Read-only tools present
      expect(names).toContain("ecs:query");
      expect(names).toContain("renderer:screenshot");
      expect(names).toContain("renderer:tree");
      expect(names).toContain("scene:getInfo");
      expect(names).toHaveLength(4);
      // Mutating / interaction tools absent
      expect(names).not.toContain("ecs:spawn");
      expect(names).not.toContain("input:key");
      expect(names).not.toContain("loop:step");
      expect(names).not.toContain("game:reset");
      expect(names).not.toContain("renderer:attach");
    });

    it("annotates mutating tools with destructiveHint:true", () => {
      registerTools(
        server,
        { world, loop, scene, renderer, input, trackedEntities, emitReset },
        { enableMutations: true, enqueueMutation }
      );
      expect(getToolRecord(server, "ecs:spawn").annotations.destructiveHint).toBe(true);
      expect(getToolRecord(server, "renderer:attach").annotations.destructiveHint).toBe(true);
    });

    it("annotates read-only tools with readOnlyHint:true", () => {
      registerTools(
        server,
        { world, loop, scene, renderer, input, trackedEntities, emitReset },
        { enableMutations: true, enqueueMutation }
      );
      expect(getToolRecord(server, "ecs:query").annotations.readOnlyHint).toBe(true);
      expect(getToolRecord(server, "renderer:tree").annotations.readOnlyHint).toBe(true);
    });
  });

  // ── Frame-safety: mutating ECS tools enqueue, not direct mutation ─────────

  describe("frame-safety (command buffer)", () => {
    beforeEach(() => {
      registerTools(
        server,
        { world, loop, scene, renderer, input, trackedEntities, emitReset },
        { enableMutations: true, enqueueMutation }
      );
    });

    it("ecs:spawn does NOT call world.spawn synchronously", async () => {
      const settled = getToolHandler(server, "ecs:spawn")({});
      expect(world.spawn).not.toHaveBeenCalled();
      for (const fn of pending) fn();
      await settled;
    });

    it("ecs:spawn calls world.spawn after drain runs", async () => {
      const resultPromise = getToolHandler(server, "ecs:spawn")({});
      for (const fn of pending) fn();
      const result = await resultPromise;
      expect(world.spawn).toHaveBeenCalledOnce();
      expect(result.content[0]?.text).toContain("42");
    });

    it("ecs:despawn does NOT call world.despawn synchronously", async () => {
      const settled = getToolHandler(server, "ecs:despawn")({ id: 42 });
      expect(world.despawn).not.toHaveBeenCalled();
      for (const fn of pending) fn();
      await settled;
    });

    it("game:reset does NOT call world.despawn synchronously", async () => {
      const settled = getToolHandler(server, "game:reset")({});
      expect(world.despawn).not.toHaveBeenCalled();
      for (const fn of pending) fn();
      await settled;
    });
  });

  // ── trackedEntities wiring (spawn/despawn/reset still scope to MCP-spawned) ──

  describe("trackedEntities wiring", () => {
    beforeEach(() => {
      registerTools(
        server,
        { world, loop, scene, renderer, input, trackedEntities, emitReset },
        { enableMutations: true, enqueueMutation }
      );
    });

    it("ecs:spawn adds the new entity to trackedEntities after drain", async () => {
      const resultPromise = getToolHandler(server, "ecs:spawn")({});
      for (const fn of pending) fn();
      await resultPromise;
      expect(trackedEntities.size).toBe(1);
      expect([...trackedEntities]).toContain(42 as unknown as Entity);
    });

    it("ecs:despawn removes the entity from trackedEntities after drain", async () => {
      trackedEntities.add(42 as unknown as Entity);
      const resultPromise = getToolHandler(server, "ecs:despawn")({ id: 42 });
      for (const fn of pending) fn();
      await resultPromise;
      expect(trackedEntities.size).toBe(0);
    });

    it("game:reset despawns all tracked entities and clears the set after drain", async () => {
      trackedEntities.add(10 as unknown as Entity);
      trackedEntities.add(20 as unknown as Entity);
      const resultPromise = getToolHandler(server, "game:reset")({});
      for (const fn of pending) fn();
      await resultPromise;
      expect(world.despawn).toHaveBeenCalledTimes(2);
      expect(trackedEntities.size).toBe(0);
      expect(scene.unload).toHaveBeenCalledOnce();
    });
  });

  // ── ecs:query — reads the WHOLE world by component name (Cycle 4) ──────────

  describe("ecs:query (world-wide)", () => {
    beforeEach(() => {
      registerTools(
        server,
        { world, loop, scene, renderer, input, trackedEntities, emitReset },
        { enableMutations: true, enqueueMutation }
      );
    });

    it("returns every live entity with its named components when filter is empty", async () => {
      world.liveEntities.mockReturnValue([1, 2] as unknown as Entity[]);
      world.componentsOf.mockImplementation((entity: Entity) =>
        (entity as unknown as number) === 1 ? [{ name: "Transform", value: { x: 10, y: 5 } }] : []
      );

      const result = await getToolHandler(server, "ecs:query")({ componentNames: [] });
      const parsed = parseText(result) as {
        entities: Array<{ id: number; components: Array<{ name: string; value: unknown }> }>;
        count: number;
      };

      expect(parsed.count).toBe(2);
      const first = parsed.entities.find(e => e.id === 1);
      expect(first?.components).toEqual([{ name: "Transform", value: { x: 10, y: 5 } }]);
      // Does not touch the deferred queue (read-only tool)
      expect(pending).toHaveLength(0);
    });

    it("filters to entities having ALL requested component names", async () => {
      world.componentNames.mockReturnValue(["Transform", "Velocity"]);
      world.liveEntities.mockReturnValue([1, 2, 3] as unknown as Entity[]);
      world.componentsOf.mockImplementation((entity: Entity) => {
        const id = entity as unknown as number;
        if (id === 1) return [{ name: "Transform", value: {} }];
        if (id === 2) {
          return [
            { name: "Transform", value: {} },
            { name: "Velocity", value: {} }
          ];
        }
        return [{ name: "Velocity", value: {} }];
      });

      const both = parseText(
        await getToolHandler(server, "ecs:query")({ componentNames: ["Transform", "Velocity"] })
      ) as { count: number; entities: Array<{ id: number }> };
      expect(both.count).toBe(1);
      expect(both.entities[0]?.id).toBe(2);

      const justTransform = parseText(
        await getToolHandler(server, "ecs:query")({ componentNames: ["Transform"] })
      ) as { count: number };
      expect(justTransform.count).toBe(2);
    });

    it("returns an error listing known names when a requested name is unknown", async () => {
      world.componentNames.mockReturnValue(["Transform"]);
      const result = await getToolHandler(server, "ecs:query")({ componentNames: ["Bogus"] });
      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain("Bogus");
      expect(result.content[0]?.text).toContain("Transform");
    });

    it("treats omitted componentNames as 'all entities'", async () => {
      world.liveEntities.mockReturnValue([7] as unknown as Entity[]);
      const result = await getToolHandler(server, "ecs:query")({});
      expect((parseText(result) as { count: number }).count).toBe(1);
    });
  });

  // ── Loop control: direct calls (NOT enqueued) ─────────────────────────────

  describe("loop control (direct)", () => {
    beforeEach(() => {
      registerTools(
        server,
        { world, loop, scene, renderer, input, trackedEntities, emitReset },
        { enableMutations: true, enqueueMutation }
      );
    });

    it("loop:step calls loop.step() directly and does not enqueue", async () => {
      await getToolHandler(server, "loop:step")({});
      expect(loop.step).toHaveBeenCalledOnce();
      expect(pending).toHaveLength(0);
    });

    it("loop:step echoes frame/elapsed/dt from the step() return value", async () => {
      loop.step.mockReturnValue({ frame: 5, elapsed: 0.08, dt: 0.016 });
      const result = await getToolHandler(server, "loop:step")({});
      const parsed = parseText(result) as {
        stepped: boolean;
        frame: number;
        elapsed: number;
        dt: number;
      };
      expect(parsed.stepped).toBe(true);
      expect(parsed.frame).toBe(5);
      expect(parsed.elapsed).toBeCloseTo(0.08);
      expect(parsed.dt).toBeCloseTo(0.016);
    });

    it("loop:pause calls loop.stop() directly", async () => {
      await getToolHandler(server, "loop:pause")({});
      expect(loop.stop).toHaveBeenCalledOnce();
    });

    it("loop:resume calls loop.start() directly", async () => {
      await getToolHandler(server, "loop:resume")({});
      expect(loop.start).toHaveBeenCalledOnce();
    });
  });

  // ── input:key — injects via the input API directly (not buffered) ─────────

  describe("input:key (direct injection)", () => {
    beforeEach(() => {
      registerTools(
        server,
        { world, loop, scene, renderer, input, trackedEntities, emitReset },
        { enableMutations: true, enqueueMutation }
      );
    });

    it("action 'down' calls input.keyDown with the key and does not enqueue", async () => {
      const result = await getToolHandler(
        server,
        "input:key"
      )({ key: "ArrowRight", action: "down" });
      expect(input.keyDown).toHaveBeenCalledWith("ArrowRight");
      expect(input.keyUp).not.toHaveBeenCalled();
      expect(pending).toHaveLength(0);
      expect(result.content[0]?.text).toContain("ArrowRight");
    });

    it("action 'up' calls input.keyUp", async () => {
      await getToolHandler(server, "input:key")({ key: "ArrowRight", action: "up" });
      expect(input.keyUp).toHaveBeenCalledWith("ArrowRight");
    });

    it("action 'press' calls input.keyPress", async () => {
      await getToolHandler(server, "input:key")({ key: "Space", action: "press" });
      expect(input.keyPress).toHaveBeenCalledWith("Space");
    });
  });

  // ── Read tools: direct API calls ──────────────────────────────────────────

  describe("read tools (direct)", () => {
    beforeEach(() => {
      registerTools(
        server,
        { world, loop, scene, renderer, input, trackedEntities, emitReset },
        { enableMutations: true, enqueueMutation }
      );
    });

    it("renderer:screenshot returns base64 from renderer.screenshot (prefix stripped)", async () => {
      renderer.screenshot.mockResolvedValue("data:image/png;base64,iVBORw0");
      const result = await getToolHandler(server, "renderer:screenshot")({});
      expect(result.content[0]?.text).toContain("iVBORw0");
      expect(result.content[0]?.text).not.toContain("data:image/png");
    });

    it("renderer:screenshot returns not-available (no throw) when headless", async () => {
      renderer.screenshot.mockResolvedValue(undefined);
      const result = await getToolHandler(server, "renderer:screenshot")({});
      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toMatch(/not available|headless|not started/i);
    });

    it("renderer:tree returns the serialized scene graph", async () => {
      renderer.tree.mockReturnValue({
        label: "stage",
        type: "Container",
        x: 0,
        y: 0,
        rotation: 0,
        scaleX: 1,
        scaleY: 1,
        visible: true,
        alpha: 1,
        width: 800,
        height: 600,
        children: []
      } satisfies SceneNode);
      const result = await getToolHandler(server, "renderer:tree")({});
      expect(result.content[0]?.text).toContain("stage");
    });

    it("renderer:tree returns not-available (no throw) when headless", async () => {
      renderer.tree.mockReturnValue(undefined);
      const result = await getToolHandler(server, "renderer:tree")({});
      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toMatch(/not available|headless|not started/i);
    });

    it("scene:getInfo returns current, scenes, and owned", async () => {
      scene.currentScene.mockReturnValue("menu");
      scene.sceneNames.mockReturnValue(["menu", "game"]);
      scene.ownedEntities.mockReturnValue([10, 20] as unknown as Entity[]);
      const result = await getToolHandler(server, "scene:getInfo")({});
      const parsed = parseText(result) as {
        current: string | undefined;
        scenes: readonly string[];
        owned: readonly number[];
      };
      expect(parsed.current).toBe("menu");
      expect(parsed.scenes).toEqual(["menu", "game"]);
      expect(parsed.owned).toEqual([10, 20]);
    });
  });

  // ── scene:load enqueues ────────────────────────────────────────────────────

  describe("scene:load", () => {
    it("scene:load calls scene.load after drain when name is known", async () => {
      scene.sceneNames.mockReturnValue(["level1", "menu"]);
      registerTools(
        server,
        { world, loop, scene, renderer, input, trackedEntities, emitReset },
        { enableMutations: true, enqueueMutation }
      );
      const resultPromise = getToolHandler(server, "scene:load")({ name: "level1" });
      for (const fn of pending) fn();
      await resultPromise;
      expect(scene.load).toHaveBeenCalledWith("level1");
    });

    it("scene:load returns an error and does not enqueue when scene name is unknown", async () => {
      scene.sceneNames.mockReturnValue(["menu", "game"]);
      registerTools(
        server,
        { world, loop, scene, renderer, input, trackedEntities, emitReset },
        { enableMutations: true, enqueueMutation }
      );
      const result = await getToolHandler(server, "scene:load")({ name: "bogus" });
      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain("bogus");
      expect(result.content[0]?.text).toMatch(/menu|game/);
      // Nothing enqueued
      expect(pending).toHaveLength(0);
      expect(scene.load).not.toHaveBeenCalled();
    });
  });

  // ── Cycle 5: ecs:setComponent — real upsert ────────────────────────────────

  describe("ecs:setComponent (Cycle 5 — real upsert)", () => {
    beforeEach(() => {
      registerTools(
        server,
        { world, loop, scene, renderer, input, trackedEntities, emitReset },
        { enableMutations: true, enqueueMutation }
      );
    });

    it("returns an error listing known names when component name is unknown", async () => {
      world.componentNames.mockReturnValue(["Transform", "Velocity"]);
      world.componentByName.mockReturnValue(undefined);
      const result = await getToolHandler(
        server,
        "ecs:setComponent"
      )({
        id: 42,
        component: "Bogus",
        value: { x: 1 }
      });
      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain("Bogus");
      expect(result.content[0]?.text).toMatch(/Transform|Velocity/);
    });

    it("returns an error when entity is not alive", async () => {
      const fakeToken = { __id: 1, __value: {} };
      world.componentByName.mockReturnValue(fakeToken);
      world.isAlive.mockReturnValue(false);
      const result = await getToolHandler(
        server,
        "ecs:setComponent"
      )({
        id: 99,
        component: "Transform",
        value: { x: 5 }
      });
      expect(result.isError).toBe(true);
    });

    it("calls world.set when entity has the component (update path)", async () => {
      const fakeToken = { __id: 1, __value: {} };
      world.componentByName.mockReturnValue(fakeToken);
      world.isAlive.mockReturnValue(true);
      world.has.mockReturnValue(true);
      const resultPromise = getToolHandler(
        server,
        "ecs:setComponent"
      )({
        id: 42,
        component: "Transform",
        value: { x: 10 }
      });
      for (const fn of pending) fn();
      const result = await resultPromise;
      expect(world.set).toHaveBeenCalledWith(42 as unknown as Entity, fakeToken, { x: 10 });
      expect(world.add).not.toHaveBeenCalled();
      const parsed = parseText(result) as { id: number; component: string; changed: boolean };
      expect(parsed.changed).toBe(true);
      expect(parsed.id).toBe(42);
      expect(parsed.component).toBe("Transform");
    });

    it("calls world.add when entity does not have the component (add path)", async () => {
      const fakeToken = { __id: 1, __value: {} };
      world.componentByName.mockReturnValue(fakeToken);
      world.isAlive.mockReturnValue(true);
      world.has.mockReturnValue(false);
      const resultPromise = getToolHandler(
        server,
        "ecs:setComponent"
      )({
        id: 42,
        component: "Transform",
        value: { x: 5 }
      });
      for (const fn of pending) fn();
      const result = await resultPromise;
      expect(world.add).toHaveBeenCalledWith(42 as unknown as Entity, fakeToken, { x: 5 });
      expect(world.set).not.toHaveBeenCalled();
      const parsed = parseText(result) as { changed: boolean };
      expect(parsed.changed).toBe(true);
    });

    it("does not include status:v1-noop in the result", async () => {
      const fakeToken = { __id: 1, __value: {} };
      world.componentByName.mockReturnValue(fakeToken);
      world.isAlive.mockReturnValue(true);
      world.has.mockReturnValue(true);
      const resultPromise = getToolHandler(
        server,
        "ecs:setComponent"
      )({
        id: 42,
        component: "Transform",
        value: {}
      });
      for (const fn of pending) fn();
      const result = await resultPromise;
      expect(result.content[0]?.text).not.toContain("v1-noop");
    });
  });

  // ── Cycle 5: ecs:removeComponent — real remove ────────────────────────────

  describe("ecs:removeComponent (Cycle 5 — real remove)", () => {
    beforeEach(() => {
      registerTools(
        server,
        { world, loop, scene, renderer, input, trackedEntities, emitReset },
        { enableMutations: true, enqueueMutation }
      );
    });

    it("returns an error when component name is unknown", async () => {
      world.componentNames.mockReturnValue(["Transform"]);
      world.componentByName.mockReturnValue(undefined);
      const result = await getToolHandler(
        server,
        "ecs:removeComponent"
      )({
        id: 42,
        component: "Bogus"
      });
      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain("Bogus");
    });

    it("returns an error when entity is not alive", async () => {
      const fakeToken = { __id: 1, __value: {} };
      world.componentByName.mockReturnValue(fakeToken);
      world.isAlive.mockReturnValue(false);
      const result = await getToolHandler(
        server,
        "ecs:removeComponent"
      )({
        id: 99,
        component: "Transform"
      });
      expect(result.isError).toBe(true);
    });

    it("returns changed:false when entity does not have the component", async () => {
      const fakeToken = { __id: 1, __value: {} };
      world.componentByName.mockReturnValue(fakeToken);
      world.isAlive.mockReturnValue(true);
      world.has.mockReturnValue(false);
      const resultPromise = getToolHandler(
        server,
        "ecs:removeComponent"
      )({
        id: 42,
        component: "Transform"
      });
      for (const fn of pending) fn();
      const result = await resultPromise;
      const parsed = parseText(result) as { changed: boolean };
      expect(parsed.changed).toBe(false);
      expect(world.remove).not.toHaveBeenCalled();
    });

    it("calls world.remove and returns changed:true when entity has the component", async () => {
      const fakeToken = { __id: 1, __value: {} };
      world.componentByName.mockReturnValue(fakeToken);
      world.isAlive.mockReturnValue(true);
      world.has.mockReturnValue(true);
      const resultPromise = getToolHandler(
        server,
        "ecs:removeComponent"
      )({
        id: 42,
        component: "Transform"
      });
      for (const fn of pending) fn();
      const result = await resultPromise;
      expect(world.remove).toHaveBeenCalledWith(42 as unknown as Entity, fakeToken);
      const parsed = parseText(result) as { changed: boolean };
      expect(parsed.changed).toBe(true);
    });

    it("does not include status:v1-noop in the result", async () => {
      const fakeToken = { __id: 1, __value: {} };
      world.componentByName.mockReturnValue(fakeToken);
      world.isAlive.mockReturnValue(true);
      world.has.mockReturnValue(true);
      const resultPromise = getToolHandler(
        server,
        "ecs:removeComponent"
      )({
        id: 42,
        component: "Transform"
      });
      for (const fn of pending) fn();
      const result = await resultPromise;
      expect(result.content[0]?.text).not.toContain("v1-noop");
    });
  });

  // ── Cycle 5: ecs:spawn with optional components map ──────────────────────

  describe("ecs:spawn with components map (Cycle 5)", () => {
    beforeEach(() => {
      registerTools(
        server,
        { world, loop, scene, renderer, input, trackedEntities, emitReset },
        { enableMutations: true, enqueueMutation }
      );
    });

    it("bare spawn (no components) still returns { entity } and tracks", async () => {
      const resultPromise = getToolHandler(server, "ecs:spawn")({});
      for (const fn of pending) fn();
      const result = await resultPromise;
      const parsed = parseText(result) as { entity: number };
      expect(parsed.entity).toBe(42);
      expect(trackedEntities.size).toBe(1);
    });

    it("rejects all unknown names before spawning — spawn NOT called", async () => {
      world.componentNames.mockReturnValue(["Transform"]);
      world.componentByName.mockReturnValue(undefined);
      const result = await getToolHandler(
        server,
        "ecs:spawn"
      )({
        components: { Bogus: { x: 1 } }
      });
      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain("Bogus");
      expect(world.spawn).not.toHaveBeenCalled();
    });

    it("calls spawn then add for each component in the map", async () => {
      const transformToken = { __id: 1, __value: {} };
      world.componentNames.mockReturnValue(["Transform"]);
      world.componentByName.mockImplementation((name: string) =>
        name === "Transform" ? transformToken : undefined
      );
      world.isAlive.mockReturnValue(true);
      const resultPromise = getToolHandler(
        server,
        "ecs:spawn"
      )({
        components: { Transform: { x: 10, y: 5 } }
      });
      for (const fn of pending) fn();
      const result = await resultPromise;
      expect(world.spawn).toHaveBeenCalledOnce();
      expect(world.add).toHaveBeenCalledWith(42 as unknown as Entity, transformToken, {
        x: 10,
        y: 5
      });
      const parsed = parseText(result) as { entity: number; components: string[] };
      expect(parsed.entity).toBe(42);
      expect(parsed.components).toEqual(["Transform"]);
    });
  });

  // ── Cycle 5: renderer:attach ───────────────────────────────────────────────

  describe("renderer:attach (Cycle 5)", () => {
    beforeEach(() => {
      registerTools(
        server,
        { world, loop, scene, renderer, input, trackedEntities, emitReset },
        { enableMutations: true, enqueueMutation }
      );
    });

    it("returns an error when entity is not alive (before enqueue)", async () => {
      world.isAlive.mockReturnValue(false);
      const result = await getToolHandler(
        server,
        "renderer:attach"
      )({
        id: 99,
        spec: { shape: "rect", width: 10, height: 10 }
      });
      expect(result.isError).toBe(true);
      expect(renderer.attachPrimitive).not.toHaveBeenCalled();
    });

    it("calls renderer.attachPrimitive inside mutation and returns attached:true", async () => {
      world.isAlive.mockReturnValue(true);
      renderer.attachPrimitive.mockReturnValue(true);
      const resultPromise = getToolHandler(
        server,
        "renderer:attach"
      )({
        id: 42,
        spec: { shape: "circle", radius: 5, fill: 0xff_00_00 }
      });
      for (const fn of pending) fn();
      const result = await resultPromise;
      expect(renderer.attachPrimitive).toHaveBeenCalledWith(42 as unknown as Entity, {
        shape: "circle",
        radius: 5,
        fill: 0xff_00_00
      });
      const parsed = parseText(result) as { id: number; attached: boolean };
      expect(parsed.attached).toBe(true);
      expect(parsed.id).toBe(42);
    });

    it("returns an error when attachPrimitive returns false (headless/not-started)", async () => {
      world.isAlive.mockReturnValue(true);
      renderer.attachPrimitive.mockReturnValue(false);
      const resultPromise = getToolHandler(
        server,
        "renderer:attach"
      )({
        id: 42,
        spec: { shape: "rect", width: 20, height: 10 }
      });
      for (const fn of pending) fn();
      const result = await resultPromise;
      expect(result.isError).toBe(true);
    });
  });

  // ── Cycle 5: honest results ────────────────────────────────────────────────

  describe("honest results (Cycle 5)", () => {
    beforeEach(() => {
      registerTools(
        server,
        { world, loop, scene, renderer, input, trackedEntities, emitReset },
        { enableMutations: true, enqueueMutation }
      );
    });

    it("ecs:despawn returns changed:false when entity was not alive", async () => {
      world.isAlive.mockReturnValue(false);
      const resultPromise = getToolHandler(server, "ecs:despawn")({ id: 999 });
      for (const fn of pending) fn();
      const result = await resultPromise;
      const parsed = parseText(result) as { despawned: number; changed: boolean };
      expect(parsed.changed).toBe(false);
      expect(parsed.despawned).toBe(999);
    });

    it("ecs:despawn returns changed:true when entity was alive", async () => {
      world.isAlive.mockReturnValue(true);
      const resultPromise = getToolHandler(server, "ecs:despawn")({ id: 42 });
      for (const fn of pending) fn();
      const result = await resultPromise;
      const parsed = parseText(result) as { despawned: number; changed: boolean };
      expect(parsed.changed).toBe(true);
      expect(world.despawn).toHaveBeenCalledOnce();
    });

    it("game:reset calls emitReset after despawning and unloading", async () => {
      trackedEntities.add(10 as unknown as Entity);
      const resultPromise = getToolHandler(server, "game:reset")({});
      for (const fn of pending) fn();
      await resultPromise;
      expect(emitReset).toHaveBeenCalledOnce();
      expect(scene.unload).toHaveBeenCalledBefore(emitReset);
    });
  });
});
