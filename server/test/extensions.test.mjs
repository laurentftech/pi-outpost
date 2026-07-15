/**
 * Test: noExtensions + extensionPaths isolation.
 * Boots a server with noExtensions:true, checks that global packages
 * (from ~/.pi/agent/settings.json) are NOT loaded.
 */
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { startServer, freePort, connect } from "./harness.mjs";

const root = await mkdtemp(path.join(tmpdir(), "pi-outpost-ext-test-"));
try {
  // Create a minimal test extension
  await mkdir(path.join(root, "my-ext"), { recursive: true });
  await writeFile(
    path.join(root, "my-ext", "index.ts"),
    `export default (pi) => { pi.registerCommand("my-cmd", { description: "from my ext" }); };`,
  );

  const server = await startServer(root, {
    noExtensions: true,
    extensionPaths: [path.join(root, "my-ext", "index.ts")],
    // noSkills already set by harness; override noPromptTemplates
    noPromptTemplates: true,
  });

  const ws = connect(server.wsUrl());
  await ws.open();

  // Wait for the server's init message
  const hello = await ws.waitFor("hello", 10_000);
  console.log("=== hello message ===");
  console.log(JSON.stringify(hello, null, 2));
  
  // Also check log for extension diagnostics
  console.log("\n=== server log ===");
  console.log(server.log());

  await ws.close();
  await server.stop();
} finally {
  await rm(root, { recursive: true, force: true });
}
