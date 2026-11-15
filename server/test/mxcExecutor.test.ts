/**
 * Where `"mxc"` finds MXC's executor: the installed package's, for this architecture, else
 * the one beside a standalone executable.
 */
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";
import { BUNDLED_MXC, bundledMxcExecutor, MXC_EXECUTOR_NAME, MXC_LINUX_EXECUTOR_NAME, MXC_MAC_EXECUTOR_NAME, mxcExecutorName, mxcMissingReason, mxcSupportsArch, isMxcExecutorPath, mxcSdkInstalled, mxcSdkMissingReason } from "../src/mxcExecutor.ts";

const pkg = path.resolve("/opt/app/node_modules/@microsoft/mxc-sdk");
const manifest = path.join(pkg, "package.json");
const exe = path.resolve("/opt/standalone/pi-outpost.exe");
const beside = path.join(path.dirname(exe), MXC_EXECUTOR_NAME);

describe("bundledMxcExecutor", () => {
  // openlore: scenario=MxcNamesTheBundledExecutor spec=sandbox-runner-bash
  test("the installed package's executor for this architecture comes first", () => {
    const all = new Set([path.join(pkg, "bin", "x64", MXC_EXECUTOR_NAME), path.join(pkg, "bin", "arm64", MXC_EXECUTOR_NAME), beside]);
    const lookup = { platform: "win32" as const, execPath: exe, packageManifest: () => manifest, exists: (file: string) => all.has(file) };
    assert.equal(bundledMxcExecutor({ ...lookup, arch: "x64" }), path.join(pkg, "bin", "x64", MXC_EXECUTOR_NAME));
    assert.equal(bundledMxcExecutor({ ...lookup, arch: "arm64" }), path.join(pkg, "bin", "arm64", MXC_EXECUTOR_NAME));
  });

  // openlore: scenario=AStandaloneExecutableFindsTheExecutorBesideIt spec=sandbox-runner-bash
  test("without the package, the executor beside the running executable", () => {
    const found = bundledMxcExecutor({ platform: "win32", arch: "x64", execPath: exe, packageManifest: () => undefined, exists: (file) => file === beside });
    assert.equal(found, beside);
  });

  test("nothing when neither is there, or for an architecture the package does not carry", () => {
    assert.equal(bundledMxcExecutor({ platform: "win32", arch: "x64", execPath: exe, packageManifest: () => manifest, exists: () => false }), undefined);
    assert.equal(bundledMxcExecutor({ platform: "win32", arch: "ia32", execPath: exe, packageManifest: () => manifest, exists: () => true }), undefined);
    assert.equal(bundledMxcExecutor({ platform: "freebsd", arch: "x64", execPath: exe, packageManifest: () => manifest, exists: () => true }), undefined, "no executor for that platform");
  });

  // openlore: scenario=MxcNamesTheLinuxExecutor spec=sandbox-runner-bash
  test("MxcNamesTheLinuxExecutor: on Linux, the package's lxc-exec for this architecture", () => {
    const all = new Set([path.join(pkg, "bin", "x64", MXC_LINUX_EXECUTOR_NAME), path.join(pkg, "bin", "arm64", MXC_LINUX_EXECUTOR_NAME), path.join(pkg, "bin", "x64", MXC_EXECUTOR_NAME)]);
    const lookup = { platform: "linux" as const, execPath: exe, packageManifest: () => manifest, exists: (file: string) => all.has(file) };
    assert.equal(bundledMxcExecutor({ ...lookup, arch: "x64" }), path.join(pkg, "bin", "x64", MXC_LINUX_EXECUTOR_NAME));
    assert.equal(bundledMxcExecutor({ ...lookup, arch: "arm64" }), path.join(pkg, "bin", "arm64", MXC_LINUX_EXECUTOR_NAME));
    assert.equal(mxcExecutorName("linux"), "lxc-exec");
    assert.equal(mxcExecutorName("win32"), "wxc-exec.exe");
  });

  // openlore: scenario=MxcNamesTheMacOsExecutor spec=sandbox-runner-bash
  test("MxcNamesTheMacOsExecutor: on Apple silicon, the package's mxc-exec-mac; on an Intel Mac, none", () => {
    // The package carries bin/x64 too, with Linux's and Windows' executors in it: never a Mac's.
    const all = new Set([path.join(pkg, "bin", "arm64", MXC_MAC_EXECUTOR_NAME), path.join(pkg, "bin", "x64", MXC_LINUX_EXECUTOR_NAME), path.join(pkg, "bin", "x64", MXC_MAC_EXECUTOR_NAME)]);
    const lookup = { platform: "darwin" as const, execPath: exe, packageManifest: () => manifest, exists: (file: string) => all.has(file) };
    assert.equal(bundledMxcExecutor({ ...lookup, arch: "arm64" }), path.join(pkg, "bin", "arm64", MXC_MAC_EXECUTOR_NAME));
    assert.equal(bundledMxcExecutor({ ...lookup, arch: "x64" }), undefined);
    assert.equal(mxcExecutorName("darwin"), "mxc-exec-mac");
    assert.equal(mxcSupportsArch("darwin", "x64"), false);
    assert.equal(mxcSupportsArch("darwin", "arm64"), true);
    assert.equal(mxcSupportsArch("linux", "x64"), true);
  });

  // openlore: scenario=OnAnIntelMacMxcIsRefused spec=sandbox-runner-bash
  test("OnAnIntelMacMxcIsRefused: the reason names the architecture, not a missing install", () => {
    assert.equal(mxcMissingReason("darwin", "x64", "/usr/local/bin/node"), "MXC has no executor for darwin on x64: on macOS it ships for Apple silicon (arm64) only");
    assert.match(mxcMissingReason("darwin", "arm64", "/usr/local/bin/node"), /not installed for arm64: .* put mxc-exec-mac beside/);
    assert.match(mxcMissingReason("freebsd", "x64", "/usr/local/bin/node"), /no executor for freebsd/);
  });

  test("the real installation: the optional dependency resolves to a file that exists", { skip: !mxcSupportsArch(process.platform, process.arch) || !mxcExecutorName(process.platform) }, () => {
    const found = bundledMxcExecutor();
    assert.ok(found, `@microsoft/mxc-sdk is an optional dependency: "${BUNDLED_MXC}" should resolve in this checkout`);
    assert.equal(path.basename(found), mxcExecutorName(process.platform));
    assert.equal(path.basename(path.dirname(found)), process.arch);
    assert.ok(existsSync(found));
  });
});

