/** Writes down the agent directory Pi reports to an extension that looks it up itself. */
import { writeFileSync } from "node:fs";
import { getAgentDir } from "@earendil-works/pi-coding-agent";

export default function (pi) {
  pi.on("session_start", () => {
    if (process.env.AGENT_DIR_REPORT) writeFileSync(process.env.AGENT_DIR_REPORT, JSON.stringify({ agentDir: getAgentDir() }));
  });
}
