/**
 * @file hierarchy plugin — type-level contracts.
 *
 * Compile-time assertions over the public `Api` surface: `Node` is `Component<NodeValue>`;
 * `worldOf`/`computeLocalForPreserveWorld` return `TransformValue`; `parentOf`/`orderBetween`
 * return `EditorId | undefined` / `number`; `childrenOf`/`roots` return `readonly EditorId[]`
 * (rejecting `.push`); no method carries a type parameter. Mirrors the sibling `camera` plugin's
 * `types.test.ts` (one type test per API return type + a `@ts-expect-error` rejection).
 */
import { describe, expectTypeOf, it } from "vitest";
import type { EditorId } from "../../../commands/types";
import type { Component, Entity } from "../../../ecs/types";
import type { TransformValue } from "../../../renderer/types";
import type { Api, NodeValue } from "../../types";

describe("hierarchy Api — return-type contracts", () => {
  it("Node is Component<NodeValue>", () => {
    expectTypeOf<Api["Node"]>().toEqualTypeOf<Component<NodeValue>>();
  });

  it("worldOf / computeLocalForPreserveWorld return TransformValue", () => {
    expectTypeOf<Api["worldOf"]>().returns.toEqualTypeOf<TransformValue>();
    expectTypeOf<Api["computeLocalForPreserveWorld"]>().returns.toEqualTypeOf<TransformValue>();
  });

  it("parentOf returns EditorId | undefined; orderBetween returns number", () => {
    expectTypeOf<Api["parentOf"]>().returns.toEqualTypeOf<EditorId | undefined>();
    expectTypeOf<Api["orderBetween"]>().returns.toEqualTypeOf<number>();
  });

  it("childrenOf / roots return readonly EditorId[]", () => {
    expectTypeOf<Api["childrenOf"]>().returns.toEqualTypeOf<readonly EditorId[]>();
    expectTypeOf<Api["roots"]>().returns.toEqualTypeOf<readonly EditorId[]>();
  });
});

// Never-executed compile-time contracts, declared at module scope (the sibling `camera` plugin's
// `types.test.ts` precedent): tsc type-checks the bodies regardless of the absent call, so each
// `@ts-expect-error` fails the build if the rejection ever stops holding.
const rejectsMutatingChildren = (api: Api): void => {
  const kids = api.childrenOf(1 as EditorId);
  // @ts-expect-error — childrenOf returns a readonly array; push is not allowed.
  kids.push(2 as EditorId);
};

const rejectsTypeArguments = (api: Api, entity: Entity): void => {
  // @ts-expect-error — worldOf takes no type parameters.
  api.worldOf<number>(entity);
};

describe("hierarchy Api — compile-time rejections", () => {
  it("rejects mutating a readonly EditorId[] result", () => {
    expectTypeOf(rejectsMutatingChildren).toBeFunction();
  });

  it("rejects explicit type arguments on an API method", () => {
    expectTypeOf(rejectsTypeArguments).toBeFunction();
  });
});
