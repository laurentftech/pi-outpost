/**
 * What the agent reads of landstrip's own reports, and the startup line's account of the network.
 * The real runner's lines are `confinedNetworkLandstrip.test.ts`'s.
 */
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { landstripNote, landstripStderr } from "../src/confinedBash.ts";
import { networkSummary, toolchainsFor } from "../src/sandbox.ts";
import { bunInstallNote } from "../src/confinedBash.ts";

// As landstrip 0.20.26 prints them (abridged to the fields read).
const BIND = '{"kind":"network","code":"NETWORK_DENIED","state":"info","query_id":"0","operation":"bind","target":"[::1]:0","syscall":"bind","errno":"EACCES","mechanism":"seccomp"}';
const WRITE = '{"kind":"filesystem","code":"FILESYSTEM_DENIED","state":"info","operation":"write","path":"/tmp/x/out.txt","suggested_grant":{"allowWrite":"/tmp/x/out.txt"},"mechanism":"seccomp"}';

describe("landstripNote", () => {
  // openlore: scenario=ALandstripRefusalIsToldInWords spec=sandbox-runner-bash
  test("a refusal becomes one line naming the operation and its target, and saying the command went on", () => {
    assert.equal(landstripNote(BIND), "[sandbox] refused bind [::1]:0: outside what this sandbox allows. The command went on; judge it by its exit status and output.");
    assert.match(landstripNote(WRITE) ?? "", /^\[sandbox\] refused write \/tmp\/x\/out\.txt: outside what this sandbox allows\./);
  });

  test("anything else is left alone: program output, other JSON, landstrip's non-refusals, broken JSON", () => {
    for (const line of [
      "cat: secret.txt: Permission denied",
      '{"state":"info"}',
      '{"kind":"network","code":"NETWORK_ALLOWED","state":"info"}',
      '{"kind":"network","code":"NETWORK_DENIED","state":"error","operation":"connect"}',
      '{"kind":"network","code":"NETWORK_DENIED","state":"info"',
      "",
    ]) {
      assert.equal(landstripNote(line), undefined, line);
    }
  });
});

describe("landstripStderr", () => {
  function collect() {
    const chunks: string[] = [];
    const sink = landstripStderr((data) => chunks.push(data.toString()));
    return { sink, text: () => chunks.join("") };
  }

  test("a refusal split across chunks is rewritten once whole; other lines pass unchanged, in order", () => {
    const { sink, text } = collect();
    sink.write(Buffer.from("before\n" + BIND.slice(0, 30)));
    sink.write(Buffer.from(BIND.slice(30) + "\r\nafter\n"));
    sink.end();
    assert.equal(text(), `before\n${landstripNote(BIND)}\nafter\n`);
    assert.doesNotMatch(text(), /NETWORK_DENIED/);
  });

  test("an unfinished last line is written at the end, as it came", () => {
    const { sink, text } = collect();
    sink.write(Buffer.from("no newline"));
    assert.equal(text(), "", "held until its end arrives");
    sink.end();
    assert.equal(text(), "no newline");
  });
});

