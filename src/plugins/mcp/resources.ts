/**
 * @file mcp plugin — resource registration.
 *
 * Registers the four read-only MCP resources that expose live runtime state to
 * agent clients as on-demand snapshots (no per-frame push / no subscriptions in v1).
 *
 * Cycle 4: game://world/snapshot now reports EVERY live entity with its named
 * component values (via the ecs introspection facet). game://systems/list still
 * reports stage names only (per-stage system counts are not tracked).
 */
import type { World } from "../ecs/types";
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
   * World introspection (Cycle 4) — powers the live world snapshot. Replaces the
   * MCP-spawned-only `trackedEntities` set so the snapshot covers EVERY live entity.
   */
  world: Pick<World, "liveEntities" | "componentsOf">;
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
 * - `game://world/snapshot` — every live entity with its named component values.
 * - `game://systems/list` — Stage names from the scheduler.
 * - `game://stats/frame` — Frame number, last delta, entity count.
 * - `game://scene/current` — Current scene name.
 *
 * @param server - The structural MCP server to register resources on.
 * @param deps - Runtime plugin APIs and live state accessors.
 * @example
 * ```ts
 * registerResources(server, { scene, scheduler, world, getStats });
 * ```
 */
export const registerResources = (server: McpServerLike, deps: ResourceDeps): void => {
  const { scene, scheduler, world, getStats } = deps;

  // ── game://world/snapshot ─────────────────────────────────────────────────

  server.registerResource(
    "world:snapshot",
    URI_WORLD_SNAPSHOT,
    {
      title: "World snapshot",
      description:
        "Every live entity with its named component values (Cycle 4 — full world, not just MCP-spawned).",
      mimeType: "application/json"
    },
    (_uri: URL): McpResourceResult => {
      const entities = world.liveEntities().map(entity => ({
        id: entity as number,
        components: world.componentsOf(entity)
      }));
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
        "Stage names only (systems are anonymous functions; per-stage system names/counts are not tracked).",
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
      description:
        "Current frame number, last delta time, and live entity count (all entities in the world, not just MCP-tracked).",
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
