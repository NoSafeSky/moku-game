/**
 * @file asset-store plugin — type-level tests.
 *
 * Compile-time only (checked by `tsc --noEmit`, not collected by vitest's `unit`/`integration`
 * projects — see `vitest.config.ts`'s `include` globs, which match `*.test.ts` not `*.test-d.ts`).
 * Asserts: `app["asset-store"]` is the `Api`; `import` resolves `Promise<StoredAsset>`; `url`
 * resolves `string | undefined`; `emit("asset-store:imported"/"removed", …)` payloads are typed
 * (`@ts-expect-error` on a wrong shape); `AssetBackend.put` resolves `Promise<boolean>`. No
 * explicit generics on `createPlugin` and no Pixi type on the surface are structural properties of
 * `index.ts`/`types.ts` verified by inspection, not re-asserted here.
 */
import { describe, expect, expectTypeOf, it } from "vitest";

import { coreConfig } from "../../../../config";
import { assetStorePlugin } from "../../index";
import type { Api, AssetBackend, StoredAsset } from "../../types";

describe("asset-store types", () => {
  it('app["asset-store"] is the Api', () => {
    const { createApp } = coreConfig.createCore(coreConfig, { plugins: [assetStorePlugin] });
    const app = createApp();

    expectTypeOf(app["asset-store"]).toMatchTypeOf<Api>();
  });

  it("import resolves Promise<StoredAsset>", () => {
    const { createApp } = coreConfig.createCore(coreConfig, { plugins: [assetStorePlugin] });
    const app = createApp();

    expectTypeOf(app["asset-store"].import).returns.toEqualTypeOf<Promise<StoredAsset>>();
  });

  it("url resolves string | undefined (synchronous)", () => {
    const { createApp } = coreConfig.createCore(coreConfig, { plugins: [assetStorePlugin] });
    const app = createApp();

    expectTypeOf(app["asset-store"].url).toEqualTypeOf<(alias: string) => string | undefined>();
  });

  it("has / entries are synchronous; get / remove are async", () => {
    const { createApp } = coreConfig.createCore(coreConfig, { plugins: [assetStorePlugin] });
    const app = createApp();

    expectTypeOf(app["asset-store"].has).toEqualTypeOf<(alias: string) => boolean>();
    expectTypeOf(app["asset-store"].entries).returns.not.toMatchTypeOf<Promise<unknown>>();
    expectTypeOf(app["asset-store"].get).returns.toMatchTypeOf<Promise<unknown>>();
    expectTypeOf(app["asset-store"].remove).returns.toEqualTypeOf<Promise<void>>();
  });

  it("AssetBackend.put resolves Promise<boolean>", () => {
    expectTypeOf<AssetBackend["put"]>().returns.toEqualTypeOf<Promise<boolean>>();
  });

  it('emit("asset-store:imported", …) payload is type-checked', () => {
    const { createPlugin } = coreConfig.createCore(coreConfig, { plugins: [assetStorePlugin] });

    const plugin = createPlugin("type-check-imported", {
      depends: [assetStorePlugin],
      api: ctx => ({
        test: () => {
          ctx.emit("asset-store:imported", { alias: "a", mime: "image/png", byteLength: 1 });
          // @ts-expect-error -- "size" is not a valid key (should be "byteLength")
          ctx.emit("asset-store:imported", { alias: "a", mime: "image/png", size: 1 });
        }
      })
    });

    expect(plugin.name).toBe("type-check-imported");
  });

  it('emit("asset-store:removed", …) payload is type-checked', () => {
    const { createPlugin } = coreConfig.createCore(coreConfig, { plugins: [assetStorePlugin] });

    const plugin = createPlugin("type-check-removed", {
      depends: [assetStorePlugin],
      api: ctx => ({
        test: () => {
          ctx.emit("asset-store:removed", { alias: "a" });
          // @ts-expect-error -- "id" is not a valid key (should be "alias")
          ctx.emit("asset-store:removed", { id: "a" });
        }
      })
    });

    expect(plugin.name).toBe("type-check-removed");
  });
});