describe("networkSummary", () => {
  const base = { root: "/w", allowWrite: true, allowBash: true, readExceptions: [], bashRunner: "/usr/bin/sandbox-exec" } as never as Parameters<typeof networkSummary>[0];

  // openlore: scenario=TheStartupLineSaysAnEmptyListAsks spec=sandbox-runner-bash
  test("an empty list under host questions asks about every host; without questions it is closed", () => {
    assert.equal(networkSummary({ ...base, allowedHosts: [] }), "network: every host asked about");
    assert.equal(networkSummary({ ...base, allowedHosts: [], grants: "never" }), "network closed");
  });

  test("a list names its hosts, and says the others are asked about when they are; no list says nothing", () => {
    assert.equal(networkSummary({ ...base, allowedHosts: ["pypi.org", "github.com"] }), "network only to pypi.org, github.com, other hosts asked about");
    assert.equal(networkSummary({ ...base, allowedHosts: ["pypi.org"], grants: "never" }), "network only to pypi.org");
    assert.equal(networkSummary(base), undefined);
  });

  const mxc = { ...base, bashRunner: "mxc", cacheDir: "D:/cache" } as never as Parameters<typeof networkSummary>[0];
  const cache = ", sandbox cache D:/cache";

  // openlore: scenario=TheLineNamesTheAsyncioLimit spec=sandbox-runner-bash
  test("TheLineNamesTheAsyncioLimit: under MXC on Windows a closed loopback says asyncio cannot start", () => {
    assert.equal(networkSummary({ ...mxc, allowedHosts: ["pypi.org"], grants: "never" }, "win32", [], {}), `network only to pypi.org, loopback closed: Python's asyncio cannot start in the shell${cache}`);
    assert.equal(networkSummary({ ...mxc, hostLoopback: false }, "win32", [], {}), `loopback closed: Python's asyncio cannot start in the shell${cache}`);
  });

  test("under MXC on Windows a private network the user opened is named; closed, the default, it is not", () => {
    assert.equal(
      networkSummary({ ...mxc, privateNetwork: true }, "win32", [], {}),
      `loopback open: services listening on this machine are reachable, private network open: the intranet is reachable, and can reach a command${cache}`,
    );
    assert.doesNotMatch(networkSummary(mxc, "win32", [], {})!, /private network/);
    assert.doesNotMatch(networkSummary({ ...mxc, privateNetwork: true, allowedHosts: ["pypi.org"], grants: "never" }, "win32", [], {})!, /private network/, "under a proxy the list decides");
  });

  test("under MXC on Windows the line names the MSYS2 folders left out of PATH, and nothing when there are none", () => {
    const gitUsr = String.raw`C:\Program Files\Git\usr\bin`;
    assert.ok(networkSummary(mxc, "win32", [gitUsr])!.endsWith(`, MSYS2 folders left out of PATH: ${gitUsr}`));
    assert.doesNotMatch(networkSummary(mxc, "win32", [])!, /MSYS2/);
  });

  test("under MXC on Windows an open loopback says what it reaches; elsewhere nothing is added", () => {
    assert.equal(networkSummary(mxc, "win32", [], {}), `loopback open: services listening on this machine are reachable${cache}`);
    assert.equal(networkSummary({ ...mxc, hostLoopback: true }, "win32", [], {}), `loopback open: services listening on this machine are reachable${cache}`);
    assert.equal(networkSummary(mxc, "linux", [], {}), undefined, "MXC on Linux: a process reaches its own loopback");
    assert.equal(networkSummary({ ...mxc, bashImage: "buildpack-deps:bookworm-scm" }, "win32", [], {}), undefined, "WSLC has its own network");
  });
});

describe("toolchainsFor", () => {
  const base = { root: "C:/w", allowWrite: true, allowBash: true, readExceptions: [] } as never as Parameters<typeof toolchainsFor>[0];

  test("only MXC's process container on Windows gets the sandbox cache; Linux, macOS, WSLC and other runners are unchanged", () => {
    const windows = toolchainsFor({ ...base, bashRunner: "mxc", cacheDir: "D:/cache" } as never, {}, "win32");
    assert.equal(windows?.toolchains.cacheDir, "D:/cache");
    assert.equal(toolchainsFor({ ...base, bashRunner: "mxc" } as never, {}, "linux"), undefined);
    assert.equal(toolchainsFor({ ...base, bashRunner: "mxc" } as never, {}, "darwin"), undefined);
    assert.equal(toolchainsFor({ ...base, bashRunner: "mxc", bashImage: "buildpack-deps:bookworm-scm" } as never, {}, "win32"), undefined);
    assert.equal(toolchainsFor({ ...base, bashRunner: "C:/tools/landstrip.exe" } as never, {}, "win32"), undefined);
    assert.ok(toolchainsFor({ ...base, bashRunner: "mxc" } as never, {}, "win32")?.toolchains.cacheDir.endsWith("pi-outpost\\sandbox-cache"));
  });
});

describe("bunInstallNote", () => {
  // openlore: scenario=BunInstallsFailureIsExplained spec=sandbox-runner-bash
  test("says what fails, what still works, and to run the install outside without retrying", () => {
    const note = bunInstallNote();
    assert.match(note, /bun cannot install packages in this sandbox/);
    assert.match(note, /bun run, bun test and bun <file> work/);
    assert.match(note, /outside the sandbox; do not retry/);
  });
});
