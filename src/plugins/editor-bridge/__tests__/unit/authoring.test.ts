/**
 * @file editor-bridge plugin — authoring orchestrator unit tests.
 *
 * Drives `reparent`/`deleteSubtrees`/`duplicateSubtrees` over STUB facets (no kernel) and asserts
 * the exact command bursts + gesture bracketing via a shared "calls ledger" — each stubbed
 * `history` method appends a tag to a plain array, so assertions read as an ordered list rather
 * than fragile mock-call-order plumbing.
 */
import { describe, expect, it, type Mock, vi } from "vitest";

import type { Command, CommandResult, EditorId } from "../../../commands/types";
import type { Component, Entity } from "../../../ecs/types";
import type { NodeValue } from "../../../hierarchy/types";
import type { TransformValue } from "../../../renderer/types";
import type { AuthoringFacets, HierarchyFacet, HistoryFacet } from "../../authoring";
import { deleteSubtrees, duplicateSubtrees, idFromSpawn, reparent } from "../../authoring";
import { asEditorId, asEntity } from "../mock-deps";

/** A stable, never-invoked fake `Node` component token. */
const NODE_TOKEN = vi.fn() as unknown as Component<NodeValue>;

/** Renders a `Command` as a short, readable tag for the calls ledger. */
const tag = (command: Command): string => {
  if (command.kind === "setField")
    return `setField:${command.component}.${command.field}=${JSON.stringify(command.value)}`;
  if (command.kind === "despawn") return `despawn:${command.id}`;
  if (command.kind === "spawn") return `spawn:${JSON.stringify(command.components)}`;
  return command.kind;
};

/**
 * A `HistoryFacet` whose `beginGesture`/`endGesture`/`applyTracked` each append a tag to a shared
 * ledger array, and whose `applyTracked` relays a caller-supplied `respond` function's result
 * (default: `{ ok: true, inverse: command }`).
 */
const makeLedgerHistory = (
  ledger: string[],
  respond: (command: Command) => CommandResult = command => ({ ok: true, inverse: command })
): HistoryFacet => ({
  beginGesture: () => {
    ledger.push("begin");
  },
  endGesture: () => {
    ledger.push("end");
  },
  applyTracked: (command: Command): CommandResult => {
    ledger.push(tag(command));
    return respond(command);
  }
});

/** A default `HierarchyFacet` stub, overridable per test. */
const makeHierarchy = (overrides: Partial<HierarchyFacet> = {}): HierarchyFacet => ({
  Node: NODE_TOKEN,
  childrenOf: () => [],
  canReparent: () => true,
  computeLocalForPreserveWorld: () => ({ x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1 }),
  orderBetween: () => 0,
  ...overrides
});

describe("authoring — idFromSpawn", () => {
  it("recovers the minted EditorId from a spawn's despawn inverse", () => {
    const id = asEditorId(42);
    expect(idFromSpawn({ ok: true, inverse: { kind: "despawn", id } })).toBe(id);
  });

  it("throws a diagnostic when the result did not carry a despawn inverse", () => {
    expect(() => idFromSpawn({ ok: false, error: "nope" })).toThrow(/despawn inverse/);
  });
});

