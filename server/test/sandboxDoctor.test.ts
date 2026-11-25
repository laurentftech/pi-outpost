/**
 * The sandbox doctor (issue #573): `pi-outpost sandbox doctor` and the agent's `sandbox_doctor`
 * tool — a read-only, paste-safe snapshot of the sandbox's own state, and the decision log it
 * reads. The fake runner is node itself, as in `confinedBash.test.ts`, so the confinedBash-level
 * test of the decision log runs on every host.
 */
import assert from "node:assert/strict";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import { parseCli, CliError, helpText } from "../src/cli.ts";
import type { SandboxConfig } from "../src/config.ts";
import { confinedBashOperations } from "../src/confinedBash.ts";
import {
  assertPasteSafe,
  boundedAgentSummary,
  collectSandboxSnapshot,
  createSandboxDoctorToolDefinition,
  decisionLog,
  envFilterGroups,
  renderSnapshot,
  runDoctorProbes,
  setDoctorVersion,
  type SandboxSnapshot,
} from "../src/sandboxDoctor.ts";
import { rulesStoreFor } from "../src/sandboxRules.ts";

const tmp = async () => await realpath(await mkdtemp(path.join(tmpdir(), "pi-outpost-doctor-")));

function fixtureSnapshot(overrides: Partial<SandboxSnapshot> = {}): SandboxSnapshot {
  return {
    identity: {
      version: "0.0.0-test",
      platform: "win32",
      arch: "x64",
      runner: "mxc",
      runnerKind: "mxc",
      mxcEnumerateLevel: 1,
      sandboxRoot: "C:\\work\\app",
      generatedAt: "2026-11-24T00:00:00.000Z",
    },
    policy: {
      backend: "mxc-processcontainer-windows",
      readwritePaths: ["C:/work/app"],
      readonlyPaths: ["C:/Program Files/nodejs"],
      denied: [
        { path: "C:\\Users\\me\\.pi\\agent", reasonClass: "agent directory (the keys)" },
        { path: "D:/tools", reasonClass: "beside the way down" },
      ],
      enumeratePaths: ["C:/Program Files/nodejs"],
    },
    links: [{ link: "C:\\tools\\current", target: "D:\\WRK\\real", targetReadable: true }],
    network: { proxy: false, internetOpen: true, privateNetwork: false, hostLoopback: true },
    envFilter: [{ group: "UV_*", dropped: 1, names: ["UV_INDEX_PASSWORD"] }],
    relays: [
      { name: "registry-relay", running: false, detail: "not started (no credential-bearing configuration carried)" },
      { name: "signing-relay", running: false, detail: "not started (no signed commits asked for, or no signer on the host)" },
    ],
    seeds: ["npmrc"],
    probes: [{ name: "PATH node", status: "ok", layer: "filesystem", detail: "resolved to C:\\tools\\node.exe" }],
    decisions: [{ kind: "host", target: "example.com", command: "npm ping", key: "host:example.com", count: 2, lastSeen: "2026-11-24T00:00:00.000Z" }],
    ...overrides,
  };
}

