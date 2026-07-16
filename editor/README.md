# Moku Editor

**An in-browser, Unity-style visual editor for games built on the Moku ECS framework.**

A Layer-3 `@moku-labs/web` shell that renders editor chrome — viewport, inspector, scene tree, asset
browser, toolbar — around a live `@nosafesky/ludemic` runtime. It is a developer tool, not a game and
not a content site: two `createApp` instances share **one** object, the exported `editor-bridge`, and
the shell drives the game entirely through it.

<br/>

[![node](https://img.shields.io/badge/node-%3E%3D24-339933?logo=node.js&logoColor=white)](#requirements)
[![client bundle](https://img.shields.io/badge/client-node--free-2da44e)](#bundling-notes)
[![built with](https://img.shields.io/badge/built%20with-%40moku--labs%2Fweb-1864ab)](https://github.com/moku-labs/web)
[![license: MIT](https://img.shields.io/badge/license-MIT-blue)](./LICENSE)

<br/>

[What it is](#what-it-is) · [Quick start](#quick-start) · [Architecture](#architecture) · [The boundary](#the-boundary) · [Development](#development) · [Bundling notes](#bundling-notes) · [Deployment](#deployment)

---

## What it is

The editor renders panel chrome around a running game and edits its world visually:

- **Viewport** — a live PixiJS canvas with click-to-select and a translate gizmo.
- **Inspector** — per-component field controls for the selected entity (number/boolean/string/color/select/vector2).
- **Scene tree** — every entity as a selectable row.
- **Asset browser** — a read-only listing of the loaded asset manifest.
- **Toolbar** — undo/redo, play/stop/step, save/load.

Run on its own, the shell has no host game, so it boots a small **demo scene** (a few primitives) as a
stand-in — enough to select, edit, and undo. A real integration replaces that seed with an actual game
(see [`lib/demo-scene.ts`](./src/lib/demo-scene.ts)).

> [!NOTE]
> **Status: 0.x — early.** The editor tracks the framework's `editor-bridge` MVP surface; multi-select,
> rotate/scale gizmos, and the MCP editor mirror are framework follow-ups the shell will consume
> additively as they land.

## Quick start

> [!IMPORTANT]
> This app consumes the framework `@nosafesky/ludemic` through a `file:..` link, so the framework's
> `dist/` must exist first. From the **repository root**, build the framework once:
> ```sh
> bun install && bun run build
> ```
> On Windows the link is a directory junction; any `bun add`/`bun install` inside `editor/` re-breaks it
> and it must be restored (`New-Item -ItemType Junction -Path editor/node_modules/@nosafesky/ludemic -Target <repo-root>`).

Then, from `editor/`:

```sh
bun install          # resolves @moku-labs/web + the framework link
bun run dev          # build the shell + serve it at http://localhost:4173
```

`bun run dev` builds the static shell and the client bundle, then serves it. Open
[http://localhost:4173](http://localhost:4173) — the demo scene renders, and every panel is live.

## Architecture

Two frameworks compose in **one browser page** as **two `createApp` instances**. They share exactly one
runtime object — `gameApp["editor-bridge"]` — and nothing else.

```mermaid
flowchart LR
  Shell["Web shell<br/>@moku-labs/web (SSG + islands)"] -->|"editor-bridge (only seam)"| Game["Game runtime<br/>@nosafesky/ludemic"]
  Game --> Canvas["Pixi canvas + ECS<br/>+ editor plugins"]
  classDef u fill:#0b7285,stroke:#08525f,color:#fff;
  classDef m fill:#1864ab,stroke:#0d3d6e,color:#fff;
  class Shell,Canvas u
  class Game m
```

- **Web shell** — renders the panel chrome as static HTML (SSG) and hydrates five islands; owns routing
  and the client bundle.
- **Game runtime** — owns the Pixi canvas, the ECS world, and all editor plugins. Booted client-side by
  the shell and held as a runtime object in [`lib/editor-host.ts`](./src/lib/editor-host.ts) — the single
  integration seam.
- **The shell polls, it never subscribes.** Moku Core's `App` has no `on`/subscribe member, so
  `editor-host` runs one `requestAnimationFrame` loop over `bridge.snapshot()`; islands gate their heavy
  rebuilds on `snapshot.epoch` and re-read cheap scalars (`selection`/`mode`/`canUndo`/`canRedo`) every
  frame. A committed edit surfaces on the next frame.

### Islands

| Island | Drives | Via |
|---|---|---|
| `viewport` | reflects the current selection (`data-has-selection`) | `onSnapshot` |
| `inspector` | edits fields on the selected entity | `bridge.setField` |
| `scene-tree` | selects an entity from a row | `bridge.select` |
| `asset-browser` | lists the asset manifest | `assets.entries`/`metadata` |
| `toolbar` | undo/redo · play/stop/step · save/load | `bridge.*` |

## The boundary

The shell reaches the game **only** through the bridge (plus the viewport/asset handles the bridge
intentionally does not forward). It imports no `commands`/`ecs` symbol and no `@moku-labs/core`.

| Concern | Allowed surface | Never |
|---|---|---|
| Read world/entities/selection/mode/undo | `bridge.snapshot()` | `ecs.*`, `commands.*` |
| Write a field / apply a command | `bridge.setField` / `bridge.apply` | `commands.apply`, `ecs.set` |
| Undo / redo · play/stop/step · save/load | `bridge.undo/redo` · `bridge.play/stop/step` · `bridge.save/load` | `editor-history`/`editor-runtime`/`serialization` directly |
| Viewport picking + translate gizmo | `editor-selection` / `editor-gizmos` (via editor-host) | `commands`/`ecs` |
| Asset enumeration | `assets.entries/manifest/metadata` | `ecs`, loader internals |

`editor-host` is the one place that touches the game runtime's own APIs (to boot it, mount the canvas,
and re-sync views after a write); `demo-scene` is the one place that authors game content. Both are
clearly fenced — new editor capability is a new method on the framework's `EditorBridge.Api`, then a new
island, never a reach-through.

## Development

| Script | What it does |
|---|---|
| `bun run dev` | Build the shell + serve it at `http://localhost:4173` |
| `bun run build` | Build the static shell + repaired client bundle into `dist/` |
| `bun run preview` | Serve an already-built `dist/` at `http://localhost:4173` |
| `bun run test` | Unit + integration tests (vitest) |
| `bun run test:e2e` | End-to-end drives + visual baselines (Playwright) |
| `bun run typecheck` | `tsc --noEmit` |
| `bun run lint` | Biome + ESLint |

Tests live in [`tests/unit`](./tests/unit) and [`tests/integration`](./tests/integration) (vitest,
happy-dom) and [`tests/e2e`](./tests/e2e) (Playwright — real-browser drives, a node-free bundle audit,
and per-panel visual baselines).

## Bundling notes

The client bundle is **node-free** by construction — `mode: "ssg"`, `mcp: { transports: ["inMemory"] }`,
no `@moku-labs/core` — so it ships as static assets. The `tests/e2e/bundle-audit.spec.ts` gate codifies
that (no static `node:*` import, no core, and a source-boundary scan).

Two build details worth knowing (both handled in [`scripts/build.ts`](./scripts/build.ts)):

- **Pixi is bundled from its pre-bundled single-module ESM.** `Bun.build`'s code-splitting mis-links
  Pixi v8's `extensions` singleton (its submodules register with top-level `extensions.add(...)` side
  effects; splitting scatters the declaration from its uses), so a split bundle throws
  `ReferenceError: <id> is not defined` and never boots. The build re-bundles the JS entry as one
  self-contained file, aliasing `pixi.js` to `pixi.js/dist/pixi.mjs` — a single flat module where
  `extensions` lives in one scope. This is a real-browser-only failure, invisible to the happy-dom unit
  tests (Pixi stays headless there), which is why the e2e gate exists.
- **The framework must be built first** (see [Quick start](#quick-start)) — the `file:..` link resolves
  the framework's published `dist/`.

## Deployment

The built `dist/` is static — deploy it to any static host. The repository ships a Cloudflare Pages
workflow; the build command is `bun run build` and the output directory is `editor/dist`.

## Requirements

Node ≥ 24 · Bun ≥ 1.3 · TypeScript strict · [`@nosafesky/ludemic`](../) built (`bun run build` at the repo root).

## License

[MIT](./LICENSE) © [moku-labs](https://github.com/moku-labs)
