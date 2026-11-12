import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import esbuild from "esbuild";
import { connect, makeWorkspace, startServer } from "./harness.mjs";

for (const bundled of [false, true]) {
  // openlore: scenario=EstablishWebSocketConnection spec=api
  test(`${bundled ? "npm bundle" : "source"}: git changes during extension loading do not crash startup`, async t => {
    const root = await realpath(await makeWorkspace({ "readme.md": "# Startup watcher\n" }));
    // Outside the watched workspace: writing the debug log must not itself cause
    // directory-change notifications and feed the watcher under test.
    const logs = await mkdtemp(path.join(tmpdir(), "pi-outpost-git-startup-"));
    const wireLog = path.join(logs, "websocket.jsonl");
    const observed = path.join(logs, "observed-during-initialization.jsonl");
    let server;
    let client;
    let bundleDir;
    t.after(async () => {
      client?.close();
      if (server) await server.stop();
      await rm(root, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 });
      await rm(logs, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 });
      if (bundleDir) await rm(bundleDir, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 });
    });
    const git = (...args) => execFileSync("git", ["-c", "user.email=test@example.com", "-c", "user.name=test", ...args], { cwd: root, stdio: "ignore", windowsHide: true });
    git("init", "-q");
    git("add", ".");
    git("commit", "-qm", "fixture");
    const head = path.join(root, ".git", "HEAD");
    const extension = path.join(root, "slow-extension.mjs");
    // Real filesystem events, while the SDK is still loading an extension. This
    // exercises the startup race on every OS, without relying on Windows' initial
    // fs.watch notification or on source-code ordering assertions.
    await writeFile(extension, `import { readFile, writeFile } from "node:fs/promises";
export default async () => {
  const head = ${JSON.stringify(head)};
  const original = await readFile(head);
  const deadline = Date.now() + 10_000;
  for (;;) {
    await writeFile(head, original);
    const messages = await readFile(${JSON.stringify(wireLog)}, "utf8").catch(() => "");
    if (messages.split(/\\r?\\n/).slice(0, -1).filter(Boolean).some(line => JSON.parse(line).type === "git_changed")) {
      await writeFile(${JSON.stringify(observed)}, messages);
      return;
    }
    if (Date.now() > deadline) throw new Error("git watcher did not announce while the extension was initializing");
    await new Promise(resolve => setTimeout(resolve, 50));
  }
};`);
    let entry;
    if (bundled) {
      const cache = fileURLToPath(new URL("../../node_modules/.cache", import.meta.url));
      await mkdir(cache, { recursive: true });
      bundleDir = await mkdtemp(path.join(cache, "git-startup-"));
      entry = path.join(bundleDir, "server.mjs");
      await esbuild.build({
        entryPoints: [fileURLToPath(new URL("../src/index.ts", import.meta.url))],
        outfile: entry, bundle: true, platform: "node", format: "esm", target: "node22",
        external: ["@earendil-works/pi-coding-agent", "@fastify/static", "@fastify/websocket", "fastify", "node-pty", "ws"],
        banner: { js: "import { createRequire as ___createRequire } from 'node:module'; const require = ___createRequire(import.meta.url);" },
      });
    }
    server = await startServer(root, { noExtensions: false, extensionPaths: [extension] }, {
      ...(entry ? { entry } : {}), env: { ANTHROPIC_API_KEY: "e2e-not-a-real-key", WS_LOG_PATH: wireLog },
    });
    const early = (await readFile(observed, "utf8")).split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line));
    assert.ok(early.some(message => message.type === "git_changed"), "a real git notification reached broadcast before extension initialization returned");
    client = connect(server.wsUrl());
    const hello = await client.waitFor("hello");
    assert.ok(hello.sessionId, "startup completed and a real client received its session");
    // Notifications still work after startup: moving initialization must not hide
    // the race by disabling the watcher or dropping all future announcements.
    const seen = client.received.length;
    await writeFile(head, await readFile(head));
    const changed = await client.waitFor(m => client.received.indexOf(m) >= seen && m.type === "git_changed", 10_000);
    assert.equal(changed.repo, "");
    assert.ok((await fetch(`${server.base}/health`)).ok, "the server remains healthy after another git event");
  });
}
