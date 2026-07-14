import type { Mock } from "vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// A controllable mock of the game runtime (@nosafesky/moku-game). vi.hoisted so it is defined
// before the vi.mock factory (which is hoisted above the editor-host import) references it.
const mocks = vi.hoisted(() => {
  const snapshot = {
    epoch: 0,
    entities: [],
    selection: [],
    mode: "edit",
    canUndo: false,
    canRedo: false
  };
  const canvas = { tagName: "CANVAS" };
  const app = {
    start: vi.fn(async () => {}),
    stop: vi.fn(async () => {}),
    renderer: { getView: vi.fn<() => typeof canvas | undefined>(() => canvas) },
    assets: { entries: vi.fn(() => []) },
    "editor-runtime": { enterEdit: vi.fn() },
    "editor-selection": { enable: vi.fn() },
    "editor-gizmos": { enable: vi.fn() },
    "editor-bridge": { snapshot: vi.fn(() => snapshot) }
  };
  return { snapshot, canvas, app, createApp: vi.fn(() => app) };
});

vi.mock("@nosafesky/moku-game", () => ({ createApp: mocks.createApp }));

const { getEditor, onSnapshot, startEditor, stopEditor } = await import(
  "../../src/lib/editor-host"
);

/** A fake viewport element whose `append` we can assert against. */
function fakeMount(): { element: HTMLElement; append: Mock } {
  const append = vi.fn();
  return { element: { append } as unknown as HTMLElement, append };
}

describe("editor-host", () => {
  let rafCallbacks: Array<() => void>;
  let requestFrame: Mock;
  let cancelFrame: Mock;

  beforeEach(() => {
    rafCallbacks = [];
    requestFrame = vi.fn((cb: FrameRequestCallback) => {
      rafCallbacks.push(() => cb(0));
      return rafCallbacks.length;
    });
    cancelFrame = vi.fn();
    vi.stubGlobal("requestAnimationFrame", requestFrame);
    vi.stubGlobal("cancelAnimationFrame", cancelFrame);
  });

  afterEach(async () => {
    await stopEditor();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("boots the game app and mounts the canvas into the viewport (W1)", async () => {
    const { element, append } = fakeMount();

    const handles = await startEditor(element);

    expect(mocks.createApp).toHaveBeenCalledTimes(1);
    expect(mocks.createApp).toHaveBeenCalledWith({
      pluginConfigs: {
        loop: { autoStart: true },
        renderer: { mount: undefined },
        mcp: { transports: ["inMemory"], inMemoryGlobalKey: "" }
      }
    });
    expect(mocks.app.start).toHaveBeenCalledTimes(1);
    expect(append).toHaveBeenCalledWith(mocks.canvas);
    expect(mocks.app["editor-runtime"].enterEdit).toHaveBeenCalledTimes(1);
    expect(mocks.app["editor-selection"].enable).toHaveBeenCalledTimes(1);
    expect(mocks.app["editor-gizmos"].enable).toHaveBeenCalledTimes(1);
    expect(handles.bridge).toBe(mocks.app["editor-bridge"]);
    expect(handles.canvas).toBe(mocks.canvas);
    expect(getEditor()).toBe(handles);
  });

  it("polls bridge.snapshot() and notifies onSnapshot subscribers (W1)", async () => {
    await startEditor(fakeMount().element);

    const seen: unknown[] = [];
    onSnapshot(snapshot => seen.push(snapshot));
    expect(seen).toHaveLength(0); // no poll has run yet → no immediate fire

    rafCallbacks[0]?.(); // drive exactly one frame → one poll
    expect(mocks.app["editor-bridge"].snapshot).toHaveBeenCalledTimes(1);
    expect(seen).toEqual([mocks.snapshot]);

    // A late subscriber receives the latest snapshot immediately.
    const late: unknown[] = [];
    onSnapshot(snapshot => late.push(snapshot));
    expect(late).toEqual([mocks.snapshot]);
  });

  it("getEditor() throws before startEditor() has resolved (W1)", () => {
    expect(() => getEditor()).toThrow(/Not started/);
  });

  it("is idempotent — a second startEditor() reuses the booted handles (W1)", async () => {
    const first = await startEditor(fakeMount().element);
    const second = await startEditor(fakeMount().element);

    expect(second).toBe(first);
    expect(mocks.createApp).toHaveBeenCalledTimes(1);
    expect(mocks.app.start).toHaveBeenCalledTimes(1);
  });

  it("stopEditor() cancels the rAF loop, drops subscribers, and stops the game app (W1)", async () => {
    await startEditor(fakeMount().element);
    onSnapshot(() => {});

    await stopEditor();

    expect(cancelFrame).toHaveBeenCalled();
    expect(mocks.app.stop).toHaveBeenCalledTimes(1);
    expect(() => getEditor()).toThrow(/Not started/);
  });

  it("stopEditor() is a no-op when the editor was never started (W1)", async () => {
    await expect(stopEditor()).resolves.toBeUndefined();
    expect(mocks.app.stop).not.toHaveBeenCalled();
  });

  it("stops the just-booted game app and throws when the renderer yields no canvas (W1)", async () => {
    mocks.app.renderer.getView.mockReturnValueOnce(undefined);

    await expect(startEditor(fakeMount().element)).rejects.toThrow(/no canvas/i);
    expect(mocks.app.stop).toHaveBeenCalledTimes(1); // failed boot torn down, not orphaned
    expect(() => getEditor()).toThrow(/Not started/); // handles never assigned → retry starts clean
  });
});
