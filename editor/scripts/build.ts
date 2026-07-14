/** @file Build the static editor shell (thin app.cli.build passthrough). */
import { app } from "../src/app";

await app.cli.build();
