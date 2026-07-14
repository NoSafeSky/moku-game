# editor-history

> Standard plugin — the editor's **undo/redo authority**. It wraps the single write-authority (`commands`) so every user edit is reversible, and clears itself whenever a non-undoable bulk restore reseeds the world.

Its one hot method, `applyTracked(command)`, applies a `Command` through `commands.applyRaw` **synchronously** and, on success, records the operation's **bounded inverse** (a field-diff, not a snapshot) as one undo step. `undo()` / `redo()` replay those recorded inverses / forwards back through `commands.applyRaw`, so the editor never grows a second mutation path — history reuses the single write-authority.

**Gesture coalescing** (`beginGesture()` / `endGesture()`) collapses a `pointerdown→up` burst of edits (a gizmo drag, a slider scrub) into **one** undo entry, so a drag is a single "undo", not fifty. Availability is **polled** — the plugin emits no events; a UI reads `canUndo()` / `canRedo()` on the ecs `changeEpoch` tick. The stack is a **ring buffer** capped at `config.maxDepth`. It **listens for `commands:restored`** (a scene reload or an exit-play revert, declared via the plugin's `hooks` field) and **clears** — a bulk reseed must never be swallowed into the undo stack.

**Pure data** — no scheduler system, no PixiJS, no external resource — so it has no `onStart`/`onStop`; the `commands` API is resolved on demand via `ctx.require`.

## API

Accessed as `app["editor-history"].*` after `createApp()`:

### `applyTracked(command: Command): CommandResult`
Apply `command` through `commands.applyRaw` AND record it as an undo step (or buffer into the open gesture). Returns the `CommandResult` (`{ ok: true, inverse } | { ok: false, error }`) so a caller can surface a validation failure.

### `undo(): boolean`
Reverse the most recent step (replaying its inverses via `commands.applyRaw`); moves it to the redo stack. Returns whether a step was undone.

### `redo(): boolean`
Re-apply the most recently undone step (replaying its forwards); moves it back to the undo stack. Returns whether a step was redone.

### `canUndo(): boolean` / `canRedo(): boolean`
Whether there is at least one step to undo / redo. Poll these on the ecs `changeEpoch` tick.

### `beginGesture(): void` / `endGesture(): void`
Open a gesture — subsequent tracked edits buffer into ONE step — then close it, coalescing the buffer into a single undo step (or nothing, if empty). A gizmo drag brackets its per-tick `setField` edits with these.

### `clear(): void`
Empty both stacks and drop any open gesture. Called automatically on `commands:restored`.

## Configuration

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `maxDepth` | `number` | `100` | Ring-buffer cap on retained undo steps; the oldest step is evicted past this. Values `< 1` are treated as `1`. |

## Dependencies

`commands` (#17) — the only dependency. `applyTracked`/`undo`/`redo` all funnel through `commands.applyRaw`, and the `commands:restored` hook clears the stacks. No edge to `editor-selection`/`editor-gizmos`/`editor-runtime` (they route *to* history, not the reverse).

## Example

```ts
import { createApp } from "game";

const app = createApp();
await app.start();

const history = app["editor-history"];

// A single tracked edit → one undo step.
history.applyTracked({ kind: "setField", id, component: "Position", field: "x", value: 10 });
history.undo(); // reverts it; history.canRedo() === true
history.redo();

// A drag coalesced into one undo entry.
history.beginGesture();
history.applyTracked({ kind: "setField", id, component: "Position", field: "x", value: 20 });
history.applyTracked({ kind: "setField", id, component: "Position", field: "y", value: 30 });
history.endGesture();
history.undo(); // undoes the whole drag at once
```