describe("authoring — reparent", () => {
  it("preserve-world: brackets a gesture and emits the 5 Transform setFields + Node.parent + Node.order, in order", () => {
    const ledger: string[] = [];
    const local: TransformValue = { x: 10, y: 20, rotation: 0.5, scaleX: 2, scaleY: 3 };
    const facets: AuthoringFacets = {
      history: makeLedgerHistory(ledger),
      hierarchy: makeHierarchy({
        computeLocalForPreserveWorld: () => local,
        orderBetween: () => 7
      }),
      commands: { resolve: () => undefined },
      world: { get: () => undefined, componentsOf: () => [] }
    };

    const id = asEditorId(1);
    const newParent = asEditorId(2);
    const result = reparent(facets, id, newParent);

    expect(ledger).toEqual([
      "begin",
      `setField:Transform.x=${JSON.stringify(local.x)}`,
      `setField:Transform.y=${JSON.stringify(local.y)}`,
      `setField:Transform.rotation=${JSON.stringify(local.rotation)}`,
      `setField:Transform.scaleX=${JSON.stringify(local.scaleX)}`,
      `setField:Transform.scaleY=${JSON.stringify(local.scaleY)}`,
      `setField:Node.parent=${JSON.stringify(newParent)}`,
      "setField:Node.order=7",
      "end"
    ]);
    expect(result.ok).toBe(true);
  });

  it("keep-local: skips the 5 Transform setFields", () => {
    const ledger: string[] = [];
    const facets: AuthoringFacets = {
      history: makeLedgerHistory(ledger),
      hierarchy: makeHierarchy({ orderBetween: () => 3 }),
      commands: { resolve: () => undefined },
      world: { get: () => undefined, componentsOf: () => [] }
    };

    reparent(facets, asEditorId(1), asEditorId(2), { mode: "keep-local" });

    expect(ledger).toEqual(["begin", "setField:Node.parent=2", "setField:Node.order=3", "end"]);
  });

  it("invalid move (canReparent -> false): returns { ok: false } and emits NO command and NO gesture", () => {
    const beginGesture = vi.fn();
    const endGesture = vi.fn();
    const applyTracked = vi.fn();
    const facets: AuthoringFacets = {
      history: { beginGesture, endGesture, applyTracked },
      hierarchy: makeHierarchy({ canReparent: () => false }),
      commands: { resolve: () => undefined },
      world: { get: () => undefined, componentsOf: () => [] }
    };

    const result = reparent(facets, asEditorId(1), asEditorId(2));

    expect(result.ok).toBe(false);
    expect(beginGesture).not.toHaveBeenCalled();
    expect(endGesture).not.toHaveBeenCalled();
    expect(applyTracked).not.toHaveBeenCalled();
  });

  it("preserve-world inverse restores the old parent + old local transform + old order (zero drift)", () => {
    const store: { Transform: Record<string, unknown>; Node: Record<string, unknown> } = {
      Transform: { x: 1, y: 2, rotation: 0, scaleX: 1, scaleY: 1 },
      Node: { parent: asEditorId(9), order: 3 }
    };
    const original = structuredClone(store);
    const inverses: Command[] = [];

    const applyTracked = (command: Command): CommandResult => {
      if (command.kind !== "setField") throw new Error("expected only setField commands");
      const table = store[command.component as "Transform" | "Node"];
      const old = table[command.field];
      table[command.field] = command.value;
      const inverse: Command = {
        kind: "setField",
        id: command.id,
        component: command.component,
        field: command.field,
        value: old
      };
      inverses.push(inverse);
      return { ok: true, inverse };
    };

    const facets: AuthoringFacets = {
      history: { beginGesture: () => {}, endGesture: () => {}, applyTracked },
      hierarchy: makeHierarchy({
        computeLocalForPreserveWorld: () => ({ x: 10, y: 20, rotation: 0.5, scaleX: 2, scaleY: 3 }),
        orderBetween: () => 7
      }),
      commands: { resolve: () => undefined },
      world: { get: () => undefined, componentsOf: () => [] }
    };

    reparent(facets, asEditorId(1), asEditorId(2));
    expect(store).not.toEqual(original);

    // Undo replays the recorded inverses in REVERSE order.
    for (const inverse of inverses.toReversed()) {
      if (inverse.kind !== "setField") continue;
      store[inverse.component as "Transform" | "Node"][inverse.field] = inverse.value;
    }

    expect(store).toEqual(original);
  });
});

