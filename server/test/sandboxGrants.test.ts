/**
 * Grants: what the agent may ask the user to let a confined command reach, and what it may
 * never ask for, whatever the user would click.
 */
import assert from "node:assert/strict";
import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import { asksAboutHosts } from "../src/sandbox.ts";
import { checkGrantRequest, describeGrant, forbiddenHost, hostGrantsRefusal, mergeGrants, type GrantContext } from "../src/sandboxGrants.ts";

let dir: string;
let context: GrantContext;

before(async () => {
  dir = await realpath(await mkdtemp(path.join(tmpdir(), "grants-")));
  for (const sub of ["home", "home/project", "home/project/.pi", "home/agent", "home/beside", "home/etc"]) await mkdir(path.join(dir, sub));
  await writeFile(path.join(dir, "home", "etc", "pi-outpost.json"), "{}");
  // A link pointing into the agent directory: a junction, which Windows makes without privilege.
  await symlink(path.join(dir, "home", "agent"), path.join(dir, "home", "beside", "into-agent"), process.platform === "win32" ? "junction" : "dir");
  context = {
    root: path.join(dir, "home", "project"),
    allowWrite: true,
    agentDir: path.join(dir, "home", "agent"),
    configFile: path.join(dir, "home", "etc", "pi-outpost.json"),
    home: path.join(dir, "home"),
  };
});

after(async () => {
  if (dir) await rm(dir, { recursive: true, force: true });
});

const refusedTargets = async (request: Parameters<typeof checkGrantRequest>[0]) => {
  const check = await checkGrantRequest(request, context);
  assert.equal(check.ok, false, `expected a refusal: ${JSON.stringify(check)}`);
  return check.ok ? [] : check.refusals;
};

// openlore: scenario=TheAgentDirectoryIsNeverGranted spec=sandbox-approved-grants
describe("TheAgentDirectoryIsNeverGranted", () => {
  test("the agent directory, one holding it, one inside it, and a link into it are refused, naming why", async () => {
    for (const asked of [
      path.join(dir, "home", "agent"),
      path.join(dir, "home", "agent", "sessions"),
      path.join(dir, "home", "beside", "into-agent"),
    ]) {
      const [refusal] = await refusedTargets({ directories: [{ path: asked, access: "read" }] });
      assert.equal(refusal.target, asked);
      assert.match(refusal.why, /agent directory/, asked);
    }
    // The home directory holds the agent directory: refused for that reason first.
    const [holding] = await refusedTargets({ directories: [{ path: path.join(dir, "home"), access: "read" }] });
    assert.match(holding.why, /agent directory|home directory/);
  });

  test("the configuration file, and a directory holding it, are refused", async () => {
    for (const asked of [path.join(dir, "home", "etc"), path.join(dir, "home", "etc", "pi-outpost.json")]) {
      const [refusal] = await refusedTargets({ directories: [{ path: asked, access: "write" }] });
      assert.match(refusal.why, /configuration file/, asked);
    }
  });

  test("one forbidden target refuses the whole request, and every refusal is named", async () => {
    const refusals = await refusedTargets({
      directories: [
        { path: path.join(dir, "home", "beside"), access: "write" },
        { path: path.join(dir, "home", "agent"), access: "read" },
        { path: path.join(dir, "home", "etc"), access: "read" },
      ],
    });
    assert.deepEqual(refusals.map((refusal) => refusal.target), [path.join(dir, "home", "agent"), path.join(dir, "home", "etc")]);
  });
});

