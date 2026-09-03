/**
 * A live embed, for pressing the buttons by hand.
 *
 * The browser suite boots this same shape and tears it down in the same second;
 * what a person needs is the shape left running. So: the built host page on its
 * own origin, and two servers behind it — a plain one (sandbox configured, so
 * Settings has something to show) and one whose session already holds the
 * seeded transcript (diagrams and the table).
 *
 *   npm run bench
 *
 * Serves `dist/`, so build first: web, then @pi-outpost/embed, then
 * `npm run build:e2e-host` — an unbuilt fix is invisible here.
 */
import { createServer } from "node:http";
import { readFile, realpath, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { SEEDED_MESSAGES } from "../e2e/fixtures/seeded-transcript";
import { createStructuredExchangeFigureToolDefinition } from "../server/src/structuredExchangeFigureTool.ts";
// @ts-expect-error -- .mjs harness, no types
import { makeWorkspace, startServer } from "../server/test/harness.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.join(HERE, "..");
const HOST_DIST = path.join(REPO, "e2e/dist-host");
const HOST_PORT = Number(process.env.BENCH_PORT ?? 4321);

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".map": "application/json",
};

function serveHostPage(port: number): Promise<{ url: string; close: () => Promise<void> }> {
  const server = createServer((request, response) => {
    const requested = new URL(request.url ?? "/", "http://localhost").pathname;
    const relative = requested === "/" ? "index.html" : requested.replace(/^\/+/, "");
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
    server.listen(port, "127.0.0.1", () => {
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
 * Whether this bench may talk to a real model.
 *
 * Off by default and deliberately opt-in: a bench that spends tokens every time
 * someone opens it is a bench nobody leaves running. `BENCH_LIVE=1 npm run bench`
 * turns it on, and then the agent in the widget is the real one — which is the only
 * way to see whether it reaches for a tool, as opposed to whether the tool works.
 */
const LIVE = process.env.BENCH_LIVE === "1";

/** No real provider key: nothing here talks to a model, and PI_OFFLINE keeps it that way. */
function onlyOneFakeProvider(): Record<string, string | undefined> {
  if (LIVE) return {};
  const env: Record<string, string | undefined> = {};
  for (const name of Object.keys(process.env)) {
    if (/API_KEY|AUTH_TOKEN|_TOKEN$/.test(name)) env[name] = undefined;
  }
  env.ANTHROPIC_API_KEY = "sk-ant-not-a-real-key";
  return env;
}

const host = await serveHostPage(HOST_PORT);

/**
 * Four JSON files that differ only in what they declare.
 *
 * The viewer decides by content, so a bench that carries one document proves
 * nothing: what has to be visible side by side is the document that draws, the
 * JSON that does not, the version we do not implement, and the one that claims
 * the contract and fails it.
 */
const DOCUMENT_FILES = {
  "diagrams/architecture.json": JSON.stringify(
    {
      schema: "urn:structured-exchange:1",
      kind: "graph",
      data: {
        nodes: [
          { id: "batt", label: "Batterie", kind: "power" },
          { id: "ecu", label: "Calculateur", kind: "compute" },
          { id: "dash", label: "Tableau de bord", kind: "compute" },
        ],
        edges: [
          { from: "batt", to: "ecu", label: "400V", kind: "power" },
          { from: "ecu", to: "dash", label: "état", kind: "signal" },
        ],
      },
    },
    null,
    2,
  ),
  "diagrams/not-a-document.json": JSON.stringify({ kind: "graph", data: { nodes: [], edges: [] } }, null, 2),
  "diagrams/future.json": JSON.stringify({ schema: "urn:structured-exchange:2", kind: "constellation" }, null, 2),
  "diagrams/broken.json": JSON.stringify(
    { schema: "urn:structured-exchange:1", kind: "graph", data: { nodes: [{ label: "no id" }], edges: [] } },
    null,
    2,
  ),
};

const root = await makeWorkspace({
  "readme.md": "# workspace\n\nA file the browser is allowed to see.\n",
  "docs/notes.md": "# notes\n\nAnother file, so the tree has a folder in it.\n",
  ".pi/prompts/greet.md": "---\ndescription: say hello\n---\n\nSay hello.\n",
  ...DOCUMENT_FILES,
});

/**
 * Two figures and a report that references them, written by the agent's own tool.
 *
 * Not fixtures. The point of having them here is that the whole path runs in a real
 * process against a real workspace before anyone looks at it: the tool reads the
 * document off disk, validates it, narrows it, and writes an `.svg` the Markdown
 * view then has to fetch and decode. A hand-written SVG dropped in this directory
 * would prove none of that.
 */
async function seedFigures(): Promise<void> {
  const tool = createStructuredExchangeFigureToolDefinition({
    cwd: root,
    allowedRoots: [await realpath(root)],
    maxBytes: 4_000_000,
    writableRoot: await realpath(root),
  });
  const write = (params: Record<string, unknown>) =>
    (tool.execute as (id: string, params: unknown) => Promise<{ content: { text: string }[]; isError?: boolean }>)(
      "bench",
      params,
    );

  const whole = await write({ path: "diagrams/architecture.json", output_path: "figures/whole.svg" });
  const narrowed = await write({
    path: "diagrams/architecture.json",
    output_path: "figures/power-only.svg",
    hide_relationship_kinds: ["signal"],
  });
  for (const result of [whole, narrowed]) {
    if (result.isError) throw new Error(`the bench could not write its figures: ${result.content[0]?.text}`);
  }

  await writeFile(
    path.join(root, "report.md"),
    [
      "# Vehicle architecture",
      "",
      "The whole document, as the reader would see it in a conversation:",
      "",
      "![The whole architecture](figures/whole.svg)",
      "",
      "And the power path on its own, with the signal relationships hidden. The figure",
      "says so itself, at the bottom of the picture:",
      "",
      "![Power only](figures/power-only.svg)",
      "",
      "Both were written by `write_structure_figure` from `diagrams/architecture.json`.",
      "",
    ].join("\n"),
  );
}

await seedFigures();
const plain = await startServer(
  root,
  {
    // Fixed ports, unlike the browser suite's: a bench whose URL changes every
    // run is a bench nobody keeps open in a tab.
    server: { allowedOrigins: [host.url], port: HOST_PORT + 1 },
    branding: { title: "bench" },
    noPromptTemplates: false,
    // The harness turns skills off so a test measures the tool alone. Here the
    // opposite is wanted: the bundled skill is what tells the agent this tool exists
    // and what its two hide lists mean, so leaving it out would make a live bench
    // measure the tool description and call it agent behaviour.
    noSkills: false,
  },
  { env: onlyOneFakeProvider() },
);

const diagramRoot = await makeWorkspace({ "readme.md": "# diagrams\n" });
const fakeConfig = path.join(diagramRoot, "fake-rpc.json");
await writeFile(fakeConfig, JSON.stringify({ messages: SEEDED_MESSAGES, state: { sessionId: "diagrams-1" } }));
const diagrams = await startServer(
  diagramRoot,
  {
    server: { allowedOrigins: [host.url], port: HOST_PORT + 2 },
    branding: { title: "bench diagrams", defaultTheme: "light" },
    agentRuntime: {
      mode: "rpc",
      executable: process.execPath,
      args: [path.join(REPO, "server/test/fixtures/fake-pi-rpc.mjs")],
      startupTimeoutMs: 20_000,
    },
    // RPC refuses a sandbox it cannot enforce on a child that builds its own tools.
    sandbox: undefined,
  },
  { env: { ...onlyOneFakeProvider(), FAKE_PI_RPC_CONFIG: fakeConfig } },
);

// A server whose scripted RPC child runs a tool that reports a rising completion
// fraction on every prompt — so the tool-card progress bar can be watched by hand.
const progressRoot = await makeWorkspace({ "readme.md": "# progress\n" });
const progressConfig = path.join(progressRoot, "fake-rpc.json");
await writeFile(
  progressConfig,
  JSON.stringify({ state: { sessionId: "progress-1" }, progressDemo: { steps: 8, intervalMs: 600, toolName: "crawl" } }),
);
const progress = await startServer(
  progressRoot,
  {
    server: { allowedOrigins: [host.url], port: HOST_PORT + 5 },
    branding: { title: "bench progress" },
    agentRuntime: {
      mode: "rpc",
      executable: process.execPath,
      args: [path.join(REPO, "server/test/fixtures/fake-pi-rpc.mjs")],
      startupTimeoutMs: 20_000,
    },
    sandbox: undefined,
  },
  { env: { ...onlyOneFakeProvider(), FAKE_PI_RPC_CONFIG: progressConfig } },
);

// A server whose model accepts only a subset of the thinking levels — no `high` —
// so the model-aware thinking slider can be watched by hand. Its second model is the
// office case: a deployment declaring that it accepts no thinking at all, reached from
// a session sitting on a level that model has never heard of.
const thinkingRoot = await makeWorkspace({ "readme.md": "# thinking\n" });
const thinkingConfig = path.join(thinkingRoot, "fake-rpc.json");
await writeFile(
  thinkingConfig,
  JSON.stringify({
    state: {
      sessionId: "thinking-1",
      thinkingLevel: "high",
      model: { provider: "local", id: "qwen3.8-27b", name: "Qwen3.8 27B", reasoning: true },
    },
    commands_: {
      get_available_models: {
        data: {
          models: [
            { provider: "local", id: "qwen3.8-27b", name: "Qwen3.8 27B", reasoning: true },
            { provider: "local", id: "plain-mini", name: "Plain Mini", reasoning: true },
          ],
        },
      },
    },
    // What the child answers for each model, and what it silently clamps to on a
    // model change — the real one does both.
    thinkingLevelsByModel: {
      // `off` included, as a real reasoning model's set is: thinking can be turned off
      // whatever the effort tiers are. Without it the child would step a returning `off`
      // *up* to `low`, which is a fake's artefact and not what a deployment sees.
      "local/qwen3.8-27b": ["off", "low", "medium", "high", "xhigh"],
      "local/plain-mini": ["off", "low", "medium", "high", "xhigh"],
    },
  }),
);
const thinking = await startServer(
  thinkingRoot,
  {
    server: { allowedOrigins: [host.url], port: HOST_PORT + 6 },
    branding: { title: "bench thinking" },
    // The declaration the child knows nothing about: nobody but the server can clamp
    // a session's level onto this model.
    thinkingLevels: [{ provider: "local", id: "plain-mini", levels: ["off"] }],
    agentRuntime: {
      mode: "rpc",
      executable: process.execPath,
      args: [path.join(REPO, "server/test/fixtures/fake-pi-rpc.mjs")],
      startupTimeoutMs: 20_000,
    },
    sandbox: undefined,
  },
  { env: { ...onlyOneFakeProvider(), FAKE_PI_RPC_CONFIG: thinkingConfig } },
);

// The three embed workspace-control policies, each on its own server, because the
// policy is loaded configuration rather than a mount option: the only way to see
// what a deployment would show is to run a server configured that way.
const rootModeRoot = await realpath(
  await makeWorkspace({ "readme.md": "# root mode\n", "inner/notes.md": "# inner\n", "other/notes.md": "# other\n" }),
);
const rootMode = await startServer(
  rootModeRoot,
  {
    server: { allowedOrigins: [host.url], port: HOST_PORT + 3 },
    branding: { title: "bench root mode" },
    embed: { workspaceControls: "root" },
    // Writes confined to the root itself rather than a directory beside it: the
    // harness default pins a writable root that any narrowing would strand, which
    // is a refusal worth testing and a poor thing to leave a bench stuck on.
    sandbox: { root: rootModeRoot, allowWrite: true, allowBash: false },
  },
  { env: onlyOneFakeProvider() },
);

const projectsSecond = await realpath(await makeWorkspace({ "readme.md": "# second project\n" }));
const projectsMode = await startServer(
  await makeWorkspace({ "readme.md": "# projects mode\n" }),
  {
    server: { allowedOrigins: [host.url], port: HOST_PORT + 4 },
    branding: { title: "bench projects mode" },
    embed: { workspaceControls: "projects" },
    openProjects: [projectsSecond],
  },
  { env: onlyOneFakeProvider() },
);

const link = (server: string) => `${host.url}/?server=${encodeURIComponent(server)}&theme=light`;
console.log("\n  embed bench — the widget inside a host page that fights it\n");
console.log(`  settings, files, sessions   ${link(plain.base)}`);
console.log(`  workspace                   ${root}`);
console.log(
  LIVE
    ? "  live: the agent is real — ask it for a figure and watch the file land"
    : "  offline: no model (BENCH_LIVE=1 npm run bench to talk to a real one)",
);
console.log(`  seeded transcript           ${link(diagrams.base)}   (diagrams + table)`);
console.log(`  tool progress bar           ${link(progress.base)}   (send any prompt, watch the tool card)`);
console.log(`  model-aware thinking slider ${link(thinking.base)}   (🧠: low..xhigh, no off; switch to Plain Mini — declared off-only — and watch it settle)`);
console.log("\n  embed workspace controls — the same widget under each policy\n");
console.log(`  settings (the default)      ${link(plain.base)}   no header control; the root lives in Settings`);
console.log(`  root                        ${link(rootMode.base)}   one root, moved from the header`);
console.log(`  projects                    ${link(projectsMode.base)}   open, switch and close, with a second project already open`);
console.log("\n  ctrl-c to stop\n");

let stopping = false;
const stop = async () => {
  if (stopping) return;
  stopping = true;
  await projectsMode.stop();
  await rootMode.stop();
  await thinking.stop();
  await progress.stop();
  await diagrams.stop();
  await plain.stop();
  await host.close();
  process.exit(0);
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
