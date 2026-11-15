/**
 * One record for what the sandbox refused, whatever told it (`sandboxRefusals.ts`). What reaches
 * it from a running command is `confinedBash.test.ts`'s.
 */
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { hostRefusal, landstripRefusal, operationAccess, REFUSAL_COMMAND_MAX, refusalCollector, refusalKey, seatbeltReportRefusals, type Refusal } from "../src/sandboxRefusals.ts";
import { fileReporting } from "../src/sandboxRulesView.ts";

// As landstrip 0.20.26 prints them (abridged to the fields read): `landstripNotes.test.ts`'s.
const BIND = '{"kind":"network","code":"NETWORK_DENIED","state":"info","query_id":"0","operation":"bind","target":"[::1]:0","syscall":"bind","errno":"EACCES","mechanism":"seccomp"}';
const WRITE = '{"kind":"filesystem","code":"FILESYSTEM_DENIED","state":"info","operation":"write","path":"/tmp/x/out.txt","suggested_grant":{"allowWrite":"/tmp/x/out.txt"},"mechanism":"seccomp"}';

describe("landstripRefusal", () => {
  test("a refused file is recorded against its directory, with the access its operation needs", () => {
    assert.deepEqual(landstripRefusal(WRITE, "echo hi > /tmp/x/out.txt", "linux"), { kind: "directory", target: "/tmp/x", access: "write", command: "echo hi > /tmp/x/out.txt" });
    const read = WRITE.replace('"operation":"write"', '"operation":"read"');
    assert.deepEqual(landstripRefusal(read, "cat", "linux"), { kind: "directory", target: "/tmp/x", access: "read", command: "cat" });
  });

  test("a Windows path is taken as one on Windows", () => {
    const line = JSON.stringify({ kind: "filesystem", code: "FILESYSTEM_DENIED", state: "info", operation: "read", path: "C:\\Users\\u\\other\\secret.txt" });
    assert.deepEqual(landstripRefusal(line, "type", "win32"), { kind: "directory", target: "C:\\Users\\u\\other", access: "read", command: "type" });
  });

  test("a refused socket, an unknown operation or a relative path is information only", () => {
    assert.deepEqual(landstripRefusal(BIND, "python3 -m venv .v", "linux"), { kind: "info", target: "[::1]:0", detail: "network bind", command: "python3 -m venv .v" });
    const ioctl = WRITE.replace('"operation":"write"', '"operation":"ioctl"');
    assert.equal(landstripRefusal(ioctl, "x", "linux")?.kind, "info");
    const relative = WRITE.replace('"/tmp/x/out.txt","suggested', '"out.txt","suggested');
    assert.equal(landstripRefusal(relative, "x", "linux")?.kind, "info");
  });

  test("anything that is not one of landstrip's refusals is no refusal", () => {
    for (const line of ["cat: secret.txt: Permission denied", '{"state":"info"}', '{"kind":"network","code":"NETWORK_ALLOWED","state":"info"}', '{"kind":"network","code":"NETWORK_DENIED","state":"error"}', '{"kind":"x","code":"X_DENIED","state":"info"', ""]) {
      assert.equal(landstripRefusal(line, "x", "linux"), undefined, line);
    }
  });

  test("a long command is kept to its start, on one line", () => {
    const refusal = landstripRefusal(WRITE, `a\n${"b".repeat(REFUSAL_COMMAND_MAX * 2)}`, "linux");
    assert.equal(refusal?.command.length, REFUSAL_COMMAND_MAX);
    assert.match(refusal?.command ?? "", /^a b+…$/);
  });
});

describe("hostRefusal", () => {
  test("a host is recorded by its name, without case", () => {
    assert.deepEqual(hostRefusal("Example.COM", "curl"), { kind: "host", target: "example.com", command: "curl" });
  });

  test("what no rule could name is information only: an address, the loopback", () => {
    assert.equal(hostRefusal("10.0.0.1", "curl").kind, "info");
    assert.equal(hostRefusal("localhost", "curl").kind, "info");
  });
});

describe("operationAccess", () => {
  test("writes, reads, and neither", () => {
    assert.equal(operationAccess("unlink"), "write");
    assert.equal(operationAccess("EXEC"), "read");
    assert.equal(operationAccess("ioctl"), undefined);
  });
});

describe("refusalCollector", () => {
  test("each thing once, in order, passed on as it comes", () => {
    const told: Refusal[] = [];
    const collector = refusalCollector((refusal) => told.push(refusal));
    const read: Refusal = { kind: "directory", target: "/a", access: "read", command: "c" };
    collector.add(read);
    collector.add(undefined);
    collector.add({ ...read, command: "other" });
    collector.add({ ...read, access: "write" });
    collector.add({ kind: "host", target: "example.com", command: "c" });
    assert.deepEqual(told.map(refusalKey), ["directory:read:/a", "directory:write:/a", "host:example.com"]);
    assert.deepEqual(collector.all(), told);
  });
});

