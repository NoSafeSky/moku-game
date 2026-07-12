/**
 * @file ui plugin — type-level tests.
 *
 * Compile-time contracts (no runtime behaviour): the screen/widget handles are
 * nominally distinct (a `ScreenHandle` is not a `WidgetHandle`), `WidgetSpec` is a
 * discriminated union on `kind`, and `getRoot` exposes only the structural `Container`
 * handle. These assertions fail the build (tsc) rather than the test run.
 */
import type { Container } from "pixi.js";
import { describe, expect, expectTypeOf, it } from "vitest";
import type { Api, ScreenHandle, WidgetHandle, WidgetSpec } from "../../types";

/** Accept only a valid WidgetSpec — used to probe the discriminated union. */
const acceptSpec = (_spec: WidgetSpec): void => {};

/**
 * Type-only probe (never executed): the screen/widget handles are nominally
 * distinct, so the `@ts-expect-error` lines are the compile-time assertions.
 */
const handlesAreDistinct = (api: Api, screen: ScreenHandle, widget: WidgetHandle): void => {
  // @ts-expect-error — removeHud takes a WidgetHandle, not a ScreenHandle
  api.removeHud(screen);
  // @ts-expect-error — getWidget's first arg is a ScreenHandle, not a WidgetHandle
  api.getWidget(widget, "x");
};

describe("ui types", () => {
  it("pushScreen returns ScreenHandle and addHud returns WidgetHandle", () => {
    expectTypeOf<Api["pushScreen"]>().returns.toEqualTypeOf<ScreenHandle>();
    expectTypeOf<Api["addHud"]>().returns.toEqualTypeOf<WidgetHandle>();
  });

  it("getRoot exposes only the structural Container handle", () => {
    expectTypeOf<Api["getRoot"]>().returns.toEqualTypeOf<Container | undefined>();
  });

  it("ScreenHandle and WidgetHandle are not interchangeable", () => {
    expect(handlesAreDistinct).toBeTypeOf("function");
  });

  it("WidgetSpec is a discriminated union on kind", () => {
    acceptSpec({ kind: "label", text: "ok" });
    acceptSpec({ kind: "button", text: "Go", onTap: () => {} });
    // @ts-expect-error — "slider" is not a WidgetSpec kind
    acceptSpec({ kind: "slider", value: 1 });
    // @ts-expect-error — a button spec requires onTap
    acceptSpec({ kind: "button", text: "Go" });
    // @ts-expect-error — a bar spec requires value + max
    acceptSpec({ kind: "bar", width: 10, height: 4 });
    expect(acceptSpec).toBeTypeOf("function");
  });
});
