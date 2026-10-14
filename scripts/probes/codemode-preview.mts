/** A visible local demo: node --import tsx/esm scripts/probes/codemode-preview.mts */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { makeWorkspace, startServer, connect } from "../../server/test/harness.mjs";

const root = await makeWorkspace({ "inside.txt": "Bonjour depuis le fichier du projet." });
await mkdir(path.join(root, ".pi-agent"), { recursive: true });
await writeFile(path.join(root, ".pi-agent", "settings.json"), JSON.stringify({ defaultTools: ["+codemode"] }));
const server = await startServer(root, {
  extensionPaths: [fileURLToPath(new URL("../../server/test/fixtures/codemode-provider.mjs", import.meta.url))],
  allowedModels: [{ provider: "codemode-test", id: "codemode-test" }],
}, { env: { CODEMODE_LOG: path.join(root, "result.txt"), CODEMODE_READ_DELAY_MS: "1800" } });
const client = connect(server.wsUrl());
await client.waitFor("hello", 30_000);
client.send({ type: "prompt", text: `RUN CODEMODE ${path.resolve(root, "..", "outside-secret.txt")}` });
await client.waitFor("agent_end", 60_000);
client.close();
console.log(`CODEMODE_PREVIEW_URL=${server.base}`);
console.log("Pour rejouer la démonstration, envoyer : RUN CODEMODE outside-secret.txt");
for (const signal of ["SIGINT", "SIGTERM"] as const) process.on(signal, async () => {
  await server.stop();
  process.exit(0);
});
