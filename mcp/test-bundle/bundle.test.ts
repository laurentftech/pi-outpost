/**
 * The packed `.mcpb`, as Claude Desktop receives it: its manifest validated, its
 * contents unpacked to a temporary folder, and its server started there with the
 * current Node over stdio, as the host starts it.
 *
 * Needs `npm run pack --workspace @pi-outpost/mcp` first.
 */
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { CREATION_EXAMPLE } from "@pi-outpost/apps-core/descriptions";

const BUNDLE = fileURLToPath(new URL("../dist/pi-outpost-plannings.mcpb", import.meta.url));
// @ts-expect-error -- a plain .mjs script, shared with pack.
import { mcpb } from "../scripts/mcpb.mjs";

let scratch: string;
let unpacked: string;

before(async () => {
  await fs.access(BUNDLE).catch(() => {
    throw new Error(`${BUNDLE} is missing: run npm run pack --workspace @pi-outpost/mcp first`);
  });
  scratch = await fs.mkdtemp(path.join(os.tmpdir(), "outpost-mcpb-"));
  unpacked = path.join(scratch, "bundle");
  mcpb(["unpack", BUNDLE, unpacked], { stdio: "pipe" });
});

after(async () => {
  if (scratch) await fs.rm(scratch, { recursive: true, force: true });
});

// openlore: scenario=TheBundleValidates spec=mcp-planning-app
test("TheBundleValidates", async () => {
  mcpb(["validate", path.join(unpacked, "manifest.json")], { stdio: "pipe" });
  const manifest = JSON.parse(await fs.readFile(path.join(unpacked, "manifest.json"), "utf8"));
  const folder = manifest.user_config.plannings_dir;
  assert.equal(folder.type, "directory");
  assert.equal(folder.required, true);
  // A default greyed out Claude Desktop's folder picker: none, so the person chooses.
  assert.equal("default" in folder, false);
  assert.equal(manifest.server.mcp_config.env.PLANNINGS_DIR, "${user_config.plannings_dir}");
  const repoVersion = JSON.parse(await fs.readFile(fileURLToPath(new URL("../../cli/package.json", import.meta.url)), "utf8")).version;
  assert.equal(manifest.version, repoVersion);
  for (const file of ["server/index.mjs", "server/planning.html", "server/guide/timelines.md"]) {
    assert.ok((await fs.stat(path.join(unpacked, file))).size > 0, file);
  }
});

// openlore: scenario=TheBundledServerAnswersOverStdio spec=mcp-planning-app
test("TheBundledServerAnswersOverStdio", async () => {
  const manifest = JSON.parse(await fs.readFile(path.join(unpacked, "manifest.json"), "utf8"));
  const folder = path.join(scratch, "My plannings");
  // The arguments as the host expands them.
  const args = (manifest.server.mcp_config.args as string[]).map((arg) => arg.replace("${__dirname}", unpacked));
  const transport = new StdioClientTransport({ command: process.execPath, args, env: { ...process.env, PLANNINGS_DIR: folder } as Record<string, string>, stderr: "pipe" });
  const client = new Client({ name: "bundle-check", version: "1" });
  await client.connect(transport);
  try {
    const { tools } = await client.listTools();
    assert.ok(tools.some((tool) => tool.name === "show_planning"));
    const { resources } = await client.listResources();
    const { contents } = await client.readResource({ uri: resources[0]!.uri });
    assert.match((contents[0] as { text: string }).text, /<html/i);

    const created = (await client.callTool({ name: "create_planning", arguments: { planning: CREATION_EXAMPLE } })) as { isError?: boolean; content: Array<{ text: string }> };
    assert.notEqual(created.isError, true, created.content[0]?.text);
    const id = JSON.parse(created.content[0]!.text).id as string;
    const shown = (await client.callTool({ name: "show_planning", arguments: { id } })) as { isError?: boolean; structuredContent?: { id: string } };
    assert.notEqual(shown.isError, true);
    assert.equal(shown.structuredContent?.id, id);
    const guide = (await client.callTool({ name: "read_structure_guide", arguments: { topic: "timelines" } })) as { isError?: boolean };
    assert.notEqual(guide.isError, true);

    assert.deepEqual((await fs.readdir(folder)).filter((name) => !name.startsWith(".")), ["Greenhouse construction.planning.json"]);
  } finally {
    await client.close();
  }
});
