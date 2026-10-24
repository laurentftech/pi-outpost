/**
 * The posters extension, started by the host over stdio: `node server/index.mjs --stdio`,
 * with `POSTERS_DIR` set to the folder chosen at installation, and `POSTERS_DEBUG` set to
 * keep a log of what the host asks in `<folder>/.posters/debug.log`.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { StdioServerTransport } from "@modelcontextprotocol/server/stdio";
import { createPosterServer } from "./server.ts";
import { LocalPosterStore } from "./store.ts";

async function readViewHtml(): Promise<string> {
  try {
    return await fs.readFile(fileURLToPath(new URL("./poster.html", import.meta.url)), "utf8");
  } catch {
    return fs.readFile(fileURLToPath(new URL("../../dist/viewer-poster/poster.html", import.meta.url)), "utf8");
  }
}

try {
  const folder = process.env.POSTERS_DIR?.trim();
  if (!folder || !path.isAbsolute(folder)) throw new Error("POSTERS_DIR must be the absolute path of the posters folder");
  const store = await LocalPosterStore.open(folder);
  // POSTERS_DEBUG: also into the folder, since Claude Desktop does not keep the server's
  // stderr. That log is what found the earlier invisible view (design.md, decision 7).
  let log: ((line: string) => void) | undefined;
  // From the extension's "Debug log" setting: "true" or "false" as text, or 1 when set by hand.
  if (/^(true|1)$/i.test(process.env.POSTERS_DEBUG ?? "")) {
    const debugLog = path.join(store.root, ".posters", "debug.log");
    await fs.mkdir(path.dirname(debugLog), { recursive: true });
    log = (line: string) => void fs.appendFile(debugLog, `${new Date().toISOString()} ${line}\n`).catch(() => undefined);
    log("started");
  }
  await createPosterServer({ store, viewHtml: await readViewHtml(), log }).connect(new StdioServerTransport());
} catch (error) {
  process.stderr.write(`pi-outpost posters: ${(error as Error).stack ?? String(error)}\n`);
  process.exit(1);
}
