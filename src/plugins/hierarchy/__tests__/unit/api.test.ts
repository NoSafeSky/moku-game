/**
 * @file hierarchy plugin — unit tests for the API factory (`api.ts`).
 *
 * Drives `createApi` against the fake ecs/renderer/commands doubles from `../mock-deps` over a
 * small family tree: a root R, three siblings (C1/C2/C3, out-of-order `Node.order`), a
 * grandchild G under C1, a second root R2 (non-identity transform, for the preserve-world
 * invariant), and a dangling node D whose `Node.parent` never resolves (root-heal).
 */
import { describe, expect, it } from "vitest";
import type { Entity } from "../../../ecs/types";
import { createApi } from "../../api";
import { compose } from "../../transform";
import {
  asEditorId,
  asEntity,
  makeApiCtx,
  makeCommandsFixture,
  makeWorldFixture,
  NODE_TOKEN
} from "../mock-deps";

// ─────────────────────────────────────────────────────────────────────────────
// Family-tree fixture
// ─────────────────────────────────────────────────────────────────────────────

const R = asEntity(1);
const C1 = asEntity(2);
const C2 = asEntity(3);
const C3 = asEntity(4);
const G = asEntity(5);
const D = asEntity(6);
const R2 = asEntity(7);

const rId = asEditorId(1);
const c1Id = asEditorId(2);
const c2Id = asEditorId(3);
const c3Id = asEditorId(4);
const gId = asEditorId(5);
const dId = asEditorId(6);
const r2Id = asEditorId(7);
const danglingId = asEditorId(999);

/** Builds the shared family-tree world + commands fixtures. */
const makeTreeFixtures = () => {
  const worldFixture = makeWorldFixture({
    nodes: new Map([
      [R, { parent: undefined, order: 0, name: "root", enabled: true }],
      [C1, { parent: rId, order: 2, name: "c1", enabled: true }],
      [C2, { parent: rId, order: 1, name: "c2", enabled: true }],
      [C3, { parent: rId, order: 3, name: "c3", enabled: true }],
      [G, { parent: c1Id, order: 0, name: "g", enabled: true }],
      [D, { parent: danglingId, order: 0, name: "d", enabled: true }],
      [R2, { parent: undefined, order: -1, name: "root2", enabled: true }]
    ]),
    transforms: new Map([
      [R, { x: 10, y: 5, rotation: Math.PI / 2, scaleX: 2, scaleY: 2 }],
      [C1, { x: 1, y: 0, rotation: 0, scaleX: 1, scaleY: 1 }],
      [C2, { x: 2, y: 0, rotation: 0, scaleX: 1, scaleY: 1 }],
      [C3, { x: 3, y: 0, rotation: 0, scaleX: 1, scaleY: 1 }],
      [G, { x: 0, y: 2, rotation: 0, scaleX: 1, scaleY: 1 }],
      [D, { x: 3, y: 3, rotation: 0, scaleX: 1, scaleY: 1 }],
      [R2, { x: 100, y: 50, rotation: Math.PI / 4, scaleX: 3, scaleY: 3 }]
    ])
  });

  const commandsFixture = makeCommandsFixture({
    byId: new Map([
      [rId, R],
      [c1Id, C1],
      [c2Id, C2],
      [c3Id, C3],
      [gId, G],
      [dId, D],
      [r2Id, R2]
    ]),
    byEntity: new Map([
      [R, rId],
      [C1, c1Id],
      [C2, c2Id],
      [C3, c3Id],
      [G, gId],
      [D, dId],
      [R2, r2Id]
    ])
  });

  return { worldFixture, commandsFixture };
};

// ─────────────────────────────────────────────────────────────────────────────
// Node getter
// ─────────────────────────────────────────────────────────────────────────────

