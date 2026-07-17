/**
 * @file editor-gizmos plugin — integration tests.
 *
 * Boots a real ecs + scheduler + renderer + tween + input + camera + editor-selection +
 * commands + editor-gizmos stack via `createApp` (headless — renderer auto-headless in Node,
 * so no stage / no overlay). Proves: the plugin is reachable as `app["editor-gizmos"]` with
 * the full surface; `setMode`/`setSnap`/`mode` work on numeric state headless; the translate-only
 * MVP gate keeps rotate/scale no-op; `enable()`/`disable()` flip without throwing with no stage;
 * and `setGestureSink` accepts a sink and `undefined`.
 *
 * **Phase-1 F3** additionally proves the gate flip end-to-end: with the FRAMEWORK DEFAULT
 * (`translateOnly: true`) `setMode("rotate"|"scale"|"rect")` still no-ops, while an app that
 * opts in with `editor-gizmos: { translateOnly: false }` (as the editor shell does) can select
 * every widened mode; and that `setSpace`/`setPivot`/`space`/`pivot` are headless-safe pure
 * state, unaffected by the gate.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { coreConfig } from "../../../../config";
import { cameraPlugin } from "../../../camera";
import { commandsPlugin } from "../../../commands";
import { ecsPlugin } from "../../../ecs";
import { editorSelectionPlugin } from "../../../editor-selection";
import { inputPlugin } from "../../../input";
import { rendererPlugin } from "../../../renderer";
import { schedulerPlugin } from "../../../scheduler";
import { tweenPlugin } from "../../../tween";
import { editorGizmosPlugin } from "../../index";

/** Dependency-ordered plugin array (`depends` is validation-only — order is explicit). */
const PLUGINS = [
  ecsPlugin,
  schedulerPlugin,
  rendererPlugin,
  tweenPlugin,
  inputPlugin,
  cameraPlugin,
  commandsPlugin,
  editorSelectionPlugin,
  editorGizmosPlugin
];

/** Per-plugin config overrides accepted by {@link bootApp}. */
type TestPluginConfigs = { "editor-gizmos"?: { translateOnly?: boolean } };

/** Boot the headless editor-gizmos stack (default config unless overrides are passed). */
const bootApp = (pluginConfigs: TestPluginConfigs = {}) => {
  const { createApp } = coreConfig.createCore(coreConfig, { plugins: PLUGINS });
  return createApp({ pluginConfigs });
};

const SURFACE = [
  "enable",
  "disable",
  "setMode",
  "setSnap",
  "mode",
  "setSpace",
  "setPivot",
  "space",
  "pivot",
  "setGestureSink"
] as const;

describe("editor-gizmos integration", () => {
  // editor-selection's input dep resolves "window" → an EventTarget in onStart; provide one.
  beforeEach(() => {
    (globalThis as Record<string, unknown>).window = new EventTarget();
  });
  afterEach(() => {
    delete (globalThis as Record<string, unknown>).window;
  });

  it("exposes app['editor-gizmos'] with the full surface", async () => {
    const app = bootApp();
    await app.start();

    const gizmos = app["editor-gizmos"] as unknown as Record<string, unknown>;
    for (const method of SURFACE) expect(typeof gizmos[method]).toBe("function");

    await app.stop();
  });

  it("setMode/mode work; translate-only gate keeps rotate/scale a no-op", async () => {
    const app = bootApp();
    await app.start();

    expect(app["editor-gizmos"].mode()).toBe("translate");

    app["editor-gizmos"].setMode("rotate"); // gated by translateOnly (default true) → warn + no-op
    expect(app["editor-gizmos"].mode()).toBe("translate");

    app["editor-gizmos"].setMode("scale");
    expect(app["editor-gizmos"].mode()).toBe("translate");

    app["editor-gizmos"].setMode("rect");
    expect(app["editor-gizmos"].mode()).toBe("translate");

    app["editor-gizmos"].setMode("translate"); // the one functional mode
    expect(app["editor-gizmos"].mode()).toBe("translate");

    await app.stop();
  });

  it("opting out of the gate (translateOnly:false) enables every widened mode", async () => {
    const app = bootApp({ "editor-gizmos": { translateOnly: false } });
    await app.start();

    expect(app["editor-gizmos"].mode()).toBe("translate"); // the default is unchanged

    app["editor-gizmos"].setMode("rotate");
    expect(app["editor-gizmos"].mode()).toBe("rotate");

    app["editor-gizmos"].setMode("scale");
    expect(app["editor-gizmos"].mode()).toBe("scale");

    app["editor-gizmos"].setMode("rect");
    expect(app["editor-gizmos"].mode()).toBe("rect");

    await app.stop();
  });

  it("setSpace/setPivot round-trip headless and are ungated by translateOnly", async () => {
    const app = bootApp(); // the FRAMEWORK DEFAULT — translateOnly stays true
    await app.start();

    expect(app["editor-gizmos"].space()).toBe("global");
    expect(app["editor-gizmos"].pivot()).toBe("pivot");

    app["editor-gizmos"].setSpace("local");
    app["editor-gizmos"].setPivot("center");

    expect(app["editor-gizmos"].space()).toBe("local");
    expect(app["editor-gizmos"].pivot()).toBe("center");

    await app.stop();
  });

  it("enable()/disable() flip without throwing headless; setSnap + setGestureSink accept input", async () => {
    const app = bootApp();
    await app.start();

    expect(() => app["editor-gizmos"].enable()).not.toThrow();
    expect(() => app["editor-gizmos"].disable()).not.toThrow();
    expect(() => app["editor-gizmos"].setSnap(8)).not.toThrow();

    const sink = { begin: () => undefined, applyTracked: () => undefined, end: () => undefined };
    expect(() => app["editor-gizmos"].setGestureSink(sink)).not.toThrow();
    expect(() => app["editor-gizmos"].setGestureSink(undefined)).not.toThrow();

    await app.stop();
  });
});
