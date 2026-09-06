import { execFileSync } from "node:child_process";
import { createServer } from "node:http";
import { access, mkdir, readdir, readFile, realpath, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { SEEDED_MESSAGES } from "./fixtures/seeded-transcript";
// The same harness the server's own integration tests use: a real server, in its
// own process group, against a throwaway workspace, with PI_OFFLINE set so the
// SDK's model runtime never reaches the network.
// @ts-expect-error -- .mjs harness, no types; the shape is asserted below
import { makeWorkspace, startServer } from "../server/test/harness.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.join(HERE, "..");
const HOST_DIST = path.join(HERE, "dist-host");
const SANDBOX_SETTINGS_PROVIDER = path.join(REPO, "server/test/fixtures/sandbox-settings-provider.mjs");

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".map": "application/json",
};

/**
 * Serves the built host page on its own origin.
 *
 * Its own origin matters: a widget loaded same-origin with the backend would
 * never exercise the cross-origin path that every real host application takes.
 */
function serveHostPage(): Promise<{ url: string; close: () => Promise<void> }> {
  const server = createServer((request, response) => {
    const requested = new URL(request.url ?? "/", "http://localhost").pathname;
    const relative = requested === "/" ? "index.html" : requested.replace(/^\/+/, "");
    // Name arithmetic, then a containment check: this serves a build directory
    // to a browser we control, and it still does not get to read outside it.
    const file = path.join(HOST_DIST, relative);
    if (!file.startsWith(HOST_DIST + path.sep) && file !== path.join(HOST_DIST, "index.html")) {
      response.writeHead(403).end();
      return;
    }
    readFile(file).then(
      (bytes) => {
        response.writeHead(200, { "content-type": TYPES[path.extname(file)] ?? "application/octet-stream" });
        response.end(bytes);
      },
      () => response.writeHead(404).end(),
    );
  });

  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address !== null ? address.port : 0;
      resolve({
        url: `http://127.0.0.1:${port}`,
        close: () =>
          new Promise((done) => {
            server.closeAllConnections();
            server.close(() => done());
          }),
      });
    });
  });
}

/**
 * The environment the test server gets: no provider key except one that is not
 * real.
 *
 * Both halves matter. Without the removals the run inherits whatever the
 * developer has configured, and the suite passes on their machine and fails on a
 * runner that has nothing — which is exactly what happened the first time this
 * job ran in CI: with no key at all the app renders the onboarding screen ("No
 * model provider is set up yet") and there is no composer to find. Without the
 * fake key it would now fail everywhere instead.
 *
 * The key is never used: PI_OFFLINE keeps the runtime off the network and no
 * test sends a message. It exists so the interface under test is the interface,
 * not the setup wizard.
 */
function onlyOneFakeProvider(): Record<string, string | undefined> {
  const env: Record<string, string | undefined> = {};
  for (const name of Object.keys(process.env)) {
    if (/API_KEY|AUTH_TOKEN|_TOKEN$/.test(name)) env[name] = undefined;
  }
  env.ANTHROPIC_API_KEY = "sk-ant-not-a-real-key";
  return env;
}

/**
 * Newest mtime under `dir` among the files a build actually consumes.
 *
 * Extensions, not everything: notes and fixtures sit next to source, and a
 * gate that rebuilds the world because a README was edited is a gate people
 * learn to work around.
 */
async function newestChange(dir: string): Promise<number> {
  const skip = new Set(["node_modules", "dist", "dist-host", "coverage", ".turbo"]);
  const built = /\.(ts|tsx|js|jsx|mjs|cjs|css|html|json)$/;
  let newest = 0;
  const walk = async (at: string): Promise<void> => {
    const entries = await readdir(at, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (entry.name.startsWith(".") || skip.has(entry.name)) continue;
      const full = path.join(at, entry.name);
      if (entry.isDirectory()) await walk(full);
      else if (built.test(entry.name)) newest = Math.max(newest, (await stat(full)).mtimeMs);
    }
  };
  await walk(dir);
  return newest;
}

