/**
 * @file component-registry plugin — integration tests.
 *
 * Builds a minimal core with ONLY componentRegistryPlugin — no other plugin. This is deliberate:
 * `depends` is empty, so the plugin must build, start, register/list/byCategory, and stop
 * completely standalone.
 */
import { describe, expect, it } from "vitest";

import { coreConfig } from "../../../../config";
import { componentRegistryPlugin } from "../../index";

/**
 * Create a minimal test app with only component-registry — proves the empty `depends`.
 *
 * @returns The synchronous app instance.
 */
const createTestApp = () => {
  const { createApp } = coreConfig.createCore(coreConfig, {
    plugins: [componentRegistryPlugin]
  });
  return createApp();
};

describe("component-registry plugin — integration", () => {
  it("starts standalone (no other plugin) and exposes app['component-registry']", async () => {
    const app = createTestApp();
    await app.start();

    expect(app["component-registry"]).toBeDefined();

    await app.stop();
  });

  it("register + list + byCategory round-trip through the real app", async () => {
    const app = createTestApp();
    await app.start();

    app["component-registry"].register({
      name: "Shape",
      category: "Rendering",
      defaults: { kind: "rect" },
      addable: true
    });

    expect(app["component-registry"].list()).toStrictEqual([
      { name: "Shape", category: "Rendering", defaults: { kind: "rect" }, addable: true }
    ]);
    expect(app["component-registry"].byCategory().get("Rendering")).toHaveLength(1);

    await app.stop();
  });

  it("stop() tears down with nothing to release", async () => {
    const app = createTestApp();
    await app.start();

    await expect(app.stop()).resolves.toBeUndefined();
  });
});
