/**
 * A real server for driving Settings → Packages by hand: a real npm, a registry of our
 * own holding `pi-fake-ext` 1.0.0 (installed) and 1.1.0 (published), and two open
 * projects so a project switch can land under an open add form.
 *
 *   npx tsx scripts/probes/pi-packages-monkey.mts
 *
 * Prints the URL and the paths to read back; stays up until Ctrl-C.
 */
import { realpath } from "node:fs/promises";
// @ts-expect-error -- plain .mjs test helpers, without type declarations
import { makeWorkspace, startServer } from "../../server/test/harness.mjs";
// @ts-expect-error -- plain .mjs test helpers, without type declarations
import { agentDirAtOldVersion } from "../../server/test/fakePiPackages.mjs";

const teardowns: (() => unknown)[] = [];
const fixture = await agentDirAtOldVersion({ after: (fn: () => unknown) => teardowns.push(fn) }, "pi-packages-monkey-");
fixture.reg.state.published.add("1.1.0");
fixture.reg.state.latest = "1.1.0";
const first = await realpath(await makeWorkspace({ "readme.md": "# first\n" }));
const second = await realpath(await makeWorkspace({ "readme.md": "# second\n" }));
const server = await startServer(
  first,
  { agentDir: fixture.agentDir, updateCheck: true, updateRegistry: fixture.reg.url, openProjects: [second], branding: { title: "packages monkey" } },
  {
    env: {
      PI_OFFLINE: undefined,
      ANTHROPIC_API_KEY: "sk-ant-not-a-real-key",
      npm_config_registry: fixture.reg.url,
      npm_config_prefix: fixture.emptyGlobal,
      npm_config_cache: fixture.cache,
    },
  },
);
console.log(JSON.stringify({ url: server.base, first, second, agentDir: fixture.agentDir, registry: fixture.reg.url }, null, 2));
process.on("SIGINT", async () => {
  await server.stop();
  for (const teardown of teardowns) await teardown();
  process.exit(0);
});
await new Promise(() => {});
