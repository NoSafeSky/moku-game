/**
 * @file editor-host — the single integration seam between the web shell and the game runtime.
 * Boots the game app (@nosafesky/ludemic), mounts its Pixi canvas, runs the one poll loop,
 * and exposes the bridge + viewport/asset handles to islands (which have no plugin ctx). The shell
 * POLLS — Moku `App` has no subscribe member; the rAF loop re-reads bridge.snapshot()'s cheap scalars
 * (selection/mode/canUndo/canRedo) every frame, so changes surface next frame with no event.
 */
import type {
  Assets,
  Camera,
  EditorBridge,
  EditorGizmos,
  EditorSelection,
  Renderer
} from "@nosafesky/ludemic";
import { createApp } from "@nosafesky/ludemic";

/**
 * The runtime handles every island consumes.
 */
export type EditorHandles = {
  readonly gameApp: ReturnType<typeof createApp>;
  readonly bridge: EditorBridge.Api;
  readonly selection: EditorSelection.Api;
  readonly gizmos: EditorGizmos.Api;
  /** Editor camera — pan/zoom/focus for the viewport (direct handle, off the poll+bridge path). */
  readonly camera: Camera.Api;
  /** Renderer — grid toggle + manual mount/re-sync (direct handle, off the poll+bridge path). */
  readonly renderer: Renderer.Api;
  readonly assets: Assets.Api;
  readonly canvas: HTMLCanvasElement;
};

let handles: EditorHandles | undefined;
let latest: EditorBridge.EditorSnapshot | undefined;
const listeners = new Set<(snapshot: EditorBridge.EditorSnapshot) => void>();
let rafId = 0;
let lastSyncedEpoch = -1;

// Re-sync every entity's view whenever a world write bumps the epoch. The framework renderer only
// repositions views it has been told are dirty (its gizmo self-marks after a drag); a bridge write —
// an inspector `setField`, an `undo`/`redo`, a `load` — mutates `Transform` through `commands` WITHOUT
// marking dirty, so the canvas would lag the data. Gating on `epoch` keeps this off the per-frame path:
// it only runs on an actual write (rare, user-driven), and marking already-current views dirty is a
// cheap no-op. This is the single place the shell nudges the renderer — islands never touch it.
const syncViewsOnWrite = (snapshot: EditorBridge.EditorSnapshot): void => {
  if (snapshot.epoch === lastSyncedEpoch) return;
  lastSyncedEpoch = snapshot.epoch;

  const { gameApp } = getEditor();
  for (const entity of snapshot.entities) {
    const handle = gameApp.commands.resolve(entity.id);
    if (handle !== undefined) gameApp.renderer.markDirty(handle);
  }
};

// The one poll: read the epoch-memoized snapshot, re-sync views on a write, fan out to island subscribers.
const poll = (): void => {
  const snapshot = getEditor().bridge.snapshot();
  syncViewsOnWrite(snapshot);
  latest = snapshot;
  for (const notify of listeners) notify(snapshot);
};

/**
 * Boot + start the game app, mount its canvas into `mountElement`, enter edit mode, begin polling.
 * Idempotent — a second call returns the already-booted handles (spa.tsx and islands may both reach in).
 *
 * @param mountElement - The viewport container the Pixi canvas is appended into.
 * @returns The resolved editor handles (also retrievable synchronously via `getEditor`).
 * @throws {Error} If the renderer produced no canvas (a headless/non-browser renderer).
 * @example
 * ```ts
 * const el = document.querySelector<HTMLElement>('[data-island="viewport"]')!;
 * const { bridge } = await startEditor(el);
 * ```
 */
export async function startEditor(mountElement: HTMLElement): Promise<EditorHandles> {
  // Idempotent boot: never spin up a second game runtime.
  if (handles) return handles;

  // Boot the game runtime node-free: manual canvas mount + in-page mcp transport only (no stdio/http).
  // The four editor plugin configs flip framework gates the app opts into — the framework keeps
  // conservative defaults (multiSelect:false, translateOnly:true, editorControls:false) so a non-editor
  // game pays nothing, while the editor enables the full authoring behaviour at this one place.
  const gameApp = createApp({
    pluginConfigs: {
      loop: { autoStart: true },
      renderer: { mount: undefined },
      mcp: { transports: ["inMemory"], inMemoryGlobalKey: "" },
      "editor-selection": { multiSelect: true, marquee: true },
      "editor-gizmos": { translateOnly: false },
      camera: { editorControls: true },
      input: { wheel: true, preventDefault: true }
    }
  });
  await gameApp.start();

  // Host the live Pixi canvas in the viewport region — the editor requires a real (non-headless) renderer.
  const canvas = gameApp.renderer.getView();
  if (!canvas) {
    // Tear the just-booted app back down before failing, so a retry starts clean rather
    // than orphaning this app (handles is still unset, so this stays idempotent).
    await gameApp.stop();
    throw new Error(
      "[editor-host] Renderer produced no canvas.\n  The editor needs a browser (non-headless) renderer."
    );
  }
  mountElement.append(canvas);

  // Gate to editStages (input/sync/render): viewport stays live, gameplay frozen — Unity-like idle.
  gameApp["editor-runtime"].enterEdit();
  gameApp["editor-selection"].enable();
  gameApp["editor-gizmos"].enable();

  handles = {
    gameApp,
    bridge: gameApp["editor-bridge"],
    selection: gameApp["editor-selection"],
    gizmos: gameApp["editor-gizmos"],
    camera: gameApp.camera,
    renderer: gameApp.renderer,
    assets: gameApp.assets,
    canvas
  };

  // ONE poll loop, in one place: snapshot() is epoch-memoized, so re-reading every frame is cheap.
  const tick = (): void => {
    poll();
    rafId = requestAnimationFrame(tick);
  };
  rafId = requestAnimationFrame(tick);

  return handles;
}

/**
 * Synchronous accessor for islands. Throws if called before startEditor().
 *
 * @returns The editor handles.
 * @throws {Error} If called before startEditor() has resolved.
 * @example
 * ```ts
 * const { bridge } = getEditor();
 * bridge.undo();
 * ```
 */
export function getEditor(): EditorHandles {
  if (!handles) {
    throw new Error("[editor-host] Not started.\n  Call startEditor() before islands mount.");
  }
  return handles;
}

/**
 * Subscribe to each poll's snapshot; fires immediately with the latest if present.
 *
 * @param fn - Called with every polled snapshot.
 * @returns An unsubscribe function.
 * @example
 * ```ts
 * const off = onSnapshot((snapshot) => console.info(snapshot.mode));
 * // later: off();
 * ```
 */
export function onSnapshot(fn: (snapshot: EditorBridge.EditorSnapshot) => void): () => void {
  listeners.add(fn);
  if (latest) fn(latest);
  return () => {
    listeners.delete(fn);
  };
}

/**
 * Tear down (tests / HMR): cancel the poll loop, drop subscribers, stop the game app.
 * Idempotent — a no-op when the editor was never started.
 *
 * @returns A promise that resolves once the loop is cancelled and the game app has stopped.
 * @example
 * ```ts
 * await stopEditor();
 * ```
 */
export async function stopEditor(): Promise<void> {
  // No-op when never started (or already torn down).
  if (!handles) return;

  cancelAnimationFrame(rafId);
  rafId = 0;
  lastSyncedEpoch = -1;
  listeners.clear();

  // Clear handles BEFORE awaiting stop so any late getEditor() fails loud rather than racing teardown.
  const { gameApp } = handles;
  handles = undefined;
  latest = undefined;
  await gameApp.stop();
}
