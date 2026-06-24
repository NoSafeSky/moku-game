/**
 * @file mcp plugin — resource registration.
 *
 * Registers the four read-only MCP resources that expose live runtime state to
 * agent clients as on-demand snapshots (no per-frame push / no subscriptions in v1).
 *
 * v1 limitations documented per resource:
 * - game://world/snapshot — reflects only MCP-spawned entities (no enumerate-all in ECS API).
 * - game://systems/list — reports stage names with system counts tracked externally (not per-stage).
 */
import type { Entity } from "../ecs/types";
import type { Api as SceneApi } from "../scene/types";
import type { Stage } from "../scheduler/types";
import type { McpResourceResult, McpServerLike } from "./types";

// ─────────────────────────────────────────────────────────────────────────────
// Deps type
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Runtime dependencies passed to registerResources from lifecycle.ts.
 */
export type ResourceDeps = {
  /** Scene plugin API for currentScene(). */
  scene: Pick<SceneApi, "currentScene">;
  /** Scheduler API for stages list. */
  scheduler: { readonly stages: readonly Stage[] };
  /**
   * MCP-tracked entity set.
   * v1 limitation: only contains entities spawned via ecs:spawn MCP tool.
   */
  trackedEntities: ReadonlySet<Entity>;
  /** Returns the current frame stats snapshot. */
  getStats: () => { frame: number; lastDt: number; entityCount: number };
};

// ─────────────────────────────────────────────────────────────────────────────
// Resource URIs (hoisted — repeated 4+ times in this file)
// ─────────────────────────────────────────────────────────────────────────────

const URI_WORLD_SNAPSHOT = "game://world/snapshot";
const URI_SYSTEMS_LIST = "game://systems/list";
const URI_STATS_FRAME = "game://stats/frame";
const URI_SCENE_CURRENT = "game://scene/current";

// ─────────────────────────────────────────────────────────────────────────────
// Registration
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Registers the read-only MCP resource catalog on the server.
 *
 * Four resources:
 * - `game://world/snapshot` — MCP-tracked entities (v1 limitation: not all world entities).
 * - `game://systems/list` — Stage names from the scheduler.
 * - `game://stats/frame` — Frame number, last delta, entity count.
 * - `game://scene/current` — Current scene name.
 *
 * @param server - The structural MCP server to register resources on.
 * @param deps - Runtime plugin APIs and live state accessors.
 * @example
 * ```ts
 * registerResources(server, { scene, scheduler, trackedEntities, getStats });
 * ```
 */
export const registerResources = (server: McpServerLike, deps: ResourceDeps): void => {
  const { scene, scheduler, trackedEntities, getStats } = deps;

  // ── game://world/snapshot ─────────────────────────────────────────────────

  server.registerResource(
    "world:snapshot",
    URI_WORLD_SNAPSHOT,
    {
      title: "World snapshot",
      description:
        "MCP-tracked entities and their ids. v1 limitation: reflects only entities spawned through MCP tools.",
      mimeType: "application/json"
    },
    (_uri: URL): McpResourceResult => {
      const entities = [...trackedEntities].map(entity => entity as number);
      return {
        contents: [
          {
            uri: URI_WORLD_SNAPSHOT,
            mimeType: "application/json",
            text: JSON.stringify({ entities, count: entities.length })
          }
        ]
      };
    }
  );

  // ── game://systems/list ───────────────────────────────────────────────────

  server.registerResource(
    "systems:list",
    URI_SYSTEMS_LIST,
    {
      title: "Systems list",
      description:
        "Registered execution stages. v1 limitation: system counts per stage are not tracked.",
      mimeType: "application/json"
    },
    (_uri: URL): McpResourceResult => ({
      contents: [
        {
          uri: URI_SYSTEMS_LIST,
          mimeType: "application/json",
          text: JSON.stringify({ stages: [...scheduler.stages] })
        }
      ]
    })
  );

  // ── game://stats/frame ────────────────────────────────────────────────────

  server.registerResource(
    "stats:frame",
    URI_STATS_FRAME,
    {
      title: "Frame stats",
      description: "Current frame number, last delta time, and MCP-tracked entity count.",
      mimeType: "application/json"
    },
    (_uri: URL): McpResourceResult => ({
      contents: [
        {
          uri: URI_STATS_FRAME,
          mimeType: "application/json",
          text: JSON.stringify(getStats())
        }
      ]
    })
  );

  // ── game://scene/current ──────────────────────────────────────────────────

  server.registerResource(
    "scene:current",
    URI_SCENE_CURRENT,
    {
      title: "Current scene",
      description: "The currently loaded scene name, or null when no scene is loaded.",
      mimeType: "application/json"
    },
    (_uri: URL): McpResourceResult => ({
      contents: [
        {
          uri: URI_SCENE_CURRENT,
          mimeType: "application/json",
          text: JSON.stringify({ current: scene.currentScene() ?? undefined })
        }
      ]
    })
  );
};
