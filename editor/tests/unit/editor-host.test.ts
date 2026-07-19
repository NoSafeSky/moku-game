import type { Mock } from "vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// A controllable mock of the game runtime (@nosafesky/ludemic). vi.hoisted so it is defined
// before the vi.mock factory (which is hoisted above the editor-host import) references it.
const mocks = vi.hoisted(() => {
  const snapshot = {
    epoch: 0,
    entities: [] as { id: number }[],
    selection: [] as number[],
    mode: "edit",
    canUndo: false,
    canRedo: false
  };
  const canvas = { tagName: "CANVAS" };
  const entity = 7 as unknown;
  const app = {
    start: vi.fn(async () => {}),
    stop: vi.fn(async () => {}),
    renderer: {
      getView: vi.fn<() => typeof canvas | undefined>(() => canvas),
      markDirty: vi.fn(),
      setGridVisible: vi.fn()
    },
    commands: { resolve: vi.fn<() => unknown>(() => entity) },
    assets: { entries: vi.fn(() => []) },
    camera: {
      focus: vi.fn(),
      zoomAt: vi.fn(),
      panBy: vi.fn(),
      worldToScreen: vi.fn(() => ({ x: 400, y: 300 })),
      setPosition: vi.fn()
    },
    "editor-runtime": { enterEdit: vi.fn() },
    "editor-selection": { enable: vi.fn() },
    "editor-gizmos": { enable: vi.fn() },
    "editor-bridge": { snapshot: vi.fn(() => snapshot) }
  };
  return { snapshot, canvas, entity, app, createApp: vi.fn(() => app) };
});

vi.mock("@nosafesky/ludemic", () => ({ createApp: mocks.createApp }));

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
    // Restore the shared mock snapshot so a test that mutated it does not leak into the next.
    mocks.snapshot.entities = [];
    mocks.snapshot.epoch = 0;
    mocks.snapshot.selection = [];
  });

  it("boots the game app and mounts the canvas into the viewport (W1)", async () => {
    const { element, append } = fakeMount();

    const handles = await startEditor(element);

    expect(mocks.createApp).toHaveBeenCalledTimes(1);
    expect(mocks.createApp).toHaveBeenCalledWith({
      pluginConfigs: {
        loop: { autoStart: true },
        renderer: { mount: undefined },
        mcp: { transports: ["inMemory"], inMemoryGlobalKey: "" },
        "editor-selection": { multiSelect: true, marquee: true },
        "editor-gizmos": { translateOnly: false },
        camera: { editorControls: true },
        input: { wheel: true, preventDefault: false }
      }
    });
    expect(mocks.app.start).toHaveBeenCalledTimes(1);
    expect(append).toHaveBeenCalledWith(mocks.canvas);
    expect(mocks.app["editor-runtime"].enterEdit).toHaveBeenCalledTimes(1);
    expect(mocks.app["editor-selection"].enable).toHaveBeenCalledTimes(1);
    expect(mocks.app["editor-gizmos"].enable).toHaveBeenCalledTimes(1);
    expect(handles.bridge).toBe(mocks.app["editor-bridge"]);
    expect(handles.camera).toBe(mocks.app.camera);
    expect(handles.renderer).toBe(mocks.app.renderer);
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

  it("re-syncs every entity's view when a world write bumps the epoch (W4)", async () => {
    // A world with two entities; the poll should re-sync both on the first write it observes.
    mocks.snapshot.entities = [{ id: 1 }, { id: 2 }];
    mocks.snapshot.epoch = 5;
    await startEditor(fakeMount().element);

    rafCallbacks[0]?.(); // one poll → epoch 5 differs from the initial -1 → re-sync
    expect(mocks.app.commands.resolve).toHaveBeenCalledWith(1);
    expect(mocks.app.commands.resolve).toHaveBeenCalledWith(2);
    expect(mocks.app.renderer.markDirty).toHaveBeenCalledTimes(2);

    // A poll at the SAME epoch does no extra work (off the per-frame path).
    rafCallbacks[1]?.();
    expect(mocks.app.renderer.markDirty).toHaveBeenCalledTimes(2);

    // A new write (epoch bump) re-syncs again.
    mocks.snapshot.epoch = 6;
    rafCallbacks[2]?.();
    expect(mocks.app.renderer.markDirty).toHaveBeenCalledTimes(4);
  });

  it("re-syncs the gizmo (re-enable) when the selection or epoch changes, else leaves it (W4)", async () => {
    await startEditor(fakeMount().element);
    mocks.app["editor-gizmos"].enable.mockClear(); // ignore the one-time boot enable()

    // First poll: key "0:" (epoch 0, empty selection) differs from the initial "" → one re-sync.
    rafCallbacks[0]?.();
    expect(mocks.app["editor-gizmos"].enable).toHaveBeenCalledTimes(1);

    // Same epoch + selection → no extra re-sync (off the per-frame path).
    rafCallbacks[1]?.();
    expect(mocks.app["editor-gizmos"].enable).toHaveBeenCalledTimes(1);

    // A selection change re-syncs the handle to the new selection.
    mocks.snapshot.selection = [7];
    rafCallbacks[2]?.();
    expect(mocks.app["editor-gizmos"].enable).toHaveBeenCalledTimes(2);

    // A world write that moves the selected object (epoch bump) re-syncs so the handle follows it.
    mocks.snapshot.epoch = 1;
    rafCallbacks[3]?.();
    expect(mocks.app["editor-gizmos"].enable).toHaveBeenCalledTimes(3);
  });

  it("skips a view whose id no longer resolves to a live entity (W4)", async () => {
    mocks.snapshot.entities = [{ id: 1 }];
    mocks.snapshot.epoch = 3;
    mocks.app.commands.resolve.mockReturnValueOnce(undefined); // retired/recycled
    await startEditor(fakeMount().element);

    rafCallbacks[0]?.();
    expect(mocks.app.commands.resolve).toHaveBeenCalledWith(1);
    expect(mocks.app.renderer.markDirty).not.toHaveBeenCalled();
  });

  it("stops the just-booted game app and throws when the renderer yields no canvas (W1)", async () => {
    mocks.app.renderer.getView.mockReturnValueOnce(undefined);

    await expect(startEditor(fakeMount().element)).rejects.toThrow(/no canvas/i);
    expect(mocks.app.stop).toHaveBeenCalledTimes(1); // failed boot torn down, not orphaned
    expect(() => getEditor()).toThrow(/Not started/); // handles never assigned → retry starts clean
  });
});
