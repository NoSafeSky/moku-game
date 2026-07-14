/** @file The ONE route table — build, SPA, and links all derive from it. */
import { defineRoutes, route } from "@moku-labs/web/browser";
import { EditorPage } from "./components/EditorPage";

export const routes = defineRoutes({
  editor: route("/").render(() => <EditorPage />)
});