// openlore: scenario=ASandboxDoctorSnapshot spec=sandbox-doctor
describe("ASandboxDoctorSnapshot", () => {
  test("the text report leads with the identity, the active backend and tier first", () => {
    const text = renderSnapshot(fixtureSnapshot());
    const lines = text.trim().split(/\r?\n/);
    assert.equal(lines[0], "pi-outpost 0.0.0-test · win32/x64 · generated 2026-11-24T00:00:00.000Z");
    assert.equal(lines[1], "backend: mxc (mxc) · MXC enumeration level 1 · root C:\\work\\app");
    assert.ok(lines.some((l) => l.startsWith("network: Internet open · private network closed · loopback open")), text);
  });

  test("policy by class, the link table, the env filter as names only, relays, seeds, probes, decisions", () => {
    const text = renderSnapshot(fixtureSnapshot());
    assert.ok(text.includes("policy (mxc-processcontainer-windows): 1 read-write, 1 read-only, 2 denied, 1 enumerable"), text);
    assert.ok(text.includes("  link C:\\tools\\current → D:\\WRK\\real (target readable)"), text);
    assert.ok(text.includes("  denied C:\\Users\\me\\.pi\\agent — agent directory (the keys)"), text);
    assert.ok(text.includes("  denied D:/tools — beside the way down"), text);
    assert.ok(text.includes("env filter: UV_* 1 dropped (UV_INDEX_PASSWORD)"), text);
    assert.ok(text.includes("relay: registry-relay not running — not started"), text);
    assert.ok(text.includes("relay: signing-relay not running — not started"), text);
    assert.ok(text.includes("seeds carried: npmrc"), text);
    assert.ok(text.includes("probe PATH node: ok (filesystem) — resolved to C:\\tools\\node.exe"), text);
    assert.ok(text.includes("decision log (last 1):"), text);
    assert.ok(text.includes("  2026-11-24T00:00:00.000Z host example.com ×2"), text);
  });

  test("--json renders the whole snapshot as one parseable JSON object", () => {
    const snapshot = fixtureSnapshot();
    assert.deepEqual(JSON.parse(renderSnapshot(snapshot, { json: true })), JSON.parse(JSON.stringify(snapshot)));
  });

  test("paste-safety: a secret environment value appears nowhere in the rendered report", () => {
    const snapshot = fixtureSnapshot({
      envFilter: [
        { group: "UV_*", dropped: 2, names: ["UV_DEFAULT_INDEX", "UV_INDEX_PASSWORD"] },
        { group: "AWS_*", dropped: 1, names: ["AWS_SECRET_ACCESS_KEY"] },
      ],
    });
    for (const rendered of [renderSnapshot(snapshot), renderSnapshot(snapshot, { json: true }), boundedAgentSummary(snapshot)]) {
      assert.deepEqual(assertPasteSafe(rendered, ["secret-value", "hunter2", "https://user:pw@index.example"]), [], rendered);
      assert.ok(rendered.includes("UV_INDEX_PASSWORD"), "the name is shown");
    }
  });
});

