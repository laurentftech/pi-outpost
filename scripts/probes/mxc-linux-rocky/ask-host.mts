/**
 * The whole host question on a POSIX runner: a command connects to a host the list does not
 * name, the connection waits while "the user" is asked, and the answer decides. Twice: allowed
 * once (the fetch succeeds, one question for two connections), then refused.
 * Runner from MXC_LXC_EXEC (Linux), MXC_MAC_EXEC or SEATBELT_EXEC (macOS).
 */
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { confinedBashOperations } from "../../../server/src/confinedBash.ts";
import { startEgressProxy } from "../../../server/src/egressProxy.ts";

const runner = process.env.MXC_LXC_EXEC ?? process.env.MXC_MAC_EXEC ?? process.env.SEATBELT_EXEC;
if (!runner) throw new Error("name a runner");
const shared = await startEgressProxy({ allowedHosts: ["registry.npmjs.org"], onRefused: () => {} });
const root = await mkdtemp(path.join(tmpdir(), "ask-host-"));
for (const answer of ["approved-once", "refused"] as const) {
  const asked: string[] = [];
  const ops = confinedBashOperations({
    runner,
    root,
    allowWrite: true,
    networkProxy: shared,
    allowedHosts: ["registry.npmjs.org"],
    askHost: async ({ host, command }) => {
      asked.push(`${host} (command: ${command.slice(0, 40)}…)`);
      await new Promise((resolve) => setTimeout(resolve, 500)); // the user reading the dialog
      return answer;
    },
  });
  let output = "";
  await ops.exec(
    `echo "first=$(curl -s -o /dev/null -m 30 -w '%{http_code}' https://example.com/)"; echo "second=$(curl -s -o /dev/null -m 30 -w '%{http_code}' https://example.com/)"`,
    root,
    { onData: (data) => (output += data.toString()) },
  );
  console.log(`== ${path.basename(runner)}, answer ${answer}\n${output.trim()}\nasked ${asked.length}×: ${asked.join("; ")}`);
}
await shared.close();
