// Runs the MCP Bundle CLI at a pinned version, fetched on demand by npm.
//
// Not a dependency: the CLI's own dependencies (node-forge, and tmp through its
// interactive prompts) carry advisories with no fixed version, and only `pack`,
// `validate` and `unpack` are used here. Run through the npm that started this
// script (`npm_execpath`) with this Node: no shell, and no `npm.cmd` on Windows.
import { execFileSync } from "node:child_process";

export const MCPB_PACKAGE = "@anthropic-ai/mcpb@2.1.2";

export function mcpb(args, options = {}) {
  const npm = process.env.npm_execpath;
  if (!npm) throw new Error("run this through npm (npm run …), which provides npm_execpath");
  return execFileSync(process.execPath, [npm, "exec", "--yes", `--package=${MCPB_PACKAGE}`, "--", "mcpb", ...args], { stdio: "inherit", ...options });
}
