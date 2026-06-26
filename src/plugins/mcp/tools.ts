/**
 * @file mcp plugin — tool registration.
 *
 * Registers the MCP tool catalog on a structural McpServerLike. Mutating ECS tools
 * route through an `enqueueMutation` closure (frame-safety); loop controls and input
 * injection (`input:key`) call their APIs directly between frames. zod is imported here
 * for input schema shapes (it is a schema lib, not the SDK — allowed by the seam rule).
 *
 * Cycle 4: `ecs:query` and `game://world/snapshot` enumerate the WHOLE live world via the
 * ECS introspection facet (liveEntities/componentsOf), and entityCount is exact. The
 * `trackedEntities` Set now scopes only mutation cleanup (`ecs:despawn`, `game:reset`).
 */
import { z } from "zod";
import type { Entity, World } from "../ecs/types";
import type { Api as InputApi } from "../input/types";
import type { Api as LoopApi } from "../loop/types";
import type { SceneNode } from "../renderer/types";
import type { Api as SceneApi } from "../scene/types";
import type { McpServerLike, McpToolResult } from "./types";

// ─────────────────────────────────────────────────────────────────────────────
// Structural renderer dep (only what tools.ts uses — screenshot + scene tree)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Structural renderer dependency — the screenshot (extract) and scene-tree methods
 * the read-only renderer tools delegate to. Both degrade to `undefined` when the
 * renderer is headless / not started. Plain data only — no Pixi/DOM types leak in.
 */
export type RendererDep = {
  /** Capture the current frame as a PNG data URL, or undefined when headless / before start. */
  screenshot(): Promise<string | undefined>;
  /** Return the Pixi scene graph snapshot, or undefined when headless / before start. */
  tree(): SceneNode | undefined;
};

// ─────────────────────────────────────────────────────────────────────────────
// Structural input dep (only the injection methods input:key needs)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Structural input dependency — the programmatic injection surface the `input:key`
 * tool calls (held down / release / one-frame tap).
 */
export type InputDep = Pick<InputApi, "keyDown" | "keyUp" | "keyPress">;

// ─────────────────────────────────────────────────────────────────────────────
// Deps type (structural — only what tools.ts actually touches)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Runtime dependencies passed to registerTools from lifecycle.ts.
 */
