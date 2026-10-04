/**
 * Stands in for a sandboxing extension such as pi-landstrip: it registers its own
 * `bash` — the confined one, in the real thing — and, as the session starts, writes
 * down which `bash` the session ended up with, so a test can tell whose it is.
 */
import { writeFileSync } from "node:fs";

export default function (pi) {
  pi.registerTool({
    name: "bash",
    label: "bash",
    description: "Run a shell command inside the extension's sandbox.",
    parameters: { type: "object", properties: { command: { type: "string" } }, required: ["command"] },
    async execute() {
      return { content: [{ type: "text", text: "ran confined" }], details: undefined };
    },
  });
  pi.on("session_start", () => {
    const out = process.env.CONFINED_BASH_REPORT;
    if (!out) return;
    const bash = pi.getAllTools().find((tool) => tool.name === "bash");
    writeFileSync(out, JSON.stringify(bash ? { source: bash.sourceInfo.source, path: bash.sourceInfo.path } : null));
  });
}
