/**
 * @file mcp plugin — tool registration.
 *
 * Registers the MCP tool catalog on a structural McpServerLike. All mutating
 * ECS tools route through an `enqueueMutation` closure (frame-safety); loop
 * controls call their APIs directly between frames. zod is imported here for
 * input schema shapes (it is a schema lib, not the SDK — allowed by the seam rule).
 *
 * v1 limitation: entityCount and world snapshot reflect only MCP-spawned entities
 * (tracked in the `trackedEntities` Set). The ECS public API has no enumerate-all.
 */
import { z } from "zod";
import type { Entity, World } from "../ecs/types";
import type { Api as LoopApi } from "../loop/types";
import type { Api as SceneApi } from "../scene/types";
import type { McpServerLike, McpToolResult } from "./types";

// ─────────────────────────────────────────────────────────────────────────────
// Structural canvas type (avoids relying on HTMLCanvasElement from DOM lib)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Structural view of a canvas-like element exposing only what the screenshot
 * tool needs. Using a structural type keeps tools.ts free of DOM lib dependency.
 */
export type CanvasLike = {
  /** Returns a data URL for the image in the canvas (e.g. "data:image/png;base64,..."). */
  toDataURL(type?: string): string;
};

// ─────────────────────────────────────────────────────────────────────────────
// Structural renderer dep (only what tools.ts uses)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Structural renderer dependency — only the getView method is needed.
 * Uses CanvasLike rather than HTMLCanvasElement to stay DOM-lib-free.
 */
export type RendererDep = {
  /** Returns the canvas-like element, or undefined before start. */
  getView(): CanvasLike | undefined;
};

// ─────────────────────────────────────────────────────────────────────────────
// Deps type (structural — only what tools.ts actually touches)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Runtime dependencies passed to registerTools from lifecycle.ts.
 */
export type ToolDeps = {
  /** The ECS world facade. */
  world: Pick<World, "spawn" | "despawn" | "isAlive">;
  /** The loop plugin API (step / start / stop). */
  loop: Pick<LoopApi, "step" | "start" | "stop">;
  /** The scene plugin API (load / unload / currentScene). */
  scene: Pick<SceneApi, "load" | "unload" | "currentScene">;
  /** Renderer dep exposing getView for screenshot. */
  renderer: RendererDep;
  /**
   * Mutable set of MCP-tracked entities.
   * Shared with resources.ts (same Set instance) so world/snapshot stays consistent.
   * v1: only entities spawned via ecs:spawn MCP tool appear here.
   */
  trackedEntities: Set<Entity>;
};

/**
 * Options controlling which tools are registered.
 */
export type ToolOptions = {
  /** Whether to register mutating tools. */
  enableMutations: boolean;
  /** Enqueue a mutation closure to be drained on the next input-stage tick. */
  enqueueMutation: <T>(fn: () => T) => Promise<T>;
};

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Wraps a JSON-serialisable value in a CallToolResult text content array.
 *
 * @param value - Any JSON-serialisable value.
 * @returns A tool result with a single text content item.
 * @example
 * ```ts
 * return textResult({ entity: 42 });
 * ```
 */
const textResult = (value: unknown): McpToolResult => ({
  content: [{ type: "text", text: JSON.stringify(value) }]
});

/**
 * Wraps an error message in a tool result with isError:true.
 *
 * @param message - Human-readable error description.
 * @returns A tool error result.
 * @example
 * ```ts
 * return errorResult("renderer not started");
 * ```
 */
const errorResult = (message: string): McpToolResult => ({
  content: [{ type: "text", text: message }],
  isError: true
});

// ─────────────────────────────────────────────────────────────────────────────
// Annotations constants
// ─────────────────────────────────────────────────────────────────────────────

const READ_ONLY_ANNOTATIONS = { readOnlyHint: true } as const;
const DESTRUCTIVE_ANNOTATIONS = { destructiveHint: true } as const;

