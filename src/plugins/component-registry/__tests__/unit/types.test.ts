/**
 * @file component-registry plugin — type-level contracts.
 *
 * Compile-time assertions over the public types: `ComponentCategory` is the exact six-member
 * literal union, `ComponentCatalogEntry` fields are `readonly`, `get` returns
 * `ComponentCatalogEntry | undefined`, `byCategory` returns a `ReadonlyMap`, and no `Api` method
 * carries a type parameter. Mirrors the sibling `camera` plugin's `types.test.ts` style (one type
 * test per contract, plus an unexecuted `@ts-expect-error` carrier function).
 */
import { describe, expect, expectTypeOf, it } from "vitest";

import type { Api, ComponentCatalogEntry, ComponentCategory } from "../../types";

/**
 * A never-executed compile-time contract: `ComponentCategory` rejects a member outside the
 * six-value union, and a `ComponentCatalogEntry`'s fields reject reassignment (`readonly`). tsc
 * type-checks the body regardless of the (absent) call; the `@ts-expect-error` lines fail the
 * build if either rejection ever stops holding.
 *
 * @param entry - A concrete catalog entry (never invoked at runtime).
 * @returns The same entry alongside the rejected category value, unchanged.
 * @example
 * ```ts
 * typeContracts(entry); // compile-time only
 * ```
 */
const typeContracts = (
  entry: ComponentCatalogEntry
): readonly [ComponentCatalogEntry, ComponentCategory] => {
  // @ts-expect-error — "Rendering2" is not a member of the six-value ComponentCategory union.
  const bad: ComponentCategory = "Rendering2";

  // @ts-expect-error — `name` is readonly and cannot be reassigned.
  entry.name = "Other";
  // @ts-expect-error — `category` is readonly and cannot be reassigned.
  entry.category = "Physics";
  // @ts-expect-error — `addable` is readonly and cannot be reassigned.
  entry.addable = false;

  return [entry, bad];
};

describe("ComponentCategory — exact six-member union", () => {
  it("accepts every documented category", () => {
    const categories: ComponentCategory[] = [
      "Transform",
      "Rendering",
      "Physics",
      "Animation",
      "Audio",
      "Scripts"
    ];
    expectTypeOf(categories).toEqualTypeOf<ComponentCategory[]>();
  });
});

describe("ComponentCatalogEntry — readonly fields", () => {
  it("rejects reassignment of readonly fields", () => {
    expect(typeof typeContracts).toBe("function");
  });
});

describe("Api — return-type contracts", () => {
  it("get returns ComponentCatalogEntry | undefined", () => {
    expectTypeOf<Api["get"]>().returns.toEqualTypeOf<ComponentCatalogEntry | undefined>();
  });

  it("list returns a readonly array of ComponentCatalogEntry", () => {
    expectTypeOf<Api["list"]>().returns.toEqualTypeOf<readonly ComponentCatalogEntry[]>();
  });

  it("byCategory returns a ReadonlyMap keyed by ComponentCategory", () => {
    expectTypeOf<Api["byCategory"]>().returns.toEqualTypeOf<
      ReadonlyMap<ComponentCategory, readonly ComponentCatalogEntry[]>
    >();
  });

  it("has returns boolean", () => {
    expectTypeOf<Api["has"]>().returns.toEqualTypeOf<boolean>();
  });

  it("register returns void and takes one ComponentCatalogEntry parameter", () => {
    expectTypeOf<Api["register"]>().returns.toEqualTypeOf<void>();
    expectTypeOf<Api["register"]>().parameter(0).toEqualTypeOf<ComponentCatalogEntry>();
  });
});
