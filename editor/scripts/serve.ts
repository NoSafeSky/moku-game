/** @file Serve the editor shell with live rebuild (thin app.cli.serve passthrough). */
import { app } from "../src/app";

await app.cli.serve();
