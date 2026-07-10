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
 *
 * Cycle 5: Real ECS mutation triad (setComponent/removeComponent/spawn-with-components),
 * renderer:attach primitive tool, honest results (despawn changed flag, scene:load
 * validation, loop:step clock echo, scene:getInfo enriched, game:reset emits event).
 *
 * Cycle 6 (issue #4, Bug 1): `ecs:setComponent` now calls `renderer.markDirty(entity)`
 * after the upsert so a Transform write repositions the view on the next sync tick
 * instead of leaving the on-screen node stale.
 */
import { z } from "zod";
import type { Component, Entity, World } from "../ecs/types";
import type { Api as InputApi } from "../input/types";
import type { Api as LoopApi } from "../loop/types";
import type { PrimitiveSpec, SceneNode } from "../renderer/types";
import type { Api as SceneApi } from "../scene/types";
import type { McpServerLike, McpToolResult } from "./types";

// ─────────────────────────────────────────────────────────────────────────────
// Structural renderer dep (screenshot + scene tree + primitive attach)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Structural renderer dependency — the screenshot (extract), scene-tree, and
 * primitive-attach methods the renderer tools delegate to. All degrade gracefully
 * when the renderer is headless / not started. Plain data only — no Pixi/DOM types
 * leak in.
 */
export type RendererDep = {
  /** Capture the current frame as a PNG data URL, or undefined when headless / before start. */
  screenshot(): Promise<string | undefined>;
  /** Return the Pixi scene graph snapshot, or undefined when headless / before start. */
  tree(): SceneNode | undefined;
  /**
   * Build a Pixi Graphics from spec, add it to the stage, and register it so the sync
   * system positions it from the entity's Transform. Returns false when headless / before
   * start (nothing added).
   *
   * @param entity - The entity to associate with the primitive view.
   * @param spec - Plain JSON-describable shape + style.
   * @returns true when attached; false when headless.
   */
  attachPrimitive(entity: Entity, spec: PrimitiveSpec): boolean;
  /**
   * Flag the entity's view dirty so the sync system repositions it from its
   * Transform on the next frame. Idempotent; a no-op when the entity has no view.
   *
   * @param entity - The entity whose Transform has changed.
   */
  markDirty(entity: Entity): void;
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
   * (`liveEntities`/`entityCount`/`componentNames`/`componentsOf`) that powers `ecs:query`,
   * and the Cycle 5 mutation surface (`componentByName`/`has`/`add`/`set`/`remove`).
   */
  world: Pick<
    World,
    | "spawn"
    | "despawn"
    | "isAlive"
    | "has"
    | "add"
    | "set"
    | "remove"
    | "componentByName"
    | "liveEntities"
    | "entityCount"
    | "componentNames"
    | "componentsOf"
  >;
  /** The loop plugin API (step / start / stop). */
  loop: Pick<LoopApi, "step" | "start" | "stop">;
  /** The scene plugin API (load / unload / currentScene / sceneNames / ownedEntities). */
  scene: Pick<SceneApi, "load" | "unload" | "currentScene" | "sceneNames" | "ownedEntities">;
  /** Renderer dep exposing screenshot + scene tree + primitive attach. */
  renderer: RendererDep;
  /** Input dep exposing key injection for the `input:key` tool. */
  input: InputDep;
  /**
   * Mutable set of entities spawned via the `ecs:spawn` MCP tool. Used by
   * `ecs:despawn` / `game:reset` to scope cleanup to MCP-created entities.
   * (Reads — `ecs:query`, `game://world/snapshot` — now enumerate the whole world.)
   */
  trackedEntities: Set<Entity>;
  /**
   * Called by `game:reset` after all tracked entities have been despawned and the
   * scene has been unloaded. Emits the `game:reset` event on the plugin event bus.
   */
  emitReset: () => void;
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
// Zod schema for PrimitiveSpec (mirrors the type union — no Pixi types)
// ─────────────────────────────────────────────────────────────────────────────

/** Shared optional style fields for all primitive shapes. */
const primitiveStyleSchema = {
  fill: z.number().optional().describe("Fill color as hex int (e.g. 0xff0000)."),
  stroke: z.number().optional().describe("Stroke color as hex int."),
  strokeWidth: z.number().optional().describe("Stroke width in pixels. Default: 1."),
  alpha: z.number().min(0).max(1).optional().describe("Opacity 0–1. Default: 1."),
  label: z.string().optional().describe("Pixi node label for renderer:tree.")
};

const primitiveSpecSchema = z.discriminatedUnion("shape", [
  z.object({
    shape: z.literal("rect"),
    width: z.number(),
    height: z.number(),
    ...primitiveStyleSchema
  }),
  z.object({ shape: z.literal("circle"), radius: z.number(), ...primitiveStyleSchema }),
  z.object({ shape: z.literal("line"), x2: z.number(), y2: z.number(), ...primitiveStyleSchema }),
  z.object({
    shape: z.literal("polygon"),
    points: z.array(z.object({ x: z.number(), y: z.number() })),
    ...primitiveStyleSchema
  })
]);

// ─────────────────────────────────────────────────────────────────────────────
// Annotations constants
// ─────────────────────────────────────────────────────────────────────────────

const READ_ONLY_ANNOTATIONS = { readOnlyHint: true } as const;
const DESTRUCTIVE_ANNOTATIONS = { destructiveHint: true } as const;

// ─────────────────────────────────────────────────────────────────────────────
// Internal helpers for ECS mutation validation
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Resolves a component name to its token, or returns an errorResult if unknown.
 *
 * @param world - The ECS world facade.
 * @param name - The component name string from the tool input.
 * @returns An object with either `token` (success) or `error` (failure).
 * @example
 * ```ts
 * const { token, error } = resolveComponent(world, "Transform");
 * if (error) return error;
 * ```
 */
const resolveComponent = (
  world: ToolDeps["world"],
  name: string
):
  | { token: Component<Record<string, unknown>>; error: undefined }
  | { token: undefined; error: McpToolResult } => {
  const token = world.componentByName(name);
  if (!token) {
    const known = world.componentNames();
    return {
      token: undefined,
      error: errorResult(
        `Unknown component name: "${name}". Known names: ${known.join(", ") || "(none — pass opts.name to defineComponent)"}`
      )
    };
  }
  return { token, error: undefined };
};

/**
 * Validates that an entity is alive, or returns an errorResult.
 *
 * @param world - The ECS world facade.
 * @param id - The raw numeric entity id from the tool input.
 * @returns An object with either `entity` (success) or `error` (failure).
 * @example
 * ```ts
 * const { entity, error } = validateEntity(world, id);
 * if (error) return error;
 * ```
 */
const validateEntity = (
  world: ToolDeps["world"],
  id: number
): { entity: Entity; error: undefined } | { entity: undefined; error: McpToolResult } => {
  const entity = id as unknown as Entity;
  if (!world.isAlive(entity)) {
    return { entity: undefined, error: errorResult(`Entity ${id} is not alive.`) };
  }
  return { entity, error: undefined };
};

// ─────────────────────────────────────────────────────────────────────────────
// Tool registration
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Registers the MCP tool catalog on the server.
 *
 * Mutating tools (ecs:spawn, ecs:despawn, ecs:setComponent, ecs:removeComponent,
 * renderer:attach, scene:load, game:reset) enqueue closures via `enqueueMutation` so
 * mutations are applied on the next input-stage tick (frame-safe). Loop controls
 * (loop:step, loop:pause, loop:resume) call their APIs directly between frames.
 * Read-only tools (ecs:query, renderer:screenshot, scene:getInfo) call their APIs
 * directly.
 *
 * @param server - The structural MCP server to register tools on.
 * @param deps - Runtime plugin APIs the tools delegate to.
 * @param opts - Options controlling mutation enablement and the enqueue function.
 * @example
 * ```ts
 * registerTools(server, { world, loop, scene, renderer, emitReset }, { enableMutations: true, enqueueMutation });
 * ```
 */
export const registerTools = (server: McpServerLike, deps: ToolDeps, opts: ToolOptions): void => {
  const { world, loop, scene, renderer, input, trackedEntities, emitReset } = deps;
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
        "Return the Pixi scene graph (labels, positions, rotation/scale, visibility, and text for Text nodes, type is one of Container/Sprite/Text/Graphics) rooted at the stage. The most direct way to read on-screen state (e.g. ball/paddle positions, score text). Not-available result when headless / not started.",
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
      description:
        "Return the current scene name, the list of all registered scene names, and the entity handles owned by the current scene.",
      inputSchema: {},
      annotations: READ_ONLY_ANNOTATIONS
    },
    async (_args: Record<string, unknown>): Promise<McpToolResult> => {
      const current = scene.currentScene() ?? undefined;
      const scenes = scene.sceneNames();
      const owned = scene.ownedEntities();
      return textResult({ current, scenes, owned });
    }
  );

  if (!enableMutations) return;

  // ── Mutating tools (registered only when enableMutations=true) ────────────

  server.registerTool(
    "ecs:spawn",
    {
      description:
        "Spawn an entity with optional named components. Returns the new entity id and the applied component names. If components is provided, ALL names must be known — any unknown name aborts the spawn before creating any entity.",
      inputSchema: {
        components: z
          .record(z.string(), z.record(z.string(), z.unknown()))
          .optional()
          .describe(
            "Optional map of component name → partial value to attach. All names must be known; any unknown name aborts the whole spawn."
          )
      },
      annotations: DESTRUCTIVE_ANNOTATIONS
    },
    async (args: Record<string, unknown>): Promise<McpToolResult> => {
      const componentsMap = args.components as Record<string, Record<string, unknown>> | undefined;

      // Validate ALL component names before touching the world.
      if (componentsMap) {
        const names = Object.keys(componentsMap);
        const unknowns = names.filter(name => !world.componentByName(name));
        if (unknowns.length > 0) {
          const known = world.componentNames();
          return errorResult(
            `Unknown component name(s): ${unknowns.join(", ")}. Known names: ${known.join(", ") || "(none)"}`
          );
        }
      }

      const entity = await enqueueMutation(() => {
        const spawned = world.spawn();
        trackedEntities.add(spawned);

        if (componentsMap) {
          for (const [name, value] of Object.entries(componentsMap)) {
            const token = world.componentByName(name);
            if (token) world.add(spawned, token, value);
          }
        }

        return spawned;
      });

      if (componentsMap) {
        return textResult({ entity: entity as number, components: Object.keys(componentsMap) });
      }
      return textResult({ entity: entity as number });
    }
  );

  server.registerTool(
    "ecs:despawn",
    {
      description:
        "Despawn an entity by id. Returns { despawned: id, changed: boolean } — changed is false when the entity was already dead.",
      inputSchema: { id: z.number().int().describe("Entity id to despawn.") },
      annotations: DESTRUCTIVE_ANNOTATIONS
    },
    async (args: Record<string, unknown>): Promise<McpToolResult> => {
      const id = args.id as number;
      const changed = await enqueueMutation(() => {
        const entityId = id as unknown as Entity;
        const wasAlive = world.isAlive(entityId);
        if (wasAlive) world.despawn(entityId);
        trackedEntities.delete(entityId);
        return wasAlive;
      });
      return textResult({ despawned: id, changed });
    }
  );

  server.registerTool(
    "ecs:setComponent",
    {
      description:
        "Upsert a component value on an entity: sets (shallow-merges) if the component is present, adds (with value merged over defaults) if absent. Requires the component to have been defined with opts.name.",
      inputSchema: {
        id: z.number().int().describe("Entity id."),
        component: z
          .string()
          .describe("Component name (must have been registered with opts.name)."),
        value: z.record(z.string(), z.unknown()).describe("Partial value to merge.")
      },
      annotations: DESTRUCTIVE_ANNOTATIONS
    },
    async (args: Record<string, unknown>): Promise<McpToolResult> => {
      const id = args.id as number;
      const componentName = args.component as string;
      const value = args.value as Record<string, unknown>;

      // Validate component name and entity liveness BEFORE enqueuing.
      const resolved = resolveComponent(world, componentName);
      if (resolved.error) return resolved.error;
      const { token } = resolved;

      const entityCheck = validateEntity(world, id);
      if (entityCheck.error) return entityCheck.error;
      const { entity } = entityCheck;

      await enqueueMutation(() => {
        if (world.has(entity, token)) {
          world.set(entity, token, value);
        } else {
          world.add(entity, token, value);
        }
        // Flag the view dirty so the sync system repositions it next tick — a
        // no-op when the entity has no view (or the write wasn't a Transform).
        renderer.markDirty(entity);
      });

      return textResult({ id, component: componentName, changed: true, value });
    }
  );

  server.registerTool(
    "ecs:removeComponent",
    {
      description:
        "Remove a component from an entity. Returns { changed: boolean } — false when the component was not present. Requires the component to have been defined with opts.name.",
      inputSchema: {
        id: z.number().int().describe("Entity id."),
        component: z.string().describe("Component name (must have been registered with opts.name).")
      },
      annotations: DESTRUCTIVE_ANNOTATIONS
    },
    async (args: Record<string, unknown>): Promise<McpToolResult> => {
      const id = args.id as number;
      const componentName = args.component as string;

      // Validate component name and entity liveness BEFORE enqueuing.
      const resolved = resolveComponent(world, componentName);
      if (resolved.error) return resolved.error;
      const { token } = resolved;

      const entityCheck = validateEntity(world, id);
      if (entityCheck.error) return entityCheck.error;
      const { entity } = entityCheck;

      const changed = await enqueueMutation(() => {
        if (!world.has(entity, token)) return false;
        world.remove(entity, token);
        return true;
      });

      return textResult({ id, component: componentName, changed });
    }
  );

  server.registerTool(
    "renderer:attach",
    {
      description:
        "Attach a primitive shape (rect/circle/line/polygon) to an entity. Builds a Pixi Graphics and adds it to the stage so the sync system positions it from the entity's Transform component. Returns false when headless / before start.",
      inputSchema: {
        id: z.number().int().describe("Entity id (must be alive)."),
        spec: primitiveSpecSchema.describe("Shape and style descriptor.")
      },
      annotations: DESTRUCTIVE_ANNOTATIONS
    },
    async (args: Record<string, unknown>): Promise<McpToolResult> => {
      const id = args.id as number;
      const spec = args.spec as PrimitiveSpec;

      // Validate entity liveness BEFORE enqueuing.
      const entity = id as unknown as Entity;
      if (!world.isAlive(entity)) {
        return errorResult(`Entity ${id} is not alive.`);
      }

      const attached = await enqueueMutation(() => renderer.attachPrimitive(entity, spec));

      if (!attached) {
        return errorResult(
          "renderer not available (headless or not started) — primitive could not be attached"
        );
      }

      return textResult({ id, attached: true });
    }
  );

  server.registerTool(
    "input:key",
    {
      description:
        "Inject a key so an agent can play: action 'down' holds the key, 'up' releases it, 'press' is a one-frame tap (justPressed+justReleased). Applied immediately between frames — the next loop:step (or tick) observes it. Note: 'Space' maps to the actual spacebar (KeyboardEvent.key === \" \") via the input plugin's key normaliser.",
      inputSchema: {
        key: z
          .string()
          .describe(
            "Key identifier, e.g. 'ArrowRight', 'ArrowLeft', 'Space', 'w'. 'Space' is normalised to the spacebar (KeyboardEvent.key === \" \")."
          ),
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
      description:
        "Advance the loop by exactly one fixed step and render once (deterministic). Returns the frame clock snapshot { stepped, frame, elapsed, dt } for the just-advanced step.",
      inputSchema: {},
      annotations: DESTRUCTIVE_ANNOTATIONS
    },
    async (_args: Record<string, unknown>): Promise<McpToolResult> => {
      // Direct call — loop ops run between frames, no command buffer needed
      const { frame, elapsed, dt } = loop.step();
      return textResult({ stepped: true, frame, elapsed, dt });
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
        "Load a named scene (unloads the current scene first). Returns an error if the scene name is not registered. The response returns once the load is scheduled on the next tick — NOT when scene setup / asset loading completes (the async load is fire-and-forget). Poll game://scene/current to confirm completion.",
      inputSchema: { name: z.string().describe("Name of the scene to load.") },
      annotations: DESTRUCTIVE_ANNOTATIONS
    },
    async (args: Record<string, unknown>): Promise<McpToolResult> => {
      const name = args.name as string;

      // Validate scene name BEFORE enqueuing.
      const knownScenes = scene.sceneNames();
      if (!knownScenes.includes(name)) {
        return errorResult(
          `Unknown scene: "${name}". Known scenes: ${knownScenes.join(", ") || "(none — call scene.define first)"}`
        );
      }

      await enqueueMutation(() => {
        scene.load(name).catch(() => {
          /* scene.load failure is fire-and-forget — completion is observed via game://scene/current */
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
        "Despawn all MCP-tracked entities and unload the current scene (hard reset). Deferred to next input-stage tick. Emits the game:reset event after cleanup.",
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
        emitReset();
      });
      return textResult({ reset: true });
    }
  );
};
