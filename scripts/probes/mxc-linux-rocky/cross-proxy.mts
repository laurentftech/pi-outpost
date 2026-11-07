/**
 * The proof host questions need on a runner (sandboxGrants.ts hostGrantsRefusal): a command
 * reaches its own proxy and no other command's. Two proxies, as two commands with their own
 * grants would have; command A, confined with proxy A, tries proxy B by its port.
 * Run inside the MXC Linux image (Debian or Rocky), with MXC_LXC_EXEC set.
 */
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { confinedBashOperations } from "../../../server/src/confinedBash.ts";
import { startEgressProxy } from "../../../server/src/egressProxy.ts";

const a = await startEgressProxy({ allowedHosts: ["registry.npmjs.org"], onRefused: () => {} });
const b = await startEgressProxy({ allowedHosts: ["example.com", "registry.npmjs.org"], onRefused: () => {} });
const root = await mkdtemp(path.join(tmpdir(), "cross-proxy-"));
const ops = confinedBashOperations({ runner: process.env.MXC_LXC_EXEC!, root, allowWrite: true, networkProxy: a });
let output = "";
const script = [
  `echo "own proxy, listed: $(curl -s -o /dev/null -m 15 -w '%{http_code}' https://registry.npmjs.org/)"`,
  `echo "own proxy, unlisted: $(curl -s -o /dev/null -m 15 -w '%{http_code}' https://example.com/; echo " exit=$?")"`,
  `echo "other proxy ${b.url}: $(curl -s -o /dev/null -m 15 -x ${b.url} -w '%{http_code}' https://example.com/; echo " exit=$?")"`,
].join("\n");
await ops.exec(script, root, { onData: (data) => (output += data.toString()) });
console.log(output.trim());
await a.close();
await b.close();
