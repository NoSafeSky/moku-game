/** @file Pure name→URL builder for the single route table. */
import { createUrls } from "@moku-labs/web/browser";
import { routes } from "../routes";

export const urls = createUrls(routes, "en");
