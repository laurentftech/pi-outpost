/**
 * A tiny pi extension published at 1.0.0 and 1.1.0 by a registry of the test's own, and
 * an agent directory with 1.0.0 installed by a real npm. Each version registers a tool
 * named after itself, so "loaded" can be read from the tools an agent was given.
 *
 * Shared by the Settings wire test and the `pi-outpost update --extensions` process test.
 */
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, realpath, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);

/**
 * npm, run the way it can be run on every platform this suite runs on.
 *
 * On Windows `npm` is `npm.cmd`, a batch file, and current Node refuses to spawn one
 * without a shell (CVE-2024-27980) — a bare `execFile("npm", …)` fails with ENOENT.
 * The same rule as `npmViewInvocation` in server/src/update.ts: go through the npm
 * this process was started by when there is one, and through cmd.exe when there is
 * not.
 */
export function npm(args, options = {}) {
  const execpath = process.env.npm_execpath?.trim();
  if (execpath) return run(process.execPath, [execpath, ...args], options);
  if (process.platform === "win32") {
    const shell = process.env.ComSpec?.trim() || "cmd.exe";
    return run(shell, ["/d", "/s", "/c", `npm.cmd ${args.join(" ")}`], options);
  }
  return run("npm", args, options);
}
export const NAME = "pi-fake-ext";
export const toolOf = (version) => `fake_ext_v${version.replaceAll(".", "_")}`;

/** One version of the extension, packed as npm would publish it. */
async function packed(version, into) {
  const dir = path.join(into, `src-${version}`);
  await mkdir(dir, { recursive: true });
  await writeFile(
    path.join(dir, "package.json"),
    JSON.stringify({ name: NAME, version, type: "module", keywords: ["pi-package"], pi: { extensions: ["./index.js"] } }),
  );
  await writeFile(
    path.join(dir, "index.js"),
    `export default function (pi) {
  pi.registerTool({
    name: ${JSON.stringify(toolOf(version))},
    label: "fake extension ${version}",
    description: "Says which version of the fake extension is loaded.",
    parameters: { type: "object", properties: {} },
    async execute() { return { content: [{ type: "text", text: ${JSON.stringify(version)} }] }; },
  });
}
`,
  );
  const { stdout } = await npm(["pack", "--silent", "--pack-destination", into], { cwd: dir });
  const bytes = await readFile(path.join(into, stdout.trim()));
  return { version, bytes, shasum: createHash("sha1").update(bytes).digest("hex"), integrity: `sha512-${createHash("sha512").update(bytes).digest("base64")}` };
}

/**
 * A registry that publishes whatever `state.published` holds, and nothing it is told to withhold.
 *
 * `others` names further packages it answers for with a single version and no tarball —
 * enough for `npm view <name>@latest version`, which is all pi-outpost's own check asks.
 */
async function registry(t, tarballs, others = {}) {
  const state = { latest: "1.0.0", published: new Set(["1.0.0"]), withholdTarballs: false, requests: 0 };
  const server = createServer((request, response) => {
    state.requests += 1;
    const url = new URL(request.url, "http://registry");
    const base = `http://127.0.0.1:${server.address().port}`;
    if (url.pathname === `/${NAME}`) {
      const versions = {};
      for (const version of state.published) {
        const tarball = tarballs.get(version);
        versions[version] = {
          name: NAME,
          version,
          dist: { tarball: `${base}/${NAME}/-/${NAME}-${version}.tgz`, shasum: tarball.shasum, integrity: tarball.integrity },
        };
      }
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify({ name: NAME, "dist-tags": { latest: state.latest }, versions }));
      return;
    }
    if (url.pathname === `/${NAME}/latest`) {
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify({ name: NAME, version: state.latest }));
      return;
    }
    const other = decodeURIComponent(url.pathname.slice(1));
    if (Object.hasOwn(others, other)) {
      const version = others[other];
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify({ name: other, "dist-tags": { latest: version }, versions: { [version]: { name: other, version } } }));
      return;
    }
    const match = /\/-\/pi-fake-ext-(.+)\.tgz$/.exec(url.pathname);
    if (match && !state.withholdTarballs && tarballs.has(match[1])) {
      response.end(tarballs.get(match[1]).bytes);
      return;
    }
    response.statusCode = 404;
    response.end("{}");
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());
  return { url: `http://127.0.0.1:${server.address().port}/`, state };
}

/**
 * An agent directory with 1.0.0 installed by npm itself, from a registry of the test's
 * own that holds 1.0.0 and 1.1.0 (published when the test says so).
 */
export async function agentDirAtOldVersion(t, prefix, others = {}) {
  const scratch = await realpath(await mkdtemp(path.join(tmpdir(), prefix)));
  const tarballs = new Map([
    ["1.0.0", await packed("1.0.0", scratch)],
    ["1.1.0", await packed("1.1.0", scratch)],
  ]);
  const reg = await registry(t, tarballs, others);
  const agentDir = path.join(scratch, "agent");
  await mkdir(path.join(agentDir, "npm"), { recursive: true });
  await writeFile(path.join(agentDir, "settings.json"), JSON.stringify({ packages: [`npm:${NAME}`] }));
  // A cache of this test's own: npm would otherwise take a tarball another run left
  // behind, and "the registry withholds it" would never be tested.
  const cache = path.join(scratch, "npm-cache");
  const emptyGlobal = path.join(scratch, "empty-global");
  await npm(["install", `${NAME}@1.0.0`, "--prefix", path.join(agentDir, "npm"), "--registry", reg.url, "--no-audit", "--no-fund"], {
    env: { ...process.env, npm_config_prefix: emptyGlobal, npm_config_cache: cache },
  });
  return { scratch, reg, agentDir, cache, emptyGlobal };
}

/** The version installed in an agent directory, read from disk. */
export async function installedVersion(agentDir) {
  return JSON.parse(await readFile(path.join(agentDir, "npm", "node_modules", NAME, "package.json"), "utf8")).version;
}
