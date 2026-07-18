/** @file Workspace island — resizes the dock splitters within clamped bounds via inline CSS custom props. */
import { createIsland } from "@moku-labs/web/browser";

/** The axis a splitter drags along — `x` resizes a column width, `y` a row height. */
type Axis = "x" | "y";

/**
 * One splitter's resize contract: the CSS custom property it drives on the workspace element, the drag
 * axis, the direction the adjacent band grows as the pointer coordinate increases (`+1` grows with it,
 * `-1` grows against it), the clamp bounds, and the seeded initial size — all in px.
 */
type SplitterSpec = {
  readonly prop: string;
  readonly axis: Axis;
  readonly dir: 1 | -1;
  readonly min: number;
  readonly max: number;
  readonly initial: number;
};

// Hierarchy grows rightward (dir +1); the right-docked Inspector and the bottom Project region grow
// against the pointer (dir -1). Bounds match design-context §5 (e.g. Hierarchy stays 180–400px).
const SPLITTERS: Readonly<Record<string, SplitterSpec>> = {
  hierarchy: { prop: "--w-hierarchy", axis: "x", dir: 1, min: 180, max: 400, initial: 240 },
  inspector: { prop: "--w-inspector", axis: "x", dir: -1, min: 240, max: 460, initial: 300 },
  project: { prop: "--h-project", axis: "y", dir: -1, min: 90, max: 360, initial: 160 }
};

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

const coordOf = (event: PointerEvent, axis: Axis): number =>
  axis === "x" ? event.clientX : event.clientY;

/**
 * Workspace island — drives the dock's clamped splitter resize.
 *
 * Each band's size is an inline custom property (`--w-hierarchy` / `--w-inspector` / `--h-project`) the
 * shell CSS reads; the island seeds them from the clamped defaults on mount and, during a splitter drag,
 * recomputes the active band's size from the pointer delta (clamped to its bounds). One drag is live at a
 * time; document-level move/up listeners let the pointer leave the thin handle. `data-resizing="<key>"`
 * signals the active splitter for its accent state. All listeners are released on destroy via `ctx.cleanup`.
 */
export const workspace = createIsland("workspace", {
  onMount(ctx) {
    const host = ctx.el as HTMLElement;

    // Seed each band to its initial size; the shell grid reads these custom properties.
    const size = new Map<string, number>();
    for (const [key, spec] of Object.entries(SPLITTERS)) {
      size.set(key, spec.initial);
      host.style.setProperty(spec.prop, `${spec.initial}px`);
    }

    let active:
      | { key: string; spec: SplitterSpec; startCoord: number; startSize: number }
      | undefined;

    const onMove = (event: PointerEvent): void => {
      if (!active) return;
      const delta = (coordOf(event, active.spec.axis) - active.startCoord) * active.spec.dir;
      const next = clamp(active.startSize + delta, active.spec.min, active.spec.max);
      size.set(active.key, next);
      host.style.setProperty(active.spec.prop, `${next}px`);
    };

    const onUp = (): void => {
      if (!active) return;
      active = undefined;
      delete host.dataset.resizing;
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerup", onUp);
    };

    const onDown = (event: PointerEvent): void => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      const key = target.closest<HTMLElement>("[data-splitter]")?.dataset.splitter;
      if (!key) return;
      const spec = SPLITTERS[key];
      if (!spec) return;

      event.preventDefault();
      active = {
        key,
        spec,
        startCoord: coordOf(event, spec.axis),
        startSize: size.get(key) ?? spec.initial
      };
      host.dataset.resizing = key;
      document.addEventListener("pointermove", onMove);
      document.addEventListener("pointerup", onUp);
    };

    host.addEventListener("pointerdown", onDown);
    ctx.cleanup(() => {
      host.removeEventListener("pointerdown", onDown);
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerup", onUp);
    });
  }
});
