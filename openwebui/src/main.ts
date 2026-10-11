/**
 * Starts pi-outpost's Open WebUI server from the environment, or explains why it will not.
 */
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { buildApp } from "./app.ts";
import { ConfigError, loadConfig } from "./config.ts";
import { planningRoutes } from "./routes.ts";
import { PlanningStore } from "./store.ts";

let config;
try {
  config = loadConfig();
} catch (error) {
  if (!(error instanceof ConfigError)) throw error;
  console.error(`pi-outpost Open WebUI server: ${error.message}`);
  process.exit(1);
}

const store = new PlanningStore(config);
// Bundled, the Mermaid worker is its own file beside this one (see build:server); run
// from source, the renderer finds its TypeScript module itself.
const bundledWorker = new URL("./mermaid-worker.mjs", import.meta.url);
const app = buildApp(config, planningRoutes(store, config, existsSync(fileURLToPath(bundledWorker)) ? { mermaidWorker: bundledWorker } : {}));
const address = await app.listen({ host: config.host, port: config.port });
console.log(`pi-outpost Open WebUI server listening on ${address} (identity: ${config.identity}, data: ${config.dataDir})`);
