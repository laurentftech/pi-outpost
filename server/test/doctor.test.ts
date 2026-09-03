import assert from "node:assert/strict";
import http from "node:http";
import net from "node:net";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, describe, test } from "node:test";
import {
  addressCheck,
  type Check,
  configurationCheck,
  type Diagnosis,
  diagnose,
  exitCodeFor,
  gitCheck,
  installationCheck,
  probeAddress,
  renderReport,
  settingsCheck,
  terminalCheck,
  webDistCandidatesFor,
  webUiCheck,
} from "../src/doctor.ts";
import { findConfigFile, implicitConfigCandidates, NoConfigError, userConfigDir } from "../src/config.ts";

const temps: string[] = [];
const tempDir = () => {
  const dir = mkdtempSync(path.join(tmpdir(), "doctor-"));
  temps.push(dir);
  return dir;
};
after(() => {
  for (const dir of temps) rmSync(dir, { recursive: true, force: true });
});

/** A diagnosis where everything is fine, so each test can break exactly one thing. */
function healthy(overrides: Partial<Diagnosis> = {}): Diagnosis {
  return {
    version: "1.2.3",
    nodeVersion: "v22.0.0",
    platform: "win32",
    arch: "x64",
    channel: "global",
    launchDir: "C:\\work\\new-folder",
    env: { USERPROFILE: "C:\\Users\\lf" },
    findConfig: () => "C:\\work\\new-folder\\pi-outpost.config.json",
    loadConfig: () => {
      throw new NoConfigError([]);
    },
    probeAddress: async () => ({ listening: false }),
    embeddedWebAssets: 42,
    webDistCandidates: ["C:\\app\\web\\dist"],
    hasIndexHtml: () => false,
    git: async () => ({ executable: "C:\\Program Files\\Git\\cmd\\git.exe" }),
    loadPty: async () => ({ ok: true }),
    ...overrides,
  };
}

const text = (check: Check) => [...check.detail, ...(check.remedy ?? [])].join("\n");

// ---------------------------------------------------------------------------
// configuration — the check the command exists for
// ---------------------------------------------------------------------------
describe("configurationCheck", () => {
  test("a directory with no configuration anywhere fails, and names both files init would write", () => {
    const candidates = implicitConfigCandidates("C:\\work\\new-folder", { USERPROFILE: "C:\\Users\\lf" });
    const check = configurationCheck(
      healthy({
        findConfig: () => {
          throw new NoConfigError(candidates);
        },
      }),
    );

    assert.equal(check.status, "fail", "no configuration file stops the server, so it is not a warning");
    const said = text(check);
    // The paths matter more than the prose: they are what the operator goes and looks at.
    for (const candidate of candidates) assert.ok(said.includes(candidate), `report names ${candidate}`);
    assert.match(said, /before it binds a port/, "says the server never reached the port");
    assert.match(said, /pi-outpost init\b/);
    assert.match(said, /pi-outpost init --global/);
    // The belief that sent the operator looking in the wrong place.
    assert.match(said, /Installing pi-outpost globally does not write either file/);
  });

  test("the chosen file is marked in the search order, so a shadowed candidate is visible", () => {
    const chosen = path.join("C:\\work\\new-folder", "pi-outpost.config.json");
    const check = configurationCheck(healthy({ findConfig: () => chosen }));
    assert.equal(check.status, "ok");
    const marked = check.detail.filter((line) => line.startsWith("→"));
    assert.equal(marked.length, 1, "exactly one candidate is marked as the winner");
    assert.ok(marked[0].includes(chosen));
    // The global candidate is still listed, unmarked: that it was not read is the point.
    assert.ok(text(check).includes(path.join(userConfigDir({ USERPROFILE: "C:\\Users\\lf" }), "config.json")));
  });

  test("an explicitly named file says the search never ran, rather than listing it", () => {
    const check = configurationCheck(healthy({ findConfig: () => "D:\\elsewhere\\custom.json" }));
    assert.equal(check.status, "ok");
    assert.match(text(check), /named explicitly, so the usual search was not performed/);
    assert.equal(
      check.detail.some((line) => line.startsWith("→")),
      false,
      "a search that did not happen has no winner to mark",
    );
  });

  test("a named file that is missing fails with the resolver's own message", () => {
    const check = configurationCheck(
      healthy({
        findConfig: () => {
          throw new Error("[config] config file not found: D:\\typo.json");
        },
      }),
    );
    assert.equal(check.status, "fail");
    assert.match(text(check), /D:\\typo\.json/, "the path the operator typed is in the report");
    assert.match(text(check), /named explicitly/);
  });

  test("the candidates reported are the ones findConfigFile actually searches", () => {
    // A diagnostic that describes a search the product does not perform is worse than
    // no diagnostic. Proven by making the first candidate real and asserting the
    // resolver picks that exact path.
    const dir = tempDir();
    const env = { XDG_CONFIG_HOME: path.join(dir, "xdg") };
    const [local, global] = implicitConfigCandidates(dir, env);

    assert.equal(local, path.join(dir, "pi-outpost.config.json"));
    assert.equal(global, path.join(dir, "xdg", "pi-outpost", "config.json"));

    writeFileSync(local, "{}");
    assert.equal(findConfigFile(dir, {}, env), local, "the first candidate is what a start reads");

    rmSync(local);
    mkdirSync(path.dirname(global), { recursive: true });
    writeFileSync(global, "{}");
    assert.equal(findConfigFile(dir, {}, env), global, "the second candidate is the fallback a start uses");
  });
});

