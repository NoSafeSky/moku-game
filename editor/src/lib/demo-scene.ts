/**
 * @file demo-scene — the stand-in "game" the standalone editor edits.
 *
 * The editor shell wraps a HOST game (the two-`createApp` model); run on its own it boots an EMPTY world
 * with nothing to author. This module seeds a small, NESTED fixture scene — a faithful subset of the
 * design's frozen `Neon Drift` hierarchy — so the editor opens on a real-feeling project and the e2e
 * round-trip has a subject with folders, depth, a disabled node, and visible shapes.
 *
 * Unlike the flat MVP seed, it builds the scene through the **`editor-bridge` authoring verbs**
 * (`create` / `createShape` / `setEnabled`) — the same seam the shell itself drives — so every seeded
 * object carries a real `Node` (name / parent / order) and the hierarchy panel shows genuine nesting.
 * The one direct authoring-surface call it keeps is `reflection.register("Transform", …)`, a typed field
 * schema the framework does not auto-register, so the inspector shows bounded controls. In a real
 * deployment the host game owns its own components + scene — pass a real game and drop this seed.
 */

import type { Commands, Graphics2d, Renderer } from "@nosafesky/ludemic";
import { field } from "@nosafesky/ludemic";
import type { EditorHandles } from "./editor-host";

/** The game runtime app the editor hosts (typed off the editor handles — no extra imports needed). */
type GameApp = EditorHandles["gameApp"];

/** The editor-bridge authoring surface the seed drives (the same seam the shell uses). */
type Bridge = GameApp["editor-bridge"];

/** One node in the declarative demo tree — an optional shape + local transform + nested children. */
type DemoNode = {
  /** The object's display name (its `Node.name`). */
  readonly name: string;
  /** `false` seeds the node disabled (greyed row + hidden view + descendants). */
  readonly enabled?: boolean;
  /** A renderable Shape (`createShape`); omit for a bare transform "folder". */
  readonly shape?: {
    readonly kind: "rect" | "circle";
    readonly value: Partial<Graphics2d.ShapeValue>;
  };
  /** Local transform overrides (composed under the parent's world transform by `hierarchy`). */
  readonly transform?: Partial<Renderer.TransformValue>;
  /** Ordered children, created after (and parented to) this node. */
  readonly children?: readonly DemoNode[];
};

// The Transform field schema — the framework auto-DEFINES Transform on the world but registers no
// reflection schema for it, so the inspector would infer bare fields. Typed, bounded fields give it real
// controls (scale clamped non-negative). Registered once, before seeding.
const TRANSFORM_SCHEMA = {
  x: field.number({ step: 1 }),
  y: field.number({ step: 1 }),
  rotation: field.number({ step: 0.05 }),
  scaleX: field.number({ min: 0, step: 0.1 }),
  scaleY: field.number({ min: 0, step: 0.1 })
};

// A nested subset of the design's frozen `Level_01_Rooftops` hierarchy: three top-level branches, a
// disabled node (Platform_B), empty-transform folders, and bright shapes that read on the dark canvas.
const DEMO_TREE: readonly DemoNode[] = [
  {
    name: "Environment",
    transform: { x: 0, y: 0 },
    children: [
      {
        name: "Skyline_Back",
        transform: { x: 140, y: 90 },
        shape: { kind: "rect", value: { width: 180, height: 70, fill: "#3A506B" } }
      },
      {
        name: "Skyline_Mid",
        transform: { x: 260, y: 140 },
        shape: { kind: "rect", value: { width: 140, height: 60, fill: "#5C7AA8" } }
      },
      {
        name: "Ground",
        transform: { x: 120, y: 470 },
        shape: { kind: "rect", value: { width: 260, height: 40, fill: "#6B4F3A" } },
        children: [
          {
            name: "Platform_A",
            transform: { x: 340, y: 420 },
            shape: { kind: "rect", value: { width: 96, height: 24, fill: "#8A6A4A" } }
          },
          {
            name: "Platform_B",
            enabled: false,
            transform: { x: 520, y: 380 },
            shape: { kind: "rect", value: { width: 96, height: 24, fill: "#8A6A4A" } }
          }
        ]
      }
    ]
  },
  {
    name: "Player",
    transform: { x: 210, y: 300 },
    shape: { kind: "circle", value: { radius: 26, fill: "#5CB85C" } },
    children: [{ name: "Camera_Follow", transform: { x: 0, y: -40 } }]
  },
  {
    name: "Enemies",
    transform: { x: 0, y: 0 },
    children: [
      {
        name: "Drone_01",
        transform: { x: 560, y: 200 },
        shape: { kind: "circle", value: { radius: 22, fill: "#D9534F" } }
      },
      {
        name: "Drone_02",
        transform: { x: 640, y: 260 },
        shape: { kind: "circle", value: { radius: 22, fill: "#E0704C" } }
      }
    ]
  }
];

// Create one node (depth-first, parents before children) via the bridge authoring verbs, threading the
// minted editor id down as each child's parent so the `Node` graph nests correctly. Options are built
// without explicit `undefined` fields (exactOptionalPropertyTypes).
const createNode = (bridge: Bridge, node: DemoNode, parent?: Commands.EditorId): void => {
  const opts: {
    name: string;
    parent?: Commands.EditorId;
    transform?: Partial<Renderer.TransformValue>;
  } = {
    name: node.name
  };
  if (parent !== undefined) opts.parent = parent;
  if (node.transform !== undefined) opts.transform = node.transform;

  const id = node.shape
    ? bridge.createShape(node.shape.kind, { ...opts, shape: node.shape.value })
    : bridge.create(opts);

  if (node.enabled === false) bridge.setEnabled(id, false);

  for (const child of node.children ?? []) createNode(bridge, child, id);
};

/**
 * Seed the fixture "game" the editor edits: register the `Transform` field schema, then build the nested
 * demo hierarchy through the `editor-bridge` authoring verbs. Idempotent — a no-op once the world already
 * holds editor entities (a re-entered `startEditor`, or a real host game already present), so it never
 * double-seeds.
 *
 * @param gameApp - The booted game runtime app (from `startEditor`).
 * @example
 * ```ts
 * const { gameApp } = await startEditor(viewport);
 * seedDemoScene(gameApp);
 * ```
 */
export function seedDemoScene(gameApp: GameApp): void {
  // Never double-seed: a real host game (or a prior seed) already owns the world.
  if (gameApp.commands.count() > 0) return;

  gameApp.reflection.register("Transform", TRANSFORM_SCHEMA);

  const bridge = gameApp["editor-bridge"];
  for (const node of DEMO_TREE) createNode(bridge, node);
}
