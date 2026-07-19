/**
 * @file Preview the built editor shell (thin app.cli.preview passthrough).
 *
 * Honours `PORT` (falls back to the framework default, 4173) so `playwright.config.ts`'s own
 * `PORT`-driven `PREVIEW_URL` and an ad hoc parallel preview (e.g. a second reviewer driving the app
 * on its own port) always agree on where the server actually listens.
 */
import { app } from "../src/app";

const port = process.env["PORT"];
await app.cli.preview(port ? { port: Number(port) } : {});