// As MXC 1.1.0 wrote it on an Apple M1 (`scripts/probes/mxc-capture-denials-mac.mjs`), pids and times dropped.
const SEATBELT_REPORT = {
  denials: [
    { resource: "ipc-posix-shm-read-data:apple.shm.notification_center", resourceType: "other", accessType: "read" },
    { resource: "mach-lookup:com.apple.system.opendirectoryd.libinfo", resourceType: "other", accessType: "unknown" },
    { resource: "/private/var/folders/3n/T/mxc-cd/other/secret.txt", resourceType: "file", accessType: "read" },
    { resource: "/private/var/folders/3n/T/mxc-cd/other/w.txt", resourceType: "file", accessType: "write" },
    { resource: "/private/var/folders/3n/T/mxc-cd/named/secret.txt", resourceType: "file", accessType: "read" },
    { resource: "/Users/me/Documents", resourceType: "file", accessType: "read" },
    { resource: "network-outbound:/private/var/run/mDNSResponder", resourceType: "network", accessType: "unknown" },
    { resource: "mach-lookup:com.apple.pasteboard.1", resourceType: "ui", accessType: "unknown" },
    { resource: "system-info:vfs.disk-space", resourceType: "other", accessType: "unknown" },
  ],
  summary: { exitCode: 0, totalDenials: 9, deniedResourcesTruncated: false },
};

describe("seatbeltReportRefusals", () => {
  const isDirectory = (file: string) => file === "/Users/me/Documents";

  // openlore: scenario=ARefusedFileIsRecordedAgainstItsDirectory spec=sandbox-durable-rules
  test("each refused file is its directory with its access, a refused directory is itself, and nothing that is not a file is kept", () => {
    assert.deepEqual(seatbeltReportRefusals(SEATBELT_REPORT, "cat x", isDirectory), [
      { kind: "directory", target: "/private/var/folders/3n/T/mxc-cd/other", access: "read", command: "cat x" },
      { kind: "directory", target: "/private/var/folders/3n/T/mxc-cd/other", access: "write", command: "cat x" },
      { kind: "directory", target: "/private/var/folders/3n/T/mxc-cd/named", access: "read", command: "cat x" },
      { kind: "directory", target: "/Users/me/Documents", access: "read", command: "cat x" },
    ]);
  });

  test("an access that is neither a read nor a write, a relative path, and a report of another shape give nothing", () => {
    const odd = { denials: [{ resource: "/a/b", resourceType: "file", accessType: "unknown" }, { resource: "b/c", resourceType: "file", accessType: "read" }, { resourceType: "file", accessType: "read" }] };
    assert.deepEqual(seatbeltReportRefusals(odd, "x", isDirectory), []);
    // Windows' report names its list the same; an older shape, or none, is no refusal.
    for (const report of [null, undefined, "text", {}, { deniedResources: SEATBELT_REPORT.denials }]) assert.deepEqual(seatbeltReportRefusals(report, "x", isDirectory), []);
  });

  test("the file system tells a directory from a file when nobody says", () => {
    const [refusal] = seatbeltReportRefusals({ denials: [{ resource: process.cwd(), resourceType: "file", accessType: "read" }] }, "ls");
    assert.equal(refusal?.target, process.cwd().split("\\").join("/"));
  });
});

describe("fileReporting", () => {
  // openlore: scenario=ARunnerThatReportsOnDemandSaysSo spec=sandbox-durable-rules
  test("landstrip outside Windows and MXC on macOS report as it happens, MXC on Windows on demand, MXC on Linux and Seatbelt alone nothing", () => {
    assert.equal(fileReporting("/usr/local/bin/landstrip", "linux"), "reported");
    assert.equal(fileReporting("C:\\tools\\landstrip.exe", "win32"), "not-reported");
    assert.equal(fileReporting("mxc", "darwin"), "reported");
    assert.equal(fileReporting("/opt/sdk/bin/arm64/mxc-exec-mac", "darwin"), "reported");
    assert.equal(fileReporting("mxc", "win32"), "on-demand");
    assert.equal(fileReporting("mxc", "linux"), "not-reported");
    assert.equal(fileReporting("/usr/bin/sandbox-exec", "darwin"), "not-reported");
    assert.equal(fileReporting(undefined, "darwin"), "not-reported");
  });
});
