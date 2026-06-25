/**
 * @file mcp plugin — unit tests for tools.ts
 *
 * Tests that:
 * - Each tool maps inputs → right dep call
 * - Mutating tools enqueue (spy on world.spawn → not called until drain runs, then called)
 * - ecs:query / resources serialize correctly
 * - enableMutations:false registers only read-only tools
 * - toolNames() matches the catalog
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Entity } from "../../../ecs/types";
import type { CanvasLike, RendererDep } from "../../tools";
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
// Fake world / deps — typed to match ToolDeps exactly
// ─────────────────────────────────────────────────────────────────────────────

const createFakeWorld = () => ({
  spawn: vi.fn(() => 42 as unknown as Entity),
  despawn: vi.fn<(entity: Entity) => void>(),
  isAlive: vi.fn(() => true)
});

const createFakeLoop = () => ({
  start: vi.fn(),
  stop: vi.fn(),
  step: vi.fn()
});

const createFakeScene = () => ({
  load: vi.fn(() => Promise.resolve()),
  unload: vi.fn(),
  currentScene: vi.fn((): string | undefined => undefined)
});

// RendererDep-typed fake — only getView() is needed
const createFakeRenderer = (): RendererDep & { getView: ReturnType<typeof vi.fn> } => {
  const getView = vi.fn((): CanvasLike | undefined => undefined);
  return { getView };
};

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

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

describe("registerTools", () => {
  let server: ReturnType<typeof createFakeServer>;
  let world: ReturnType<typeof createFakeWorld>;
  let loop: ReturnType<typeof createFakeLoop>;
  let scene: ReturnType<typeof createFakeScene>;
  let renderer: ReturnType<typeof createFakeRenderer>;
  let trackedEntities: Set<Entity>;
  let pending: Array<() => void>;
  let enqueueMutation: <T>(fn: () => T) => Promise<T>;

  beforeEach(() => {
    server = createFakeServer();
    world = createFakeWorld();
    loop = createFakeLoop();
    scene = createFakeScene();
    renderer = createFakeRenderer();
    trackedEntities = new Set<Entity>();
    pending = [];
    enqueueMutation = <T>(fn: () => T): Promise<T> =>
      new Promise(resolve => {
        pending.push(() => {
          resolve(fn());
        });
      });
  });

  // ── Catalog registration ───────────────────────────────────────────────────

  describe("catalog", () => {
    it("registers all 12 tools when enableMutations=true", () => {
      registerTools(
        server,
        { world, loop, scene, renderer, trackedEntities },
        { enableMutations: true, enqueueMutation }
      );
      const names = server.tools.map(t => t.name);
      expect(names).toContain("ecs:spawn");
      expect(names).toContain("ecs:despawn");
      expect(names).toContain("ecs:setComponent");
      expect(names).toContain("ecs:removeComponent");
      expect(names).toContain("ecs:query");
      expect(names).toContain("loop:step");
      expect(names).toContain("loop:pause");
      expect(names).toContain("loop:resume");
      expect(names).toContain("renderer:screenshot");
      expect(names).toContain("scene:load");
      expect(names).toContain("scene:getInfo");
      expect(names).toContain("game:reset");
      expect(server.tools).toHaveLength(12);
    });

    it("registers only read-only tools when enableMutations=false", () => {
      registerTools(
        server,
        { world, loop, scene, renderer, trackedEntities },
        { enableMutations: false, enqueueMutation }
      );
      const names = server.tools.map(t => t.name);
      // Read-only tools should be present
      expect(names).toContain("ecs:query");
      expect(names).toContain("renderer:screenshot");
      expect(names).toContain("scene:getInfo");
      // Mutating tools must not be registered
      expect(names).not.toContain("ecs:spawn");
      expect(names).not.toContain("ecs:despawn");
      expect(names).not.toContain("ecs:setComponent");
      expect(names).not.toContain("ecs:removeComponent");
      expect(names).not.toContain("loop:step");
      expect(names).not.toContain("loop:pause");
      expect(names).not.toContain("loop:resume");
      expect(names).not.toContain("scene:load");
      expect(names).not.toContain("game:reset");
    });

    it("annotates mutating tools with destructiveHint:true", () => {
      registerTools(
        server,
        { world, loop, scene, renderer, trackedEntities },
        { enableMutations: true, enqueueMutation }
      );
      const spawnRecord = getToolRecord(server, "ecs:spawn");
      expect(spawnRecord.annotations.destructiveHint).toBe(true);
    });

    it("annotates read-only tools with readOnlyHint:true", () => {
      registerTools(
        server,
        { world, loop, scene, renderer, trackedEntities },
        { enableMutations: true, enqueueMutation }
      );
      const queryRecord = getToolRecord(server, "ecs:query");
      expect(queryRecord.annotations.readOnlyHint).toBe(true);
    });
  });

  // ── Frame-safety: mutating tools enqueue, not direct mutation ─────────────

  describe("frame-safety (command buffer)", () => {
    it("ecs:spawn does NOT call world.spawn synchronously", async () => {
      registerTools(
        server,
        { world, loop, scene, renderer, trackedEntities },
        { enableMutations: true, enqueueMutation }
      );
      const handler = getToolHandler(server, "ecs:spawn");
      // Fire the handler but do NOT drain the queue
      void handler({});
      expect(world.spawn).not.toHaveBeenCalled();
    });

    it("ecs:spawn calls world.spawn after drain runs", async () => {
      registerTools(
        server,
        { world, loop, scene, renderer, trackedEntities },
        { enableMutations: true, enqueueMutation }
      );
      const handler = getToolHandler(server, "ecs:spawn");
      const resultPromise = handler({});
      // Drain the queue
      for (const fn of pending) fn();
      const result = await resultPromise;
      expect(world.spawn).toHaveBeenCalledOnce();
      expect(result.content[0]?.text).toContain("42");
    });

    it("ecs:despawn does NOT call world.despawn synchronously", async () => {
      registerTools(
        server,
        { world, loop, scene, renderer, trackedEntities },
        { enableMutations: true, enqueueMutation }
      );
      const handler = getToolHandler(server, "ecs:despawn");
      void handler({ id: 42 });
      expect(world.despawn).not.toHaveBeenCalled();
    });

    it("ecs:despawn calls world.despawn after drain", async () => {
      registerTools(
        server,
        { world, loop, scene, renderer, trackedEntities },
        { enableMutations: true, enqueueMutation }
      );
      const handler = getToolHandler(server, "ecs:despawn");
      const resultPromise = handler({ id: 42 });
      for (const fn of pending) fn();
      await resultPromise;
      expect(world.despawn).toHaveBeenCalledOnce();
    });

    it("game:reset does NOT call world.despawn synchronously", async () => {
      registerTools(
        server,
        { world, loop, scene, renderer, trackedEntities },
        { enableMutations: true, enqueueMutation }
      );
      const handler = getToolHandler(server, "game:reset");
      void handler({});
      expect(world.despawn).not.toHaveBeenCalled();
    });
  });

  // ── trackedEntities wiring ────────────────────────────────────────────────

  describe("trackedEntities wiring", () => {
    it("ecs:spawn adds the new entity to trackedEntities after drain", async () => {
      registerTools(
        server,
        { world, loop, scene, renderer, trackedEntities },
        { enableMutations: true, enqueueMutation }
      );
      const handler = getToolHandler(server, "ecs:spawn");
      const resultPromise = handler({});
      for (const fn of pending) fn();
      await resultPromise;
      expect(trackedEntities.size).toBe(1);
      expect([...trackedEntities]).toContain(42 as unknown as Entity);
    });

    it("ecs:query returns tracked entity ids and count", async () => {
      // Pre-seed two entities
      const e1 = 1 as unknown as Entity;
      const e2 = 2 as unknown as Entity;
      trackedEntities.add(e1);
      trackedEntities.add(e2);
      registerTools(
        server,
        { world, loop, scene, renderer, trackedEntities },
        { enableMutations: true, enqueueMutation }
      );
      const handler = getToolHandler(server, "ecs:query");
      const result = await handler({ componentNames: [] });
      const parsed = JSON.parse(result.content[0]?.text ?? "{}") as {
        entities: number[];
        count: number;
      };
      expect(parsed.count).toBe(2);
      expect(parsed.entities).toContain(1);
      expect(parsed.entities).toContain(2);
    });

    it("ecs:despawn removes the entity from trackedEntities after drain", async () => {
      const entity = 42 as unknown as Entity;
      trackedEntities.add(entity);
      registerTools(
        server,
        { world, loop, scene, renderer, trackedEntities },
        { enableMutations: true, enqueueMutation }
      );
      const handler = getToolHandler(server, "ecs:despawn");
      const resultPromise = handler({ id: 42 });
      for (const fn of pending) fn();
      await resultPromise;
      expect(trackedEntities.size).toBe(0);
    });

    it("game:reset despawns all tracked entities and clears the set after drain", async () => {
      const e1 = 10 as unknown as Entity;
      const e2 = 20 as unknown as Entity;
      trackedEntities.add(e1);
      trackedEntities.add(e2);
      registerTools(
        server,
        { world, loop, scene, renderer, trackedEntities },
        { enableMutations: true, enqueueMutation }
      );
      const handler = getToolHandler(server, "game:reset");
      const resultPromise = handler({});
      for (const fn of pending) fn();
      await resultPromise;
      expect(world.despawn).toHaveBeenCalledTimes(2);
      expect(trackedEntities.size).toBe(0);
      expect(scene.unload).toHaveBeenCalledOnce();
    });
  });

  // ── Loop control: direct calls (NOT enqueued) ─────────────────────────────

  describe("loop control (direct)", () => {
    it("loop:step calls loop.step() directly", async () => {
      registerTools(
        server,
        { world, loop, scene, renderer, trackedEntities },
        { enableMutations: true, enqueueMutation }
      );
      const handler = getToolHandler(server, "loop:step");
      await handler({});
      expect(loop.step).toHaveBeenCalledOnce();
      // pending queue should be empty (not enqueued)
      expect(pending).toHaveLength(0);
    });

    it("loop:pause calls loop.stop() directly", async () => {
      registerTools(
        server,
        { world, loop, scene, renderer, trackedEntities },
        { enableMutations: true, enqueueMutation }
      );
      const handler = getToolHandler(server, "loop:pause");
      await handler({});
      expect(loop.stop).toHaveBeenCalledOnce();
      expect(pending).toHaveLength(0);
    });

    it("loop:resume calls loop.start() directly", async () => {
      registerTools(
        server,
        { world, loop, scene, renderer, trackedEntities },
        { enableMutations: true, enqueueMutation }
      );
      const handler = getToolHandler(server, "loop:resume");
      await handler({});
      expect(loop.start).toHaveBeenCalledOnce();
      expect(pending).toHaveLength(0);
    });
  });

  // ── Read tools: direct API calls ──────────────────────────────────────────

  describe("read tools (direct)", () => {
    it("ecs:query returns a result without accessing pending queue", async () => {
      registerTools(
        server,
        { world, loop, scene, renderer, trackedEntities },
        { enableMutations: true, enqueueMutation }
      );
      const handler = getToolHandler(server, "ecs:query");
      const result = await handler({ componentNames: [] });
      expect(result.content[0]?.text).toBeDefined();
      // Should not be in pending queue
      expect(pending).toHaveLength(0);
    });

    it("renderer:screenshot returns base64 from canvas.toDataURL", async () => {
      const mockCanvas: CanvasLike = { toDataURL: vi.fn(() => "data:image/png;base64,iVBORw0") };
      renderer.getView.mockReturnValue(mockCanvas);
      registerTools(
        server,
        { world, loop, scene, renderer, trackedEntities },
        { enableMutations: true, enqueueMutation }
      );
      const handler = getToolHandler(server, "renderer:screenshot");
      const result = await handler({});
      expect(result.content[0]?.text).toContain("iVBORw0");
    });

    it("renderer:screenshot returns error when canvas not available", async () => {
      renderer.getView.mockReturnValue(undefined);
      registerTools(
        server,
        { world, loop, scene, renderer, trackedEntities },
        { enableMutations: true, enqueueMutation }
      );
      const handler = getToolHandler(server, "renderer:screenshot");
      const result = await handler({});
      expect(result.isError).toBe(true);
    });

    it("renderer:screenshot with a HEADLESS renderer returns not-available and does NOT throw", async () => {
      // Headless renderer: getView() returns undefined (renderer spec). The tool
      // must tolerate the missing view and return an error result, never throw.
      renderer.getView.mockReturnValue(undefined);
      registerTools(
        server,
        { world, loop, scene, renderer, trackedEntities },
        { enableMutations: true, enqueueMutation }
      );
      const handler = getToolHandler(server, "renderer:screenshot");

      const result = await handler({});

      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toMatch(/no canvas|not started|not available|headless/i);
      // The view was probed (proves the headless branch was exercised)
      expect(renderer.getView).toHaveBeenCalled();
    });

    it("scene:getInfo returns current scene", async () => {
      scene.currentScene.mockReturnValue("menu");
      registerTools(
        server,
        { world, loop, scene, renderer, trackedEntities },
        { enableMutations: true, enqueueMutation }
      );
      const handler = getToolHandler(server, "scene:getInfo");
      const result = await handler({});
      expect(result.content[0]?.text).toContain("menu");
    });
  });

  // ── scene:load enqueues ────────────────────────────────────────────────────

  describe("scene:load", () => {
    it("scene:load calls scene.load after drain", async () => {
      registerTools(
        server,
        { world, loop, scene, renderer, trackedEntities },
        { enableMutations: true, enqueueMutation }
      );
      const handler = getToolHandler(server, "scene:load");
      const resultPromise = handler({ name: "level1" });
      for (const fn of pending) fn();
      await resultPromise;
      expect(scene.load).toHaveBeenCalledWith("level1");
    });
  });
});
