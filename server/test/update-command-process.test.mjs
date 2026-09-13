/**
 * What `pi-outpost update` does at process level, which is where it was broken.
 *
 * Every other test of this command injects a `lookupImpl`, so the real npm child was
 * never on the path being asserted — and the old request unref'd its socket
 * unconditionally. `runUpdateCommand` is awaited at top level in index.ts with nothing
 * else pending, so the loop emptied before the registry answered: the command printed
 * no verdict at all and node exited 13 complaining about an unsettled top-level await.
 * Thirty-five scenarios passed over it.
 *
 * So these drive the real `npm view` path through a controlled fake npm, in a child
 * process that awaits the command the way the binary does. The assertion that matters is not
 * the text — it is that there *is* output, and that the exit code is the command's own.
 */
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { describe, test } from "node:test";

const UPDATE_MODULE = pathToFileURL(fileURLToPath(new URL("../src/update.ts", import.meta.url))).href;
const SERVER_DIR = fileURLToPath(new URL("..", import.meta.url));

/**
 * The parent's environment with the coverage sink blanked. Blanked, not removed: node's
 * child_process puts a removed NODE_V8_COVERAGE straight back (see childEnv.mjs).
 */
function envWithoutCoverageSink() {
  return { ...process.env, NODE_V8_COVERAGE: "" };
}

