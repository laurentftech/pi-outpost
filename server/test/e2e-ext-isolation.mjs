import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { startServer, connect } from "./harness.mjs";

const root = await mkdtemp(path.join(tmpdir(), "pi-outpost-e2e-ext-test-"));
try {
  await mkdir(path.join(root, "extensions"), { recursive: true });
  await writeFile(
    path.join(root, "extensions", "hello-ext.ts"),
    [
      `export default (pi) => {`,
      `  pi.registerCommand("hello", {`,
      `    description: "Say hello",`,
      `    handler: async (args, ctx) => { ctx.ui.notify("Hi!", "info"); },`,
      `  });`,
      `};`,
    ].join("\n"),
  );

  await writeFile(
    path.join(root, "extensions", "tool-ext.ts"),
    [
      `export default (pi) => {`,
      `  pi.registerCommand("tool-cmd", {`,
      `    description: "A tool",`,
      `    handler: async (args, ctx) => { ctx.ui.notify("Tool ran!", "info"); },`,
      `  });`,
      `};`,
    ].join("\n"),
  );

  const server = await startServer(root, {
    noExtensions: true,
    noSkills: true,
    noPromptTemplates: true,
    extensionPaths: ["./extensions/hello-ext.ts", "./extensions/tool-ext.ts"],
  });

  const ws = connect(server.wsUrl());
  await ws.open();

  const hello = await ws.waitFor("hello", 15_000);

  const extNames = (hello.commands ?? [])
    .filter((c) => c.source === "extension")
    .map((c) => c.name);

  assert.ok(
    extNames.includes("hello"),
    `missing extension 'hello'. found: ${JSON.stringify(extNames)}`,
  );
  assert.ok(
    extNames.includes("tool-cmd"),
    `missing extension 'tool-cmd'. found: ${JSON.stringify(extNames)}`,
  );

  console.log("=== hello.commands (extensions only) ===");
  console.log(JSON.stringify((hello.commands ?? []).filter((c) => c.source === "extension"), null, 2));

  console.log("\n=== RESULT: SUCCESS ===");
  console.log(`- Extensions loaded: ${JSON.stringify(extNames)}`);
  console.log(`- Isolated server: noExtensions=true, noSkills=true, noPromptTemplates=true`);
  console.log(`- Relative paths: ./extensions/hello-ext.ts, ./extensions/tool-ext.ts`);

  await ws.close();
  await server.stop();
} finally {
  await rm(root, { recursive: true, force: true });
}