// ─────────────────────────────────────────────────────────────────────────────
// Tool registration
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Registers the MCP tool catalog on the server.
 *
 * Mutating tools (ecs:spawn, ecs:despawn, ecs:setComponent, ecs:removeComponent,
 * scene:load, game:reset) enqueue closures via `enqueueMutation` so mutations
 * are applied on the next input-stage tick (frame-safe). Loop controls (loop:step,
 * loop:pause, loop:resume) call their APIs directly between frames. Read-only tools
 * (ecs:query, renderer:screenshot, scene:getInfo) call their APIs directly.
 *
 * @param server - The structural MCP server to register tools on.
 * @param deps - Runtime plugin APIs the tools delegate to.
 * @param opts - Options controlling mutation enablement and the enqueue function.
 * @example
 * ```ts
 * registerTools(server, { world, loop, scene, renderer }, { enableMutations: true, enqueueMutation });
 * ```
 */
export const registerTools = (server: McpServerLike, deps: ToolDeps, opts: ToolOptions): void => {
  const { world, loop, scene, renderer, trackedEntities } = deps;
  const { enableMutations, enqueueMutation } = opts;

  // ── Read-only tools (always registered) ───────────────────────────────────

  server.registerTool(
    "ecs:query",
    {
      description:
        "Query MCP-tracked entities. v1: componentNames filter is ignored — returns all MCP-spawned entity ids and count.",
      inputSchema: {
        componentNames: z
          .array(z.string())
          .describe(
            "Component names to match (ignored in v1 — filter not implementable without component tokens)."
          )
      },
      annotations: READ_ONLY_ANNOTATIONS
    },
    async (_args: Record<string, unknown>): Promise<McpToolResult> => {
      const entities = [...trackedEntities].map(entity => entity as number);
      return textResult({ entities, count: trackedEntities.size });
    }
  );

  server.registerTool(
    "renderer:screenshot",
    {
      description: "Return the current frame as a base64 PNG (strips the data: URI prefix).",
      inputSchema: {},
      annotations: READ_ONLY_ANNOTATIONS
    },
    async (_args: Record<string, unknown>): Promise<McpToolResult> => {
      const canvas = renderer.getView();
      if (!canvas) {
        return errorResult("renderer not started — no canvas available");
      }
      const dataUrl = canvas.toDataURL("image/png");
      // Strip 'data:image/png;base64,' prefix so callers receive raw base64
      const base64 = dataUrl.replace(/^data:[^;]+;base64,/, "");
      return textResult({ base64, mimeType: "image/png" });
    }
  );

  server.registerTool(
    "scene:getInfo",
    {
      description: "Return the current scene name.",
      inputSchema: {},
      annotations: READ_ONLY_ANNOTATIONS
    },
    async (_args: Record<string, unknown>): Promise<McpToolResult> => {
      const current = scene.currentScene();
      return textResult({ current: current ?? undefined });
    }
  );

  if (!enableMutations) return;

  // ── Mutating tools (registered only when enableMutations=true) ────────────

  server.registerTool(
    "ecs:spawn",
    {
      description: "Spawn an entity with no components. Returns the new entity id.",
      inputSchema: {},
      annotations: DESTRUCTIVE_ANNOTATIONS
    },
    async (_args: Record<string, unknown>): Promise<McpToolResult> => {
      const entity = await enqueueMutation(() => {
        const spawned = world.spawn();
        trackedEntities.add(spawned);
        return spawned;
      });
      return textResult({ entity: entity as number });
    }
  );

  server.registerTool(
    "ecs:despawn",
    {
      description: "Despawn an entity by id.",
      inputSchema: { id: z.number().int().describe("Entity id to despawn.") },
      annotations: DESTRUCTIVE_ANNOTATIONS
    },
    async (args: Record<string, unknown>): Promise<McpToolResult> => {
      const id = args.id as number;
      await enqueueMutation(() => {
        const entityId = id as unknown as Entity;
        world.despawn(entityId);
        trackedEntities.delete(entityId);
      });
      return textResult({ despawned: id });
    }
  );

  server.registerTool(
    "ecs:setComponent",
    {
      description:
        "Merge a partial component value on an entity. v1: no-op placeholder (component tokens unavailable via MCP).",
      inputSchema: {
        id: z.number().int().describe("Entity id."),
        component: z.string().describe("Component name."),
        value: z.record(z.string(), z.unknown()).describe("Partial value to merge.")
      },
      annotations: DESTRUCTIVE_ANNOTATIONS
    },
    async (args: Record<string, unknown>): Promise<McpToolResult> => {
      // v1 limitation: component tokens are runtime opaque objects, not addressable by name.
      await enqueueMutation(() => {
        /* v1: no-op — component tokens are not addressable by string name */
      });
      return textResult({ id: args.id, component: args.component, status: "v1-noop" });
    }
  );

  server.registerTool(
    "ecs:removeComponent",
    {
      description:
        "Remove a component from an entity. v1: no-op placeholder (component tokens unavailable via MCP).",
      inputSchema: {
        id: z.number().int().describe("Entity id."),
        component: z.string().describe("Component name.")
      },
      annotations: DESTRUCTIVE_ANNOTATIONS
    },
    async (args: Record<string, unknown>): Promise<McpToolResult> => {
      // v1 limitation: component tokens are not addressable by string name
      await enqueueMutation(() => {
        /* v1: no-op — component tokens are not addressable by string name */
      });
      return textResult({ id: args.id, component: args.component, status: "v1-noop" });
    }
  );

  server.registerTool(
    "loop:step",
    {
      description: "Advance the loop by exactly one fixed step and render once (deterministic).",
      inputSchema: {},
      annotations: DESTRUCTIVE_ANNOTATIONS
    },
    async (_args: Record<string, unknown>): Promise<McpToolResult> => {
      // Direct call — loop ops run between frames, no command buffer needed
      loop.step();
      return textResult({ stepped: true });
    }
  );

  server.registerTool(
    "loop:pause",
    {
      description: "Pause the game loop (stop the rAF driver).",
      inputSchema: {},
      annotations: DESTRUCTIVE_ANNOTATIONS
    },
    async (_args: Record<string, unknown>): Promise<McpToolResult> => {
      // Direct call — between frames
      loop.stop();
      return textResult({ paused: true });
    }
  );

  server.registerTool(
    "loop:resume",
    {
      description: "Resume the game loop.",
      inputSchema: {},
      annotations: DESTRUCTIVE_ANNOTATIONS
    },
    async (_args: Record<string, unknown>): Promise<McpToolResult> => {
      // Direct call — between frames
      loop.start();
      return textResult({ resumed: true });
    }
  );

  server.registerTool(
    "scene:load",
    {
      description:
        "Load a named scene (unloads the current scene first). v1: the response returns once the load is scheduled on the next tick — NOT when scene setup / asset loading completes (the async load is fire-and-forget). Poll game://scene/current to confirm completion.",
      inputSchema: { name: z.string().describe("Name of the scene to load.") },
      annotations: DESTRUCTIVE_ANNOTATIONS
    },
    async (args: Record<string, unknown>): Promise<McpToolResult> => {
      const name = args.name as string;
      await enqueueMutation(() => {
        scene.load(name).catch(() => {
          /* scene.load failure is fire-and-forget in v1 — completion is observed via game://scene/current */
        });
      });
      // "scheduled" (not "loaded") — setup completes asynchronously after this returns
      return textResult({ scheduled: name });
    }
  );

  server.registerTool(
    "game:reset",
    {
      description:
        "Despawn all MCP-tracked entities and unload the current scene (hard reset). Deferred to next input-stage tick.",
      inputSchema: {},
      annotations: DESTRUCTIVE_ANNOTATIONS
    },
    async (_args: Record<string, unknown>): Promise<McpToolResult> => {
      await enqueueMutation(() => {
        for (const entity of trackedEntities) {
          world.despawn(entity);
        }
        trackedEntities.clear();
        scene.unload();
      });
      return textResult({ reset: true });
    }
  );
};
