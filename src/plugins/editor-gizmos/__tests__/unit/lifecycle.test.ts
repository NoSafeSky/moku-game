/**
 * @file editor-gizmos plugin — onStart lifecycle unit tests.
 *
 * Exercises the STAGE-PRESENT `start()` path (which the headless api/interaction/integration
 * tests never reach): capturing the four dep APIs, seeding `snap`, building the overlay
 * `Container` + translate handle via a real Pixi `Container`/`Graphics` (constructed headlessly,
 * as the vfx/ui/camera suites do), `addChild`-ing the overlay onto the stage, wiring the drag
 * pipeline, and flipping `started`. Also covers the headless branch (no stage → warn + no overlay).
 */
import { Container } from "pixi.js";
import { describe, expect, it, vi } from "vitest";
import { cameraPlugin } from "../../../camera";
import type { Api as CameraApi } from "../../../camera/types";
import type { Api as CommandsApi } from "../../../commands/types";
import { editorSelectionPlugin } from "../../../editor-selection";
import type { Api as EditorSelectionApi } from "../../../editor-selection/types";
import { rendererPlugin } from "../../../renderer";
import type { Api as RendererApi } from "../../../renderer/types";
import { type StartContext, start } from "../../lifecycle";
import { createState } from "../../state";
import type { Config } from "../../types";

const makeConfig = (over: Partial<Config> = {}): Config => ({
  overlayLayer: "editor-gizmos",
  snap: 0,
  translateOnly: true,
  ...over
});

const makeLog = () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() });

/** Build a StartContext whose renderer.getStage() returns `stage` (undefined = headless). */
const makeCtx = (stage: Container | undefined, config: Config = makeConfig()) => {
  const state = createState({ global: {}, config });
  const log = makeLog();
  const renderer = {
    getStage: () => stage,
    getEntityView: vi.fn()
  } as unknown as RendererApi;
  const camera = {} as unknown as CameraApi;
  const selection = {} as unknown as EditorSelectionApi;
  const commands = {} as unknown as CommandsApi;
  const require = ((plugin: unknown) => {
    if (plugin === rendererPlugin) return renderer;
    if (plugin === cameraPlugin) return camera;
    if (plugin === editorSelectionPlugin) return selection;
    return commands;
  }) as StartContext["require"];
  const ctx: StartContext = { config, state, log, require };
  return { ctx, state, log, renderer, camera, selection, commands };
};

describe("editor-gizmos — lifecycle (stage present)", () => {
  it("captures deps, seeds snap, builds the overlay + handle on the stage, and starts", () => {
    const stage = new Container();
    const { ctx, state } = makeCtx(stage, makeConfig({ snap: 16 }));

    start(ctx);

    // deps captured
    expect(state.renderer).toBeDefined();
    expect(state.camera).toBeDefined();
    expect(state.selection).toBeDefined();
    expect(state.commands).toBeDefined();
    expect(state.snap).toBe(16); // seeded from config.snap

    // overlay + handle built and parented under the stage
    expect(state.stage).toBe(stage);
    expect(state.overlay).toBeInstanceOf(Container);
    expect(state.handle).toBeInstanceOf(Container);
    expect(state.overlay?.visible).toBe(false); // hidden until enable()
    expect(state.overlay?.label).toBe("editor-gizmos");
    expect(stage.children).toContain(state.overlay); // stage.addChild(overlay)
    expect(state.handle?.children.length).toBe(3); // centre square + X arrow + Y arrow

    expect(state.started).toBe(true);
  });

  it("headless (no stage): warns and leaves overlay/handle undefined but still starts", () => {
    const { ctx, state, log } = makeCtx(undefined);

    start(ctx);

    expect(state.stage).toBeUndefined();
    expect(state.overlay).toBeUndefined();
    expect(state.handle).toBeUndefined();
    expect(log.warn).toHaveBeenCalled();
    expect(state.started).toBe(true);
  });
});