// ---------------------------------------------------------------------------
// settings
// ---------------------------------------------------------------------------
describe("settingsCheck", () => {
  const config = (over: Record<string, unknown> = {}) =>
    ({
      configFile: "/etc/pi.json",
      host: "127.0.0.1",
      port: 3141,
      cwd: "/work",
      agentRuntime: { mode: "embedded", args: [] },
      terminal: { enabled: false },
      ...over,
    }) as never;

  test("reports the address as a URL the operator can open", () => {
    const check = settingsCheck({ config: config() });
    assert.ok(check);
    assert.equal(check.status, "ok");
    assert.match(text(check), /listens on 127\.0\.0\.1:3141 — open http:\/\/127\.0\.0\.1:3141\//);
    assert.match(text(check), /auth token: none \(loopback only\)/);
    assert.match(text(check), /terminal: disabled/);
  });

  test("a token is reported as set and never echoed", () => {
    const check = settingsCheck({ config: config({ token: "s3cret-value" }) });
    assert.ok(check);
    assert.match(text(check), /auth token: set/);
    assert.equal(text(check).includes("s3cret-value"), false, "the token itself never reaches the report");
  });

  test("an rpc runtime names the executable it would spawn", () => {
    const check = settingsCheck({ config: config({ agentRuntime: { mode: "rpc", executable: "pi", args: [] } }) });
    assert.ok(check);
    assert.match(text(check), /agent runtime: rpc \(pi\)/);
  });

  test("a configuration that exists but cannot be used fails, carrying the reason", () => {
    const check = settingsCheck({ error: new Error('[config] "port" must be a port number') });
    assert.ok(check);
    assert.equal(check.status, "fail");
    assert.match(text(check), /"port" must be a port number/);
  });

  test("no configuration at all produces no settings line, because the check above said it", () => {
    assert.equal(settingsCheck({ error: new NoConfigError([]) }), undefined);
  });
});

// ---------------------------------------------------------------------------
// address
// ---------------------------------------------------------------------------
describe("addressCheck", () => {
  test("a free port is reported as bindable", async () => {
    const check = await addressCheck(healthy(), "127.0.0.1", 3141);
    assert.equal(check.status, "ok");
    assert.match(text(check), /is free/);
  });

  test("another pi-outpost holding the port is a warning that points at it", async () => {
    const d = healthy({ probeAddress: async () => ({ listening: true, answersHealth: true }) });
    const check = await addressCheck(d, "127.0.0.1", 3141);
    // Not a failure: the operator very likely wants the server that is already there.
    assert.equal(check.status, "warn");
    assert.match(text(check), /already serving a pi-outpost — http:\/\/127\.0\.0\.1:3141\//);
    assert.match(text(check), /--port <n>/);
  });

  test("a foreign service holding the port fails, because starting here cannot work", async () => {
    const d = healthy({ probeAddress: async () => ({ listening: true, answersHealth: false }) });
    const check = await addressCheck(d, "127.0.0.1", 3141);
    assert.equal(check.status, "fail");
    assert.match(text(check), /not a pi-outpost/);
    assert.match(text(check), /EADDRINUSE/);
  });

  test("an IPv6 address keeps its brackets in the URL", async () => {
    const d = healthy({ probeAddress: async () => ({ listening: true, answersHealth: true }) });
    const check = await addressCheck(d, "::1", 3141);
    assert.match(text(check), /http:\/\/\[::1\]:3141\//, "an unbracketed ::1:3141 names no port at all");
  });
});

// ---------------------------------------------------------------------------
// the real probe, against real sockets
// ---------------------------------------------------------------------------
describe("probeAddress", () => {
  /** A port nothing is on: opened, its number read, then closed. */
  async function freePort(): Promise<number> {
    const server = net.createServer();
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const port = (server.address() as net.AddressInfo).port;
    await new Promise<void>((resolve) => server.close(() => resolve()));
    return port;
  }

  test("a closed port is not listening", async () => {
    const probe = await probeAddress("127.0.0.1", await freePort());
    assert.deepEqual(probe, { listening: false }, "a refused connection is the free-port answer");
  });

  test("a server answering /health like this one is recognised", async () => {
    const server = http.createServer((_req, res) => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const port = (server.address() as net.AddressInfo).port;
    try {
      assert.deepEqual(await probeAddress("127.0.0.1", port), { listening: true, answersHealth: true });
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  test("the startup stub's 503 still identifies this server, because it is still holding the port", async () => {
    const server = http.createServer((_req, res) => {
      res.writeHead(503, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: false }));
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const port = (server.address() as net.AddressInfo).port;
    try {
      assert.deepEqual(await probeAddress("127.0.0.1", port), { listening: true, answersHealth: true });
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  test("a foreign HTTP service is listening but is not this one", async () => {
    const server = http.createServer((_req, res) => {
      res.writeHead(404, { "content-type": "text/html" });
      res.end("<h1>nginx</h1>");
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const port = (server.address() as net.AddressInfo).port;
    try {
      assert.deepEqual(await probeAddress("127.0.0.1", port), { listening: true, answersHealth: false });
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  test("a socket that accepts and never answers counts as taken, not as free", async () => {
    // The case that would otherwise hang the command: a listener that reads the
    // request and says nothing. It must resolve on its own timeout as occupied —
    // reporting "free" here would send the operator to a bind that fails.
    const accepted: net.Socket[] = [];
    const server = net.createServer((socket) => accepted.push(socket));
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const port = (server.address() as net.AddressInfo).port;
    try {
      const probe = await probeAddress("127.0.0.1", port);
      assert.deepEqual(probe, { listening: true, answersHealth: false });
    } finally {
      // `close` waits for open connections, and this server's whole point is a
      // connection that never ends — so the sockets go first, or the test hangs.
      for (const socket of accepted) socket.destroy();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});

// ---------------------------------------------------------------------------
// web UI, git, terminal
// ---------------------------------------------------------------------------
describe("webUiCheck", () => {
  test("an embedded bundle is reported with its size", () => {
    const check = webUiCheck(healthy({ embeddedWebAssets: 42 }));
    assert.equal(check.status, "ok");
    assert.match(text(check), /42 assets embedded/);
  });

  test("a disk build is reported by the directory that answered", () => {
    const check = webUiCheck(
      healthy({
        embeddedWebAssets: 0,
        webDistCandidates: ["/a/web/dist", "/b/web/dist"],
        hasIndexHtml: (candidate) => candidate === "/b/web/dist",
      }),
    );
    assert.equal(check.status, "ok");
    assert.match(text(check), /served from \/b\/web\/dist/);
  });

  test("no interface anywhere fails, and says the server would answer 404 rather than refuse", () => {
    // The quiet one: the server starts, listens, and serves nothing. From the browser
    // that is indistinguishable from a server that never started.
    const check = webUiCheck(healthy({ embeddedWebAssets: 0, webDistCandidates: ["/a/web/dist"] }));
    assert.equal(check.status, "fail");
    assert.match(text(check), /404/);
    assert.ok(text(check).includes("/a/web/dist"), "the places it looked are named");
  });

  test("a checkout is told to build, an installation is told to reinstall", () => {
    const missing = { embeddedWebAssets: 0, webDistCandidates: ["/a"] };
    assert.match(text(webUiCheck(healthy({ ...missing, channel: "checkout" }))), /npm run build --workspace web/);
    assert.match(text(webUiCheck(healthy({ ...missing, channel: "global" }))), /reinstall it/);
  });

  test("PI_OUTPOST_WEB_DIST replaces the candidate list rather than extending it", () => {
    assert.deepEqual(webDistCandidatesFor("/app/dist", { PI_OUTPOST_WEB_DIST: "/custom/ui" }), [
      path.resolve("/custom/ui"),
    ]);
    assert.equal(webDistCandidatesFor("/app/dist", {}).length, 3);
  });
});

describe("gitCheck", () => {
  test("a resolved git is reported by path", async () => {
    const check = await gitCheck(healthy());
    assert.equal(check.status, "ok");
    assert.match(text(check), /git\.exe/);
  });

  test("no git is a warning, not a failure, because the server still starts", async () => {
    const check = await gitCheck(healthy({ git: async () => ({ error: "git is not installed" }) }));
    assert.equal(check.status, "warn");
    assert.match(text(check), /gitPath/);
  });
});

describe("terminalCheck", () => {
  test("a disabled terminal produces no line at all", async () => {
    assert.equal(await terminalCheck(healthy(), false), undefined);
  });

  test("an enabled terminal with a loadable binding is reported ok", async () => {
    const check = await terminalCheck(healthy(), true);
    assert.ok(check);
    assert.equal(check.status, "ok");
  });

  test("an enabled terminal whose binding will not load warns with the loader's reason", async () => {
    const check = await terminalCheck(
      healthy({ loadPty: async () => ({ ok: false, error: "Cannot find module 'node-pty'" }) }),
      true,
    );
    assert.ok(check);
    assert.equal(check.status, "warn", "the rest of the product works, so this cannot be a failure");
    assert.match(text(check), /Cannot find module 'node-pty'/);
    assert.match(text(check), /terminal_error/, "says what the user will actually see");
  });
});

// ---------------------------------------------------------------------------
// the report as a whole
// ---------------------------------------------------------------------------
describe("diagnose", () => {
  test("every check still runs after the configuration failed", async () => {
    // One run, all the problems. The alternative — stopping at the first — is three
    // runs for three faults, which is exactly the experience this command replaces.
    const checks = await diagnose(
      healthy({
        findConfig: () => {
          throw new NoConfigError(["/a/pi-outpost.config.json"]);
        },
        embeddedWebAssets: 0,
        webDistCandidates: ["/a/web/dist"],
        git: async () => ({ error: "git is not installed" }),
      }),
    );
    const names = checks.map((check) => check.name);
    assert.deepEqual(names, ["installation", "configuration", "web UI", "git"]);
    assert.equal(checks.filter((check) => check.status === "fail").length, 2);
  });

  test("with a usable configuration the address and terminal are asked about too", async () => {
    const config = {
      configFile: "/etc/pi.json",
      host: "127.0.0.1",
      port: 3141,
      cwd: "/work",
      agentRuntime: { mode: "embedded", args: [] },
      terminal: { enabled: true },
    } as never;
    const checks = await diagnose(healthy({ loadConfig: () => config }));
    assert.deepEqual(checks.map((check) => check.name), [
      "installation",
      "configuration",
      "settings",
      "address",
      "web UI",
      "git",
      "terminal",
    ]);
  });

  test("the configuration is read once, however many checks want it", async () => {
    let loads = 0;
    const config = {
      configFile: "/etc/pi.json",
      host: "127.0.0.1",
      port: 3141,
      cwd: "/work",
      agentRuntime: { mode: "embedded", args: [] },
      terminal: { enabled: true },
    } as never;
    await diagnose(
      healthy({
        loadConfig: () => {
          loads += 1;
          return config;
        },
      }),
    );
    // loadConfig announces what it loaded; three loads would print that banner three
    // times, above a report that says the same thing better.
    assert.equal(loads, 1);
  });
});

describe("exitCodeFor", () => {
  const check = (status: Check["status"]): Check => ({ name: "x", status, detail: [] });

  test("a failure is a non-zero exit, so a script can trust the command", () => {
    assert.equal(exitCodeFor([check("ok"), check("fail")]), 1);
  });

  test("warnings alone exit zero, because nothing is stopping the server", () => {
    assert.equal(exitCodeFor([check("ok"), check("warn")]), 0);
  });
});

describe("renderReport", () => {
  test("no line carries trailing whitespace", () => {
    const report = renderReport([
      { name: "configuration", status: "fail", detail: ["gone"], remedy: ["do this", "", "and this"] },
    ]);
    for (const line of report.split("\n")) {
      assert.equal(line, line.trimEnd(), `line has trailing whitespace: ${JSON.stringify(line)}`);
    }
  });

  test("the closing sentence distinguishes the three outcomes", () => {
    const one = (status: Check["status"]): Check => ({ name: "x", status, detail: ["d"] });
    assert.match(renderReport([one("ok")]), /Nothing to report/);
    assert.match(renderReport([one("warn")]), /Nothing would stop the server/);
    assert.match(renderReport([one("fail")]), /1 problem would stop this server/);
    assert.match(renderReport([one("fail"), one("fail")]), /2 problems would stop this server/);
  });

  test("continuation lines are indented under the status column, not against the margin", () => {
    const report = renderReport([{ name: "configuration", status: "fail", detail: ["first", "second"] }]);
    const [, second] = report.split("\n");
    assert.match(second, /^ {22}second$/, "a wrapped path must not read as a new finding");
  });
});

describe("installationCheck", () => {
  test("names the install shape, because every remedy differs by it", () => {
    for (const [channel, expected] of [
      ["global", /installed globally/],
      ["checkout", /source checkout/],
      ["ephemeral", /one-off run \(npx\)/],
      ["executable", /standalone executable/],
      ["unknown", /could not classify/],
    ] as const) {
      const check = installationCheck(healthy({ channel }));
      assert.equal(check.status, "ok", "how it was installed never stops it from running");
      assert.match(text(check), expected);
    }
  });

  test("carries the versions a bug report needs", () => {
    assert.match(text(installationCheck(healthy())), /pi-outpost 1\.2\.3 —.*\n.*node v22\.0\.0 on win32\/x64/);
  });
});
