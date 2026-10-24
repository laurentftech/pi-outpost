/**
 * The packed posters `.mcpb`, as Claude Desktop receives it: its manifest validated, its
 * contents unpacked to a temporary folder, and its server started there with the current
 * Node over stdio, as the host starts it.
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
import { POSTER_EXAMPLE } from "@pi-outpost/posters/guide";

const BUNDLE = fileURLToPath(new URL("../dist/pi-outpost-posters.mcpb", import.meta.url));
// @ts-expect-error -- a plain .mjs script, shared with pack.
import { mcpb } from "../scripts/mcpb.mjs";

let scratch: string;
let unpacked: string;

before(async () => {
  await fs.access(BUNDLE).catch(() => {
    throw new Error(`${BUNDLE} is missing: run npm run pack --workspace @pi-outpost/mcp first`);
  });
  scratch = await fs.mkdtemp(path.join(os.tmpdir(), "outpost-posters-mcpb-"));
  unpacked = path.join(scratch, "bundle");
  mcpb(["unpack", BUNDLE, unpacked], { stdio: "pipe" });
});

after(async () => {
  if (scratch) await fs.rm(scratch, { recursive: true, force: true });
});

test("The posters bundle validates, asks for a folder with no default, and carries the editor", async () => {
  mcpb(["validate", path.join(unpacked, "manifest.json")], { stdio: "pipe" });
  const manifest = JSON.parse(await fs.readFile(path.join(unpacked, "manifest.json"), "utf8"));
  const folder = manifest.user_config.posters_dir;
  assert.equal(folder.type, "directory");
  assert.equal(folder.required, true);
  assert.equal("default" in folder, false);
  assert.equal(manifest.server.mcp_config.env.POSTERS_DIR, "${user_config.posters_dir}");
  // The debug log is off unless the person turns it on, and an unticked box arrives as "false".
  assert.equal(manifest.user_config.debug_log.default, false);
  assert.equal(manifest.server.mcp_config.env.POSTERS_DEBUG, "${user_config.debug_log}");
  const repoVersion = JSON.parse(await fs.readFile(fileURLToPath(new URL("../../cli/package.json", import.meta.url)), "utf8")).version;
  assert.equal(manifest.version, repoVersion);
  for (const file of ["server/index.mjs", "server/poster.html"]) assert.ok((await fs.stat(path.join(unpacked, file))).size > 0, file);
});

test("The bundled posters server answers over stdio, writes the poster, and keeps no debug log unless asked", async () => {
  const manifest = JSON.parse(await fs.readFile(path.join(unpacked, "manifest.json"), "utf8"));
  const folder = path.join(scratch, "My posters");
  const args = (manifest.server.mcp_config.args as string[]).map((arg) => arg.replace("${__dirname}", unpacked));
  const env = { ...process.env, POSTERS_DIR: folder, POSTERS_DEBUG: "false" } as Record<string, string>;
  const transport = new StdioClientTransport({ command: process.execPath, args, env, stderr: "pipe" });
  const client = new Client({ name: "bundle-check", version: "1" });
  await client.connect(transport);
  try {
    const { tools } = await client.listTools();
    assert.ok(tools.some((tool) => tool.name === "show_poster"));
    const { resources } = await client.listResources();
    const { contents } = await client.readResource({ uri: resources[0]!.uri });
    assert.match((contents[0] as { text: string }).text, /<html/i);
    const created = (await client.callTool({ name: "create_poster", arguments: { title: "Class rules", html: POSTER_EXAMPLE.html, css: POSTER_EXAMPLE.css, format: POSTER_EXAMPLE.format } })) as {
      isError?: boolean;
      content: Array<{ text: string }>;
    };
    assert.notEqual(created.isError, true, created.content[0]?.text);
    assert.deepEqual((await fs.readdir(folder)).filter((name) => !name.startsWith(".")), ["Class rules.poster.html"]);
    assert.equal((await fs.readdir(path.join(folder, ".posters"))).includes("debug.log"), false);
  } finally {
    await client.close();
  }
});