describe("collectSandboxSnapshot", () => {
  test("without a sandbox runner it says so instead of guessing", async () => {
    const cwd = await tmp();
    const snapshot = await collectSandboxSnapshot({ version: "0.0.0-test", cwd, sandbox: undefined, serverEnv: { PATH: "/usr/bin" }, platform: "linux", now: () => new Date("2026-11-24T00:00:00Z") });
    assert.equal(snapshot.identity.runnerKind, undefined);
    assert.equal(snapshot.policy.unavailableReason, "no sandbox runner is configured for this project");
    assert.deepEqual(snapshot.envFilter, []);
    assert.equal(snapshot.relays.every((relay) => !relay.running), true);
    assert.equal(snapshot.network.internetOpen, true);
    const text = renderSnapshot(snapshot);
    assert.ok(text.includes("policy: none — no sandbox runner is configured for this project"), text);
  });

  test("on a runner whose policy doctor cannot introspect, the backend names it and says so", async () => {
    const root = await tmp();
    const sandbox: SandboxConfig = { root, allowWrite: true, allowBash: true, bashRunner: "/usr/bin/sandbox-exec", readExceptions: [] };
    const snapshot = await collectSandboxSnapshot({ version: "0.0.0-test", cwd: root, sandbox, serverEnv: { PATH: "/usr/bin" }, platform: "linux" });
    assert.equal(snapshot.policy.backend, "seatbelt");
    assert.match(snapshot.policy.unavailableReason ?? "", /not introspectable/);
  });

  test("the MXC-on-Windows branch: identity carries the enumeration level, the policy is summarized by class, secrets stay out", async () => {
    const serverEnv = { PATH: "C:\\Program Files\\nodejs;C:\\Windows", USERPROFILE: "C:\\Users\\me", UV_INDEX_PASSWORD: "secret-value" };
    const snapshot = await collectSandboxSnapshot({
      version: "0.0.0-test",
      cwd: "C:\\Users\\me\\work\\app",
      sandbox: { root: "C:\\Users\\me\\work\\app", allowWrite: true, allowBash: true, bashRunner: "mxc", readExceptions: [] },
      agentDir: "C:\\Users\\me\\.pi\\agent",
      configFile: "C:\\Users\\me\\work\\app\\pi-outpost.config.json",
      serverEnv,
      platform: "win32",
      now: () => new Date("2026-11-24T00:00:00Z"),
    });
    assert.equal(snapshot.identity.runnerKind, "mxc");
    assert.ok(snapshot.identity.mxcEnumerateLevel !== undefined && snapshot.identity.mxcEnumerateLevel >= 0 && snapshot.identity.mxcEnumerateLevel <= 2);
    assert.equal(snapshot.policy.backend, "mxc-processcontainer-windows");
    const agentDenial = snapshot.policy.denied.find((d) => d.path.toLowerCase() === "c:\\users\\me\\.pi\\agent");
    assert.equal(agentDenial?.reasonClass, "agent directory (the keys)");
    const configDenial = snapshot.policy.denied.find((d) => d.path.toLowerCase() === "c:\\users\\me\\work\\app\\pi-outpost.config.json");
    assert.equal(configDenial?.reasonClass, "the configuration file");
    const uv = snapshot.envFilter.find((g) => g.group === "UV_*");
    assert.deepEqual(uv?.names, ["UV_INDEX_PASSWORD"]);
    for (const rendered of [renderSnapshot(snapshot), renderSnapshot(snapshot, { json: true })]) {
      assert.deepEqual(assertPasteSafe(rendered, ["secret-value"]), [], rendered);
    }
  });

  test("the env filter groups dropped variables by prefix, names only", () => {
    const groups = envFilterGroups(
      { PATH: "/usr/bin:/bin", HOME: "/home/u", LANG: "C.UTF-8", UV_INDEX_PASSWORD: "secret-value", UV_DEFAULT_INDEX: "https://index.example", AWS_SECRET_ACCESS_KEY: "hunter2" },
      "/work/app",
      "/bin/bash",
      "linux",
    );
    const uv = groups.find((g) => g.group === "UV_*");
    assert.deepEqual(uv, { group: "UV_*", dropped: 2, names: ["UV_DEFAULT_INDEX", "UV_INDEX_PASSWORD"] });
    const aws = groups.find((g) => g.group === "AWS_*");
    assert.deepEqual(aws, { group: "AWS_*", dropped: 1, names: ["AWS_SECRET_ACCESS_KEY"] });
    assert.equal(groups.some((g) => g.names.includes("PATH") || g.names.includes("HOME")), false, "passed-through variables are not dropped");
    assert.deepEqual(assertPasteSafe(JSON.stringify(groups), ["secret-value", "hunter2", "https://index.example"]), []);
  });
});