/**
 * Refuses to run a browser suite against a build older than its own source.
 *
 * Existence was the only check, and existence is not the question: a stale
 * bundle serves yesterday's behaviour perfectly happily. A fix can then be
 * written, the suite run, and every assertion pass or fail against code that is
 * not the code under test — which is exactly what happened while an overlay fix
 * sat unbuilt and the widget kept showing the bug it had already lost.
 *
 * Reads mtimes, so it assumes the build ran in the same checkout as the sources
 * it is compared against — true of this repo's CI, which builds and runs the
 * browser job together. Restoring `web/dist`, `embed/dist` or `dist-host` from a
 * cache across jobs would hand this function timestamps older than a fresh
 * checkout's, and it would refuse a build that is in fact current.
 */
async function assertFresh(artifact: string, sources: readonly string[], command: string): Promise<void> {
  const built = (await stat(artifact)).mtimeMs;
  for (const source of sources) {
    const changed = await newestChange(path.join(REPO, source));
    if (changed > built) {
      throw new Error(
        `${path.relative(REPO, artifact)} is older than ${source} — run \`${command}\` first ` +
          `(built ${new Date(built).toISOString()}, ${source} changed ${new Date(changed).toISOString()})`,
      );
    }
  }
}

/**
 * Boots what both specs need and hands the URLs to the workers through the
 * environment. Returning a function registers it as the teardown.
 */
