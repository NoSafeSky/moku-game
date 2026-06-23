# game

An ECS game framework for Moku — Spark-style ([AlexTiTanium/spark](https://github.com/AlexTiTanium/spark)) public API and memory layout, PixiJS rendering, built on @moku-labs/core and composable with @moku-labs/web.

## Package Manager

Use `bun` exclusively — never npm, yarn, or pnpm.

## Scripts

- `bun run build` — Build with tsdown
- `bun run lint` — Biome check + ESLint
- `bun run lint:fix` — Auto-fix lint issues
- `bun run format` — Format with Biome
- `bun run test` — Run all tests (vitest)
- `bun run test:unit` — Unit tests only
- `bun run test:integration` — Integration tests only
- `bun run test:coverage` — Tests with coverage

## Code Style

- **Formatter:** Biome (2-space indent, double quotes, semicolons, no trailing commas)
- **Linter:** ESLint 9 flat config + Biome (eslint-config-biome must be LAST)
- **TypeScript:** Strict mode with `exactOptionalPropertyTypes` and `noUncheckedIndexedAccess`
- **Imports:** Use `import type` enforced via `@typescript-eslint/consistent-type-imports`
- **JSDoc:** Required on all source exports with descriptions, params, returns, and examples

## Architecture

Three-layer Moku model:
1. `src/config.ts` — `createCoreConfig` (Layer 1: config + events) — registers `logPlugin` + `envPlugin` from `@moku-labs/common`, so `ctx.log` and `ctx.env` are on every plugin's `ctx`
2. `src/index.ts` — `createCore` (Layer 2: framework + plugins)
3. Consumer apps use `createApp` (Layer 3)

Plugins go in `src/plugins/`.

### Intended direction (to be designed via `/moku:plan`)

This framework is being built as a **game** framework with:

- **ECS** as the core data/runtime model — public API and memory layout modeled on [AlexTiTanium/spark](https://github.com/AlexTiTanium/spark) (archetype/SoA-style component storage, system scheduling).
- **PixiJS** (latest, v8) as the rendering backend, wired in as a renderer plugin.
- **@moku-labs/web** for the web/DOM surface (mount, lifecycle, island/asset patterns).

These are framework-design decisions: the ECS, renderer, input, and asset plugins, plus whether
`@moku-labs/web` + `pixi.js` are direct dependencies, are decided in planning. Start with
`/moku:plan create framework` (optionally `/moku:brainstorm create framework "..."` first to explore
the ECS API surface and memory-layout trade-offs against Spark).

## Testing

- Vitest with unit + integration projects
- Framework-level tests: `tests/unit/` and `tests/integration/` (cross-plugin scenarios, createApp validation)
- Plugin-specific tests: `src/plugins/[name]/__tests__/unit/` and `__tests__/integration/` (colocated inside each plugin)
- 90% coverage threshold
- Never put plugin-specific tests in root `tests/` — root tests are for framework-level integration only

## Moku Development Toolkit

This project uses the **moku** Claude Code plugin for development workflows. Below are the available commands, skills, and agents.

### Commands (slash commands)

**Planning:**
- `/moku:brainstorm [create|deep] [framework|app] "description"` — explore architecture decisions before planning (recommended for novel/complex domains like an ECS API surface).
- `/moku:plan [create|update|add|migrate|resume] [type] [args]` — 3-stage gated workflow to plan a framework, consumer app, or plugin. Output goes to `.planning/specs/` (framework/plugin) or `.planning/app-spec.md` (app).

**Building:**
- `/moku:build [framework|app|plugin] [spec-or-name]` — Build from specifications. Auto-detects what to build based on existing spec files. Resumes if partially built. Supports `/moku:build plugin #3` for individual plugins.
- `/moku-verify` — Fan out the full Moku validation pipeline (spec, plugin-structure, jsdoc, readability, types, tests, web, architecture) in parallel, then aggregate one pass/fail.

**Setup:**
- `/moku:init` — Initialize a new Moku project with full tooling (used to create this project).

### Skills (automatic context)

Skills load automatically when relevant; you can also reference them explicitly:

- **moku-core** — Architecture rules, factory chain, lifecycle, event system, context tiers. Use with `createCoreConfig`, `createCore`, `createApp`, or the three-layer model.
- **moku-plugin** — Plugin structure spec, complexity tiers (Nano → VeryComplex), file organization, wiring harness pattern. Use when creating or reviewing plugin code.
- **moku-common** — `@moku-labs/common`: branded CLI renderer, `ctx.log` (logPlugin), `ctx.env` (envPlugin). Family conventions MC1–MC3.
- **moku-web** — Web patterns: Preact components, CSS architecture (@scope, @layer, tokens), island pattern. Use when building the web/DOM surface.
- **moku-testing** — TDD protocol, mock context factories, integration scaffolds, type-level tests.
- **moku-readable-code** — Function-body readability style (stanzas, guard clauses, named predicates).

### Agents (validation)

Agents run autonomously to validate code; build commands call them automatically, but they can be triggered manually:

- **moku-spec-validator** — Moku Core spec compliance: three-layer separation, factory chain, config, lifecycle, events, error formats.
- **moku-plugin-spec-validator** — Plugin structure: tier, file organization, JSDoc coverage, test existence, anti-patterns.
- **moku-jsdoc-validator** — JSDoc completeness on all exports (descriptions, `@param`, `@returns`, `@example`).
- **moku-type-validator** / **moku-test-validator** / **moku-architecture-validator** / **moku-common-validator** — type correctness, test quality, cross-plugin architecture, family `@moku-labs/common` usage.

### Typical Workflows

**New framework from scratch:**
1. `/moku:brainstorm create framework "ECS game framework — Spark-style API on PixiJS + moku-web"` — explore decisions (optional, recommended here)
2. `/moku:plan create framework` — design plugins and structure (3 approval gates)
3. `/moku:build framework` — implement everything from specs
4. Validators run automatically after each plugin

**Add a single plugin:**
1. `/moku:plan add plugin ecs "Spark-style archetype ECS"` — create plugin spec
2. `/moku:build add ecs` — build, wire, and verify the planned plugin

## Specification

For questions about how things should be implemented, refer to the Moku Core specification (vendored in the moku plugin's `skills/moku-core/references/spec/`, source: https://github.com/moku-labs/core/tree/main/specification).
