/**
 * @file Build the static editor shell, then repair the client JS bundle.
 *
 * `app.cli.build()` (moku-web) emits the HTML/CSS and bundles the client with `Bun.build`'s
 * `splitting: true`. That splitting mis-links Pixi v8's `extensions` singleton — Pixi's many
 * submodules register environment/loader extensions with top-level `extensions.add(...)` side
 * effects, and the bundler scatters the declaration and its uses across chunks (and mis-deconflicts
 * the name into `extensions2`/`extensions3`), leaving one reference undeclared → the client throws
 * `ReferenceError: <id> is not defined` and never boots. This is a real-browser-only failure: under
 * happy-dom Pixi stays headless, so the unit/integration suites never exercise it.
 *
 * Fix: after moku-web's build, re-bundle the JS entry ourselves as ONE self-contained file, aliasing
 * `pixi.js` to its pre-bundled single-module ESM (`pixi.js/dist/pixi.mjs`). Because that file is
 * already a single flat module, Pixi's `extensions` lives in one scope with all its `.add(...)`
 * calls — no cross-module/cross-chunk deconfliction, so minification is safe. We reuse the exact
 * hashed entry filename moku-web injected into the HTML, so the page loads the repaired bundle.
 */
import { rm } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { app } from "../src/app";

await app.cli.build();

// Resolve Pixi's pre-bundled single-module ESM (the package's `exports` hides subpaths, so walk the
// resolved main entry up to the package root and reach into `dist/`).
const require = createRequire(import.meta.url);
const pixiEntry = require.resolve("pixi.js");
const pixiRoot = pixiEntry.slice(0, pixiEntry.lastIndexOf(`pixi.js${path.sep}`) + "pixi.js".length);
const pixiSingle = path.join(pixiRoot, "dist", "pixi.mjs");

// Find the client entry moku-web emitted (the HTML references exactly this hashed filename).
const entries = [...new Bun.Glob("assets/spa-*.js").scanSync({ cwd: "dist" })];
if (entries.length !== 1) {
  throw new Error(`[build] expected exactly one client entry, found ${entries.length}: ${entries}`);
}
const entryName = path.basename(entries[0] as string);

// Drop moku-web's split JS artifacts, then re-emit a single self-contained entry under the same name.
for (const file of new Bun.Glob("assets/*.js").scanSync({ cwd: "dist" })) {
  await rm(path.join("dist", file));
}

const result = await Bun.build({
  entrypoints: ["src/spa.tsx"],
  target: "browser",
  minify: true,
  splitting: false,
  naming: entryName,
  outdir: "dist/assets",
  plugins: [
    {
      name: "pixi-prebundled",
      setup(build) {
        build.onResolve({ filter: /^pixi\.js$/ }, () => ({ path: pixiSingle }));
      }
    }
  ]
});

if (!result.success) {
  for (const log of result.logs) console.error(String(log));
  throw new Error("[build] client re-bundle failed");
}

console.info(`[build] repaired client bundle → assets/${entryName} (pixi.js → dist/pixi.mjs)`);