describe("MXC in process: whether it can run here", () => {
  const files = (present: string[]) => (file: string) => present.includes(file.replaceAll("\\", "/"));

  test("installed: the SDK's native library for this platform and architecture", () => {
    const manifest = "/n/@microsoft/mxc-sdk/package.json";
    assert.equal(mxcSdkInstalled({ platform: "linux", arch: "x64", packageManifest: () => manifest, exists: files(["/n/@microsoft/mxc-sdk/bin/x64/libmxc_ffi.so"]) }), true);
    assert.equal(mxcSdkInstalled({ platform: "win32", arch: "x64", packageManifest: () => manifest, exists: files(["/n/@microsoft/mxc-sdk/bin/x64/libmxc_ffi.so"]) }), false, "Windows needs its DLL");
    assert.equal(mxcSdkInstalled({ platform: "darwin", arch: "x64", packageManifest: () => manifest, exists: () => true }), false, "macOS: Apple silicon only");
    assert.equal(mxcSdkInstalled({ platform: "freebsd", arch: "x64", packageManifest: () => manifest, exists: () => true }), false);
  });

  test("standalone: the native library, koffi and its platform package beside the executable, all three", () => {
    const beside = ["/app/mxc_ffi.dll", "/app/node_modules/koffi/package.json", "/app/node_modules/@koromix/koffi-win32-x64/package.json"];
    const lookup = (present: string[]) => ({ platform: "win32" as const, arch: "x64", execPath: "/app/pi-outpost.exe", packageManifest: () => undefined, exists: files(present) });
    assert.equal(mxcSdkInstalled(lookup(beside)), true);
    for (const missing of beside) assert.equal(mxcSdkInstalled(lookup(beside.filter((file) => file !== missing))), false, missing);
  });

  test("a path to one of MXC's executors, never the bare word nor another program", () => {
    for (const runner of [String.raw`C:\mxc\wxc-exec.exe`, "./wxc-exec", "/opt/mxc/lxc-exec", "/opt/mxc/mxc-exec-mac", "WXC-EXEC.EXE"]) assert.equal(isMxcExecutorPath(runner), true, runner);
    for (const runner of ["mxc", "./mxc", "/usr/bin/landstrip", "/usr/bin/sandbox-exec", "wxc-exec-old.exe"]) assert.equal(isMxcExecutorPath(runner), false, runner);
  });

  test("why it cannot run, in words a user can act on", () => {
    assert.match(mxcSdkMissingReason("freebsd", "x64", "/x"), /Windows, Linux and macOS only/);
    assert.match(mxcSdkMissingReason("darwin", "x64", "/x"), /Apple silicon/);
    assert.match(mxcSdkMissingReason("win32", "x64", String.raw`C:\app\pi-outpost.exe`), /reinstall pi-outpost with its optional dependencies/);
  });
});
