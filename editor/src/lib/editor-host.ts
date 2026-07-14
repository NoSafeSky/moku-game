/**
 * @file editor-host — the single integration seam between the web shell and the game runtime.
 * Boots the game app (@nosafesky/moku-game), mounts its Pixi canvas, runs the one poll loop,
 * and exposes the bridge + viewport/asset handles to islands (which have no plugin ctx). The shell
 * POLLS — Moku `App` has no subscribe member; the rAF loop re-reads bridge.snapshot()'s cheap scalars
 * (selection/mode/canUndo/canRedo) every frame, so changes surface next frame with no event.
 */
import type {
  Assets,
  createApp,
  EditorBridge,
  EditorGizmos,
  EditorSelection
} from "@nosafesky/moku-game";

/**
 * The runtime handles every island consumes.
 */
export type EditorHandles = {
  readonly gameApp: ReturnType<typeof createApp>;
  readonly bridge: EditorBridge.Api;
  readonly selection: EditorSelection.Api;
  readonly gizmos: EditorGizmos.Api;
  readonly assets: Assets.Api;
  readonly canvas: HTMLCanvasElement;
};

let handles: EditorHandles | undefined;
let latest: EditorBridge.EditorSnapshot | undefined;
// eslint-disable-next-line sonarjs/no-unused-collection -- W1's poll loop iterates listeners each tick
const listeners = new Set<(snapshot: EditorBridge.EditorSnapshot) => void>();

/**
 * Boot + start the game app, mount its canvas into `mountEl`, enter edit mode, begin polling. Idempotent.
 *
 * @param _mountElement - The viewport container the Pixi canvas is appended into.
 * @throws {Error} Until W1 implements the boot + poll loop.
 * @example
 * ```ts
 * const el = document.querySelector<HTMLElement>('[data-island="viewport"]')!;
 * const { bridge } = await startEditor(el);
 * ```
 */
export async function startEditor(_mountElement: HTMLElement): Promise<EditorHandles> {
  throw new Error("[editor-host] not implemented");
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
 * Tear down (tests / HMR): cancel the poll loop, stop the game app.
 *
 * @throws {Error} Until W1 implements teardown.
 * @example
 * ```ts
 * await stopEditor();
 * ```
 */
export async function stopEditor(): Promise<void> {
  throw new Error("[editor-host] not implemented");
}
