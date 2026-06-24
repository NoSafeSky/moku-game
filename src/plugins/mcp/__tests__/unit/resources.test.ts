/**
 * @file mcp plugin — unit tests for resources.ts
 *
 * Tests that each resource read callback serializes runtime state correctly.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Entity } from "../../../ecs/types";
import { registerResources } from "../../resources";
import type { McpResourceResult, McpServerLike } from "../../types";

// ─────────────────────────────────────────────────────────────────────────────
// Fake McpServerLike — records registered resources
// ─────────────────────────────────────────────────────────────────────────────

type ResourceRecord = {
  name: string;
  uri: string;
  readCallback: (uri: URL) => Promise<McpResourceResult> | McpResourceResult;
};

const createFakeServer = (): McpServerLike & { resources: ResourceRecord[] } => {
  const resources: ResourceRecord[] = [];
  return {
    resources,
    registerTool(_name, _config, _handler) {
      /* no-op for resource tests */
    },
    registerResource(name, uri, _config, readCallback) {
      resources.push({ name, uri, readCallback });
    }
  };
};

// ─────────────────────────────────────────────────────────────────────────────
// Fake deps
// ─────────────────────────────────────────────────────────────────────────────

const createFakeScene = () => ({
  define: vi.fn(),
  load: vi.fn(() => Promise.resolve()),
  unload: vi.fn(),
  currentScene: vi.fn(() => undefined as string | undefined)
});

const createFakeScheduler = () => ({
  stages: ["input", "update", "physics", "sync", "render"] as const,
  addSystem: vi.fn(() => vi.fn()),
  tick: vi.fn()
});

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

const getResourceCallback = (server: ReturnType<typeof createFakeServer>, name: string) => {
  const found = server.resources.find(r => r.name === name);
  if (!found) throw new Error(`Resource ${name} not registered`);
  return found.readCallback;
};

const fakeUrl = (uri: string) => new URL(uri);

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

describe("registerResources", () => {
  let server: ReturnType<typeof createFakeServer>;
  let scene: ReturnType<typeof createFakeScene>;
  let scheduler: ReturnType<typeof createFakeScheduler>;
  let trackedEntities: Set<Entity>;
  let getStats: () => { frame: number; lastDt: number; entityCount: number };

  beforeEach(() => {
    server = createFakeServer();
    scene = createFakeScene();
    scheduler = createFakeScheduler();
    trackedEntities = new Set();
    getStats = () => ({ frame: 0, lastDt: 0, entityCount: 0 });
  });

  // ── Catalog ────────────────────────────────────────────────────────────────

  describe("catalog", () => {
    it("registers all 4 resources", () => {
      registerResources(server, { scene, scheduler, trackedEntities, getStats });
      expect(server.resources).toHaveLength(4);
      const uris = server.resources.map(r => r.uri);
      expect(uris).toContain("game://world/snapshot");
      expect(uris).toContain("game://systems/list");
      expect(uris).toContain("game://stats/frame");
      expect(uris).toContain("game://scene/current");
    });
  });

  // ── game://stats/frame ────────────────────────────────────────────────────

  describe("game://stats/frame", () => {
    it("returns frame stats as JSON text", async () => {
      getStats = () => ({ frame: 42, lastDt: 0.016, entityCount: 5 });
      registerResources(server, { scene, scheduler, trackedEntities, getStats });
      const callback = getResourceCallback(server, "stats:frame");
      const result = await callback(fakeUrl("game://stats/frame"));
      expect(result.contents[0]?.text).toContain("42");
      expect(result.contents[0]?.text).toContain("0.016");
      expect(result.contents[0]?.text).toContain("5");
    });
  });

  // ── game://scene/current ──────────────────────────────────────────────────

  describe("game://scene/current", () => {
    it("returns current scene name when loaded", async () => {
      scene.currentScene.mockReturnValue("level1");
      registerResources(server, { scene, scheduler, trackedEntities, getStats });
      const callback = getResourceCallback(server, "scene:current");
      const result = await callback(fakeUrl("game://scene/current"));
      expect(result.contents[0]?.text).toContain("level1");
    });

    it("returns null/undefined indicator when no scene loaded", async () => {
      scene.currentScene.mockReturnValue(undefined);
      registerResources(server, { scene, scheduler, trackedEntities, getStats });
      const callback = getResourceCallback(server, "scene:current");
      const result = await callback(fakeUrl("game://scene/current"));
      expect(result.contents[0]?.text).toBeDefined();
    });
  });

  // ── game://systems/list ───────────────────────────────────────────────────

  describe("game://systems/list", () => {
    it("returns stage list from scheduler", async () => {
      registerResources(server, { scene, scheduler, trackedEntities, getStats });
      const callback = getResourceCallback(server, "systems:list");
      const result = await callback(fakeUrl("game://systems/list"));
      expect(result.contents[0]?.text).toContain("input");
      expect(result.contents[0]?.text).toContain("update");
    });
  });

  // ── game://world/snapshot ─────────────────────────────────────────────────

  describe("game://world/snapshot", () => {
    it("returns tracked entity ids as JSON", async () => {
      trackedEntities.add(10 as unknown as Entity);
      trackedEntities.add(20 as unknown as Entity);
      registerResources(server, { scene, scheduler, trackedEntities, getStats });
      const callback = getResourceCallback(server, "world:snapshot");
      const result = await callback(fakeUrl("game://world/snapshot"));
      expect(result.contents[0]?.text).toContain("10");
      expect(result.contents[0]?.text).toContain("20");
    });

    it("returns empty list when no tracked entities", async () => {
      registerResources(server, { scene, scheduler, trackedEntities, getStats });
      const callback = getResourceCallback(server, "world:snapshot");
      const result = await callback(fakeUrl("game://world/snapshot"));
      expect(result.contents[0]?.text).toBeDefined();
    });
  });
});
