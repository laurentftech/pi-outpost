/**
 * Where `"mxc"` finds MXC's executor: the installed package's, for this architecture, else
 * the one beside a standalone executable.
 */
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";
import { BUNDLED_MXC, bundledMxcExecutor, MXC_EXECUTOR_NAME, MXC_LINUX_EXECUTOR_NAME, MXC_MAC_EXECUTOR_NAME, mxcExecutorName, mxcSupportsArch } from "../src/mxcExecutor.ts";

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

  test("the real installation: the optional dependency resolves to a file that exists", { skip: !mxcSupportsArch(process.platform, process.arch) || !mxcExecutorName(process.platform) }, () => {
    const found = bundledMxcExecutor();
    assert.ok(found, `@microsoft/mxc-sdk is an optional dependency: "${BUNDLED_MXC}" should resolve in this checkout`);
    assert.equal(path.basename(found), mxcExecutorName(process.platform));
    assert.equal(path.basename(path.dirname(found)), process.arch);
    assert.ok(existsSync(found));
  });
});