export default async function globalSetup(): Promise<() => Promise<void>> {
  // Both specs read a built artifact rather than source. Saying which one is
  // missing beats the cascade of 404s and blank pages that follows otherwise.
  const required = [
    [path.join(REPO, "web/dist/index.html"), "npm run build --workspace web", ["web/src", "ui/src", "shared/src"]],
    [
      path.join(REPO, "embed/dist/pi-outpost-embed.js"),
      "npm run build --workspace @pi-outpost/embed",
      ["embed/src", "ui/src", "web/src", "shared/src"],
    ],
    [path.join(HOST_DIST, "index.html"), "npm run build:e2e-host", ["e2e/host", "embed/dist"]],
  ] as const;
  for (const [file, command, sources] of required) {
    await access(file).catch(() => {
      throw new Error(`missing ${path.relative(REPO, file)} — run \`${command}\` first`);
    });
    await assertFresh(file, sources, command);
  }

  const host = await serveHostPage();

  const root = await makeWorkspace({
    "readme.md": "# workspace\n\nA file the browser is allowed to see.\n",
    // A prompt template, so `/` has something to autocomplete. Discovered from
    // the workspace's own .pi/prompts, the same way a real project's are.
    ".pi/prompts/greet.md": "---\ndescription: say hello\n---\n\nSay hello.\n",
  });
  const secondRoot = await realpath(await makeWorkspace({ "second.md": "# second workspace\n" }));
  // An extension directory the settings menu can be pointed at. Outside the server's
  // workspace on purpose: the path picker browses the server's own filesystem, which
  // is what an operator pointing a setting at a mounted share actually does.
  const extensionsDir = await realpath(
    await makeWorkspace({
      "index.ts":
        'export default (pi) => {\n  pi.registerCommand("e2e-added", { description: "Added through Settings", handler: async () => {} });\n};\n',
    }),
  );
  const server = await startServer(
    root,
    {
      openProjects: [secondRoot],
      // The host page is a different origin, which is the whole point of the widget.
      server: { allowedOrigins: [host.url] },
      branding: { title: "embed smoke" },
      // The harness disables template discovery; this server wants it, so `/`
      // has a command to complete.
      noPromptTemplates: false,
    },
    { env: onlyOneFakeProvider() },
  );

  // Two more servers, one per embed workspace-control policy. The policy is
  // loaded configuration rather than a mount option, so the only way to see what
  // a deployment would show is to run a server configured that way. The default
  // server above is `settings`, the third policy, by saying nothing.
  const rootModeRoot = await realpath(
    await makeWorkspace({ "readme.md": "# root mode\n", "inner/notes.md": "# inner\n" }),
  );
  const embedRootMode = await startServer(
    rootModeRoot,
    {
      server: { allowedOrigins: [host.url] },
      branding: { title: "root mode" },
      embed: { workspaceControls: "root" },
      // Writes confined to the root itself: the harness default pins a writable
      // root beside it that any narrowing would strand.
      sandbox: { root: rootModeRoot, allowWrite: true, allowBash: false },
    },
    { env: onlyOneFakeProvider() },
  );

  // Dedicated to the Settings sandbox regression. The browser moves from one
  // child directory to the other, then the fake provider calls the live `ls`
  // tool so the Playwright test can verify the agent moved with it.
  const settingsSandboxRoot = await realpath(
    await makeWorkspace({
      "original/original.txt": "old\n",
      "moved/moved.txt": "new\n",
      "resources/outside-skill/SKILL.md": "---\nname: outside-skill\ndescription: Readable outside the sandbox\n---\n\nE2E_OUTSIDE_SKILL_BODY\n",
    }),
  );
  const settingsSandboxLog = path.join(settingsSandboxRoot, "agent-ls.json");
  const settingsSandboxSkillDir = path.join(settingsSandboxRoot, "resources", "outside-skill");
  const settingsSandbox = await startServer(
    settingsSandboxRoot,
    {
      server: { allowedOrigins: [host.url] },
      branding: { title: "sandbox settings" },
      sandbox: {
        root: path.join(settingsSandboxRoot, "original"),
        allowWrite: true,
        writableRoot: path.join(settingsSandboxRoot, "original"),
        allowBash: false,
      },
      extensionPaths: [SANDBOX_SETTINGS_PROVIDER],
      allowedModels: [{ provider: "sandbox-settings-test", id: "sandbox-settings-test" }],
    },
    {
      env: {
        ...onlyOneFakeProvider(),
        SANDBOX_SETTINGS_LOG: settingsSandboxLog,
        SANDBOX_SETTINGS_READ_PATH: path.join(settingsSandboxSkillDir, "SKILL.md"),
      },
    },
  );

  const projectsSecondRoot = await realpath(await makeWorkspace({ "second.md": "# second project\n" }));
  const embedProjectsMode = await startServer(
    await makeWorkspace({ "readme.md": "# projects mode\n" }),
    {
      server: { allowedOrigins: [host.url] },
      branding: { title: "projects mode" },
      embed: { workspaceControls: "projects" },
      openProjects: [projectsSecondRoot],
    },
    { env: onlyOneFakeProvider() },
  );

  // A server offering project controls to embeds AND pinned: the lock is the
  // authorization boundary, and it has to win over the presentation policy.
  const embedLockedProjects = await startServer(
    await makeWorkspace({ "readme.md": "# locked\n" }),
    {
      server: { allowedOrigins: [host.url] },
      branding: { title: "locked projects mode" },
      embed: { workspaceControls: "projects" },
      workspaceLock: true,
    },
    { env: onlyOneFakeProvider() },
  );

  // A server that forbids changing extension paths, so the browser can see what a
  // deployment that keeps code-loading to itself actually presents. The lock is
  // loaded configuration, not a mount option: only a server configured that way
  // shows it.
  const extensionsLocked = await startServer(
    await makeWorkspace({ "readme.md": "# locked extensions\n" }),
    {
      server: { allowedOrigins: [host.url] },
      branding: { title: "locked extensions" },
      extensionPaths: [extensionsDir],
      extensionLock: true,
    },
    { env: onlyOneFakeProvider() },
  );

  // A second server, token-protected. The widget then sends `Authorization`,
  // which is not a CORS-safelisted header, so the browser preflights every
  // request — the one path a curl-shaped test cannot exercise, because curl
  // never sends a preflight of its own accord.
  const guarded = await startServer(
    await makeWorkspace({ "readme.md": "# guarded workspace\n" }),
    {
      server: { allowedOrigins: [host.url], token: E2E_TOKEN },
      branding: { title: "guarded smoke" },
    },
    { env: onlyOneFakeProvider() },
  );

  // A dedicated server with terminal: { enabled: true }
  const terminalServer = await startServer(
    await makeWorkspace({ "readme.md": "# terminal enabled\n" }),
    {
      server: { allowedOrigins: [host.url] },
      branding: { title: "terminal smoke" },
      terminal: { enabled: true },
    },
    { env: onlyOneFakeProvider() },
  );

  // A third server, whose session already holds the diagrams. Its own server
  // because the transcript comes from a scripted RPC child rather than the
  // embedded runtime, and because it is the one configured to open light —
  // `branding.defaultTheme` is untestable on a server whose host page names a
  // theme of its own.
  const diagramRoot = await makeWorkspace({ "readme.md": "# diagrams\n" });
  const fakeConfig = path.join(diagramRoot, "fake-rpc.json");
  await writeFile(
    fakeConfig,
    JSON.stringify({ messages: SEEDED_MESSAGES, state: { sessionId: "diagrams-1" } }),
  );
  const diagrams = await startServer(
    diagramRoot,
    {
      server: { allowedOrigins: [host.url] },
      branding: { title: "diagram smoke", defaultTheme: "light" },
      agentRuntime: {
        mode: "rpc",
        executable: process.execPath,
        args: [path.join(REPO, "server/test/fixtures/fake-pi-rpc.mjs")],
        startupTimeoutMs: 20_000,
      },
      // RPC refuses to pair with a sandbox it cannot enforce on a child that
      // builds its own tools; the harness sandboxes by default.
      sandbox: undefined,
    },
    { env: { ...onlyOneFakeProvider(), FAKE_PI_RPC_CONFIG: fakeConfig } },
  );

  // A fourth real app server drives the Work Plan lifecycle. Its RPC child is
  // scripted because browser CI is offline, but it emits the same tool events
  // and writes the same per-session sidecars as the real work_plan extension.
  const planRoot = await makeWorkspace({ "readme.md": "# work plan\n" });
  const planSessionDir = path.join(planRoot, ".pi-agent", "sessions");
  await mkdir(planSessionDir, { recursive: true });
  const sourceSession = path.join(planSessionDir, "2026-08-23T00-00-00-000Z_source.jsonl");
  const otherSession = path.join(planSessionDir, "2026-08-23T00-01-00-000Z_other.jsonl");
  const forkSession = path.join(planSessionDir, "2026-08-23T00-02-00-000Z_fork.jsonl");
  const entry = {
    id: "user-1",
    parentId: null,
    timestamp: "2026-08-23T00:00:01.000Z",
    type: "message",
    message: { role: "user", content: [{ type: "text", text: "Ship the release" }], timestamp: 1 },
  };
  const sessionText = (id: string, name: string) =>
    `${JSON.stringify({ type: "session", version: 3, id, timestamp: "2026-08-23T00:00:00.000Z", cwd: planRoot })}\n` +
    `${JSON.stringify(entry)}\n` +
    `${JSON.stringify({ type: "session_info", id: `${id}-name`, parentId: "user-1", timestamp: "2026-08-23T00:00:02.000Z", name })}\n`;
  await writeFile(sourceSession, sessionText("source", "Release source"));
  await writeFile(otherSession, sessionText("other", "Other work"));

  const sourcePlan = (status: "in_progress" | "done") => ({
    version: 1,
    id: "release",
    title: "Release plan",
    updatedAt: "2026-08-23T00:00:03.000Z",
    tasks: [{
      id: "publish",
      title: "Publish release",
      description: "Build, verify, and publish the release.",
      status,
      dependsOn: [],
      resources: [{ uri: "workspace:readme.md", label: "Release notes" }],
    }],
  });
  const otherPlan = {
    version: 1,
    id: "other",
    title: "Other plan",
    updatedAt: "2026-08-23T00:00:03.000Z",
    tasks: [{ id: "wait", title: "Wait", status: "todo", dependsOn: [], resources: [] }],
  };
  await writeFile(`${otherSession}.work-plan.json`, `${JSON.stringify(otherPlan, null, 2)}\n`);

  const toolEnd = (sessionFile: string, workPlan: object, call: string) => ({
    type: "tool_execution_end",
    toolCallId: call,
    toolName: "work_plan",
    result: {
      content: [{ type: "text", text: "Work Plan updated." }],
      details: { type: "work_plan", sessionFile, plan: workPlan, changed: true },
    },
    isError: false,
  });
  const planFakeConfig = path.join(planRoot, "fake-rpc.json");
  await writeFile(planFakeConfig, JSON.stringify({
    state: { sessionId: "source", sessionFile: sourceSession },
    entries: [entry],
    tree: [{ entry, children: [] }],
    leafId: "user-1",
    commands_: {
      prompt: [
        {
          replacement: { state: { isStreaming: false } },
          writes: [{ path: `${sourceSession}.work-plan.json`, content: `${JSON.stringify(sourcePlan("in_progress"), null, 2)}\n` }],
          after: [toolEnd(sourceSession, sourcePlan("in_progress"), "plan-create"), { type: "agent_settled" }],
        },
        {
          replacement: { state: { isStreaming: false } },
          writes: [{ path: `${sourceSession}.work-plan.json`, content: `${JSON.stringify(sourcePlan("done"), null, 2)}\n` }],
          after: [toolEnd(sourceSession, sourcePlan("done"), "plan-update"), { type: "agent_settled" }],
        },
        {
          replacement: { state: { isStreaming: false } },
          writes: [{ path: `${forkSession}.work-plan.json`, content: `${JSON.stringify(sourcePlan("in_progress"), null, 2)}\n` }],
          after: [toolEnd(forkSession, sourcePlan("in_progress"), "fork-update"), { type: "agent_settled" }],
        },
      ],
      switch_session: [
        { data: { cancelled: false }, replacement: { state: { sessionId: "other", sessionFile: otherSession }, entries: [entry], tree: [{ entry, children: [] }], leafId: "user-1" } },
        { data: { cancelled: false }, replacement: { state: { sessionId: "source", sessionFile: sourceSession }, entries: [entry], tree: [{ entry, children: [] }], leafId: "user-1" } },
      ],
      fork: {
        data: { cancelled: false, text: "Ship the release" },
        replacement: { state: { sessionId: "fork", sessionFile: forkSession }, entries: [entry], tree: [{ entry, children: [] }], leafId: "user-1" },
      },
    },
  }));
  const plans = await startServer(
    planRoot,
    {
      agentRuntime: { mode: "rpc", executable: process.execPath, args: [path.join(REPO, "server/test/fixtures/fake-pi-rpc.mjs")], startupTimeoutMs: 20_000 },
      sandbox: undefined,
    },
    { env: { ...onlyOneFakeProvider(), FAKE_PI_RPC_CONFIG: planFakeConfig } },
  );

  // A fifth real app server, for the extension toast stack over that same Work
  // Plan. Its own server because its `notify` fires on every prompt: sharing the
  // plan server would drop a toast on top of the Work Plan spec's own clicks,
  // which is precisely what this one is here to catch.
  const notifyRoot = await makeWorkspace({ "readme.md": "# notifications\n" });
  const notifySessionDir = path.join(notifyRoot, ".pi-agent", "sessions");
  await mkdir(notifySessionDir, { recursive: true });
  const notifySession = path.join(notifySessionDir, "2026-08-23T00-03-00-000Z_notify.jsonl");
  await writeFile(notifySession, sessionText("notify", "Formatted work"));
  const notifyPlan = {
    version: 1,
    id: "notified",
    title: "Formatting plan",
    updatedAt: "2026-08-23T00:00:03.000Z",
    tasks: [{ id: "format", title: "Format the workspace", status: "in_progress", dependsOn: [], resources: [] }],
  };
  const notifyFakeConfig = path.join(notifyRoot, "fake-rpc.json");
  await writeFile(notifyFakeConfig, JSON.stringify({
    state: { sessionId: "notify", sessionFile: notifySession },
    entries: [entry],
    tree: [{ entry, children: [] }],
    leafId: "user-1",
    // One script for every prompt, not a list: the spec sends more than one and
    // neither of them should depend on which spec ran before it.
    commands_: {
      prompt: {
        replacement: { state: { isStreaming: false } },
        writes: [{ path: `${notifySession}.work-plan.json`, content: `${JSON.stringify(notifyPlan, null, 2)}\n` }],
        after: [
          toolEnd(notifySession, notifyPlan, "notify-plan"),
          // The real shape an extension's ui.notify() takes on the RPC wire.
          {
            type: "extension_ui_request",
            id: "notify-1",
            method: "notify",
            message: "pi-Lens deferred format applied to 1 file(s): readme.md",
            notifyType: "info",
          },
          { type: "agent_settled" },
        ],
      },
    },
  }));
  const notifications = await startServer(
    notifyRoot,
    {
      agentRuntime: { mode: "rpc", executable: process.execPath, args: [path.join(REPO, "server/test/fixtures/fake-pi-rpc.mjs")], startupTimeoutMs: 20_000 },
      sandbox: undefined,
    },
    { env: { ...onlyOneFakeProvider(), FAKE_PI_RPC_CONFIG: notifyFakeConfig } },
  );

  // A sixth server whose scripted RPC child, on every prompt, runs a tool that
  // reports a rising completion fraction — the offline stand-in for an extension
  // tool calling onUpdate(). The whole path from the runtime out is real.
  const progressRoot = await makeWorkspace({ "readme.md": "# progress\n" });
  const progressFakeConfig = path.join(progressRoot, "fake-rpc.json");
  await writeFile(
    progressFakeConfig,
    JSON.stringify({ state: { sessionId: "progress-1" }, progressDemo: { steps: 5, intervalMs: 500, toolName: "crawl" } }),
  );
  const progress = await startServer(
    progressRoot,
    {
      agentRuntime: { mode: "rpc", executable: process.execPath, args: [path.join(REPO, "server/test/fixtures/fake-pi-rpc.mjs")], startupTimeoutMs: 20_000 },
      sandbox: undefined,
    },
    { env: { ...onlyOneFakeProvider(), FAKE_PI_RPC_CONFIG: progressFakeConfig } },
  );

  // A seventh server whose model accepts a proper subset of the thinking levels —
  // no `high` — so the model-aware slider can be read back.
  const thinkingRoot = await makeWorkspace({ "readme.md": "# thinking\n" });
  const thinkingFakeConfig = path.join(thinkingRoot, "fake-rpc.json");
  await writeFile(
    thinkingFakeConfig,
    JSON.stringify({
      state: { sessionId: "thinking-1", model: { provider: "local", id: "qwen3.8", name: "Qwen3.8", reasoning: true } },
      commands_: { get_available_thinking_levels: { data: { levels: ["low", "medium", "xhigh"] } } },
    }),
  );
  const thinking = await startServer(
    thinkingRoot,
    {
      agentRuntime: { mode: "rpc", executable: process.execPath, args: [path.join(REPO, "server/test/fixtures/fake-pi-rpc.mjs")], startupTimeoutMs: 20_000 },
      sandbox: undefined,
    },
    { env: { ...onlyOneFakeProvider(), FAKE_PI_RPC_CONFIG: thinkingFakeConfig } },
  );

  // A dedicated multi-project server with two independently authoritative
  // review-ready sidecars. Distinct private markers catch plan mix-ups as well as
  // content leaking through the server-wide summary.
  const reviewReadyRoot = await realpath(await makeWorkspace({ "primary.md": "# primary review\n" }));
  const reviewReadySecond = await realpath(await makeWorkspace({ "secondary.md": "# secondary review\n" }));
  const reviewReadySession = path.join(reviewReadyRoot, "review-ready.jsonl");
  const reviewReadySecondSession = path.join(reviewReadySecond, "review-ready.jsonl");
  const reviewReadyPlan = {
    version: 1,
    id: "private-review-plan",
    title: "Private launch details",
    updatedAt: "2026-09-01T00:00:00.000Z",
    tasks: [{ id: "private-task", title: "Private customer result", status: "needs_review", dependsOn: [], resources: [] }],
  };
  const reviewReadySecondPlan = {
    version: 1,
    id: "private-secondary-review-plan",
    title: "Private secondary launch details",
    updatedAt: "2026-09-01T00:00:00.000Z",
    tasks: [{ id: "private-secondary-task", title: "Private secondary customer result", status: "needs_review", dependsOn: [], resources: [] }],
  };
  await writeFile(reviewReadySession, "");
  await writeFile(reviewReadySecondSession, "");
  await writeFile(`${reviewReadySession}.work-plan.json`, `${JSON.stringify(reviewReadyPlan, null, 2)}\n`);
  await writeFile(`${reviewReadySecondSession}.work-plan.json`, `${JSON.stringify(reviewReadySecondPlan, null, 2)}\n`);
  const reviewReadyFakeConfig = path.join(reviewReadyRoot, "fake-rpc.json");
  await writeFile(reviewReadyFakeConfig, JSON.stringify({
    stateByCwd: {
      [reviewReadyRoot]: { sessionId: "review-ready-primary", sessionFile: reviewReadySession, isStreaming: false },
      [reviewReadySecond]: { sessionId: "review-ready-secondary", sessionFile: reviewReadySecondSession, isStreaming: false },
    },
  }));
  const reviewReady = await startServer(
    reviewReadyRoot,
    {
      openProjects: [reviewReadySecond],
      agentRuntime: { mode: "rpc", executable: process.execPath, args: [path.join(REPO, "server/test/fixtures/fake-pi-rpc.mjs")], startupTimeoutMs: 20_000 },
      sandbox: undefined,
    },
    { env: { ...onlyOneFakeProvider(), FAKE_PI_RPC_CONFIG: reviewReadyFakeConfig } },
  );

  // The Outcome view reads three authoritative sources at once, and two of them
  // cannot be faked at the protocol level: a workspace holding SEVERAL git
  // repositories, and a Work Plan sidecar carrying evidence. So this server gets
  // real repositories with real working-tree changes, and a plan whose statuses
  // and evidence results cover every label the panel can draw.
  const outcomeRoot = await realpath(await makeWorkspace({ "readme.md": "# outcome workspace\n" }));
  const git = (cwd: string, ...args: string[]) =>
    execFileSync("git", args, { cwd, stdio: "ignore", windowsHide: true });
  const makeRepo = (dir: string) => {
    git(dir, "init");
    git(dir, "branch", "-M", "main");
    git(dir, "config", "user.email", "test@test");
    git(dir, "config", "user.name", "Test");
    git(dir, "config", "commit.gpgsign", "false");
    git(dir, "add", ".");
    git(dir, "commit", "-m", "initial");
  };
  const alpha = path.join(outcomeRoot, "alpha");
  const beta = path.join(outcomeRoot, "beta");
  await mkdir(alpha, { recursive: true });
  await mkdir(beta, { recursive: true });
  await writeFile(path.join(alpha, "committed.md"), "# alpha\n");
  await writeFile(path.join(beta, "committed.md"), "# beta\n");
  makeRepo(alpha);
  makeRepo(beta);
  // One repository is modified, the other gains an untracked file: the section has
  // to attribute each path to its own repository and keep both states.
  await writeFile(path.join(alpha, "committed.md"), "# alpha, edited\n");
  await writeFile(path.join(beta, "untracked.md"), "# beta addition\n");

  const outcomeSession = path.join(outcomeRoot, "outcome.jsonl");
  await writeFile(outcomeSession, "");
  const outcomePlan = {
    version: 1,
    id: "outcome-plan",
    title: "Release readiness",
    updatedAt: "2026-09-01T00:00:00.000Z",
    tasks: [
      {
        id: "ship", title: "Ship the release", status: "done", dependsOn: [], resources: [],
        evidence: [{ id: "suite", type: "test", result: "passed", summary: "Full suite green" }],
      },
      {
        id: "probe", title: "Probe the staging host", status: "in_progress", dependsOn: [], resources: [],
        evidence: [
          { id: "http", type: "external-check", result: "failed", summary: "Staging probe returned 503" },
          { id: "note", type: "observation", result: "informational", summary: "Provider status page mentions maintenance" },
        ],
      },
      {
        id: "sign", title: "Await signing key", status: "blocked", statusReason: "The signing key has not been issued", dependsOn: [], resources: [],
        evidence: [],
      },
      {
        id: "docs", title: "Review the release notes", status: "needs_review", dependsOn: [], resources: [],
        evidence: [{ id: "link", type: "reference", result: "informational", summary: "Draft notes", reference: { uri: "mailto:release@example.test", label: "Mail the release desk" } }],
      },
    ],
  };
  await writeFile(`${outcomeSession}.work-plan.json`, `${JSON.stringify(outcomePlan, null, 2)}\n`);
  const outcomeFakeConfig = path.join(outcomeRoot, "fake-rpc.json");
  await writeFile(outcomeFakeConfig, JSON.stringify({
    state: { sessionId: "outcome-1", sessionFile: outcomeSession, isStreaming: false },
  }));
  // A second project on the same server, with no plan of its own: switching to it
  // must replace the Outcome rather than leave the first workspace's tasks on
  // screen under another project's name.
  const outcomeSecond = await realpath(await makeWorkspace({ "other.md": "# other workspace\n" }));
  const outcomeSecondSession = path.join(outcomeSecond, "other.jsonl");
  await writeFile(outcomeSecondSession, "");
  await writeFile(outcomeFakeConfig, JSON.stringify({
    stateByCwd: {
      [outcomeRoot]: { sessionId: "outcome-1", sessionFile: outcomeSession, isStreaming: false },
      [outcomeSecond]: { sessionId: "outcome-2", sessionFile: outcomeSecondSession, isStreaming: false },
    },
  }));
  const outcome = await startServer(
    outcomeRoot,
    {
      openProjects: [outcomeSecond],
      agentRuntime: { mode: "rpc", executable: process.execPath, args: [path.join(REPO, "server/test/fixtures/fake-pi-rpc.mjs")], startupTimeoutMs: 20_000 },
      sandbox: undefined,
    },
    { env: { ...onlyOneFakeProvider(), FAKE_PI_RPC_CONFIG: outcomeFakeConfig } },
  );

  process.env.PI_E2E_HOST_URL = host.url;
  process.env.PI_E2E_SERVER_URL = server.base;
  process.env.PI_E2E_PRIMARY_PROJECT = await realpath(root);
  process.env.PI_E2E_SECOND_PROJECT = secondRoot;
  process.env.PI_E2E_EMBED_ROOT_URL = embedRootMode.base;
  process.env.PI_E2E_EMBED_ROOT_WORKSPACE = rootModeRoot;
  process.env.PI_E2E_SETTINGS_SANDBOX_URL = settingsSandbox.base;
  process.env.PI_E2E_SETTINGS_SANDBOX_ROOT = settingsSandboxRoot;
  process.env.PI_E2E_SETTINGS_SANDBOX_LOG = settingsSandboxLog;
  process.env.PI_E2E_SETTINGS_SANDBOX_SKILL_DIR = settingsSandboxSkillDir;
  process.env.PI_E2E_EMBED_PROJECTS_URL = embedProjectsMode.base;
  process.env.PI_E2E_EMBED_PROJECTS_SECOND = projectsSecondRoot;
  process.env.PI_E2E_EMBED_LOCKED_URL = embedLockedProjects.base;
  process.env.PI_E2E_GUARDED_URL = guarded.base;
  process.env.PI_E2E_DIAGRAMS_URL = diagrams.base;
  process.env.PI_E2E_PLANS_URL = plans.base;
  process.env.PI_E2E_NOTIFY_URL = notifications.base;
  process.env.PI_E2E_PROGRESS_URL = progress.base;
  process.env.PI_E2E_THINKING_URL = thinking.base;
  process.env.PI_E2E_OUTCOME_URL = outcome.base;
  process.env.PI_E2E_OUTCOME_WORKSPACE = outcomeRoot;
  process.env.PI_E2E_OUTCOME_SECOND = outcomeSecond;
  process.env.PI_E2E_REVIEW_READY_URL = reviewReady.base;
  process.env.PI_E2E_REVIEW_READY_PRIMARY = reviewReadyRoot;
  process.env.PI_E2E_REVIEW_READY_SECOND = reviewReadySecond;
  process.env.PI_E2E_PLAN_SOURCE = sourceSession;
  process.env.PI_E2E_PLAN_FORK = forkSession;
  process.env.PI_E2E_EXTENSIONS_DIR = extensionsDir;
  process.env.PI_E2E_EXTENSIONS_LOCKED_URL = extensionsLocked.base;
  process.env.PI_E2E_TERMINAL_URL = terminalServer.base;
  process.env.PI_E2E_TOKEN = E2E_TOKEN;

  return async () => {
    await terminalServer.stop();
    await outcome.stop();
    await reviewReady.stop();
    await thinking.stop();
    await progress.stop();
    await notifications.stop();
    await plans.stop();
    await diagrams.stop();
    await guarded.stop();
    await extensionsLocked.stop();
    await embedLockedProjects.stop();
    await embedProjectsMode.stop();
    await settingsSandbox.stop();
    await embedRootMode.stop();
    await server.stop();
    await rm(secondRoot, { recursive: true, force: true });
    await rm(projectsSecondRoot, { recursive: true, force: true });
    await rm(reviewReadySecond, { recursive: true, force: true });
    await rm(outcomeSecond, { recursive: true, force: true });
    await host.close();
  };
}

/** Not a secret: a literal the guarded test server checks against. */
const E2E_TOKEN = "e2e-smoke-token";
