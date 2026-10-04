/**
 * Started by the host over stdio: `node server/index.mjs --stdio`, with `PLANNINGS_DIR`
 * set to the folder chosen at installation. Anything written to stdout is protocol, so
 * the only other output is an error on stderr when the server cannot start.
 */
import fs from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { StdioServerTransport } from "@modelcontextprotocol/server/stdio";
import { ConfigError, planningsDirFrom } from "./config.ts";
import { createServer } from "./server.ts";
import { LocalPlanningStore } from "./store.ts";

/** Beside the bundled server in the `.mcpb`; under `dist/viewer/` when run from source. */
async function readViewHtml(): Promise<string> {
  const bundled = new URL("./planning.html", import.meta.url);
  try {
    return await fs.readFile(fileURLToPath(bundled), "utf8");
  } catch {
    return fs.readFile(fileURLToPath(new URL("../dist/viewer/planning.html", import.meta.url)), "utf8");
  }
}

try {
  const store = await LocalPlanningStore.open(planningsDirFrom(process.env));
  await createServer({ store, viewHtml: await readViewHtml() }).connect(new StdioServerTransport());
} catch (error) {
  process.stderr.write(`pi-outpost plannings: ${error instanceof ConfigError ? error.message : (error as Error).stack ?? String(error)}\n`);
  process.exit(1);
}