describe("hierarchy api — Node getter", () => {
  it("throws before start and returns the token after", () => {
    const { ctx, state } = makeApiCtx();
    state.nodeToken = undefined;
    state.started = false;
    const api = createApi(ctx);

    expect(() => api.Node).toThrow(/hierarchy\.Node accessed before start/);

    state.nodeToken = NODE_TOKEN;
    expect(api.Node).toBe(NODE_TOKEN);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// worldOf
// ─────────────────────────────────────────────────────────────────────────────

describe("hierarchy api — worldOf", () => {
  it("a root returns its local transform verbatim", () => {
    const { worldFixture, commandsFixture } = makeTreeFixtures();
    const { ctx } = makeApiCtx({}, worldFixture, commandsFixture);
    const api = createApi(ctx);

    const world = api.worldOf(R);

    expect(world).toEqual({ x: 10, y: 5, rotation: Math.PI / 2, scaleX: 2, scaleY: 2 });
  });

  it("a child under a translated+rotated+scaled parent composes correctly", () => {
    const { worldFixture, commandsFixture } = makeTreeFixtures();
    const { ctx } = makeApiCtx({}, worldFixture, commandsFixture);
    const api = createApi(ctx);

    const world = api.worldOf(C1);

    expect(world.x).toBeCloseTo(10);
    expect(world.y).toBeCloseTo(7);
    expect(world.rotation).toBeCloseTo(Math.PI / 2);
    expect(world.scaleX).toBeCloseTo(2);
    expect(world.scaleY).toBeCloseTo(2);
  });

  it("a grandchild composes two levels of ancestry", () => {
    const { worldFixture, commandsFixture } = makeTreeFixtures();
    const { ctx } = makeApiCtx({}, worldFixture, commandsFixture);
    const api = createApi(ctx);

    const world = api.worldOf(G);

    expect(world.x).toBeCloseTo(6);
    expect(world.y).toBeCloseTo(7);
    expect(world.rotation).toBeCloseTo(Math.PI / 2);
    expect(world.scaleX).toBeCloseTo(2);
    expect(world.scaleY).toBeCloseTo(2);
  });

  it("root-heals when Node.parent is unresolvable (no throw), returning the local transform", () => {
    const { worldFixture, commandsFixture } = makeTreeFixtures();
    const { ctx } = makeApiCtx({}, worldFixture, commandsFixture);
    const api = createApi(ctx);

    let world = { x: 0, y: 0, rotation: 0, scaleX: 0, scaleY: 0 };
    expect(() => {
      world = api.worldOf(D);
    }).not.toThrow();

    expect(world).toEqual({ x: 3, y: 3, rotation: 0, scaleX: 1, scaleY: 1 });
    // parentOf still returns the stored (dangling) EditorId — the heal is a read concern only.
    expect(api.parentOf(D)).toBe(danglingId);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// childrenOf / roots ordering + reparent invalidation
// ─────────────────────────────────────────────────────────────────────────────

describe("hierarchy api — childrenOf / roots", () => {
  it("orders siblings by Node.order", () => {
    const { worldFixture, commandsFixture } = makeTreeFixtures();
    const { ctx } = makeApiCtx({}, worldFixture, commandsFixture);
    const api = createApi(ctx);

    expect(api.childrenOf(rId)).toEqual([c2Id, c1Id, c3Id]);
  });

  it("roots() orders top-level nodes the same way", () => {
    const { worldFixture, commandsFixture } = makeTreeFixtures();
    const { ctx } = makeApiCtx({}, worldFixture, commandsFixture);
    const api = createApi(ctx);

    expect(api.roots()).toEqual([r2Id, rId]);
  });

  it("a reparent (Node.parent field change) moves a node between buckets on the next epoch", () => {
    const { worldFixture, commandsFixture } = makeTreeFixtures();
    const { ctx } = makeApiCtx({}, worldFixture, commandsFixture);
    const api = createApi(ctx);

    expect(api.childrenOf(rId)).toEqual([c2Id, c1Id, c3Id]);
    expect(api.childrenOf(c1Id)).toEqual([gId]);

    const c3Node = worldFixture.nodes.get(C3);
    if (!c3Node) throw new Error("fixture setup error");
    worldFixture.nodes.set(C3, { ...c3Node, parent: c1Id });
    worldFixture.epoch += 1;

    expect(api.childrenOf(rId)).toEqual([c2Id, c1Id]);
    // G (order 0) sorts before C3 (order 3, unchanged by the reparent — only `parent` moved).
    expect(api.childrenOf(c1Id)).toEqual([gId, c3Id]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// depth
// ─────────────────────────────────────────────────────────────────────────────

describe("hierarchy api — depth", () => {
  it("a root is depth 0, its child is depth 1", () => {
    const { worldFixture, commandsFixture } = makeTreeFixtures();
    const { ctx } = makeApiCtx({}, worldFixture, commandsFixture);
    const api = createApi(ctx);

    expect(api.depth(R)).toBe(0);
    expect(api.depth(C1)).toBe(1);
  });

  it("caps at maxDepth for a pathological (cyclic) chain", () => {
    const a: Entity = asEntity(50);
    const b: Entity = asEntity(51);
    const aId = asEditorId(50);
    const bId = asEditorId(51);

    const worldFixture = makeWorldFixture({
      nodes: new Map([
        [a, { parent: bId, order: 0, name: "a", enabled: true }],
        [b, { parent: aId, order: 0, name: "b", enabled: true }]
      ])
    });
    const commandsFixture = makeCommandsFixture({
      byId: new Map([
        [aId, a],
        [bId, b]
      ]),
      byEntity: new Map([
        [a, aId],
        [b, bId]
      ])
    });
    const { ctx } = makeApiCtx({ maxDepth: 3 }, worldFixture, commandsFixture);
    const api = createApi(ctx);

    expect(api.depth(a)).toBe(3);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// canReparent
// ─────────────────────────────────────────────────────────────────────────────

describe("hierarchy api — canReparent", () => {
  it("rejects a self-reparent", () => {
    const { worldFixture, commandsFixture } = makeTreeFixtures();
    const { ctx } = makeApiCtx({}, worldFixture, commandsFixture);
    const api = createApi(ctx);

    expect(api.canReparent(c1Id, c1Id)).toBe(false);
  });

  it("rejects a cycle (newParent inside child's subtree)", () => {
    const { worldFixture, commandsFixture } = makeTreeFixtures();
    const { ctx } = makeApiCtx({}, worldFixture, commandsFixture);
    const api = createApi(ctx);

    expect(api.canReparent(c1Id, gId)).toBe(false);
  });

  it("allows a legal move to an unrelated node", () => {
    const { worldFixture, commandsFixture } = makeTreeFixtures();
    const { ctx } = makeApiCtx({}, worldFixture, commandsFixture);
    const api = createApi(ctx);

    expect(api.canReparent(c3Id, c2Id)).toBe(true);
  });

  it("allows a to-root move", () => {
    const { worldFixture, commandsFixture } = makeTreeFixtures();
    const { ctx } = makeApiCtx({}, worldFixture, commandsFixture);
    const api = createApi(ctx);

    expect(api.canReparent(c1Id, undefined)).toBe(true);
  });

  it("rejects a reparent that would push the deepest carried descendant past maxDepth", () => {
    const root = asEntity(60);
    const mid = asEntity(61);
    const deep = asEntity(62); // depth 2 — the candidate new parent
    const x = asEntity(63); // the node being reparented — has one child
    const xChild = asEntity(64);

    const rootId = asEditorId(60);
    const midId = asEditorId(61);
    const deepId = asEditorId(62);
    const xId = asEditorId(63);
    const xChildId = asEditorId(64);

    const worldFixture = makeWorldFixture({
      nodes: new Map([
        [root, { parent: undefined, order: 0, name: "root", enabled: true }],
        [mid, { parent: rootId, order: 0, name: "mid", enabled: true }],
        [deep, { parent: midId, order: 0, name: "deep", enabled: true }],
        [x, { parent: undefined, order: 0, name: "x", enabled: true }],
        [xChild, { parent: xId, order: 0, name: "xChild", enabled: true }]
      ])
    });
    const commandsFixture = makeCommandsFixture({
      byId: new Map([
        [rootId, root],
        [midId, mid],
        [deepId, deep],
        [xId, x],
        [xChildId, xChild]
      ]),
      byEntity: new Map([
        [root, rootId],
        [mid, midId],
        [deep, deepId],
        [x, xId],
        [xChild, xChildId]
      ])
    });
    const { ctx } = makeApiCtx({ maxDepth: 3 }, worldFixture, commandsFixture);
    const api = createApi(ctx);

    // depth(deep) = 2; +1 + subtreeHeight(x) = 1 => 4 > maxDepth(3).
    expect(api.canReparent(xId, deepId)).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// computeLocalForPreserveWorld
// ─────────────────────────────────────────────────────────────────────────────

describe("hierarchy api — computeLocalForPreserveWorld", () => {
  it("to-root returns worldOf(child)", () => {
    const { worldFixture, commandsFixture } = makeTreeFixtures();
    const { ctx } = makeApiCtx({}, worldFixture, commandsFixture);
    const api = createApi(ctx);

    expect(api.computeLocalForPreserveWorld(c3Id, undefined)).toEqual(api.worldOf(C3));
  });

  it("the returned local, composed under newParent's world, reproduces the child's original worldOf", () => {
    const { worldFixture, commandsFixture } = makeTreeFixtures();
    const { ctx } = makeApiCtx({}, worldFixture, commandsFixture);
    const api = createApi(ctx);

    const originalWorld = api.worldOf(C3);
    const local = api.computeLocalForPreserveWorld(c3Id, r2Id);
    const reproduced = compose(api.worldOf(R2), local);

    expect(reproduced.x).toBeCloseTo(originalWorld.x);
    expect(reproduced.y).toBeCloseTo(originalWorld.y);
    expect(reproduced.rotation).toBeCloseTo(originalWorld.rotation);
    expect(reproduced.scaleX).toBeCloseTo(originalWorld.scaleX);
    expect(reproduced.scaleY).toBeCloseTo(originalWorld.scaleY);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// orderBetween
// ─────────────────────────────────────────────────────────────────────────────

describe("hierarchy api — orderBetween", () => {
  it("returns the midpoint between two siblings", () => {
    const { worldFixture, commandsFixture } = makeTreeFixtures();
    const { ctx } = makeApiCtx({}, worldFixture, commandsFixture);
    const api = createApi(ctx);

    // c2 order 1, c1 order 2 => midpoint 1.5
    expect(api.orderBetween(rId, c2Id, c1Id)).toBe(1.5);
  });

  it("returns after - 1 when dropping before the first sibling", () => {
    const { worldFixture, commandsFixture } = makeTreeFixtures();
    const { ctx } = makeApiCtx({}, worldFixture, commandsFixture);
    const api = createApi(ctx);

    expect(api.orderBetween(rId, undefined, c2Id)).toBe(0); // c2 order 1 -> 1 - 1
  });

  it("returns before + 1 when dropping after the last sibling", () => {
    const { worldFixture, commandsFixture } = makeTreeFixtures();
    const { ctx } = makeApiCtx({}, worldFixture, commandsFixture);
    const api = createApi(ctx);

    expect(api.orderBetween(rId, c3Id, undefined)).toBe(4); // c3 order 3 -> 3 + 1
  });

  it("returns 0 for the first child (no siblings on either side)", () => {
    const { ctx } = makeApiCtx();
    const api = createApi(ctx);

    expect(api.orderBetween(undefined, undefined, undefined)).toBe(0);
  });
});
