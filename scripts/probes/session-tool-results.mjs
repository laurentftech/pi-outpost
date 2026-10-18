// Print the tool calls, tool results and assistant text of the newest session transcript under a
// pi agent directory's sessions/. Usage: node session-tool-results.mjs <agentDir>
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
const files = [];
const walk = (dir) => { for (const e of readdirSync(dir, { withFileTypes: true })) { const p = path.join(dir, e.name); if (e.isDirectory()) walk(p); else if (p.endsWith(".jsonl")) files.push(p); } };
walk(path.join(process.argv[2], "sessions"));
const newest = files.sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)[0];
for (const line of readFileSync(newest, "utf8").split(/\r?\n/).filter(Boolean)) {
  const m = JSON.parse(line).message;
  if (!m) continue;
  for (const c of [].concat(m.content ?? [])) {
    if (c.type === "toolCall") console.log("CALL", JSON.stringify(c.arguments).slice(0, 500));
    else if (m.role === "toolResult" && c.type === "text") console.log("RESULT", c.text);
    else if (m.role === "assistant" && c.type === "text") console.log("ASSISTANT", c.text.slice(0, 300));
  }
}
