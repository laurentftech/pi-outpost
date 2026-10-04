/**
 * Starts the planning server from the environment, or explains why it will not.
 */
import { buildApp } from "./app.ts";
import { ConfigError, loadConfig } from "./config.ts";
import { planningRoutes } from "./routes.ts";
import { PlanningStore } from "./store.ts";

let config;
try {
  config = loadConfig();
} catch (error) {
  if (!(error instanceof ConfigError)) throw error;
  console.error(`pi-outpost planning server: ${error.message}`);
  process.exit(1);
}

const store = new PlanningStore(config);
const app = buildApp(config, planningRoutes(store, config));
const address = await app.listen({ host: config.host, port: config.port });
console.log(`pi-outpost planning server listening on ${address} (identity: ${config.identity}, data: ${config.dataDir})`);