// openlore: scenario=BroadOrLocalTargetsAreRefused spec=sandbox-approved-grants
describe("BroadOrLocalTargetsAreRefused", () => {
  test("the home directory itself, a drive's root and a .pi directory are refused", async () => {
    const elsewhere = { ...context, agentDir: undefined, configFile: undefined };
    const refused = async (asked: string) => {
      const check = await checkGrantRequest({ directories: [{ path: asked, access: "read" }] }, elsewhere);
      assert.equal(check.ok, false, asked);
      return check.ok ? "" : check.refusals[0].why;
    };
    assert.match(await refused(path.join(dir, "home")), /home directory/);
    assert.match(await refused(path.parse(dir).root), /drive's root/);
    assert.match(await refused(path.join(dir, "home", "project", ".pi")), /\.pi/);
    assert.match(await refused(path.join(dir, "home", "project", ".pi", "extensions")), /\.pi/);
  });

  test("on Windows, a .pi or agent directory not yet created is refused whatever its case; elsewhere case tells names apart", async () => {
    // Paths that do not exist: realpath cannot give their case, so the check has to fold it.
    const notYet = path.join(dir, "home", "not-yet");
    const windows = { ...context, platform: "win32" as const };
    for (const asked of [path.join(notYet, ".PI", "x"), path.join(notYet, ".Pi"), path.join(dir, "home", "AGENT", "new")]) {
      const check = await checkGrantRequest({ directories: [{ path: asked, access: "write" }] }, windows);
      assert.equal(check.ok, false, `${asked} was granted`);
    }
    const lookalike = await checkGrantRequest({ directories: [{ path: path.join(dir, "home", "Agent-x"), access: "write" }] }, windows);
    assert.ok(lookalike.ok, "a name that only starts like the agent directory is another directory");
    const linux = await checkGrantRequest({ directories: [{ path: path.join(notYet, ".PI", "x"), access: "write" }] }, { ...context, platform: "linux" });
    assert.ok(linux.ok, "on a case-sensitive filesystem .PI is not .pi");
  });

  test("IP literals, loopback names, patterns and malformed names are refused as hosts", () => {
    for (const host of ["127.0.0.1", "10.0.0.8", "::1", "[::1]", "example.com:443", "localhost", "LOCALHOST", "api.localhost", "*.example.com", "example.com.", "https://example.com", ""]) {
      assert.ok(forbiddenHost(host), host);
    }
    for (const host of ["example.com", "files.pythonhosted.org", "a-b.c0"]) assert.equal(forbiddenHost(host), undefined, host);
  });
});

// openlore: scenario=WslcRefusesADirectoryGrant spec=sandbox-approved-grants
test("WslcRefusesADirectoryGrant: a directory grant to bash in a WSLC container is refused, naming the fixed mounts", async () => {
  const plain = await checkGrantRequest({ directories: [{ path: path.join(dir, "home", "beside"), access: "read" }] }, context);
  assert.ok(plain.ok, "allowed without WSLC");
  const check = await checkGrantRequest({ directories: [{ path: path.join(dir, "home", "beside"), access: "read" }] }, { ...context, wslc: true });
  assert.equal(check.ok, false);
  assert.match(check.ok ? "" : check.refusals[0].why, /WSLC container.*mounts are fixed/);
});

// openlore: scenario=AnUnprovenRunnerAsksNothingAboutHosts spec=sandbox-approved-grants
test("AnUnprovenRunnerAsksNothingAboutHosts: hosts are asked about under MXC on Windows, with a list and grants on — nowhere else", () => {
  const sandbox = { root: dir, allowWrite: true, allowBash: true, readExceptions: [], allowedHosts: ["registry.npmjs.org"], bashRunner: "C:\\pi\\bin\\x64\\wxc-exec.exe" };
  assert.equal(asksAboutHosts(sandbox), true);
  for (const bashRunner of ["/app/bin/x64/lxc-exec", "/app/bin/arm64/mxc-exec-mac", "/usr/bin/sandbox-exec"]) {
    assert.equal(asksAboutHosts({ ...sandbox, bashRunner }), false, bashRunner);
  }
  assert.equal(asksAboutHosts({ ...sandbox, grants: "never" }), false, "grants off: the list alone decides");
  assert.equal(asksAboutHosts({ ...sandbox, allowedHosts: undefined }), false, "no list: the network is open, nothing to ask");
});

test("an unlisted host is asked about only under a runner shown to keep a command off other proxies", () => {
  assert.equal(hostGrantsRefusal("C:\\pi\\node_modules\\@microsoft\\mxc-sdk\\bin\\x64\\wxc-exec.exe"), undefined);
  for (const runner of ["/app/bin/x64/lxc-exec", "/app/bin/arm64/mxc-exec-mac", "/usr/bin/sandbox-exec", "/opt/landstrip/bin/landstrip"]) {
    assert.match(hostGrantsRefusal(runner) ?? "", /not yet proven under/, runner);
  }
});

describe("what the sandbox already gives is not asked for", () => {
  test("a readable directory and a writable one are dropped; a relative path is the root's", async () => {
    const check = await checkGrantRequest(
      {
        directories: [
          { path: "src", access: "write" },
          { path: path.join(dir, "home", "project"), access: "read" },
          { path: path.join(dir, "home", "beside"), access: "write" },
          { path: path.join(dir, "home", "beside", "not-yet"), access: "read" },
        ],
      },
      context,
    );
    assert.ok(check.ok, JSON.stringify(check));
    assert.deepEqual(check.grant.hosts, []);
    assert.deepEqual(check.grant.directories, [
      { path: path.join(dir, "home", "beside"), access: "write" },
      { path: path.join(dir, "home", "beside", "not-yet"), access: "read" },
    ]);
  });

  test("with writing off, a write inside the root is asked for", async () => {
    const check = await checkGrantRequest({ directories: [{ path: "out", access: "write" }] }, { ...context, allowWrite: false });
    assert.ok(check.ok);
    assert.deepEqual(check.grant.directories, [{ path: path.join(dir, "home", "project", "out"), access: "write" }]);
  });

  test("merging keeps the wider access, and a grant reads as one line", () => {
    const merged = mergeGrants({ hosts: ["a.com"], directories: [{ path: "/x", access: "read" }] }, { hosts: ["a.com", "b.com"], directories: [{ path: "/x", access: "write" }] });
    assert.deepEqual(merged, { hosts: ["a.com", "b.com"], directories: [{ path: "/x", access: "write" }] });
    assert.equal(describeGrant(merged), "host a.com, host b.com, read-write /x");
  });
});
