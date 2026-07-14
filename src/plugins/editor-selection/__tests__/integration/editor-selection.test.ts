/**
 * @file editor-selection plugin — integration tests.
 *
 * Boots a real ecs + scheduler + renderer + tween + input + camera + editor-selection
 * stack via `createApp` (headless — renderer auto-headless in Node, so no stage / no
 * pick layer). Proves: the plugin is reachable as `app["editor-selection"]` with the
 * full surface; `select`/`toggle`/`clear` drive `selected()`/`isSelected()` and each
 * real change emits `editor-selection:changed` exactly once (asserted through a kernel
 * hook on a listener plugin) with a matching `selected` snapshot; `enable()`/`disable()`
 * flip without throwing headless and `pickAt` returns `undefined` with no stage; and a
 * despawned selected entity drops out of `selected()`.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { coreConfig } from "../../../../config";
import { cameraPlugin } from "../../../camera";
import { ecsPlugin } from "../../../ecs";
import type { Entity } from "../../../ecs/types";
import { inputPlugin } from "../../../input";
import { rendererPlugin } from "../../../renderer";
import { schedulerPlugin } from "../../../scheduler";
import { tweenPlugin } from "../../../tween";
import { editorSelectionPlugin } from "../../index";

/** Dependency-ordered plugin array (`depends` is validation-only — order is explicit). */
const PLUGINS = [
  ecsPlugin,
  schedulerPlugin,
  rendererPlugin,
  tweenPlugin,
  inputPlugin,
  cameraPlugin,
  editorSelectionPlugin
];

/** Boot the headless ecs+scheduler+renderer+tween+input+camera+editor-selection stack. */
const bootApp = () => {
  const { createApp } = coreConfig.createCore(coreConfig, { plugins: PLUGINS });
  return createApp();
};

const SURFACE = [
  "enable",
  "disable",
  "select",
  "toggle",
  "clear",
  "selected",
  "isSelected",
  "pickAt"
] as const;

describe("editor-selection integration", () => {
  // The input plugin resolves "window" → an EventTarget in onStart (the ui/input
  // integration-test precedent); provide one so listeners attach cleanly in Node.
  beforeEach(() => {
    (globalThis as Record<string, unknown>).window = new EventTarget();
  });
  afterEach(() => {
    delete (globalThis as Record<string, unknown>).window;
  });

  it("exposes app['editor-selection'] with the full surface", async () => {
    const app = bootApp();
    await app.start();

    const selection = app["editor-selection"] as unknown as Record<string, unknown>;
    for (const method of SURFACE) expect(typeof selection[method]).toBe("function");

    await app.stop();
  });

  it("select/toggle/clear drive selected()/isSelected(); each real change emits editor-selection:changed once", async () => {
    const received: Array<{ selected: readonly Entity[] }> = [];
    const { createApp, createPlugin } = coreConfig.createCore(coreConfig, { plugins: PLUGINS });
    const listenerPlugin = createPlugin("selection-listener", {
      depends: [editorSelectionPlugin],
      hooks: _ctx => ({
        "editor-selection:changed": payload => {
          received.push(payload);
        }
      })
    });

    const app = createApp({ plugins: [listenerPlugin] });
    await app.start();

    const e1 = app.ecs.spawn();
    const e2 = app.ecs.spawn();

    app["editor-selection"].select(e1);
    expect(app["editor-selection"].selected()).toEqual([e1]);
    expect(app["editor-selection"].isSelected(e1)).toBe(true);

    app["editor-selection"].select(e1); // redundant — no set change, no re-emit
    app["editor-selection"].toggle(e2); // single-select: not yet selected → replaces
    expect(app["editor-selection"].selected()).toEqual([e2]);

    app["editor-selection"].clear();
    expect(app["editor-selection"].selected()).toEqual([]);

    expect(received).toEqual([{ selected: [e1] }, { selected: [e2] }, { selected: [] }]);

    await app.stop();
  });

  it("enable()/disable() flip without throwing headless; pickAt returns undefined with no stage", async () => {
    const app = bootApp();
    await app.start();

    expect(() => app["editor-selection"].enable()).not.toThrow();
    expect(app["editor-selection"].pickAt({ x: 0, y: 0 })).toBeUndefined();
    expect(() => app["editor-selection"].disable()).not.toThrow();

    await app.stop();
  });

  it("a despawned selected entity drops out of selected()", async () => {
    const app = bootApp();
    await app.start();

    const e1 = app.ecs.spawn();
    app["editor-selection"].select(e1);
    expect(app["editor-selection"].selected()).toEqual([e1]);

    app.ecs.despawn(e1);
    expect(app["editor-selection"].selected()).toEqual([]);
    expect(app["editor-selection"].isSelected(e1)).toBe(false);

    await app.stop();
  });
});