describe("authoring — deleteSubtrees", () => {
  const ROOT = asEditorId(1);
  const CHILD_A = asEditorId(2);
  const GRANDCHILD = asEditorId(3);
  const CHILD_B = asEditorId(4);

  const childrenOf = (id: EditorId): readonly EditorId[] => {
    if (id === ROOT) return [CHILD_A, CHILD_B];
    if (id === CHILD_A) return [GRANDCHILD];
    return [];
  };

  it("despawns the whole subtree deepest-first, in ONE gesture", () => {
    const ledger: string[] = [];
    const facets: AuthoringFacets = {
      history: makeLedgerHistory(ledger),
      hierarchy: makeHierarchy({ childrenOf }),
      commands: { resolve: () => undefined },
      world: { get: () => undefined, componentsOf: () => [] }
    };

    deleteSubtrees(facets, [ROOT]);

    expect(ledger).toEqual([
      "begin",
      `despawn:${CHILD_B}`,
      `despawn:${GRANDCHILD}`,
      `despawn:${CHILD_A}`,
      `despawn:${ROOT}`,
      "end"
    ]);
  });

  it("self-heals on undo: the recorded despawn inverses respawn shallowest-first with each original Node.parent ref", () => {
    const originalNodeOf: Record<number, NodeValue> = {
      [ROOT]: { parent: undefined, order: 0, name: "Root", enabled: true },
      [CHILD_A]: { parent: ROOT, order: 0, name: "A", enabled: true },
      [GRANDCHILD]: { parent: CHILD_A, order: 0, name: "Grandchild", enabled: true },
      [CHILD_B]: { parent: ROOT, order: 1, name: "B", enabled: true }
    };
    const applyTracked = (command: Command): CommandResult => {
      if (command.kind !== "despawn") throw new Error("expected only despawn commands");
      const node = originalNodeOf[command.id];
      return { ok: true, inverse: { kind: "spawn", id: command.id, components: { Node: node } } };
    };
    const results: CommandResult[] = [];
    const facets: AuthoringFacets = {
      history: {
        beginGesture: () => {},
        endGesture: () => {},
        applyTracked: (command: Command): CommandResult => {
          const result = applyTracked(command);
          results.push(result);
          return result;
        }
      },
      hierarchy: makeHierarchy({ childrenOf }),
      commands: { resolve: () => undefined },
      world: { get: () => undefined, componentsOf: () => [] }
    };

    deleteSubtrees(facets, [ROOT]);

    // Undo replays the recorded inverses in REVERSE order — shallowest-first respawn.
    const respawnOrder = results
      .toReversed()
      .map(result =>
        result.ok && result.inverse.kind === "spawn" ? result.inverse.id : undefined
      );
    expect(respawnOrder).toEqual([ROOT, CHILD_A, GRANDCHILD, CHILD_B]);

    const parentOfRespawned = (id: EditorId): EditorId | undefined => originalNodeOf[id]?.parent;
    expect(parentOfRespawned(CHILD_A)).toBe(ROOT);
    expect(parentOfRespawned(GRANDCHILD)).toBe(CHILD_A);
    expect(parentOfRespawned(CHILD_B)).toBe(ROOT);
  });
});

describe("authoring — duplicateSubtrees", () => {
  it("clones the subtree parents-first, remapping Node.parent (top-level keeps source parent; descendant points at the clone), in ONE gesture", () => {
    const EXTERNAL_PARENT = asEditorId(99);
    const ROOT = asEditorId(1);
    const CHILD = asEditorId(2);
    let nextMintedId = 1000;

    const nodeOf: Record<number, NodeValue> = {
      [ROOT]: { parent: EXTERNAL_PARENT, order: 0, name: "Root", enabled: true },
      [CHILD]: { parent: ROOT, order: 0, name: "Child", enabled: true }
    };
    const childrenOf = (id: EditorId): readonly EditorId[] => (id === ROOT ? [CHILD] : []);
    const resolve = (id: EditorId): Entity | undefined => asEntity(id);
    // Typed as the bare (any-based) `Mock` — `WorldFacet.get` is generic over `T`, and a concrete
    // `NodeValue`-returning stub is not itself assignable to `<T>(...) => T | undefined`.
    const get: Mock = vi.fn((entity: Entity) => nodeOf[entity]);
    const componentsOf = (entity: Entity): ReadonlyArray<{ name: string; value: unknown }> => [
      { name: "Node", value: get(entity) },
      { name: "Transform", value: { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1 } }
    ];

    const spawnedParents: Array<EditorId | undefined> = [];
    const ledger: string[] = [];
    const facets: AuthoringFacets = {
      history: {
        beginGesture: () => {
          ledger.push("begin");
        },
        endGesture: () => {
          ledger.push("end");
        },
        applyTracked: (command: Command): CommandResult => {
          if (command.kind !== "spawn") throw new Error("expected only spawn commands");
          ledger.push("spawn");
          const node = command.components.Node as NodeValue;
          spawnedParents.push(node.parent);
          const mintedId = asEditorId(nextMintedId);
          nextMintedId += 1;
          return { ok: true, inverse: { kind: "despawn", id: mintedId } };
        }
      },
      hierarchy: makeHierarchy({ childrenOf }),
      commands: { resolve },
      world: { get, componentsOf }
    };

    const clones = duplicateSubtrees(facets, [ROOT]);

    expect(ledger).toEqual(["begin", "spawn", "spawn", "end"]);
    // Parents-first: the root's clone is spawned BEFORE the child's clone.
    expect(spawnedParents).toEqual([EXTERNAL_PARENT, 1000]);
    expect(clones).toEqual([1000]);
  });
});