// openlore: scenario=SandboxDecisionsAreLogged spec=sandbox-doctor
describe("SandboxDecisionsAreLogged", () => {
  let base: string;
  let root: string;
  let agentDir: string;

  before(async () => {
    base = await tmp();
    root = path.join(base, "app");
    await mkdir(path.join(root, "out"), { recursive: true });
    agentDir = path.join(base, "agent");
  });
  after(async () => {
    if (base) await rm(base, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });

  test("the decision log reads the project's rules store: newest last, a repeat counted", async () => {
    const store = rulesStoreFor(agentDir, root);
    await store.record({ kind: "host", target: "example.com", command: "npm ping" });
    await store.record({ kind: "directory", target: path.join(base, "outside"), access: "write", command: "cp x y" });
    await store.record({ kind: "host", target: "example.com", command: "npm ping" });
    const log = await decisionLog(agentDir, root);
    assert.deepEqual(
      log.map((entry) => ({ kind: entry.kind, target: entry.target, count: entry.count })),
      [
        { kind: "directory", target: path.join(base, "outside"), count: 1 },
        { kind: "host", target: "example.com", count: 2 },
      ],
    );
  });

  test("the log caps at 200 and keeps the newest", async () => {
    const freshAgent = path.join(base, "agent-cap");
    const freshRoot = path.join(base, "app-cap");
    await mkdir(freshRoot, { recursive: true });
    const store = rulesStoreFor(freshAgent, freshRoot);
    for (let i = 0; i < 205; i++) await store.record({ kind: "host", target: `host-${i}.example`, command: "x" });
    const log = await decisionLog(freshAgent, freshRoot);
    assert.equal(log.length, 200);
    assert.equal(log[0]!.target, "host-5.example", "the oldest five went first");
    assert.equal(log.at(-1)!.target, "host-204.example");
  });

  test("a refused connection and a refused write, recorded where their notes are emitted, reach the doctor's log", async () => {
    // The fake runner is node itself, as in confinedBash.test.ts: the command is JavaScript.
    await writeFile(
      path.join(root, "run"),
      `const fs = require("node:fs");\nconst { spawn } = require("node:child_process");\nconst args = process.argv.slice(2);\nconst [shell, script] = args.slice(args.indexOf("--") + 1);\nconst child = spawn(shell, [script], { stdio: "inherit", env: process.env });\nchild.on("exit", (code) => process.exit(code ?? 1));\n`,
    );
    const store = rulesStoreFor(agentDir, root);
    const ops = confinedBashOperations({
      runner: process.execPath,
      shell: process.execPath,
      root,
      writableRoot: path.join(root, "out"),
      allowWrite: true,
      agentDir,
      configFile: path.join(base, "config.json"),
      check: async () => ({ ok: true as const }),
      platform: "linux",
      onRefusal: (refusal) => void store.record(refusal),
      networkProxy: { url: "http://127.0.0.1:3999", watchRefusals: () => () => {} },
      allowedHosts: [],
      askHost: async () => "refused",
      startProxy: async (proxyOptions) => {
        await proxyOptions.ask?.("example.org");
        return { url: "http://127.0.0.1:4123", watchRefusals: () => () => {}, close: async () => {} };
      },
    });
    const refused = JSON.stringify({ kind: "filesystem", code: "FILESYSTEM_DENIED", state: "info", operation: "write", path: "/srv/data/out.txt" });
    let output = "";
    await ops.exec(`process.stderr.write(${JSON.stringify(`${refused}\n`)}); console.log("ran")`, root, { onData: (data) => (output += data.toString()) });
    assert.match(output, /the sandbox refused writing to \/srv\/data\./);
    assert.match(output, /the user refused example\.org\./);
    const log = await decisionLog(agentDir, root);
    const kinds = log.map((entry) => `${entry.kind}:${"target" in entry ? entry.target : ""}`);
    assert.ok(kinds.includes("directory:/srv/data"), JSON.stringify(kinds));
    assert.ok(kinds.includes("host:example.org"), JSON.stringify(kinds));
    // And the doctor's snapshot carries them, never a credential or file content.
    const snapshot = await collectSandboxSnapshot({
      version: "0.0.0-test",
      cwd: root,
      sandbox: { root, allowWrite: true, allowBash: true, bashRunner: "/usr/bin/sandbox-exec", readExceptions: [] },
      agentDir,
      serverEnv: { PATH: "/usr/bin" },
      platform: "linux",
    });
    assert.ok(snapshot.decisions.some((d) => d.kind === "host" && d.target === "example.org"));
    assert.deepEqual(assertPasteSafe(renderSnapshot(snapshot, { json: true }), ["secret-value"]), []);
  });
});

// openlore: scenario=TheAgentCanRequestABoundedSandboxSnapshot spec=sandbox-doctor
describe("TheAgentCanRequestABoundedSandboxSnapshot", () => {
  test("the bounded summary is size-capped and keeps the headline sections", () => {
    const big = fixtureSnapshot({
      links: Array.from({ length: 30 }, (_, i) => ({ link: `C:\\tools\\l${i}`, target: `D:\\real${i}`, targetReadable: true })),
      policy: {
        ...fixtureSnapshot().policy,
        denied: Array.from({ length: 50 }, (_, i) => ({ path: `D:\\d${i}`, reasonClass: "beside the way down" })),
      },
      decisions: Array.from({ length: 50 }, (_, i) => ({ kind: "host" as const, target: `h${i}.example`, command: "x", key: `host:h${i}.example`, count: 1, lastSeen: "2026-11-24T00:00:00.000Z" })),
    });
    const text = boundedAgentSummary(big);
    assert.ok(text.length <= 4000, `capped: ${text.length}`);
    assert.ok(text.startsWith("sandbox snapshot (bounded; full: `pi-outpost sandbox doctor` on the host)"), text);
    assert.ok(text.includes("backend: mxc (mxc) · MXC enumeration level 1"), text);
    assert.ok(text.includes("network: Internet open"), text);
    assert.ok(text.includes("policy (mxc-processcontainer-windows):"), text);
    assert.ok(text.includes("decision log (last 10):"), "the decisions are cut to the last 10");
    assert.ok(text.includes("denied D:\\d9 — beside the way down"), "the denial head is cut to 10 like the full report's");
  });

  test("the sandbox_doctor tool returns exactly the bounded summary, with no probe run", async () => {
    setDoctorVersion("9.9.9-test");
    const root = await tmp();
    const agentDir = path.join(root, "agent");
    const sandbox: SandboxConfig = { root, allowWrite: true, allowBash: true, bashRunner: "/usr/bin/sandbox-exec", readExceptions: [] };
    const tool = createSandboxDoctorToolDefinition(sandbox, root, { agentDir, configFile: path.join(root, "pi-outpost.config.json") });
    assert.equal(tool.name, "sandbox_doctor");
    const execute = tool.execute as unknown as (toolCallId: string) => Promise<{ content: Array<{ type: string; text: string }>; details: unknown }>;
    const result = await execute("t1");
    assert.equal(result.content.length, 1);
    assert.equal(result.content[0]!.type, "text");
    const text = result.content[0]!.text;
    assert.ok(text.startsWith("sandbox snapshot (bounded"), text);
    assert.ok(text.includes("pi-outpost 9.9.9-test ·"), "the version set from the bundle");
    assert.ok(!text.includes("probe "), "the tool never runs the probe battery");
  });

  test("with no runner configured the tool says so instead of guessing", async () => {
    const root = await tmp();
    const sandbox: SandboxConfig = { root, allowWrite: false, allowBash: false, readExceptions: [] };
    const tool = createSandboxDoctorToolDefinition(sandbox, root, {});
    const execute = tool.execute as unknown as (toolCallId: string) => Promise<{ content: Array<{ type: string; text: string }> }>;
    const result = await execute("t2");
    assert.ok(result.content[0]!.text.includes("no sandbox runner is configured for this project"));
  });
});

describe("runDoctorProbes", () => {
  test("without a runner the battery is skipped, with the reason and its layer", async () => {
    const cwd = await tmp();
    const probes = await runDoctorProbes({ sandbox: undefined, cwd });
    assert.deepEqual(probes, [{ name: "probes", status: "skipped", layer: "policy", detail: "no sandbox runner is configured for this project" }]);
    const withoutRunner = await runDoctorProbes({ sandbox: { root: cwd, allowWrite: true, allowBash: true, readExceptions: [] }, cwd });
    assert.equal(withoutRunner[0]!.status, "skipped");
  });

  test("every probe result names its layer and a status", async () => {
    const root = await tmp();
    const probes = await runDoctorProbes({
      sandbox: { root, allowWrite: true, allowBash: true, bashRunner: path.join(root, "no-such-runner"), readExceptions: [] },
      cwd: root,
    });
    assert.ok(probes.length >= 6, `the tool probes and the scratch write ran: ${JSON.stringify(probes)}`);
    for (const probe of probes) {
      assert.ok(["ok", "warn", "fail", "skipped"].includes(probe.status), probe.name);
      assert.ok(typeof probe.layer === "string" && probe.layer.length > 0, probe.name);
    }
    assert.ok(probes.some((p) => p.name.startsWith("PATH ")), "the PATH probes ran");
    assert.ok(probes.some((p) => p.name === "scratch write in the root"), "the scratch write ran");
  });
});

describe("the sandbox command's CLI", () => {
  test('"sandbox doctor" parses, with --json allowed', () => {
    const parsed = parseCli(["sandbox", "doctor"]);
    assert.equal(parsed.command, "sandbox");
    assert.equal(parsed.subcommand, "doctor");
    assert.equal(parsed.print.json, false);
    assert.equal(parseCli(["sandbox", "doctor", "--json"]).print.json, true);
  });

  test('"sandbox" alone, or with another word, is an error naming the one subcommand', () => {
    assert.throws(() => parseCli(["sandbox"]), CliError);
    assert.throws(() => parseCli(["sandbox", "bogus"]), CliError);
    assert.throws(() => parseCli(["sandbox", "doctor", "extra"]), CliError);
  });

  test("the help names the command", () => {
    assert.match(helpText(), /pi-outpost sandbox doctor \[--json\]/);
  });
});
