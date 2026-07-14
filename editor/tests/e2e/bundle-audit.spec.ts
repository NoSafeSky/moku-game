/**
 * @file Node-free bundle audit + source-boundary guard (W4).
 *
 * The two hard invariants of this app, codified so a regression fails CI:
 *  1. The built client bundle carries NO node-only code — no static `node:*` import, no
 *     `@moku-labs/core`, no stdio/http MCP transport — so it runs in a browser and deploys as static
 *     assets. The one allowed dynamic node import is `@moku-labs/web`'s browser-guarded
 *     `import("node:fs/promises")` (inert in the browser), which is whitelisted.
 *  2. The editor SOURCE never reaches past the bridge boundary — it imports no `@moku-labs/core`,
 *     no game-runtime `commands`/`ecs` module, and no `pixi.js`. The shell drives the game only through
 *     `gameApp["editor-bridge"]` (+ the viewport/asset handles editor-host exposes); Pixi is bundled
 *     transitively via the framework, never imported by the shell.
 *
 * These run without a browser — a filesystem audit of the build output and the source tree.
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const ASSETS = path.join(ROOT, "dist", "assets");
const SRC = path.join(ROOT, "src");

/** All built client JS files (the webServer builds `dist/` before the suite runs). */
function clientBundles(): { name: string; code: string }[] {
  const files = readdirSync(ASSETS).filter(name => name.endsWith(".js"));
  return files.map(name => ({ name, code: readFileSync(path.join(ASSETS, name), "utf8") }));
}

/** Every `.ts`/`.tsx` file under `src/`, recursively. */
function sourceFiles(dir = SRC): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...sourceFiles(full));
    else if (/\.tsx?$/.test(entry.name)) out.push(full);
  }
  return out;
}

test.describe("client bundle — node-free invariant", () => {
  test("exposes exactly one hashed client entry", () => {
    const entries = clientBundles().filter(b => /^spa-[a-z0-9]+\.js$/.test(b.name));
    expect(entries).toHaveLength(1);
  });

  test("has no static node: import", () => {
    for (const { name, code } of clientBundles()) {
      const staticNode = code.match(/(?:from|import)\s*["']node:[a-z/]+["']/g) ?? [];
      const requireNode = code.match(/require\(\s*["']node:[a-z/]+["']\)/g) ?? [];
      expect(staticNode, `${name} has a static ESM node: import`).toEqual([]);
      expect(requireNode, `${name} has a require("node:*")`).toEqual([]);
    }
  });

  test("limits dynamic node: imports to the whitelisted node:fs/promises", () => {
    const allowed = new Set(["node:fs/promises"]);
    for (const { name, code } of clientBundles()) {
      const dynamic = [...code.matchAll(/import\(\s*["'](node:[a-z/.]+)["']\)/g)].map(m => m[1]);
      for (const spec of dynamic) {
        expect(allowed.has(spec as string), `${name} dynamically imports ${spec}`).toBe(true);
      }
    }
  });

  test("bundles no @moku-labs/core (Layer-1) symbol", () => {
    for (const { name, code } of clientBundles()) {
      expect(code.includes("@moku-labs/core"), `${name} references @moku-labs/core`).toBe(false);
      expect(code.includes("createCoreConfig"), `${name} references createCoreConfig`).toBe(false);
    }
  });
});

test.describe("source boundary — the shell only crosses via the bridge", () => {
  // Imports the editor shell source must never contain (Pixi comes in transitively via the framework;
  // world reads/writes go through `gameApp["editor-bridge"]`, never the game's commands/ecs modules).
  const forbidden: { label: string; pattern: RegExp }[] = [
    { label: "@moku-labs/core", pattern: /["']@moku-labs\/core["']/ },
    { label: "createCore/createCoreConfig", pattern: /\b(?:createCore|createCoreConfig)\b/ },
    { label: "a commands/ecs module", pattern: /from\s+["'][^"']*\/(?:commands|ecs)["']/ },
    { label: "pixi.js", pattern: /from\s+["']pixi\.js["']/ }
  ];

  test("no shell source imports a forbidden module", () => {
    for (const file of sourceFiles()) {
      const code = readFileSync(file, "utf8");
      const rel = path.relative(ROOT, file);
      for (const { label, pattern } of forbidden) {
        expect(pattern.test(code), `${rel} imports/uses ${label}`).toBe(false);
      }
    }
  });
});
