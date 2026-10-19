// Probe: does Claude Code carry an MCP tool result's structuredContent (and the tool's
// _meta.ui.resourceUri) into its stream-json output? A dependency-free stdio MCP server
// with one tool whose text and structuredContent differ, so each can be traced.
import { createInterface } from "node:readline";

const tool = {
  name: "probe_planning",
  description: "Returns the probe planning. Call it when asked for the probe planning.",
  inputSchema: { type: "object", properties: {} },
  _meta: { ui: { resourceUri: "ui://probe/view.html" } },
};

function reply(id, result) {
  process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id, result }) + "\n");
}

createInterface({ input: process.stdin }).on("line", (line) => {
  const msg = JSON.parse(line);
  if (msg.id === undefined) return;
  switch (msg.method) {
    case "initialize":
      return reply(msg.id, {
        protocolVersion: msg.params.protocolVersion,
        capabilities: { tools: {}, resources: {} },
        serverInfo: { name: "probe", version: "0.0.0" },
      });
    case "tools/list":
      return reply(msg.id, { tools: [tool] });
    case "tools/call":
      return reply(msg.id, {
        content: [{ type: "text", text: "TEXT_ONLY_SUMMARY" }],
        structuredContent: { marker: "STRUCTURED_ONLY_MARKER", tasks: 3 },
        _meta: { probe: "RESULT_META_MARKER" },
      });
    default:
      return process.stdout.write(
        JSON.stringify({ jsonrpc: "2.0", id: msg.id, error: { code: -32601, message: "no" } }) + "\n",
      );
  }
});
