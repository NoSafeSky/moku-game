/**
 * @file demo-scene — the stand-in "game" the standalone editor edits.
 *
 * The editor shell is built to wrap a HOST game (the two-`createApp` model); run on its own it boots
 * an EMPTY world with nothing to select or edit. This module seeds a tiny fixture "game" so the
 * editor opens usable and the e2e round-trip has a subject. It is the ONE place that reaches the game
 * app's AUTHORING surface — `reflection.register` (a field schema the framework does not auto-register
 * for `Transform`), `commands.applyRaw` (a clean, non-undoable seed spawn), and
 * `renderer.attachPrimitive` (a clickable, visible view). The editor shell proper still drives the
 * game ONLY through `gameApp["editor-bridge"]`; this fixture stands in for the absent host game. In a
 * real deployment the host game owns its own components + scene — pass a real game and drop this seed.
 */
import { field } from "@nosafesky/moku-game";
import type { EditorHandles } from "./editor-host";

/** The game runtime app the editor hosts (typed off the editor handles — no extra imports needed). */
type GameApp = EditorHandles["gameApp"];

/** A renderer primitive spec (`rect`/`circle`/…), typed off `attachPrimitive` to avoid a renderer import. */
type PrimitiveSpec = Parameters<GameApp["renderer"]["attachPrimitive"]>[1];

/** One fixture entity: a `Transform` value plus the primitive view attached to it. */
type DemoEntity = {
  /** The entity's starting Transform (world-space pixels; the canvas is 800×600, origin top-left). */
  readonly transform: { x: number; y: number; rotation: number; scaleX: number; scaleY: number };
  /** The clickable, visible primitive the renderer attaches (its `Transform` is the shape's center). */
  readonly primitive: PrimitiveSpec;
};

// The Transform field schema — the framework auto-DEFINES the Transform component on the ECS world
// (renderer) but registers no reflection schema for it, so the inspector would infer bare fields.
// Registering typed, bounded fields gives the inspector real controls (scale is clamped non-negative).
const TRANSFORM_SCHEMA = {
  x: field.number({ step: 1 }),
  y: field.number({ step: 1 }),
  rotation: field.number({ step: 0.05 }),
  scaleX: field.number({ min: 0, step: 0.1 }),
  scaleY: field.number({ min: 0, step: 0.1 })
};

// A handful of distinct, well-spaced primitives so every panel has something real to show: the
// scene-tree lists four rows, the viewport renders four pickable shapes, the inspector edits their
// Transforms. Bright fills read against the renderer's default black background.
const DEMO_ENTITIES: readonly DemoEntity[] = [
  {
    transform: { x: 210, y: 170, rotation: 0, scaleX: 1, scaleY: 1 },
    primitive: { shape: "rect", width: 96, height: 64, fill: 0xe8_59_0c, label: "Player" }
  },
  {
    transform: { x: 430, y: 300, rotation: 0, scaleX: 1, scaleY: 1 },
    primitive: { shape: "circle", radius: 44, fill: 0x2f_9e_44, label: "Coin" }
  },
  {
    transform: { x: 620, y: 200, rotation: 0, scaleX: 1, scaleY: 1 },
    primitive: { shape: "rect", width: 72, height: 72, fill: 0x19_71_c2, label: "Crate" }
  },
  {
    transform: { x: 330, y: 450, rotation: 0, scaleX: 1, scaleY: 1 },
    primitive: { shape: "circle", radius: 32, fill: 0xf0_8c_00, label: "Enemy" }
  }
];

/**
 * Seed the fixture "game" the editor edits: register the `Transform` field schema, then spawn each
 * demo entity through `commands.applyRaw` (a clean seed that adds no undo history) and attach its
 * primitive view. Idempotent — a no-op once the world already holds editor entities (a re-entered
 * `startEditor`, or a real host game already present), so it never double-seeds.
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

  for (const entity of DEMO_ENTITIES) {
    const spawned = gameApp.commands.applyRaw({
      kind: "spawn",
      components: { Transform: entity.transform }
    });
    if (!spawned.ok) continue;

    const handle = gameApp.commands.resolve(spawned.id);
    if (handle !== undefined) gameApp.renderer.attachPrimitive(handle, entity.primitive);
  }
}
