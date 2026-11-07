/**
 * Probe for host-questions-on-posix-runners: a real server whose agent's shell runs under a POSIX
 * runner with `sandbox.allowedHosts`, and a scripted agent that fetches a host the list does not name.
 *
 * Runner from PROBE_RUNNER (default: macOS' Seatbelt). Port 4332 by default (PROBE_PORT). Next to
 * `npm run bench`, open http://127.0.0.1:4321/?server=http%3A%2F%2F127.0.0.1%3A4332&theme=light and
 * send any message: the agent runs `curl https://example.com/` and the dialog asks about example.com.
 * PROBE_COMMAND replaces the command (e.g. an internal page by its name). In a container, set
 * PROBE_HOST=0.0.0.0 and PROBE_TOKEN, and add `&token=<it>` to the page's URL.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
// @ts-expect-error -- .mjs harness, no types
import { makeWorkspace, startServer } from "../../../server/test/harness.mjs";

const REPO = path.join(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const PROVIDER = path.join(REPO, "server/test/fixtures/bash-call-provider.mjs");
const runner = process.env.PROBE_RUNNER ?? "/usr/bin/sandbox-exec";
const port = Number(process.env.PROBE_PORT ?? 4332);
const host = process.env.PROBE_HOST ?? "127.0.0.1";
const origin = process.env.PROBE_ORIGIN ?? "http://127.0.0.1:4321";
const command = process.env.PROBE_COMMAND ?? `curl -sS -o /dev/null -w 'fetched=%{http_code}\\n' https://example.com/`;

const root = await makeWorkspace({ "readme.md": "# host questions probe\n" });
const server = await startServer(
  root,
  {
    // Listening beyond the loopback (in a container, its port published) needs a token.
    server: { host, port, allowedOrigins: [origin], ...(process.env.PROBE_TOKEN ? { token: process.env.PROBE_TOKEN } : {}) },
    branding: { title: "host questions probe", defaultTheme: "light" },
    sandbox: { root, allowWrite: true, allowBash: true, bashRunner: runner, allowedHosts: ["registry.npmjs.org"] },
    extensionPaths: [PROVIDER],
    allowedModels: [{ provider: "bash-call-test", id: "bash-call-test" }],
  },
  { env: { BASH_CALL_COMMANDS: JSON.stringify([command]) } },
);
console.log(`pi-outpost ${server.base} — runner ${runner}, allowedHosts registry.npmjs.org; workspace ${root}`);
process.on("SIGTERM", () => void server.stop().then(() => process.exit(0)));
await new Promise(() => {});
