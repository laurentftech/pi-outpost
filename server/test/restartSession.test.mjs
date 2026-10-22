import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { connect, makeWorkspace, startServer } from "./harness.mjs";

const extension = name => `export default function(pi) {
  pi.registerTool({ name: ${JSON.stringify(name)}, label: "Reload probe", description: "Reload probe",
    parameters: { type: "object", properties: {} },
    execute: async () => ({ content: [{ type: "text", text: "ok" }] }) });
}`;

test("RestartWithoutChanges: reloads edited extensions without writing settings or requiring a sandbox", async t => {
  const root = await makeWorkspace({ "extension.ts": extension("reload_v1") });
  const file = path.join(root, "extension.ts");
  const server = await startServer(root, { sandbox: undefined, noExtensions: true, extensionScripts: [file] });
  t.after(() => server.stop());
  const client = connect(server.wsUrl());
  t.after(() => client.close());
  const before = await client.waitFor("hello");
  assert.ok(before.tools.some(tool => tool.name === "reload_v1"));
  const configFile = path.join(root, "pi-outpost.test.json");
  const config = await readFile(configFile, "utf8");
  await writeFile(file, extension("reload_v2"));
  client.send({ type: "restart_session" });
  const after = await client.waitFor("update_config_ack", 30_000);
  assert.notEqual(after.sessionId, before.sessionId);
  assert.ok(after.tools.some(tool => tool.name === "reload_v2"));
  assert.ok(!after.tools.some(tool => tool.name === "reload_v1"));
  assert.equal(await readFile(configFile, "utf8"), config);
  assert.equal(after.sandbox, undefined);
  // Both frames arrive before the first asynchronous runtime rebuild can settle.
  client.send({ type: "restart_session" });
  client.send({ type: "restart_session" });
  const refused = await client.waitFor("error", 30_000);
  assert.match(refused.message, /working or changing/);
  const restarted = await client.waitFor(message => message.type === "update_config_ack" && message.sessionId !== after.sessionId, 30_000);
  assert.notEqual(restarted.sessionId, after.sessionId);
  assert.equal(await readFile(configFile, "utf8"), config);
});

test("RestartVeto: an extension refusal is visible and retains the active session", async t => {
  const root = await makeWorkspace({ "veto.ts": `export default function(pi) { pi.on("session_before_switch", () => ({ cancel: true })); }` });
  const server = await startServer(root, { noExtensions: true, extensionScripts: [path.join(root, "veto.ts")] });
  t.after(() => server.stop());
  const client = connect(server.wsUrl());
  t.after(() => client.close());
  const before = await client.waitFor("hello");
  client.send({ type: "restart_session" });
  const error = await client.waitFor("error", 30_000);
  assert.match(error.message, /cancelled by an extension/);
  const other = connect(server.wsUrl());
  t.after(() => other.close());
  assert.equal((await other.waitFor("hello")).sessionId, before.sessionId);
});

test("RestartMcp: rereads MCP configuration and connects the new stdio server", async t => {
  const root = await makeWorkspace();
  const marker = path.join(root, "mcp-initialized.txt");
  const executable = path.join(root, "mcp.mjs");
  await writeFile(executable, `import readline from 'node:readline';
import fs from 'node:fs';
const version=process.argv[2];
readline.createInterface({input:process.stdin}).on('line',line=>{
 const request=JSON.parse(line);if(request.id===undefined)return;
 let result={};
 if(request.method==='initialize'){fs.appendFileSync(${JSON.stringify(marker)},version+'\\n');result={protocolVersion:request.params.protocolVersion,capabilities:{tools:{}},serverInfo:{name:'reload-probe',version:'1.0.0'}};}
 if(request.method==='tools/list')result={tools:[{name:'probe_'+version,description:'Reload probe',inputSchema:{type:'object',properties:{}}}]};
 process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:request.id,result})+'\\n');
});`);
  const agentDir = path.join(root, ".pi-agent");
  await mkdir(agentDir, { recursive: true });
  const mcpFile = path.join(agentDir, "mcp.json");
  const config = version => JSON.stringify({ mcpServers: { probe: { command: process.execPath, args: [executable, version], exposure: "direct" } } });
  await writeFile(mcpFile, config("v1"));
  const server = await startServer(root, { sandbox: undefined });
  t.after(() => server.stop());
  const client = connect(server.wsUrl());
  t.after(() => client.close());
  const before = await client.waitFor("hello");
  const initialized = async version => {
    const deadline = Date.now() + 20_000;
    while (Date.now() < deadline) {
      if ((await readFile(marker, "utf8").catch(() => "")).split(/\r?\n/).includes(version)) return;
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    assert.fail(`MCP ${version} never initialized`);
  };
  await initialized("v1");
  await writeFile(mcpFile, config("v2"));
  client.send({ type: "restart_session" });
  const after = await client.waitFor("update_config_ack", 30_000);
  assert.notEqual(after.sessionId, before.sessionId);
  await initialized("v2");
});
