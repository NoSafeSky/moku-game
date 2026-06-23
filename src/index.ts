import { coreConfig, createCore } from "./config";

const framework = createCore(coreConfig, {
  plugins: []
});

export const { createApp, createPlugin } = framework;
