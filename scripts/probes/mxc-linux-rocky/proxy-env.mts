/**
 * Does a confined command see the server's proxy variables? Behind a corporate proxy the
 * server is started with HTTPS_PROXY; a command that does not inherit it connects directly.
 * Run inside the Rocky image (see Dockerfile), with MXC_LXC_EXEC set.
 */
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { confinedBashOperations } from "../../../server/src/confinedBash.ts";

process.env.HTTPS_PROXY = "http://proxy.corp.example:3128";
process.env.HTTP_PROXY = "http://proxy.corp.example:3128";
process.env.NO_PROXY = "localhost,.corp.example";
const root = await mkdtemp(path.join(tmpdir(), "proxy-env-"));
const ops = confinedBashOperations({ runner: process.env.MXC_LXC_EXEC!, root, allowWrite: true });
let output = "";
const { exitCode } = await ops.exec(`echo "server HTTPS_PROXY seen as: [\${HTTPS_PROXY:-}] HTTP_PROXY: [\${HTTP_PROXY:-}] NO_PROXY: [\${NO_PROXY:-}]"`, root, { onData: (data) => (output += data.toString()) });
console.log(output.trim(), `(exit ${exitCode})`);