export type ToolDeps = {
  /**
   * The ECS world facade — structural ops plus the Cycle 4 introspection facet
   * (`liveEntities`/`entityCount`/`componentNames`/`componentsOf`) that powers `ecs:query`.
   */
  world: Pick<
    World,
    | "spawn"
    | "despawn"
    | "isAlive"
    | "liveEntities"
    | "entityCount"
    | "componentNames"
    | "componentsOf"
  >;
  /** The loop plugin API (step / start / stop). */
  loop: Pick<LoopApi, "step" | "start" | "stop">;
  /** The scene plugin API (load / unload / currentScene). */
  scene: Pick<SceneApi, "load" | "unload" | "currentScene">;
  /** Renderer dep exposing screenshot + scene tree. */
  renderer: RendererDep;
  /** Input dep exposing key injection for the `input:key` tool. */
  input: InputDep;
  /**
   * Mutable set of entities spawned via the `ecs:spawn` MCP tool. Used by
   * `ecs:despawn` / `game:reset` to scope cleanup to MCP-created entities.
   * (Reads — `ecs:query`, `game://world/snapshot` — now enumerate the whole world.)
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
  const { world, loop, scene, renderer, input, trackedEntities } = deps;
  const { enableMutations, enqueueMutation } = opts;

  // ── Read-only tools (always registered) ───────────────────────────────────

  server.registerTool(
    "ecs:query",
    {
      description:
        "Query ALL live entities, optionally filtered to those having every named component in componentNames (empty/omitted = all entities). Returns each entity's id and its named components with values. Unknown names return an error listing the known component names.",
      inputSchema: {
        componentNames: z
          .array(z.string())
          .optional()
          .describe(
            "Component names that a matching entity must ALL have (only components defined with a name are queryable). Omit or pass [] for every live entity."
          )
      },
      annotations: READ_ONLY_ANNOTATIONS
    },
    async (args: Record<string, unknown>): Promise<McpToolResult> => {
      const requested = (args.componentNames as string[] | undefined) ?? [];

      // Validate filter names up front so an agent gets an actionable error, not silence.
      const known = world.componentNames();
      const unknownNames = requested.filter(name => !known.includes(name));
      if (unknownNames.length > 0) {
        return errorResult(
          `Unknown component name(s): ${unknownNames.join(", ")}. Known names: ${known.join(", ") || "(none — pass opts.name to defineComponent)"}`
        );
      }

      // Enumerate the whole world; keep entities whose named components cover the filter.
      const entities: Array<{
        id: number;
        components: ReadonlyArray<{ name: string; value: unknown }>;
      }> = [];
      for (const entity of world.liveEntities()) {
        const components = world.componentsOf(entity);
        const names = new Set(components.map(component => component.name));
        const matches = requested.every(name => names.has(name));
        if (matches) entities.push({ id: entity as number, components });
      }

      return textResult({ entities, count: entities.length });
    }
  );

  server.registerTool(
    "renderer:screenshot",
    {
      description:
        "Return the current frame as a base64 PNG via Pixi's extract system (reliable regardless of frame timing — works while paused). Returns a not-available result when the renderer is headless / not started.",
      inputSchema: {},
      annotations: READ_ONLY_ANNOTATIONS
    },
    async (_args: Record<string, unknown>): Promise<McpToolResult> => {
      // extract.base64 re-renders into a target, so the capture is timing-independent.
      const dataUrl = await renderer.screenshot();
      if (!dataUrl) {
        return errorResult(
          "renderer not available (headless or not started) — no frame to capture"
        );
      }
      // Strip the 'data:image/png;base64,' prefix so callers receive raw base64.
      const base64 = dataUrl.replace(/^data:[^;]+;base64,/, "");
      return textResult({ base64, mimeType: "image/png" });
    }
  );

  server.registerTool(
    "renderer:tree",
    {
      description:
        "Return the Pixi scene graph (labels, positions, rotation/scale, visibility, and text for Text nodes) rooted at the stage. The most direct way to read on-screen state (e.g. ball/paddle positions, score text). Not-available result when headless / not started.",
      inputSchema: {},
      annotations: READ_ONLY_ANNOTATIONS
    },
    async (_args: Record<string, unknown>): Promise<McpToolResult> => {
      const tree = renderer.tree();
      if (!tree) {
        return errorResult("renderer not available (headless or not started) — no scene graph");
      }
      return textResult({ tree });
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
    "input:key",
    {
      description:
        "Inject a key so an agent can play: action 'down' holds the key, 'up' releases it, 'press' is a one-frame tap (justPressed+justReleased). Applied immediately between frames — the next loop:step (or tick) observes it.",
      inputSchema: {
        key: z.string().describe("Key identifier, e.g. 'ArrowRight', 'ArrowLeft', 'Space', 'w'."),
        action: z
          .enum(["down", "up", "press"])
          .describe("'down' = hold, 'up' = release, 'press' = one-frame tap.")
      },
      annotations: DESTRUCTIVE_ANNOTATIONS
    },
    async (args: Record<string, unknown>): Promise<McpToolResult> => {
      const key = args.key as string;
      const action = args.action as "down" | "up" | "press";
      // Direct injection (NOT command-buffered): the input edge-sets are written
      // between frames like real DOM events; the input-stage system snapshots them
      // next tick. Draining would run AFTER that snapshot and garble edge timing.
      if (action === "down") input.keyDown(key);
      else if (action === "up") input.keyUp(key);
      else input.keyPress(key);
      return textResult({ key, action });
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
