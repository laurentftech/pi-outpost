// Runs Claude Code once against server.mjs and reports where each part of the tool
// result ends up in its stream-json output: the text, the structured content, the
// result's _meta, and the tool's _meta.ui.resourceUri.
//
//   node scripts/probes/claude-structured-content/run.mjs [model]
//
// Needs the `claude` CLI on PATH and a signed-in account; makes one short live call.
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const config = path.join(mkdtempSync(path.join(tmpdir(), "claude-structured-content-")), "mcp.json");
writeFileSync(config, JSON.stringify({ mcpServers: { probe: { command: process.execPath, args: [path.join(here, "server.mjs")] } } }));

const run = spawnSync(
  "claude",
  [
    "-p", "Call the probe_planning tool once, then reply with just: done",
    "--model", process.argv[2] ?? "haiku",
    "--mcp-config", config,
    "--strict-mcp-config",
    "--allowedTools", "mcp__probe__probe_planning",
    "--output-format", "stream-json",
    "--verbose",
  ],
  { encoding: "utf8", shell: process.platform === "win32" },
);
if (run.status !== 0) {
  console.error(run.stderr || run.error?.message);
  process.exit(1);
}

const lines = run.stdout.split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
// Match on the call's id: a ToolSearch result for the deferred tool comes first.
const call = lines
  .flatMap((line) => (line.type === "assistant" ? line.message.content : []))
  .find((block) => block.type === "tool_use" && block.name === "mcp__probe__probe_planning");
const isOurs = (block) => block.type === "tool_result" && block.tool_use_id === call?.id;
const result = lines.find((line) => line.type === "user" && Array.isArray(line.message?.content) && line.message.content.some(isOurs));
const block = result?.message.content.find(isOurs);
const found = (marker) => run.stdout.includes(marker);
console.log(JSON.stringify({
  claudeCode: spawnSync("claude", ["--version"], { encoding: "utf8", shell: process.platform === "win32" }).stdout.trim(),
  modelSees: block?.content ?? null,
  textReachesTheModel: JSON.stringify(block?.content ?? "").includes("TEXT_ONLY_SUMMARY"),
  textAnywhere: found("TEXT_ONLY_SUMMARY"),
  rawResultInToolUseResult: result?.tool_use_result ?? null,
  resourceUriAnywhere: found("ui://probe/view.html"),
}, null, 2));