/** Awaits the command at top level, as index.ts does, and exits with what it returned. */
async function runCommandInChild(mode, { timeout, registry } = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), "pi-outpost-fake-npm-"));
  const fakeNpm = path.join(root, "npm-cli.mjs");
  const expectedRegistry = registry ?? null;
  await writeFile(fakeNpm, `
    const args = process.argv.slice(2);
    const expected = ["view", "pi-outpost@latest", "version", "--json"];
    if (JSON.stringify(args.slice(0, 4)) !== JSON.stringify(expected)) {
      console.error("unexpected npm argv: " + JSON.stringify(args));
      process.exit(2);
    }
    const registryIndex = args.indexOf("--registry");
    const expectedRegistry = ${JSON.stringify(expectedRegistry)};
    if (expectedRegistry === null ? registryIndex !== -1 : args[registryIndex + 1] !== expectedRegistry) {
      console.error("unexpected registry override: " + JSON.stringify(args));
      process.exit(2);
    }
    if (${JSON.stringify(mode)} === "hang") setInterval(() => {}, 1_000);
    else setTimeout(() => console.log(JSON.stringify("9.9.9")), 50);
  `);
  const script = `
    import { runUpdateCommand } from ${JSON.stringify(UPDATE_MODULE)};
    const code = await runUpdateCommand({
      version: "0.1.0",
      checkOnly: true,
      channel: "global",
      ${registry === undefined ? "" : `registry: ${JSON.stringify(registry)},`}
    });
    process.exit(code);
  `;
  try {
    return await new Promise((resolve, reject) => {
      const child = execFile(
        process.execPath,
        ["--import", "tsx/esm", "--input-type=module", "--eval", script],
        { cwd: SERVER_DIR, timeout, env: { ...envWithoutCoverageSink(), npm_execpath: fakeNpm } },
        (error, stdout, stderr) => {
          if (error && error.killed) reject(new Error(`the command never finished:\n${stdout}${stderr}`));
          else resolve({ code: error?.code ?? 0, stdout, stderr });
        },
      );
      child.on("error", reject);
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

/** Run through the host's real npm with its registry supplied only by `.npmrc`. */
async function runThroughNpmrc(registry, { timeout }) {
  const root = await mkdtemp(path.join(os.tmpdir(), "pi-outpost-npmrc-"));
  const userconfig = path.join(root, ".npmrc");
  await writeFile(userconfig, `registry=${registry}\n`);
  const script = `
    import { runUpdateCommand } from ${JSON.stringify(UPDATE_MODULE)};
    const code = await runUpdateCommand({
      version: "0.1.0",
      checkOnly: true,
      channel: "global",
    });
    process.exit(code);
  `;
  const {
    npm_execpath: _npmExecPath,
    npm_config_registry: _npmRegistry,
    NPM_CONFIG_REGISTRY: _npmRegistryUpper,
    ...baseEnv
  } = envWithoutCoverageSink();
  try {
    return await new Promise((resolve, reject) => {
      const child = execFile(
        process.execPath,
        ["--import", "tsx/esm", "--input-type=module", "--eval", script],
        {
          cwd: SERVER_DIR,
          timeout,
          env: {
            ...baseEnv,
            NPM_CONFIG_USERCONFIG: userconfig,
            npm_config_cache: path.join(root, "cache"),
            npm_config_update_notifier: "false",
            NO_PROXY: "127.0.0.1",
          },
        },
        (error, stdout, stderr) => {
          if (error && error.killed) reject(new Error(`the command never finished:\n${stdout}${stderr}`));
          else resolve({ code: error?.code ?? 0, stdout, stderr });
        },
      );
      child.on("error", reject);
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function withNexus(body) {
  let requests = 0;
  const server = http.createServer((request, response) => {
    requests += 1;
    response.writeHead(200, { "content-type": "application/json" });
    if (request.url?.includes("/-/package/pi-outpost/dist-tags")) {
      response.end(JSON.stringify({ latest: "9.9.9" }));
    } else if (request.url?.endsWith("/latest")) {
      response.end(JSON.stringify({ name: "pi-outpost", version: "9.9.9" }));
    } else {
      response.end(JSON.stringify({
        name: "pi-outpost",
        "dist-tags": { latest: "9.9.9" },
        versions: { "9.9.9": { name: "pi-outpost", version: "9.9.9" } },
      }));
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    return await body(`http://127.0.0.1:${server.address().port}`, () => requests);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

// openlore: {"domain":"update","requirement":"UpdateReportsWhatIsAvailable","scenario":"TheCheckOutlivesNothingButItselfIsNotCutShort","specFile":"openspec/specs/update/spec.md"}
// openlore: {"domain":"update","requirement":"UpdateChecksUseTheConfiguredRegistry","scenario":"FallsBackToThePublicRegistry","specFile":"openspec/specs/update/spec.md"}
describe("a check somebody asked for", () => {
  test("prints its verdict rather than draining the process first", async () => {
    const { code, stdout, stderr } = await runCommandInChild("answer", { timeout: 30_000 });

    // The exit code first: 13 is node's for an unsettled top-level await, and it is
    // what this produced before the request could be ref'd. Naming it separates the
    // regression from any other non-zero exit.
    assert.notEqual(code, 13, `the process drained with the check still in flight:\n${stdout}${stderr}`);
    assert.equal(code, 0, `update --check exited ${code}:\n${stdout}${stderr}`);
    assert.match(stdout, /0\.1\.0 is installed; 9\.9\.9 is available/);
    // And nothing about an await that never settled.
    assert.doesNotMatch(stderr, /unsettled top-level await/);
  });
});

// openlore: {"domain":"update","requirement":"UpdateChecksUseTheConfiguredRegistry","scenario":"UsesThePackageManagerRegistry","specFile":"openspec/specs/update/spec.md"}
describe("a Nexus registry configured only in .npmrc", () => {
  test("is reached through npm with no duplicate pi-outpost setting", async () => {
    await withNexus(async (registry, requests) => {
      const { code, stdout, stderr } = await runThroughNpmrc(registry, { timeout: 30_000 });
      assert.equal(code, 0, `update --check exited ${code}:\n${stdout}${stderr}`);
      assert.match(stdout, /0\.1\.0 is installed; 9\.9\.9 is available/);
      assert.ok(requests() > 0, "npm never queried the Nexus registry from .npmrc");
    });
  });
});

// openlore: {"domain":"update","requirement":"UpdateChecksUseTheConfiguredRegistry","scenario":"ConfiguredOverrideWins","specFile":"openspec/specs/update/spec.md"}
describe("an explicit registry override", () => {
  test("is passed to npm while the default leaves npm's own configuration alone", async () => {
    const registry = "https://nexus.internal/repository/npm-group";
    const { code, stdout, stderr } = await runCommandInChild("answer", { timeout: 30_000, registry });
    assert.equal(code, 0, `update --check exited ${code}:\n${stdout}${stderr}`);
  });
});

// openlore: {"domain":"update","requirement":"UpdateReportsWhatIsAvailable","scenario":"TheCheckOutlivesNothingButItselfIsNotCutShort","specFile":"openspec/specs/update/spec.md"}
describe("a registry that never answers", () => {
  test("is reported as a failed check, not as silence", async () => {
    // The other half of the same property. The timeout is what turns a hang into a
    // verdict, and an unref'd timer cannot fire in a process with nothing else to do —
    // it would exit silently instead, which is the answer that stops someone looking.
    const { code, stdout, stderr } = await runCommandInChild("hang", { timeout: 30_000 });

    assert.equal(code, 1, `expected a reported failure, got ${code}:\n${stdout}${stderr}`);
    assert.match(stdout, /could not check for updates/);
    assert.doesNotMatch(stdout, /newest published version/);
  });
});
